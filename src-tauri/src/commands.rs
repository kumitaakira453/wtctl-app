//! フロントへ公開する Tauri コマンド層。
//!
//! 読み取り系はデータを返し、アクション系は Channel<LogEvent> で実行ログを逐次送る。
//! git/docker/gh はブロッキングなので spawn_blocking でワーカースレッドに逃がす。

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;

use crate::app::ctx::Ctx;
use crate::app::{health, migration, query, restore, stack, teardown, verify, worktree};
use crate::domain::models::{BranchInfo, PrInfo, VerifyPlan};
use crate::error::{WtError, WtResult};
use crate::event::{LogEvent, Sink};
use crate::infra::config;

// ---------------------------------------------------------------- 実行ヘルパ

async fn run_query<T, F>(f: F) -> Result<T, WtError>
where
    T: Send + 'static,
    F: FnOnce(&Ctx) -> WtResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = Ctx::load()?;
        f(&ctx)
    })
    .await
    .map_err(|e| WtError::new(e.to_string()))?
}

async fn run_action<F>(channel: Channel<LogEvent>, f: F) -> Result<(), WtError>
where
    F: FnOnce(&Ctx, &Sink) -> WtResult<()> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = Ctx::load()?;
        let sink = move |e: LogEvent| {
            let _ = channel.send(e);
        };
        let s: &Sink = &sink;
        let result = f(&ctx, s);
        if let Err(e) = &result {
            s(LogEvent::error(e.message.clone()));
        }
        result
    })
    .await
    .map_err(|e| WtError::new(e.to_string()))?
}

// ---------------------------------------------------------------- 設定

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDto {
    repo: Option<String>,
    worktree_dir: Option<String>,
    config_path: String,
    state_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    configured: bool,
    repo: Option<String>,
    worktree_dir: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub fn get_config() -> ConfigDto {
    let cfg = config::load_config();
    let get = |k: &str| cfg.get(k).and_then(|v| v.as_str()).map(String::from);
    ConfigDto {
        repo: get("repo"),
        worktree_dir: get("worktree_dir"),
        config_path: config::config_path().to_string_lossy().to_string(),
        state_dir: config::state_dir().to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn set_config(repo: String, worktree_dir: Option<String>) -> Result<(), WtError> {
    let mut cfg = config::load_config();
    cfg.insert("repo".to_string(), Value::String(repo));
    match worktree_dir {
        Some(w) if !w.trim().is_empty() => {
            cfg.insert("worktree_dir".to_string(), Value::String(w));
        }
        _ => {
            cfg.remove("worktree_dir");
        }
    }
    config::save_config(&cfg)
}

#[tauri::command]
pub async fn repo_status() -> RepoStatus {
    tauri::async_runtime::spawn_blocking(|| match Ctx::load() {
        Ok(ctx) => RepoStatus {
            configured: true,
            repo: Some(ctx.repo),
            worktree_dir: Some(ctx.worktree_dir),
            error: None,
        },
        Err(e) => RepoStatus {
            configured: false,
            repo: None,
            worktree_dir: None,
            error: Some(e.message),
        },
    })
    .await
    .unwrap_or(RepoStatus {
        configured: false,
        repo: None,
        worktree_dir: None,
        error: Some("内部エラー".to_string()),
    })
}

// ---------------------------------------------------------------- 読み取り

#[tauri::command]
pub async fn list_worktrees() -> Result<query::ListResult, WtError> {
    run_query(query::list_worktrees).await
}

#[tauri::command]
pub async fn get_live() -> Result<query::LiveResult, WtError> {
    run_query(|ctx| Ok(query::live(ctx))).await
}

#[tauri::command]
pub async fn get_metas(paths: Vec<String>) -> Result<Vec<query::MetaEntry>, WtError> {
    run_query(move |ctx| Ok(query::metas_parallel(ctx, paths, 8))).await
}

#[tauri::command]
pub async fn plan_for(path: String) -> Result<VerifyPlan, WtError> {
    run_query(move |ctx| Ok(query::plan_for(ctx, &path))).await
}

#[tauri::command]
pub async fn get_branches() -> Result<Vec<BranchInfo>, WtError> {
    run_query(query::branches).await
}

#[tauri::command]
pub async fn get_pull_requests() -> Result<HashMap<String, PrInfo>, WtError> {
    run_query(query::pull_requests).await
}

#[tauri::command]
pub async fn disk_size(path: String) -> Result<i64, WtError> {
    run_query(move |ctx| Ok(query::disk_size(ctx, &path))).await
}

#[tauri::command]
pub async fn is_dirty(path: String) -> Result<bool, WtError> {
    run_query(move |ctx| Ok(query::is_dirty(ctx, &path))).await
}

#[tauri::command]
pub async fn migration_show(group: String, app: String) -> Result<String, WtError> {
    run_query(move |ctx| migration::show(ctx, &group, &app)).await
}

#[tauri::command]
pub async fn rollback_target(worktree: String, appdir: String, base: Option<String>) -> Result<String, WtError> {
    run_query(move |ctx| Ok(migration::rollback_target(ctx, &worktree, &appdir, base.as_deref()))).await
}

// ---------------------------------------------------------------- アクション

#[tauri::command]
pub async fn verify(path: String, channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, move |ctx, sink| {
        let plan = query::plan_for(ctx, &path);
        if let Some(err) = plan.error {
            return Err(WtError::new(err));
        }
        verify::verify(ctx, &path, &plan, sink)
    })
    .await
}

#[tauri::command]
pub async fn be_apply(
    path: String,
    groups: Vec<String>,
    build_groups: Vec<String>,
    channel: Channel<LogEvent>,
) -> Result<(), WtError> {
    run_action(channel, move |ctx, sink| verify::be(ctx, &path, &groups, &build_groups, sink)).await
}

#[tauri::command]
pub async fn fe(path: String, channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, move |ctx, sink| verify::fe(ctx, &path, sink)).await
}

#[tauri::command]
pub async fn restore(channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, |ctx, sink| restore::restore(ctx, sink)).await
}

#[tauri::command]
pub async fn restore_be(channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, |ctx, sink| restore::restore_be(ctx, sink)).await
}

#[tauri::command]
pub async fn stop_main_fe(channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, |ctx, sink| verify::stop_main_fe(ctx, sink)).await
}

#[tauri::command]
pub async fn stack_start(channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, |ctx, sink| stack::start(ctx, sink)).await
}

#[tauri::command]
pub async fn stack_stop(channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, |ctx, sink| stack::stop(ctx, sink)).await
}

#[tauri::command]
pub async fn health_check(channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, |ctx, sink| health::health(ctx, sink)).await
}

#[tauri::command]
pub async fn create_worktree(branch: String, channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, move |ctx, sink| worktree::create(ctx, &branch, sink)).await
}

#[tauri::command]
pub async fn delete_worktree(path: String, force: bool, channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, move |ctx, sink| teardown::delete(ctx, &path, force, sink)).await
}

#[tauri::command]
pub async fn teardown_worktree(path: String, force: bool, channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, move |ctx, sink| teardown::teardown(ctx, &path, force, sink)).await
}

#[tauri::command]
pub async fn migration_apply_all(groups: Vec<String>, channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, move |ctx, sink| migration::apply_all(ctx, &groups, sink)).await
}

#[tauri::command]
pub async fn migration_apply(group: String, app: String, channel: Channel<LogEvent>) -> Result<(), WtError> {
    run_action(channel, move |ctx, sink| migration::apply(ctx, &group, &app, sink)).await
}

#[tauri::command]
pub async fn migration_rollback(
    group: String,
    app: String,
    target: String,
    channel: Channel<LogEvent>,
) -> Result<(), WtError> {
    run_action(channel, move |ctx, sink| migration::rollback(ctx, &group, &app, &target, sink)).await
}
