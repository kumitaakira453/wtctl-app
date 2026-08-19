//! BE mount 差し替え・FE 起動。

use std::path::Path;

use crate::app::ctx::Ctx;
use crate::domain::models::{VerifyPlan, ViteProcess};
use crate::domain::topology::{group, service, services_of, MAIN_FE_PORT};
use crate::error::{WtError, WtResult};
use crate::event::{LogEvent, Sink};
use crate::infra::state::SwapInfo;

const HTTP_TIMEOUT: u64 = 60;

pub fn verify(ctx: &Ctx, worktree: &str, plan: &VerifyPlan, sink: &Sink) -> WtResult<()> {
    if plan.has_backend {
        be(ctx, worktree, &plan.groups, &plan.build_groups, sink)?;
    }
    if plan.fe {
        fe(ctx, worktree, sink)?;
    }
    Ok(())
}

pub fn be(ctx: &Ctx, worktree: &str, groups: &[String], build_groups: &[String], sink: &Sink) -> WtResult<()> {
    crate::app::migration::ensure_stack(ctx, sink)?;
    for g in groups {
        let gspec = group(g).ok_or_else(|| WtError::new(format!("不明なグループ: {g}")))?;
        if !ctx.fs.is_dir(&format!("{worktree}/{}", gspec.src)) {
            return Err(WtError::new(format!("{worktree}/{} が無い", gspec.src)));
        }
    }

    let services = services_of(groups);
    let mut swaps = ctx.state.load_swaps();
    for svc in &services {
        let sspec = service(svc).ok_or_else(|| WtError::new(format!("不明なサービス: {svc}")))?;
        swaps.insert(
            svc.clone(),
            SwapInfo {
                wt: worktree.to_string(),
                build: build_groups.iter().any(|b| b == sspec.group),
            },
        );
    }
    ctx.state.save_swaps(&swaps)?;
    ctx.state.render_override(&swaps)?;

    let build = groups.iter().any(|g| build_groups.contains(g));
    sink(LogEvent::info(format!(
        "コンテナ再作成: {}{}",
        services.join(", "),
        if build { "（--build）" } else { "" }
    )));
    ctx.docker.compose_up(&services, true, build, sink)?;

    for svc in &services {
        let mount = ctx.docker.app_mount(svc);
        sink(LogEvent::info(format!("{svc} mount: {mount}")));
        if !mount.starts_with(worktree) {
            return Err(WtError::new(format!("{svc} の mount が worktree を指していない")));
        }
        if let Some(port) = service(svc).and_then(|s| s.port) {
            if !ctx.http.wait(&format!("http://localhost:{port}/"), HTTP_TIMEOUT, sink) {
                return Err(WtError::new(format!("{svc} が応答しない")));
            }
        }
    }
    sink(LogEvent::success(format!(
        "BE は {worktree} のコードで稼働中（autoreload 有効）"
    )));
    Ok(())
}

/// worktree の FE を常に単一ポート :3000 で起動する（並行させない）。
pub fn fe(ctx: &Ctx, worktree: &str, sink: &Sink) -> WtResult<()> {
    let port = MAIN_FE_PORT;
    let webdir = Path::new(worktree).join("frontend").join("web").to_string_lossy().to_string();
    if !ctx.fs.is_dir(&webdir) {
        return Err(WtError::new(format!("{webdir} が無い")));
    }

    ensure_deps(ctx, worktree, &webdir, sink)?;
    let main = ctx.git.main_path()?;
    let main_web = Path::new(&main).join("frontend").join("web").to_string_lossy().to_string();
    for name in ctx.fs.copy_env_files(&main_web, &webdir)? {
        sink(LogEvent::info(format!("env copy: {name}")));
    }

    if ctx.fs.vite_bin(&webdir).is_none() {
        return Err(WtError::new(format!("{webdir} に vite が無い（npm ci 失敗）")));
    }

    // 単一 Vite 方針: 既存の :3000 を止めてから起動する
    free_main_port(ctx, port, sink);

    let log_path = ctx.state.vite_log_path(port);
    sink(LogEvent::info(format!("vite --port {port} --strictPort (log: {log_path})")));
    let (pid, lstart) = ctx.process.spawn_vite(&webdir, port, &log_path)?;
    ctx.state.save_vite(&ViteProcess {
        port,
        pid,
        worktree: worktree.to_string(),
        lstart,
    })?;

    if ctx.http.wait(&format!("http://localhost:{port}/"), HTTP_TIMEOUT, sink) {
        sink(LogEvent::success(format!("FE は :{port} で確認可能 (pid {pid})")));
    } else {
        sink(LogEvent::warn(format!("FE が応答しない。ログ: {log_path}")));
    }
    Ok(())
}

pub fn stop_main_fe(ctx: &Ctx, sink: &Sink) -> WtResult<()> {
    let killed = free_main_port(ctx, MAIN_FE_PORT, sink);
    if killed > 0 {
        sink(LogEvent::success(format!(":{MAIN_FE_PORT} の FE を {killed} 個停止しました")));
    } else {
        sink(LogEvent::info(format!(":{MAIN_FE_PORT} に停止対象はありません")));
    }
    Ok(())
}

/// :port を占有する FE を停止し、追跡レコードも破棄する。停止数を返す。
fn free_main_port(ctx: &Ctx, port: u16, sink: &Sink) -> usize {
    let count = ctx.process.terminate_port(port);
    if count > 0 {
        sink(LogEvent::info(format!(":{port} の既存 FE を停止しました")));
    }
    ctx.state.drop_vite(port);
    count
}

fn ensure_deps(ctx: &Ctx, worktree: &str, webdir: &str, sink: &Sink) -> WtResult<()> {
    let lock = Path::new(worktree).join("package-lock.json").to_string_lossy().to_string();
    let lock_sha = ctx
        .fs
        .file_sha256(&lock)
        .ok_or_else(|| WtError::new(format!("{lock} が無い")))?;
    let node_modules = Path::new(webdir).join("node_modules").to_string_lossy().to_string();
    if ctx.fs.is_dir(&node_modules) && ctx.state.npmci_cache_matches(worktree, &lock_sha) {
        sink(LogEvent::info("npm ci: skip（lockfile 不変）"));
        return Ok(());
    }
    sink(LogEvent::info("npm ci 実行（数分かかる場合あり）"));
    ctx.process.npm_ci(worktree, sink)?;
    ctx.state.store_npmci_cache(worktree, &lock_sha)?;
    Ok(())
}
