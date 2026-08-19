//! フロントへ公開する Tauri コマンド層。
//!
//! 読み取り系はデータを返し、アクション系は Channel<LogEvent> で実行ログを逐次送る。
//! git/docker/gh はブロッキングなので spawn_blocking でワーカースレッドに逃がす。

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;

use crate::app::ctx::Ctx;
use crate::app::{health, migration, query, restore, stack, teardown, verify, worktree};
use crate::domain::models::{BranchInfo, PrInfo, VerifyPlan};
use crate::domain::topology::PROJECT;
use crate::error::{WtError, WtResult};
use crate::event::{LogEvent, Sink};
use crate::infra::config;

/// 実行中の `docker logs -f` プロセス（id -> Child）。タブ切替/閉じるで kill する。
static LOG_PROCS: LazyLock<Mutex<HashMap<u64, Child>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static LOG_ID: AtomicU64 = AtomicU64::new(1);

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
pub async fn commit_log(path: String) -> Result<Vec<crate::domain::models::CommitInfo>, WtError> {
    run_query(move |ctx| Ok(ctx.git.commit_log(&path))).await
}

#[tauri::command]
pub async fn commit_files(path: String, sha: String) -> Result<Vec<crate::domain::models::FileChange>, WtError> {
    run_query(move |ctx| Ok(ctx.git.commit_files(&path, &sha))).await
}

#[tauri::command]
pub async fn commit_diff(path: String, sha: String, file: String) -> Result<String, WtError> {
    run_query(move |ctx| Ok(ctx.git.commit_diff(&path, &sha, &file))).await
}

/// `docker logs -f` を起動して行を Channel へストリームする（lazydocker 相当）。stream id を返す。
#[tauri::command]
pub fn start_container_logs(service: String, tail: u32, channel: Channel<LogEvent>) -> Result<u64, WtError> {
    let container = format!("{PROJECT}-{service}-1");
    let mut child = Command::new("docker")
        .args(["logs", "-f", "--tail", &tail.to_string(), &container])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| WtError::new(format!("docker logs の起動に失敗: {e}")))?;
    let mut pipes: Vec<Box<dyn std::io::Read + Send>> = Vec::new();
    if let Some(o) = child.stdout.take() {
        pipes.push(Box::new(o));
    }
    if let Some(e) = child.stderr.take() {
        pipes.push(Box::new(e));
    }
    let id = LOG_ID.fetch_add(1, Ordering::SeqCst);
    LOG_PROCS.lock().unwrap().insert(id, child);

    for p in pipes {
        let ch = channel.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(p).lines().map_while(Result::ok) {
                if ch.send(LogEvent::out(line)).is_err() {
                    break;
                }
            }
        });
    }
    Ok(id)
}

/// ストリームを停止して docker logs プロセスを kill する。
#[tauri::command]
pub fn stop_container_logs(id: u64) {
    if let Some(mut child) = LOG_PROCS.lock().unwrap().remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRef {
    group: String,
    app: String,
    appdir: String,
}

#[tauri::command]
pub async fn migration_rollback_to_base(
    worktree: String,
    base: Option<String>,
    apps: Vec<AppRef>,
    channel: Channel<LogEvent>,
) -> Result<(), WtError> {
    run_action(channel, move |ctx, sink| {
        let tuples: Vec<(String, String, String)> =
            apps.into_iter().map(|a| (a.group, a.app, a.appdir)).collect();
        migration::rollback_to_base(ctx, &worktree, base.as_deref(), &tuples, sink)
    })
    .await
}
