//! Claude Code のローカルセッション履歴を読む（read-only）。
//!
//! 会話は `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` に 1 行 1 イベントで
//! 保存されている。<encoded-cwd> は作業ディレクトリのパスの `/ . _` を `-` に置換したもの。
//! worktree のパスから対象ディレクトリを決定的に導出できる。書き込みは一切しない。

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::domain::models::{ClaudeBlock, ClaudeMessage, ClaudeSession};

const TOOL_TEXT_CAP: usize = 6000;

/// worktree パス → `~/.claude/projects/<encoded>` を返す。
fn projects_dir_for(worktree: &str) -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let enc: String = worktree
        .chars()
        .map(|c| if c == '/' || c == '.' || c == '_' { '-' } else { c })
        .collect();
    Some(PathBuf::from(home).join(".claude").join("projects").join(enc))
}

/// 人間発話とみなせるか（ハーネス注入の system-reminder / command / Caveat は除外）。
fn is_human_text(t: &str) -> bool {
    let s = t.trim_start();
    !s.is_empty()
        && !s.starts_with('<')
        && !s.starts_with("Caveat:")
        && !s.starts_with("[SYSTEM")
}

fn content_text_blocks(content: &Value) -> Vec<String> {
    match content {
        Value::String(s) => vec![s.clone()],
        Value::Array(arr) => arr
            .iter()
            .filter(|b| b.get("type").and_then(|v| v.as_str()) == Some("text"))
            .filter_map(|b| b.get("text").and_then(|v| v.as_str()).map(String::from))
            .collect(),
        _ => vec![],
    }
}

/// worktree に紐づくセッション一覧（新しい順）。
pub fn sessions(worktree: &str) -> Vec<ClaudeSession> {
    let dir = match projects_dir_for(worktree) {
        Some(d) => d,
        None => return vec![],
    };
    let rd = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    let mut out: Vec<ClaudeSession> = Vec::new();
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if let Some(s) = summarize(&path, &id) {
            out.push(s);
        }
    }
    out.sort_by(|a, b| b.last_active.cmp(&a.last_active));
    out
}

fn summarize(path: &Path, id: &str) -> Option<ClaudeSession> {
    let content = fs::read_to_string(path).ok()?;
    let mut first_human = String::new();
    let mut custom_title = String::new();
    let mut last_prompt = String::new();
    let mut started = String::new();
    let mut last = String::new();
    let mut user_count = 0i64;
    let mut assistant_count = 0i64;
    let mut branch = String::new();
    for line in content.lines() {
        let d: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(ts) = d.get("timestamp").and_then(|v| v.as_str()) {
            if started.is_empty() {
                started = ts.to_string();
            }
            last = ts.to_string();
        }
        if let Some(b) = d.get("gitBranch").and_then(|v| v.as_str()) {
            if !b.is_empty() {
                branch = b.to_string();
            }
        }
        let t = d.get("type").and_then(|v| v.as_str()).unwrap_or("");
        // Claude Code が付ける人間可読タイトル（最後のものを採用）
        if t == "custom-title" {
            if let Some(ct) = d.get("customTitle").and_then(|v| v.as_str()) {
                if !ct.trim().is_empty() {
                    custom_title = ct.trim().to_string();
                }
            }
            continue;
        }
        if t == "last-prompt" {
            if let Some(lp) = d.get("lastPrompt").and_then(|v| v.as_str()) {
                if last_prompt.is_empty() && !lp.trim().is_empty() {
                    last_prompt = lp.trim().to_string();
                }
            }
            continue;
        }
        let role = d
            .get("message")
            .and_then(|m| m.get("role"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if t == "assistant" {
            assistant_count += 1;
        } else if t == "user" && role == "user" {
            if let Some(content) = d.get("message").and_then(|m| m.get("content")) {
                let human: Vec<String> = content_text_blocks(content)
                    .into_iter()
                    .filter(|s| is_human_text(s) && !s.contains("<command-name>"))
                    .collect();
                if !human.is_empty() {
                    user_count += 1;
                    if first_human.is_empty() {
                        first_human = human[0].trim().lines().next().unwrap_or("").chars().take(90).collect();
                    }
                }
            }
        }
    }
    if started.is_empty() && custom_title.is_empty() && first_human.is_empty() {
        return None; // 実質空のセッションは出さない
    }
    // タイトル優先度: Claude 付与タイトル > 最初の依頼文の1行目 > lastPrompt の1行目
    let title = if !custom_title.is_empty() {
        custom_title
    } else if !first_human.is_empty() {
        first_human
    } else if !last_prompt.is_empty() {
        last_prompt.lines().next().unwrap_or("").chars().take(90).collect()
    } else {
        "(タイトルなし)".to_string()
    };
    Some(ClaudeSession {
        id: id.to_string(),
        title,
        started,
        last_active: last,
        user_count,
        assistant_count,
        branch,
    })
}

/// `<command-name>/foo</command-name> ... <command-args>bar</command-args>` から
/// 表示用のコマンド行 `/foo bar` を取り出す。
fn extract_command(text: &str) -> Option<String> {
    let name = between(text, "<command-name>", "</command-name>")?;
    let args = between(text, "<command-args>", "</command-args>").unwrap_or_default();
    let name = name.trim();
    let args = args.trim();
    if name.is_empty() {
        return None;
    }
    Some(if args.is_empty() { name.to_string() } else { format!("{name} {args}") })
}

/// Edit/Write/MultiEdit の入力を (ファイル名, unified diff 風テキスト) に変換する。
/// diff ヘッダ（---/+++/@@）は DiffView 側で解釈される。
fn edit_diff(input: &Value, tool: &str) -> Option<(String, String)> {
    let file = input.get("file_path").and_then(|v| v.as_str())?;
    let base = file.rsplit('/').next().unwrap_or(file).to_string();
    let mut out = format!("--- {file}\n+++ {file}\n");
    let hunk = |old: &str, new: &str| -> String {
        let mut s = String::from("@@ @@\n");
        for l in old.split('\n') {
            s.push('-');
            s.push_str(l);
            s.push('\n');
        }
        for l in new.split('\n') {
            s.push('+');
            s.push_str(l);
            s.push('\n');
        }
        s
    };
    match tool {
        "Write" => {
            let content = input.get("content").and_then(|v| v.as_str()).unwrap_or("");
            out.push_str("@@ @@\n");
            for l in content.split('\n') {
                out.push('+');
                out.push_str(l);
                out.push('\n');
            }
        }
        "MultiEdit" => {
            let edits = input.get("edits").and_then(|v| v.as_array())?;
            for e in edits {
                let o = e.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
                let n = e.get("new_string").and_then(|v| v.as_str()).unwrap_or("");
                out.push_str(&hunk(o, n));
            }
        }
        "Edit" => {
            let o = input.get("old_string").and_then(|v| v.as_str())?;
            let n = input.get("new_string").and_then(|v| v.as_str()).unwrap_or("");
            out.push_str(&hunk(o, n));
        }
        _ => return None,
    }
    Some((base, out))
}

fn between(s: &str, open: &str, close: &str) -> Option<String> {
    let i = s.find(open)? + open.len();
    let j = s[i..].find(close)? + i;
    Some(s[i..j].to_string())
}

fn truncate(s: &str) -> String {
    if s.len() <= TOOL_TEXT_CAP {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(TOOL_TEXT_CAP).collect();
        t.push_str("\n… (省略)");
        t
    }
}

fn stringify(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(arr) => arr
            .iter()
            .map(|b| {
                if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                    t.to_string()
                } else {
                    b.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        other => serde_json::to_string_pretty(other).unwrap_or_default(),
    }
}

/// user のテキストを種別判定して push する。コマンド呼び出しやユーザー中断は
/// 専用ブロックにし、system-reminder 等のハーネス注入は落とす。
fn push_user_text(blocks: &mut Vec<ClaudeBlock>, text: &str) {
    if text.contains("[Request interrupted by user") || text.contains("interrupted by the user") {
        blocks.push(ClaudeBlock { kind: "interrupted".into(), text: "ユーザーによる停止".into(), name: None });
        return;
    }
    if text.contains("<command-name>") {
        if let Some(cmd) = extract_command(text) {
            blocks.push(ClaudeBlock { kind: "command".into(), text: cmd, name: None });
        }
        return;
    }
    // スキル読み込み時に注入される SKILL.md 本文（"Base directory for this skill: …"）は
    // 丸ごと出さず、スキル名だけ見せて本文は折りたたむ。
    let trimmed = text.trim_start();
    if let Some(rest) = trimmed.strip_prefix("Base directory for this skill:") {
        let name = rest.lines().next().unwrap_or("").trim().rsplit('/').next().unwrap_or("skill").to_string();
        blocks.push(ClaudeBlock { kind: "skill".into(), text: truncate(trimmed), name: Some(name) });
        return;
    }
    if is_human_text(text) {
        blocks.push(ClaudeBlock { kind: "text".into(), text: text.to_string(), name: None });
    }
}

fn blocks_of(content: &Value) -> Vec<ClaudeBlock> {
    let mut blocks: Vec<ClaudeBlock> = Vec::new();
    match content {
        Value::String(s) => push_user_text(&mut blocks, s),
        Value::Array(arr) => {
            for b in arr {
                let ty = b.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match ty {
                    "text" => {
                        let t = b.get("text").and_then(|v| v.as_str()).unwrap_or("");
                        push_user_text(&mut blocks, t);
                    }
                    "thinking" => {
                        // 拡張思考は本文が保存されず空のことがある。空なら出さない。
                        let t = b.get("thinking").and_then(|v| v.as_str()).unwrap_or("");
                        if !t.trim().is_empty() {
                            blocks.push(ClaudeBlock { kind: "thinking".into(), text: t.to_string(), name: None });
                        }
                    }
                    "tool_use" => {
                        let name = b.get("name").and_then(|v| v.as_str()).unwrap_or("tool").to_string();
                        let input = b.get("input");
                        // Skill 呼び出しは生 JSON ではなく「スキル: 名前」に集約
                        if name == "Skill" {
                            let skill = input.and_then(|v| v.get("skill")).and_then(|v| v.as_str()).unwrap_or("skill");
                            let args = input.and_then(|v| v.get("args")).and_then(|v| v.as_str()).unwrap_or("");
                            blocks.push(ClaudeBlock { kind: "skill".into(), text: truncate(args), name: Some(skill.to_string()) });
                        } else if let Some(edit) = input.and_then(|v| edit_diff(v, &name)) {
                            blocks.push(ClaudeBlock { kind: "edit".into(), text: truncate(&edit.1), name: Some(edit.0) });
                        } else {
                            let text = input.map(|v| serde_json::to_string_pretty(v).unwrap_or_default()).unwrap_or_default();
                            blocks.push(ClaudeBlock { kind: "tool_use".into(), text: truncate(&text), name: Some(name) });
                        }
                    }
                    "tool_result" => {
                        let text = b.get("content").map(stringify).unwrap_or_default();
                        blocks.push(ClaudeBlock { kind: "tool_result".into(), text: truncate(&text), name: None });
                    }
                    "image" => {
                        blocks.push(ClaudeBlock { kind: "image".into(), text: "[画像]".into(), name: None });
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    blocks
}

/// 1 セッションの会話（user/assistant のみ、ブロック単位）。read-only。
pub fn transcript(worktree: &str, session: &str) -> Vec<ClaudeMessage> {
    let dir = match projects_dir_for(worktree) {
        Some(d) => d,
        None => return vec![],
    };
    let path = dir.join(format!("{session}.jsonl"));
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut msgs: Vec<ClaudeMessage> = Vec::new();
    for line in content.lines() {
        let d: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let t = d.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if t != "user" && t != "assistant" {
            continue;
        }
        let content = match d.get("message").and_then(|m| m.get("content")) {
            Some(c) => c,
            None => continue,
        };
        let blocks = blocks_of(content);
        if blocks.is_empty() {
            continue;
        }
        msgs.push(ClaudeMessage {
            role: t.to_string(),
            timestamp: d.get("timestamp").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            blocks,
        });
    }
    msgs
}
