//! スタックの健全性チェックと自動復旧。

use crate::app::core::{mount_snapshot, stop_vite};
use crate::app::ctx::Ctx;
use crate::app::verify;
use crate::domain::models::MountState;
use crate::domain::topology::service;
use crate::error::WtResult;
use crate::event::{LogEvent, Sink};

fn state_label(s: MountState) -> &'static str {
    match s {
        MountState::Main => "main",
        MountState::Worktree => "worktree",
        MountState::Down => "down",
    }
}

pub fn health(ctx: &Ctx, sink: &Sink) -> WtResult<()> {
    let mut issues = 0;
    let mut fixed = 0;
    let snapshot = mount_snapshot(ctx);
    let swaps = ctx.state.load_swaps();

    for mount in &snapshot {
        let svc = &mount.service;
        let in_swaps = swaps.contains_key(svc);
        if mount.state != MountState::Worktree && !in_swaps {
            continue;
        }
        let state_str = ctx.docker.container_state(svc);
        let need_fix = state_str != "running" || (in_swaps && mount.state == MountState::Main);
        if need_fix {
            sink(LogEvent::info(format!(
                "BE: {svc} を復旧（state={state_str}, mount={}）",
                state_label(mount.state)
            )));
            let result = if in_swaps {
                ctx.docker.compose_up(std::slice::from_ref(svc), true, false, sink)
            } else {
                ctx.docker.compose_restart(svc, sink)
            };
            match result {
                Ok(_) => fixed += 1,
                Err(e) => {
                    sink(LogEvent::error(format!("  失敗: {e}")));
                    issues += 1;
                    continue;
                }
            }
        }
        if let Some(port) = service(svc).and_then(|s| s.port) {
            if !ctx.http.wait(&format!("http://localhost:{port}/"), 60, sink) {
                sink(LogEvent::error(format!("BE: {svc} の HTTP 応答が回復しない")));
                issues += 1;
            } else {
                sink(LogEvent::info(format!("BE: {svc} OK")));
            }
        } else {
            sink(LogEvent::info(format!("BE: {svc} OK")));
        }
    }

    for record in ctx.state.vite_records() {
        let url = format!("http://localhost:{}/", record.port);
        if ctx.process.is_alive(record.pid, &record.lstart) && ctx.http.probe(&url).is_some() {
            sink(LogEvent::info(format!("FE: :{} 稼働中 (pid {})", record.port, record.pid)));
            continue;
        }
        sink(LogEvent::info(format!(
            "FE: :{} が停止 → {} から再起動",
            record.port, record.worktree
        )));
        stop_vite(ctx, sink, &record);
        match verify::fe(ctx, &record.worktree, sink) {
            Ok(_) => fixed += 1,
            Err(e) => {
                sink(LogEvent::error(format!("  失敗: {e}")));
                issues += 1;
            }
        }
    }

    if issues > 0 {
        sink(LogEvent::error(format!("health: 未回復 {issues} 件")));
    } else if fixed > 0 {
        sink(LogEvent::success(format!("{fixed} 件を自動復旧")));
    } else {
        sink(LogEvent::success("health 良好"));
    }
    Ok(())
}
