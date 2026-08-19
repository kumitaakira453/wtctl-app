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
    let mut title = String::new();
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
                    .filter(|s| is_human_text(s))
                    .collect();
                if !human.is_empty() {
                    user_count += 1;
                    if title.is_empty() {
                        title = human[0].trim().chars().take(90).collect();
                    }
                }
            }
        }
    }
    if started.is_empty() && title.is_empty() {
        return None; // 実質空のセッションは出さない
    }
    Some(ClaudeSession {
        id: id.to_string(),
        title: if title.is_empty() { "(タイトルなし)".to_string() } else { title },
        started,
        last_active: last,
        user_count,
        assistant_count,
        branch,
    })
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

fn blocks_of(content: &Value) -> Vec<ClaudeBlock> {
    let mut blocks: Vec<ClaudeBlock> = Vec::new();
    match content {
        Value::String(s) => {
            if is_human_text(s) {
                blocks.push(ClaudeBlock { kind: "text".into(), text: s.clone(), name: None });
            }
        }
        Value::Array(arr) => {
            for b in arr {
                let ty = b.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match ty {
                    "text" => {
                        let t = b.get("text").and_then(|v| v.as_str()).unwrap_or("");
                        if is_human_text(t) {
                            blocks.push(ClaudeBlock { kind: "text".into(), text: t.to_string(), name: None });
                        }
                    }
                    "thinking" => {
                        let t = b.get("thinking").and_then(|v| v.as_str()).unwrap_or("");
                        blocks.push(ClaudeBlock { kind: "thinking".into(), text: t.to_string(), name: None });
                    }
                    "tool_use" => {
                        let name = b.get("name").and_then(|v| v.as_str()).unwrap_or("tool").to_string();
                        let input = b.get("input").map(|v| serde_json::to_string_pretty(v).unwrap_or_default()).unwrap_or_default();
                        blocks.push(ClaudeBlock { kind: "tool_use".into(), text: truncate(&input), name: Some(name) });
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
