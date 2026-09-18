//! ファイルシステム読み取り・env コピー。

use std::path::{Path, PathBuf};

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

    /// worktree の node_modules をメインへの symlink にする。実体が残っていれば捨てる。
    /// 対象は npm workspaces の hoist 先（リポジトリ直下）と、vite がローカル導入される
    /// frontend/web の 2 箇所。作った数を返す。
    pub fn link_node_modules(&self, main: &str, worktree: &str) -> WtResult<usize> {
        let rels = [PathBuf::from("node_modules"), Path::new("frontend").join("web").join("node_modules")];
        let mut made = 0;
        for rel in rels {
            let src = Path::new(main).join(&rel);
            let dst = Path::new(worktree).join(&rel);
            if !src.is_dir() {
                continue;
            }
            match std::fs::symlink_metadata(&dst) {
                // 既存の symlink は貼り直す（別の worktree を指していることがある）
                Ok(meta) if meta.file_type().is_symlink() => std::fs::remove_file(&dst)?,
                // 共有を選んでいる以上、worktree が持っている実体は捨てて置き換える。
                // 残すとメインと worktree の依存が混ざったまま起動して壊れる。
                // lockfile が一致するときしか呼ばれないので、失われる内容は無い。
                Ok(_) => std::fs::remove_dir_all(&dst)?,
                Err(_) => {}
            }
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::os::unix::fs::symlink(&src, &dst)?;
            made += 1;
        }
        Ok(made)
    }

    /// vite の実行ファイルを webdir から root まで遡って探す。npm workspaces は依存を
    /// リポジトリ直下へ hoist することがあり、その場合 frontend/web 側の node_modules は
    /// 空になる。探索は root で打ち切る。worktree はメインの中に置かれるため、
    /// 越えて遡るとメイン側の vite を掴み、依存がメインと worktree で混ざって起動に失敗する。
    pub fn vite_bin(&self, webdir: &str, root: &str) -> Option<String> {
        let root = Path::new(root);
        let mut dir = Path::new(webdir);
        loop {
            let vbin = dir.join("node_modules").join(".bin").join("vite");
            if vbin.exists() {
                return Some(vbin.to_string_lossy().to_string());
            }
            if dir == root {
                return None;
            }
            dir = dir.parent()?;
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
