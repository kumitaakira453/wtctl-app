//! git CLI アダプタ。

use std::collections::HashSet;

use crate::domain::models::Worktree;
use crate::error::WtResult;
use crate::event::Sink;
use crate::infra::shell::{capture, stream};

const MIGRATION_SEP: char = '\u{1f}';

pub struct Git {
    repo: String,
}

fn basename(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .to_string()
}

impl Git {
    pub fn new(repo: &str) -> Self {
        Self { repo: repo.to_string() }
    }

    pub fn worktrees(&self) -> WtResult<Vec<Worktree>> {
        let out = capture(
            &["git", "-C", &self.repo, "worktree", "list", "--porcelain"],
            None,
            true,
        )?;
        let mut items: Vec<Worktree> = Vec::new();
        let mut cur: Option<Worktree> = None;
        for line in out.lines() {
            if let Some(path) = line.strip_prefix("worktree ") {
                if let Some(w) = cur.take() {
                    items.push(w);
                }
                cur = Some(Worktree {
                    path: path.to_string(),
                    name: basename(path),
                    branch: None,
                    head: None,
                    locked: false,
                    bare: false,
                    detached: false,
                });
            } else if let Some(w) = cur.as_mut() {
                if let Some(head) = line.strip_prefix("HEAD ") {
                    w.head = Some(head.chars().take(9).collect());
                } else if let Some(b) = line.strip_prefix("branch ") {
                    w.branch = Some(b.replace("refs/heads/", ""));
                } else if line == "detached" {
                    w.detached = true;
                } else if line.starts_with("locked") {
                    w.locked = true;
                } else if line == "bare" {
                    w.bare = true;
                }
            }
        }
        if let Some(w) = cur.take() {
            items.push(w);
        }
        Ok(items)
    }

    pub fn main_path(&self) -> WtResult<String> {
        let items = self.worktrees()?;
        Ok(items
            .first()
            .map(|w| w.path.clone())
            .unwrap_or_else(|| self.repo.clone()))
    }

    pub fn merge_base(&self, worktree: &str) -> Option<String> {
        for base_ref in ["origin/develop", "develop"] {
            if let Ok(out) = capture(
                &["git", "-C", worktree, "merge-base", base_ref, "HEAD"],
                None,
                false,
            ) {
                let t = out.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
        None
    }

    pub fn changed_paths(&self, worktree: &str) -> (HashSet<String>, Option<String>) {
        let mut paths: HashSet<String> = HashSet::new();
        let base = self.merge_base(worktree);
        if let Some(b) = &base {
            if let Ok(diff) = capture(
                &["git", "-C", worktree, "diff", "--name-only", &format!("{b}..HEAD")],
                None,
                false,
            ) {
                for p in diff.lines() {
                    if !p.is_empty() {
                        paths.insert(p.to_string());
                    }
                }
            }
        }
        for line in self.status_porcelain(worktree).lines() {
            if line.trim().is_empty() {
                continue;
            }
            let mut path = if line.len() > 3 { line[3..].to_string() } else { line.to_string() };
            if let Some((_, rhs)) = path.split_once(" -> ") {
                path = rhs.to_string();
            }
            paths.insert(path.trim().to_string());
        }
        (paths, base)
    }

    pub fn status_porcelain(&self, worktree: &str) -> String {
        capture(&["git", "-C", worktree, "status", "--short"], None, false).unwrap_or_default()
    }

    pub fn current_branch(&self, worktree: &str) -> String {
        capture(&["git", "-C", worktree, "branch", "--show-current"], None, false)
            .unwrap_or_default()
            .trim()
            .to_string()
    }

    /// (committer 日時 epoch 秒, 相対表記, 件名)。取得できなければ (0, "?", "")。
    pub fn last_commit(&self, worktree: &str) -> (i64, String, String) {
        let fmt = format!("--format=%ct{MIGRATION_SEP}%cr{MIGRATION_SEP}%s");
        let out = capture(&["git", "-C", worktree, "log", "-1", &fmt], None, false)
            .unwrap_or_default();
        let out = out.trim();
        if out.is_empty() {
            return (0, "?".to_string(), String::new());
        }
        let parts: Vec<&str> = out.split(MIGRATION_SEP).collect();
        let ts = parts.first().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let rel = parts.get(1).unwrap_or(&"").to_string();
        let subject = parts.get(2).unwrap_or(&"").to_string();
        (ts, rel, subject)
    }

    pub fn ahead_count(&self, worktree: &str, base: Option<&str>) -> i64 {
        let base = match base {
            Some(b) => b,
            None => return 0,
        };
        capture(
            &["git", "-C", worktree, "rev-list", "--count", &format!("{base}..HEAD")],
            None,
            false,
        )
        .ok()
        .and_then(|o| o.trim().parse::<i64>().ok())
        .unwrap_or(0)
    }

    /// (upstream 設定あり, 未 push 数=ahead, 未取込数=behind)。
    pub fn upstream_status(&self, worktree: &str) -> (bool, i64, i64) {
        let re = capture(
            &[
                "git", "-C", worktree, "rev-parse", "--abbrev-ref",
                "--symbolic-full-name", "@{u}",
            ],
            None,
            false,
        )
        .unwrap_or_default();
        if re.trim().is_empty() {
            return (false, 0, 0);
        }
        let out = capture(
            &["git", "-C", worktree, "rev-list", "--left-right", "--count", "@{u}...HEAD"],
            None,
            false,
        )
        .unwrap_or_default();
        let nums: Vec<i64> = out.split_whitespace().filter_map(|s| s.parse().ok()).collect();
        let behind = nums.first().copied().unwrap_or(0);
        let ahead = nums.get(1).copied().unwrap_or(0);
        (true, ahead, behind)
    }

    pub fn migration_names_at(&self, worktree: &str, appdir: &str, base: Option<&str>) -> Vec<String> {
        let base = match base {
            Some(b) => b,
            None => return vec![],
        };
        let out = capture(
            &[
                "git", "-C", worktree, "ls-tree", "-r", "--name-only", base, "--",
                &format!("{appdir}/migrations/"),
            ],
            None,
            false,
        )
        .unwrap_or_default();
        let mut names: Vec<String> = out
            .lines()
            .map(basename)
            .filter(|n| is_migration_file(n))
            .map(|n| n.trim_end_matches(".py").to_string())
            .collect();
        names.sort();
        names
    }

    pub fn ref_exists(&self, repo: &str, r: &str) -> bool {
        capture(
            &["git", "-C", repo, "rev-parse", "--verify", "--quiet", &format!("{r}^{{commit}}")],
            None,
            true,
        )
        .is_ok()
    }

    /// ローカルブランチを最新コミット順で返す [(name, committer_ts, relative, subject)]。
    pub fn local_branches(&self, repo: &str) -> Vec<(String, i64, String, String)> {
        let out = capture(
            &[
                "git", "-C", repo, "for-each-ref", "--sort=-committerdate", "refs/heads",
                "--format=%(refname:short)%09%(committerdate:unix)%09%(committerdate:relative)%09%(subject)",
            ],
            None,
            false,
        )
        .unwrap_or_default();
        let mut branches = Vec::new();
        for line in out.lines() {
            let parts: Vec<&str> = line.splitn(4, '\t').collect();
            if parts.len() < 4 {
                continue;
            }
            let ts = parts[1].parse::<i64>().unwrap_or(0);
            branches.push((parts[0].to_string(), ts, parts[2].to_string(), parts[3].to_string()));
        }
        branches
    }

    pub fn worktree_add(&self, main: &str, path: &str, branch: &str, base: Option<&str>, sink: &Sink) -> WtResult<()> {
        match base {
            None => stream(&["git", "-C", main, "worktree", "add", path, branch], None, true, sink),
            Some(b) => stream(&["git", "-C", main, "worktree", "add", "-b", branch, path, b], None, true, sink),
        }
    }

    pub fn worktree_remove(&self, main: &str, worktree: &str, force: bool, sink: &Sink) -> WtResult<()> {
        // Claude セッション等でロックされた worktree は remove できないため先に unlock する
        // （ロックされていなければエラーになるので無視）。
        let _ = capture(&["git", "-C", main, "worktree", "unlock", worktree], None, false);
        let mut cmd = vec!["git", "-C", main, "worktree", "remove"];
        if force {
            cmd.push("--force");
        }
        cmd.push(worktree);
        stream(&cmd, None, true, sink)
    }

    pub fn checkout(&self, main: &str, branch: &str, sink: &Sink) -> WtResult<()> {
        stream(&["git", "-C", main, "checkout", branch], None, true, sink)
    }
}

fn is_migration_file(name: &str) -> bool {
    // ^\d{4}_.*\.py$
    if !name.ends_with(".py") || name.len() < 5 {
        return false;
    }
    let bytes = name.as_bytes();
    bytes[..4].iter().all(|b| b.is_ascii_digit()) && bytes[4] == b'_'
}
