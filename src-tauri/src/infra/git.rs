//! git CLI アダプタ。

use std::collections::{HashMap, HashSet};

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

    /// base..HEAD のコミット一覧（新しい順）。base 未検出時は直近 30 件。
    /// -z でコミット間を NUL 区切りにし、本文（%b）の改行に対応する。
    pub fn commit_log(&self, worktree: &str) -> Vec<crate::domain::models::CommitInfo> {
        let fmt = format!("--format=%H{S}%h{S}%s{S}%an{S}%cr{S}%b", S = MIGRATION_SEP);
        let range = self.merge_base(worktree).map(|b| format!("{b}..HEAD"));
        let mut args: Vec<&str> = vec!["git", "-C", worktree, "log", "-z", &fmt];
        match &range {
            Some(r) => args.push(r),
            None => args.push("-30"),
        }
        let out = capture(&args, None, false).unwrap_or_default();
        out.split('\0')
            .filter(|r| !r.trim().is_empty())
            .filter_map(|rec| {
                let p: Vec<&str> = rec.splitn(6, MIGRATION_SEP).collect();
                if p.len() < 5 {
                    return None;
                }
                Some(crate::domain::models::CommitInfo {
                    sha: p[0].to_string(),
                    short_sha: p[1].to_string(),
                    subject: p[2].to_string(),
                    author: p[3].to_string(),
                    rel: p[4].to_string(),
                    body: p.get(5).unwrap_or(&"").trim().to_string(),
                })
            })
            .collect()
    }

    /// 1 コミット（または未コミット="WORKING"）で変わったファイル一覧。
    pub fn commit_files(&self, worktree: &str, sha: &str) -> Vec<crate::domain::models::FileChange> {
        use crate::domain::models::FileChange;
        if sha == "WORKING" {
            return self.working_files(worktree);
        }
        // committed: name-status（種別・パス）と numstat（増減）を突き合わせる
        let ns = capture(
            &[
                "git", "-c", "core.quotePath=false", "-C", worktree, "show", "--format=",
                "--name-status", "-M", sha,
            ],
            None,
            false,
        )
        .unwrap_or_default();
        let nums = self.numstat_map(&[
            "git", "-c", "core.quotePath=false", "-C", worktree, "show", "--format=", "--numstat",
            "-M", sha,
        ]);
        let mut files: Vec<FileChange> = Vec::new();
        for line in ns.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let cols: Vec<&str> = line.splitn(2, '\t').collect();
            if cols.len() < 2 {
                continue;
            }
            let status = cols[0].chars().next().unwrap_or('M').to_string();
            let path = cols[1].split('\t').last().unwrap_or(cols[1]).to_string();
            let (add, del) = nums.get(&path).copied().unwrap_or((0, 0));
            files.push(FileChange { status, path, additions: add, deletions: del });
        }
        files.sort_by(|a, b| a.path.cmp(&b.path));
        files
    }

    /// 作業ツリーの変更ファイル一覧（追跡変更 + 未追跡を個別ファイルとして列挙）。
    fn working_files(&self, worktree: &str) -> Vec<crate::domain::models::FileChange> {
        use crate::domain::models::FileChange;
        let nums = self.numstat_map(&[
            "git", "-c", "core.quotePath=false", "-C", worktree, "diff", "HEAD", "--numstat", "-M",
        ]);
        let mut files: Vec<FileChange> = Vec::new();
        // 追跡ファイルの変更
        let ns = capture(
            &[
                "git", "-c", "core.quotePath=false", "-C", worktree, "diff", "HEAD",
                "--name-status", "-M",
            ],
            None,
            false,
        )
        .unwrap_or_default();
        for line in ns.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let cols: Vec<&str> = line.splitn(2, '\t').collect();
            if cols.len() < 2 {
                continue;
            }
            let status = cols[0].chars().next().unwrap_or('M').to_string();
            let path = cols[1].split('\t').last().unwrap_or(cols[1]).to_string();
            let (add, del) = nums.get(&path).copied().unwrap_or((0, 0));
            files.push(FileChange { status, path, additions: add, deletions: del });
        }
        // 未追跡ファイル（ディレクトリではなく個別ファイル単位）
        let others = capture(
            &[
                "git", "-c", "core.quotePath=false", "-C", worktree, "ls-files", "--others",
                "--exclude-standard",
            ],
            None,
            false,
        )
        .unwrap_or_default();
        for path in others.lines() {
            if path.trim().is_empty() {
                continue;
            }
            files.push(FileChange {
                status: "?".to_string(),
                path: path.to_string(),
                additions: 0,
                deletions: 0,
            });
        }
        files.sort_by(|a, b| a.path.cmp(&b.path));
        files
    }

    /// numstat 出力を path -> (add, del) にする（rename 記法は新パスに正規化）。
    fn numstat_map(&self, args: &[&str]) -> HashMap<String, (i64, i64)> {
        let mut map: HashMap<String, (i64, i64)> = HashMap::new();
        for line in capture(args, None, false).unwrap_or_default().lines() {
            let cols: Vec<&str> = line.splitn(3, '\t').collect();
            if cols.len() < 3 {
                continue;
            }
            let add = cols[0].parse::<i64>().unwrap_or(-1);
            let del = cols[1].parse::<i64>().unwrap_or(-1);
            map.insert(normalize_rename_path(cols[2]), (add, del));
        }
        map
    }

    /// 指定ファイルの unified diff（コミットヘッダなし）。sha="WORKING" は作業ツリー差分。
    /// WORKING で追跡差分が空（=未追跡ファイル）のときは全追加として表示する。
    pub fn commit_diff(&self, worktree: &str, sha: &str, path: &str) -> String {
        if sha == "WORKING" {
            let tracked = capture(
                &["git", "-c", "core.quotePath=false", "-C", worktree, "diff", "HEAD", "--", path],
                None,
                false,
            )
            .unwrap_or_default();
            if !tracked.trim().is_empty() {
                return tracked;
            }
            // 未追跡ファイル: /dev/null との差分で全追加表示にする（--no-index は差分ありで exit 1）
            return capture(
                &[
                    "git", "-c", "core.quotePath=false", "-C", worktree, "diff", "--no-index",
                    "--", "/dev/null", path,
                ],
                None,
                false,
            )
            .unwrap_or_default();
        }
        capture(
            &["git", "-c", "core.quotePath=false", "-C", worktree, "show", "--format=", "-M", sha, "--", path],
            None,
            false,
        )
        .unwrap_or_default()
    }
}

/// numstat の rename 記法 `dir/{old => new}/file` を新パスに正規化する。
fn normalize_rename_path(raw: &str) -> String {
    if let Some(open) = raw.find('{') {
        if let Some(close) = raw[open..].find('}') {
            let close = open + close;
            let inner = &raw[open + 1..close];
            let new = inner.split("=>").nth(1).unwrap_or(inner).trim();
            return format!("{}{}{}", &raw[..open], new, &raw[close + 1..]).replace("//", "/");
        }
    }
    if let Some((_, rhs)) = raw.split_once(" => ") {
        return rhs.trim().to_string();
    }
    raw.trim().to_string()
}

fn is_migration_file(name: &str) -> bool {
    // ^\d{4}_.*\.py$
    if !name.ends_with(".py") || name.len() < 5 {
        return false;
    }
    let bytes = name.as_bytes();
    bytes[..4].iter().all(|b| b.is_ascii_digit()) && bytes[4] == b'_'
}
