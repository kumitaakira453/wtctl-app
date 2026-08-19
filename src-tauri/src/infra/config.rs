//! 設定（config.json）の読み書きと、そこからのリポジトリ解決。
//!
//! 設定・状態は XDG Base Directory 準拠の標準の場所に置く（各自ローカル専用）。
//!   - 設定: $XDG_CONFIG_HOME/wtctl/config.json（既定 ~/.config/wtctl/config.json）
//!   - 状態: $XDG_STATE_HOME/wtctl（既定 ~/.local/state/wtctl）

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::error::{WtError, WtResult};

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

fn xdg_dir(env: &str, default_subpath: &[&str]) -> PathBuf {
    let base = match std::env::var_os(env) {
        Some(v) if !v.is_empty() => PathBuf::from(v),
        _ => {
            let mut p = home();
            for seg in default_subpath {
                p.push(seg);
            }
            p
        }
    };
    base.join("wtctl")
}

pub fn config_dir() -> PathBuf {
    xdg_dir("XDG_CONFIG_HOME", &[".config"])
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

pub fn state_dir() -> PathBuf {
    xdg_dir("XDG_STATE_HOME", &[".local", "state"])
}

pub fn load_config() -> Map<String, Value> {
    let path = config_path();
    if !path.exists() {
        return Map::new();
    }
    match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(m)) => m,
            _ => Map::new(),
        },
        Err(_) => Map::new(),
    }
}

pub fn save_config(config: &Map<String, Value>) -> WtResult<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let text = serde_json::to_string_pretty(&Value::Object(config.clone()))?;
    std::fs::write(config_path(), text)?;
    Ok(())
}

fn expanduser(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        home().join(rest)
    } else if path == "~" {
        home()
    } else {
        PathBuf::from(path)
    }
}

/// worktree を作成する親ディレクトリ。config の `worktree_dir`、既定は
/// `<repo>/.claude/worktrees`。相対パスは repo からの相対とみなす。
pub fn resolve_worktree_dir(repo: &str) -> String {
    if let Some(Value::String(s)) = load_config().get("worktree_dir") {
        if !s.trim().is_empty() {
            let p = expanduser(s);
            return if p.is_absolute() {
                p.to_string_lossy().to_string()
            } else {
                Path::new(repo).join(p).to_string_lossy().to_string()
            };
        }
    }
    Path::new(repo).join(".claude").join("worktrees").to_string_lossy().to_string()
}

/// config.json の `repo` から wasurenai リポジトリのパスを解決する。
/// 設定が無い/不正なら案内付きでエラーにする。
pub fn resolve_repo() -> WtResult<String> {
    let configured = match load_config().get("repo") {
        Some(Value::String(s)) if !s.trim().is_empty() => s.clone(),
        _ => {
            return Err(WtError::new(format!(
                "{} に repo を設定してください（設定画面から）",
                config_path().to_string_lossy()
            )));
        }
    };
    let repo = expanduser(&configured);
    if !repo.join("compose.yaml").is_file() {
        return Err(WtError::new(format!(
            "repo に compose.yaml がありません: {}",
            repo.to_string_lossy()
        )));
    }
    if !repo.join("backend").join("bff").is_dir() {
        return Err(WtError::new(format!(
            "repo が wasurenai リポジトリではないようです: {}（backend/bff が無い）",
            repo.to_string_lossy()
        )));
    }
    Ok(repo.to_string_lossy().to_string())
}
