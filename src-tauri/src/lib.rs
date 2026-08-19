mod app;
mod commands;
mod domain;
mod error;
mod event;
mod infra;

/// GUI（Finder）起動ではログインシェルの PATH を継承しないため、docker/gh/npm 等の
/// CLI が見つからない。ログインシェルから PATH を取り込み、一般的な場所も補う。
fn fix_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(out) = std::process::Command::new(&shell)
        .args(["-lic", "echo $PATH"])
        .output()
    {
        if out.status.success() {
            if let Some(line) = String::from_utf8_lossy(&out.stdout).lines().last() {
                let p = line.trim();
                if !p.is_empty() {
                    std::env::set_var("PATH", p);
                }
            }
        }
    }
    let mut path = std::env::var("PATH").unwrap_or_default();
    let extra = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/Applications/Docker.app/Contents/Resources/bin",
    ];
    for dir in extra {
        if std::path::Path::new(dir).exists() && !path.split(':').any(|x| x == dir) {
            path = format!("{dir}:{path}");
        }
    }
    std::env::set_var("PATH", path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fix_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 自動更新（デスクトップのみ）: mdglow と同じく updater + process を有効化
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::repo_status,
            commands::list_worktrees,
            commands::get_live,
            commands::get_metas,
            commands::plan_for,
            commands::get_branches,
            commands::get_pull_requests,
            commands::disk_size,
            commands::is_dirty,
            commands::migration_show,
            commands::rollback_target,
            commands::verify,
            commands::be_apply,
            commands::fe,
            commands::restore,
            commands::restore_be,
            commands::stop_main_fe,
            commands::stack_start,
            commands::stack_stop,
            commands::health_check,
            commands::create_worktree,
            commands::delete_worktree,
            commands::teardown_worktree,
            commands::migration_apply_all,
            commands::migration_apply,
            commands::migration_rollback
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
