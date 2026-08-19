mod app;
mod commands;
mod domain;
mod error;
mod event;
mod infra;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
            commands::check_update,
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
