//! BE mount をメインへ戻す（＋FE 停止）。

use crate::app::core::{mount_snapshot, stop_all_vites};
use crate::app::ctx::Ctx;
use crate::domain::models::MountState;
use crate::domain::naming::image_suffix;
use crate::domain::topology::{group_of, service};
use crate::error::{WtError, WtResult};
use crate::event::{LogEvent, Sink};
use crate::infra::state::Swaps;

/// 全 BE を main に戻し、FE も停止する（フル復帰）。
pub fn restore(ctx: &Ctx, sink: &Sink) -> WtResult<()> {
    restore_be_core(ctx, sink)?;
    stop_all_vites(ctx, sink);
    sink(LogEvent::success("restored"));
    Ok(())
}

/// BE の mount だけを main に戻す（FE は止めない）。他 worktree に切り替える前に使う。
pub fn restore_be(ctx: &Ctx, sink: &Sink) -> WtResult<()> {
    let restored = restore_be_core(ctx, sink)?;
    if restored.is_empty() {
        sink(LogEvent::info("差し替え中の BE はありません"));
    } else {
        sink(LogEvent::success(format!("BE を main に復帰: {}", restored.join(" "))));
    }
    Ok(())
}

fn restore_be_core(ctx: &Ctx, sink: &Sink) -> WtResult<Vec<String>> {
    let main = ctx.git.main_path()?;
    let snapshot = mount_snapshot(ctx);
    let mut swapped: Vec<String> = snapshot
        .iter()
        .filter(|m| m.state == MountState::Worktree)
        .map(|m| m.service.clone())
        .collect();
    for svc in ctx.state.load_swaps().keys() {
        if !swapped.contains(svc) {
            swapped.push(svc.clone());
        }
    }

    if !swapped.is_empty() {
        ctx.docker.compose_up(&swapped, false, false, sink)?;
        for svc in &swapped {
            let mount = ctx.docker.app_mount(svc);
            let expect = format!("{}/{}", main, service(svc).map(|s| s.src).unwrap_or(""));
            if mount != expect {
                return Err(WtError::new(format!(
                    "{svc} の mount がメインに戻っていない（{mount}）"
                )));
            }
        }
        sink(LogEvent::info(format!("BE: mount をメインに復帰: {}", swapped.join(" "))));
        cleanup_images(ctx);
    }
    ctx.state.save_swaps(&Swaps::new())?;
    ctx.state.render_override(&Swaps::new())?;
    Ok(swapped)
}

fn cleanup_images(ctx: &Ctx) {
    for (svc, info) in ctx.state.load_swaps() {
        if info.build {
            if let Some(g) = group_of(&svc) {
                ctx.docker.remove_image(&format!("{}-wt-{}", g.image, image_suffix(&info.wt)));
            }
        }
    }
}
