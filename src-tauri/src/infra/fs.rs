//! ファイルシステム読み取り・env コピー。

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::error::{WtError, WtResult};
use crate::infra::shell::capture;

pub struct Fs;

impl Fs {
    pub fn is_dir(&self, path: &str) -> bool {
        Path::new(path).is_dir()
    }

    pub fn file_sha256(&self, path: &str) -> Option<String> {
        if !Path::new(path).is_file() {
            return None;
        }
        let bytes = std::fs::read(path).ok()?;
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        Some(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
    }

    pub fn vite_bin(&self, webdir: &str) -> Option<String> {
        let vbin = Path::new(webdir).join("node_modules").join(".bin").join("vite");
        if vbin.exists() {
            Some(vbin.to_string_lossy().to_string())
        } else {
            None
        }
    }

    /// du -sk によるディスク使用量（バイト）。取得できなければ 0。
    pub fn dir_size_bytes(&self, path: &str) -> i64 {
        let out = capture(&["du", "-sk", path], None, false).unwrap_or_default();
        out.split_whitespace()
            .next()
            .and_then(|s| s.parse::<i64>().ok())
            .map(|kb| kb * 1024)
            .unwrap_or(0)
    }

    /// .env 系をメインから worktree へコピーする（worktree 側に実体があれば尊重）。
    pub fn copy_env_files(&self, main_web: &str, target_web: &str) -> WtResult<Vec<String>> {
        let main_env = Path::new(main_web).join(".env");
        if !main_env.is_file() {
            return Err(WtError::new(format!(
                "{} が無い（README に従い作成を）",
                main_env.to_string_lossy()
            )));
        }
        let mut copied: Vec<String> = Vec::new();
        let entries = std::fs::read_dir(main_web)?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(".env") {
                continue;
            }
            let src = entry.path();
            if !src.is_file() {
                continue;
            }
            let dst = Path::new(target_web).join(&name);
            if let Ok(meta) = std::fs::symlink_metadata(&dst) {
                if meta.file_type().is_symlink() {
                    let _ = std::fs::remove_file(&dst);
                }
            }
            if !dst.exists() {
                std::fs::copy(&src, &dst)?;
                copied.push(name);
            }
        }
        Ok(copied)
    }
}
