//! worktree の削除・撤去（restore してから remove、teardown はメインで checkout まで）。

use crate::app::core::{mount_snapshot, stop_vite};
use crate::app::ctx::Ctx;
use crate::domain::models::MountState;
use crate::error::{WtError, WtResult};
use crate::event::{LogEvent, Sink};
use crate::infra::state::Swaps;

fn canonical(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string())
}

/// restore してから worktree を削除する（メインの HEAD は動かさない）。
pub fn delete(ctx: &Ctx, worktree: &str, force: bool, sink: &Sink) -> WtResult<()> {
    let main = validate(ctx, worktree)?;
    if !ctx.git.status_porcelain(worktree).trim().is_empty() && !force {
        return Err(WtError::new("worktree に未コミット変更がある（force で破棄可）"));
    }
    restore_worktree_mounts(ctx, worktree, sink)?;
    stop_worktree_vites(ctx, worktree, sink);
    ctx.git.worktree_remove(&main, worktree, force, sink)?;
    ctx.state.unmark_created(worktree)?;
    let name = worktree.trim_end_matches('/').rsplit('/').next().unwrap_or(worktree);
    sink(LogEvent::success(format!("worktree 削除: {name}")));
    Ok(())
}

/// delete に加えて、メインで該当ブランチへ checkout する。
pub fn teardown(ctx: &Ctx, worktree: &str, force: bool, sink: &Sink) -> WtResult<()> {
    let main = validate(ctx, worktree)?;
    let branch = ctx.git.current_branch(worktree);
    if branch.is_empty() {
        return Err(WtError::new("worktree のブランチを特定できない（detached HEAD）"));
    }
    delete(ctx, worktree, force, sink)?;
    ctx.git.checkout(&main, &branch, sink)?;
    sink(LogEvent::success(format!("メインで {branch} に遷移")));
    Ok(())
}

fn validate(ctx: &Ctx, worktree: &str) -> WtResult<String> {
    let main = ctx.git.main_path()?;
    if canonical(worktree) == canonical(&main) {
        return Err(WtError::new("メインチェックアウトは削除できない"));
    }
    Ok(main)
}

fn restore_worktree_mounts(ctx: &Ctx, worktree: &str, sink: &Sink) -> WtResult<()> {
    let snapshot = mount_snapshot(ctx);
    let target = canonical(worktree);
    let mut stale: Vec<String> = snapshot
        .iter()
        .filter(|m| {
            m.state == MountState::Worktree
                && m.worktree.as_deref().map(|w| canonical(w) == target).unwrap_or(false)
        })
        .map(|m| m.service.clone())
        .collect();
    let swaps = ctx.state.load_swaps();
    for (svc, info) in &swaps {
        if !stale.contains(svc) && canonical(&info.wt) == target {
            stale.push(svc.clone());
        }
    }

    if !stale.is_empty() {
        ctx.docker.compose_up(&stale, false, false, sink)?;
        for svc in &stale {
            if ctx.docker.app_mount(svc).starts_with(&canonical(worktree)) {
                return Err(WtError::new(format!("{svc} の mount が worktree を指したまま")));
            }
        }
        sink(LogEvent::info(format!("BE: mount をメインに復帰: {}", stale.join(" "))));
    }

    let mut remaining: Swaps = Swaps::new();
    for (svc, info) in swaps {
        if canonical(&info.wt) != target {
            remaining.insert(svc, info);
        }
    }
    ctx.state.save_swaps(&remaining)?;
    ctx.state.render_override(&remaining)?;
    Ok(())
}

fn stop_worktree_vites(ctx: &Ctx, worktree: &str, sink: &Sink) {
    let target = canonical(worktree);
    for record in ctx.state.vite_records() {
        if canonical(&record.worktree) == target {
            stop_vite(ctx, sink, &record);
        }
    }
}
