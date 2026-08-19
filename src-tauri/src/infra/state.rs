//! 状態ファイル（compose override / swaps / vite 追跡 / npm ci キャッシュ）の管理。
//!
//! 全て state ディレクトリ以下に置き、monorepo 内には一切書かない。現在の mount 状態の
//! 真実源は docker inspect であり、swaps.json は BE の意図の記録に留める。

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::domain::models::ViteProcess;
use crate::domain::naming::image_suffix;
use crate::domain::topology::{group, service};
use crate::error::WtResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapInfo {
    pub wt: String,
    #[serde(default)]
    pub build: bool,
}

pub type Swaps = BTreeMap<String, SwapInfo>;

fn canonical(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string())
}

pub struct State {
    dir: PathBuf,
}

impl State {
    pub fn new(dir: &str) -> WtResult<Self> {
        std::fs::create_dir_all(dir)?;
        Ok(Self { dir: PathBuf::from(dir) })
    }

    pub fn override_path(&self) -> String {
        self.dir.join("compose.worktree.local.yaml").to_string_lossy().to_string()
    }

    fn swaps_path(&self) -> PathBuf {
        self.dir.join("swaps.json")
    }

    fn npmci_path(&self, worktree: &str) -> PathBuf {
        self.dir.join(format!("npmci-{}.sha", image_suffix(worktree)))
    }

    fn vite_json(&self, port: u16) -> PathBuf {
        self.dir.join(format!("vite-{port}.json"))
    }

    pub fn vite_log_path(&self, port: u16) -> String {
        self.dir.join(format!("vite-{port}.log")).to_string_lossy().to_string()
    }

    // --- swaps ---
    pub fn load_swaps(&self) -> Swaps {
        let path = self.swaps_path();
        if !path.exists() {
            return Swaps::new();
        }
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Swaps>(&t).ok())
            .unwrap_or_default()
    }

    pub fn save_swaps(&self, swaps: &Swaps) -> WtResult<()> {
        let path = self.swaps_path();
        if swaps.is_empty() {
            if path.exists() {
                std::fs::remove_file(&path)?;
            }
        } else {
            std::fs::write(&path, serde_json::to_string_pretty(swaps)?)?;
        }
        Ok(())
    }

    // --- override 生成 ---
    pub fn render_override(&self, swaps: &Swaps) -> WtResult<()> {
        let path = self.override_path();
        if swaps.is_empty() {
            if Path::new(&path).exists() {
                std::fs::remove_file(&path)?;
            }
            return Ok(());
        }
        let mut lines: Vec<String> = vec!["services:".to_string()];
        for (svc, info) in swaps {
            let worktree = &info.wt;
            let (group_spec, svc_spec) = match (service(svc).and_then(|s| group(s.group)), service(svc)) {
                (Some(g), Some(s)) => (g, s),
                _ => continue,
            };
            lines.push(format!("  {svc}:"));
            if info.build {
                lines.push(format!("    image: {}-wt-{}", group_spec.image, image_suffix(worktree)));
                lines.push("    build:".to_string());
                lines.push(format!("      context: {worktree}"));
                lines.push(format!("      dockerfile: {}", group_spec.dockerfile));
                lines.push("      target: development".to_string());
            }
            lines.push("    volumes:".to_string());
            lines.push(format!("      - {}/{}:/app", worktree, svc_spec.src));
            lines.push("      - /app/.venv".to_string());
        }
        std::fs::write(&path, lines.join("\n") + "\n")?;
        Ok(())
    }

    // --- npm ci キャッシュ ---
    pub fn npmci_cache_matches(&self, worktree: &str, lock_sha: &str) -> bool {
        let path = self.npmci_path(worktree);
        std::fs::read_to_string(&path).map(|s| s.trim() == lock_sha).unwrap_or(false)
    }

    pub fn store_npmci_cache(&self, worktree: &str, lock_sha: &str) -> WtResult<()> {
        std::fs::write(self.npmci_path(worktree), lock_sha)?;
        Ok(())
    }

    // --- vite 追跡 ---
    pub fn vite_records(&self) -> Vec<ViteProcess> {
        let mut names: Vec<String> = match std::fs::read_dir(&self.dir) {
            Ok(rd) => rd
                .flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.starts_with("vite-") && n.ends_with(".json"))
                .collect(),
            Err(_) => vec![],
        };
        names.sort();
        let mut records = Vec::new();
        for name in names {
            if let Ok(text) = std::fs::read_to_string(self.dir.join(&name)) {
                if let Ok(rec) = serde_json::from_str::<ViteProcess>(&text) {
                    records.push(rec);
                }
            }
        }
        records
    }

    pub fn save_vite(&self, record: &ViteProcess) -> WtResult<()> {
        std::fs::write(self.vite_json(record.port), serde_json::to_string(record)?)?;
        Ok(())
    }

    pub fn drop_vite(&self, port: u16) {
        let _ = std::fs::remove_file(self.vite_json(port));
    }

    // --- wtctl が作成した worktree の追跡 ---
    fn created_path(&self) -> PathBuf {
        self.dir.join("created.json")
    }

    pub fn created_worktrees(&self) -> HashSet<String> {
        let path = self.created_path();
        if !path.exists() {
            return HashSet::new();
        }
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
            .map(|v| v.into_iter().collect())
            .unwrap_or_default()
    }

    fn save_created(&self, paths: &HashSet<String>) -> WtResult<()> {
        let path = self.created_path();
        if paths.is_empty() {
            if path.exists() {
                std::fs::remove_file(&path)?;
            }
        } else {
            let mut v: Vec<&String> = paths.iter().collect();
            v.sort();
            std::fs::write(&path, serde_json::to_string_pretty(&v)?)?;
        }
        Ok(())
    }

    pub fn mark_created(&self, path: &str) -> WtResult<()> {
        let mut paths = self.created_worktrees();
        paths.insert(canonical(path));
        self.save_created(&paths)
    }

    pub fn unmark_created(&self, path: &str) -> WtResult<()> {
        let mut paths = self.created_worktrees();
        paths.remove(&canonical(path));
        self.save_created(&paths)
    }
}
