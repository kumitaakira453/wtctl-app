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
        be(ctx, worktree, &plan.groups, &plan.build_groups, false, sink)?;
    }
    if plan.fe {
        fe(ctx, worktree, sink)?;
    }
    Ok(())
}

/// コンテナの venv が何から作られたかを表す指紋。
/// dockerfile の development ステージは root の pyproject.toml / uv.lock と
/// グループの pyproject.toml から `uv sync --frozen` するので依存定義はこの 3 つで決まる。
/// あわせてイメージ ID も混ぜる。volume はイメージから populate されるため、
/// 他のツールや手動操作で再ビルドされた場合も ID が変わって作り直しに倒れる。
fn venv_fingerprint(ctx: &Ctx, worktree: &str, group_src: &str, image: &str) -> Option<String> {
    let files = [
        Path::new(worktree).join("pyproject.toml"),
        Path::new(worktree).join("uv.lock"),
        Path::new(worktree).join(group_src).join("pyproject.toml"),
    ];
    let mut parts: Vec<String> = Vec::new();
    for f in files {
        parts.push(ctx.fs.file_sha256(&f.to_string_lossy())?);
    }
    parts.push(ctx.docker.image_id(image)?);
    Some(parts.join("-"))
}

/// 差し替え後の健全性の判定結果。venv の作り直しで直る見込みがあるものだけを
/// Deps に分ける。応答しないだけでは作り直さない（アプリ側の不具合や起動の遅れでも
/// 起きるため、数百 MB のコピーを無駄に走らせない）。
enum CheckFail {
    /// 依存の読み込みに失敗している。venv を作り直せば直る見込みがある。
    Deps(String),
    Other(String),
}

impl CheckFail {
    fn reason(&self) -> &str {
        match self {
            CheckFail::Deps(r) | CheckFail::Other(r) => r,
        }
    }
}

/// 差し替え後の健全性を見る。judge_secs は「今回の再作成以降」とみなすログの範囲。
/// 依存の失敗は先に見る。コンテナが落ちているときに HTTP の待ちを消費しないため。
fn check_services(
    ctx: &Ctx,
    worktree: &str,
    services: &[String],
    judge_secs: u64,
    sink: &Sink,
) -> Result<(), CheckFail> {
    for svc in services {
        let mount = ctx.docker.app_mount(svc);
        sink(LogEvent::info(format!("{svc} mount: {mount}")));
        if !mount.starts_with(worktree) {
            return Err(CheckFail::Other(format!("{svc} の mount が worktree を指していない")));
        }
        let logs = ctx.docker.logs_since(svc, judge_secs);
        if logs.contains("ModuleNotFoundError") || logs.contains("ImportError") {
            return Err(CheckFail::Deps(format!("{svc} で依存の読み込みに失敗している")));
        }
        let state = ctx.docker.container_state(svc);
        if state != "running" {
            return Err(CheckFail::Other(format!("{svc} が {state} で止まっている")));
        }
        if let Some(port) = service(svc).and_then(|s| s.port) {
            if !ctx.http.wait(&format!("http://localhost:{port}/"), HTTP_TIMEOUT, sink) {
                return Err(CheckFail::Other(format!("{svc} が応答しない")));
            }
        }
    }
    Ok(())
}

pub fn be(
    ctx: &Ctx,
    worktree: &str,
    groups: &[String],
    build_groups: &[String],
    force_renew: bool,
    sink: &Sink,
) -> WtResult<()> {
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

    // `-V` を付けると venv（数百 MB）がイメージから毎回コピーされる。依存定義が
    // 今 volume に入っている venv と同じなら中身は変わらないので付けない。
    // build するときはイメージ側の venv が変わるため必ず作り直す。
    let mut fps: Vec<(String, String)> = Vec::new();
    let mut renew = build || force_renew || !ctx.reuse_venv;
    for g in groups {
        let gspec = group(g).ok_or_else(|| WtError::new(format!("不明なグループ: {g}")))?;
        match venv_fingerprint(ctx, worktree, gspec.src, gspec.image) {
            Some(fp) => {
                for svc in gspec.services {
                    if !ctx.state.venv_matches(svc, &fp) {
                        renew = true;
                    }
                    fps.push(((*svc).to_string(), fp.clone()));
                }
            }
            // 依存定義が読めないときは安全側に倒して作り直す
            None => renew = true,
        }
    }

    // 流用して動かなかったときは、その場で作り直して往復を省く。
    // 記録とボリュームの実体が食い違うのは外部ツールや手動操作の後に起こり得るので、
    // 利用者に設定を戻させるのではなく自動で復旧する。
    // 流用して依存が合わなかったときだけ、その場で作り直して再試行する。
    // 記録とボリュームの実体が食い違うのは外部ツールや手動操作の後に起こり得るので、
    // 利用者に設定を戻させるのではなく自動で復旧する。再試行は 1 回だけで、
    // 作り直した後に失敗したらもう作り直さない（同じことを繰り返しても直らない）。
    for attempt in 0..2 {
        sink(LogEvent::info(format!(
            "コンテナ再作成: {}{}{}",
            services.join(", "),
            if build { "（--build）" } else { "" },
            if renew { "（venv 作り直し）" } else { "（venv 流用）" }
        )));
        if renew {
            // 作り直しの途中で失敗すると volume の中身が不定になるので、記録を先に捨てる
            for svc in &services {
                ctx.state.forget_venv(svc);
            }
        }
        let started = std::time::Instant::now();
        ctx.docker.compose_up(&services, true, build, renew, sink)?;
        if renew {
            for (svc, fp) in &fps {
                ctx.state.store_venv(svc, fp)?;
            }
        }
        // 再作成にかかった時間の分だけ遡る。差分が無くて再作成されなかった場合に
        // 過去のログを拾わないよう、範囲は必ず今回の操作以降に限る。
        let judge_secs = started.elapsed().as_secs() + 5;

        match check_services(ctx, worktree, &services, judge_secs, sink) {
            Ok(()) => {
                sink(LogEvent::success(format!(
                    "BE は {worktree} のコードで稼働中（autoreload 有効）"
                )));
                return Ok(());
            }
            Err(CheckFail::Deps(reason)) if attempt == 0 && !renew => {
                sink(LogEvent::warn(format!(
                    "{reason}。流用した venv が合っていないため作り直して再試行します"
                )));
                renew = true;
            }
            Err(fail) => return Err(WtError::new(fail.reason().to_string())),
        }
    }
    Err(WtError::new("BE の差し替えに失敗しました"))
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
    // 依存が main と同一（lockfile が一致）なら、node_modules を main への symlink で
    // 済ませる。npm ci は数分、実体コピーでも 1 分以上かかるのに対して一瞬で終わる。
    // vite の dep 最適化キャッシュは cacheDir で node_modules の外に出ているため、
    // 共有しても worktree 間で混ざらない。
    if ctx.share_node_modules {
        let main = ctx.git.main_path()?;
        let main_lock = Path::new(&main).join("package-lock.json").to_string_lossy().to_string();
        match ctx.fs.file_sha256(&main_lock) {
            Some(main_sha) if main_sha == lock_sha => {
                let made = ctx.fs.link_node_modules(&main, worktree)?;
                if made > 0 || ctx.fs.vite_bin(webdir).is_some() {
                    sink(LogEvent::info("node_modules: main と共有（lockfile 一致）"));
                    return Ok(());
                }
            }
            Some(_) => sink(LogEvent::info("node_modules 共有: lockfile が main と異なるため npm ci します")),
            None => {}
        }
    }
    sink(LogEvent::info("npm ci 実行（数分かかる場合あり）"));
    ctx.process.npm_ci(worktree, sink)?;
    ctx.state.store_npmci_cache(worktree, &lock_sha)?;
    Ok(())
}
