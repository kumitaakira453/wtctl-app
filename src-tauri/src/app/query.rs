//! ダッシュボード描画用の読み取り専用クエリ。

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::Serialize;

use crate::app::core::mount_snapshot;
use crate::app::ctx::Ctx;
use crate::domain::models::{BranchInfo, PrInfo, ServiceMount, VerifyPlan, ViteProcess, Worktree, WorktreeMeta};
use crate::domain::plan::build_plan;
use crate::domain::topology::MAIN_FE_PORT;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    #[serde(flatten)]
    pub wt: Worktree,
    pub is_main: bool,
    pub created: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub worktrees: Vec<WorktreeEntry>,
    pub main_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainFe {
    pub listening: bool,
    pub responding: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveResult {
    pub mounts: Vec<ServiceMount>,
    pub vites: Vec<ViteProcess>,
    pub main_fe: MainFe,
    pub main_fe_port: u16,
    pub stack_up: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaEntry {
    pub path: String,
    pub meta: WorktreeMeta,
    pub plan: VerifyPlan,
}

fn canonical(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string())
}

pub fn list_worktrees(ctx: &Ctx) -> crate::error::WtResult<ListResult> {
    let all = ctx.git.worktrees()?;
    let main_path = ctx.git.main_path()?;
    let main_canon = canonical(&main_path);
    let created = ctx.state.created_worktrees();
    let worktrees = all
        .into_iter()
        .filter(|w| !w.bare)
        .map(|w| {
            let c = canonical(&w.path);
            WorktreeEntry {
                is_main: c == main_canon,
                created: created.contains(&c),
                wt: w,
            }
        })
        .collect();
    Ok(ListResult { worktrees, main_path })
}

/// 生存している Vite だけを返す。死んだ pid の古い記録はここで掃除する。
pub fn vites(ctx: &Ctx) -> Vec<ViteProcess> {
    let mut alive = Vec::new();
    for rec in ctx.state.vite_records() {
        if ctx.process.is_alive(rec.pid, &rec.lstart) {
            alive.push(rec);
        } else {
            ctx.state.drop_vite(rec.port);
        }
    }
    alive
}

pub fn main_fe(ctx: &Ctx) -> MainFe {
    let listening = ctx.process.port_in_use(MAIN_FE_PORT);
    let responding = listening
        && ctx.http.probe(&format!("http://localhost:{MAIN_FE_PORT}/")).is_some();
    MainFe { listening, responding }
}

pub fn live(ctx: &Ctx) -> LiveResult {
    let stack_up = ctx.docker.stack_up();
    let mounts = if stack_up { mount_snapshot(ctx) } else { vec![] };
    LiveResult {
        mounts,
        vites: vites(ctx),
        main_fe: main_fe(ctx),
        main_fe_port: MAIN_FE_PORT,
        stack_up,
    }
}

pub fn plan_for(ctx: &Ctx, worktree: &str) -> VerifyPlan {
    let (paths, base) = ctx.git.changed_paths(worktree);
    build_plan(&paths, base)
}

pub fn meta(ctx: &Ctx, worktree: &str, base: Option<&str>) -> WorktreeMeta {
    let (commit_ts, commit_rel, subject) = ctx.git.last_commit(worktree);
    let (has_upstream, unpushed, behind) = ctx.git.upstream_status(worktree);
    WorktreeMeta {
        commit_ts,
        commit_rel,
        subject,
        ahead: ctx.git.ahead_count(worktree, base),
        dirty: is_dirty(ctx, worktree),
        has_upstream,
        unpushed,
        behind_remote: behind,
    }
}

pub fn is_dirty(ctx: &Ctx, worktree: &str) -> bool {
    !ctx.git.status_porcelain(worktree).trim().is_empty()
}

pub fn disk_size(ctx: &Ctx, worktree: &str) -> i64 {
    ctx.fs.dir_size_bytes(worktree)
}

pub fn branches(ctx: &Ctx) -> crate::error::WtResult<Vec<BranchInfo>> {
    let main = ctx.git.main_path()?;
    let wt_branches: std::collections::HashSet<String> = ctx
        .git
        .worktrees()?
        .into_iter()
        .filter_map(|w| w.branch)
        .collect();
    let prs = ctx.gh.pull_requests(&main);
    Ok(ctx
        .git
        .local_branches(&main)
        .into_iter()
        .map(|(name, ts, rel, subject)| BranchInfo {
            has_worktree: wt_branches.contains(&name),
            pr: prs.get(&name).cloned(),
            name,
            commit_ts: ts,
            commit_rel: rel,
            subject,
        })
        .collect())
}

pub fn pull_requests(ctx: &Ctx) -> crate::error::WtResult<HashMap<String, PrInfo>> {
    let main = ctx.git.main_path()?;
    Ok(ctx.gh.pull_requests(&main))
}

/// worktree ごとの plan+meta を上限 workers の並列で収集する（フェーズ3の並列化）。
pub fn metas_parallel(ctx: &Ctx, paths: Vec<String>, workers: usize) -> Vec<MetaEntry> {
    if paths.is_empty() {
        return vec![];
    }
    let out: Mutex<Vec<MetaEntry>> = Mutex::new(Vec::new());
    let next = AtomicUsize::new(0);
    let n = workers.max(1).min(paths.len());
    std::thread::scope(|s| {
        for _ in 0..n {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= paths.len() {
                    break;
                }
                let p = &paths[i];
                let plan = plan_for(ctx, p);
                let m = meta(ctx, p, plan.base.as_deref());
                out.lock().unwrap().push(MetaEntry {
                    path: p.clone(),
                    meta: m,
                    plan,
                });
            });
        }
    });
    out.into_inner().unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::ctx::Ctx;

    /// config.json が設定済みの環境でのみ実データに対して疎通確認する（未設定なら skip）。
    #[test]
    fn smoke_dashboard() {
        let ctx = match Ctx::load() {
            Ok(c) => c,
            Err(_) => {
                eprintln!("config 未設定のため skip");
                return;
            }
        };
        let list = list_worktrees(&ctx).unwrap();
        assert!(!list.main_path.is_empty());
        let paths: Vec<String> = list.worktrees.iter().map(|w| w.wt.path.clone()).collect();
        let metas = metas_parallel(&ctx, paths, 8);
        eprintln!(
            "worktrees={} metas={} main={}",
            list.worktrees.len(),
            metas.len(),
            list.main_path
        );
    }
}
