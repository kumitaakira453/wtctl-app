//! migration の適用・巻き戻し・確認。

use crate::app::ctx::Ctx;
use crate::domain::topology::group;
use crate::error::{WtError, WtResult};
use crate::event::{LogEvent, Sink};

fn container(group_key: &str) -> WtResult<&'static str> {
    group(group_key)
        .map(|g| g.container)
        .ok_or_else(|| WtError::new(format!("不明なグループ: {group_key}")))
}

/// 巻き戻し先（base 時点で最後に存在した migration 名、無ければ zero）。
pub fn rollback_target(ctx: &Ctx, worktree: &str, appdir: &str, base: Option<&str>) -> String {
    let names = ctx.git.migration_names_at(worktree, appdir, base);
    names.last().cloned().unwrap_or_else(|| "zero".to_string())
}

pub fn apply_all(ctx: &Ctx, groups: &[String], sink: &Sink) -> WtResult<()> {
    for g in groups {
        ctx.docker.migrate(container(g)?, None, None, sink)?;
    }
    sink(LogEvent::success("migration を適用しました"));
    Ok(())
}

pub fn apply(ctx: &Ctx, group_key: &str, app: &str, sink: &Sink) -> WtResult<()> {
    ctx.docker.migrate(container(group_key)?, Some(app), None, sink)?;
    sink(LogEvent::success(format!("{app} を適用しました")));
    Ok(())
}

pub fn rollback(ctx: &Ctx, group_key: &str, app: &str, target: &str, sink: &Sink) -> WtResult<()> {
    ctx.docker.migrate(container(group_key)?, Some(app), Some(target), sink)?;
    sink(LogEvent::success(format!("{app} を {target} まで巻き戻しました")));
    Ok(())
}

pub fn show(ctx: &Ctx, group_key: &str, app: &str) -> WtResult<String> {
    Ok(ctx.docker.showmigrations(container(group_key)?, app))
}
