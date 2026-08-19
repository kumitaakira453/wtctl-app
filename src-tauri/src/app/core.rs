//! 複数サービスで共有するコアロジック（mount スナップショット・vite 停止）。

use crate::app::ctx::Ctx;
use crate::domain::models::{MountState, ServiceMount, ViteProcess};
use crate::domain::topology::{known_services, service};
use crate::event::{LogEvent, Sink};

/// 全 known service の /app mount source を docker inspect から取得する（真実源）。
pub fn mount_snapshot(ctx: &Ctx) -> Vec<ServiceMount> {
    let main = ctx.git.main_path().unwrap_or_else(|_| ctx.repo.clone());
    let known = known_services();
    let sources = ctx.docker.app_mounts(&known);
    let mut out = Vec::new();
    for svc in &known {
        let sspec = match service(svc) {
            Some(s) => s,
            None => continue,
        };
        let src = sources.get(*svc).cloned().unwrap_or_default();
        let main_src = format!("{}/{}", main, sspec.src);
        let mount = if src.is_empty() {
            ServiceMount {
                service: svc.to_string(),
                source: String::new(),
                state: MountState::Down,
                worktree: None,
            }
        } else if src == main_src {
            ServiceMount {
                service: svc.to_string(),
                source: src.clone(),
                state: MountState::Main,
                worktree: Some(main.clone()),
            }
        } else {
            let suffix = format!("/{}", sspec.src);
            let root = if src.ends_with(&suffix) {
                src[..src.len() - suffix.len()].to_string()
            } else {
                src.clone()
            };
            ServiceMount {
                service: svc.to_string(),
                source: src.clone(),
                state: MountState::Worktree,
                worktree: Some(root),
            }
        };
        out.push(mount);
    }
    out
}

pub fn stop_vite(ctx: &Ctx, sink: &Sink, record: &ViteProcess) {
    if ctx.process.is_alive(record.pid, &record.lstart) {
        ctx.process.kill(record.pid, &record.lstart);
    }
    ctx.state.drop_vite(record.port);
    sink(LogEvent::info(format!("FE: :{} 停止", record.port)));
}

pub fn stop_all_vites(ctx: &Ctx, sink: &Sink) {
    for record in ctx.state.vite_records() {
        stop_vite(ctx, sink, &record);
    }
}
