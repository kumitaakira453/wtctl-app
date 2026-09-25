//! migration の適用・巻き戻し・確認。
//!
//! worktree の差分から新規 migration 群は一意に決まるため、操作は「適用（進める）」と
//! 「base へ巻き戻す」の 2 方向に集約する。

use crate::app::ctx::Ctx;
use crate::domain::models::MigrationCompare;
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

/// 2 つの ref の間で migration を比べる。DB ではなく git の一覧どうしを突き合わせる。
/// 巻き戻し先は「両方に存在する最後の migration」で、base 時点とは限らない
/// （分岐後に共通の migration が入ることがある）。
pub fn compare(
    ctx: &Ctx,
    worktree: &str,
    from_ref: &str,
    to_ref: &str,
    group_key: &str,
    app: &str,
    appdir: &str,
) -> MigrationCompare {
    let from = ctx.git.migration_names_at(worktree, appdir, Some(from_ref));
    let to = ctx.git.migration_names_at(worktree, appdir, Some(to_ref));

    let common: Vec<String> = from.iter().filter(|n| to.contains(n)).cloned().collect();
    // 分岐点は「差し替え中のブランチの並びを後ろから見て、相手にもある最初のもの」
    let fork_point = from.iter().rev().find(|n| to.contains(n)).cloned();

    let mut rollback: Vec<String> = from.iter().filter(|n| !to.contains(n)).cloned().collect();
    rollback.reverse(); // 新しい順（戻す順番）
    let apply: Vec<String> = to.iter().filter(|n| !from.contains(n)).cloned().collect();

    MigrationCompare {
        group: group_key.to_string(),
        app: app.to_string(),
        appdir: appdir.to_string(),
        common,
        fork_point,
        rollback,
        apply,
    }
}

/// 検出した全グループの migration を適用する（進める）。
pub fn apply_all(ctx: &Ctx, groups: &[String], sink: &Sink) -> WtResult<()> {
    ensure_stack(ctx, sink)?;
    for g in groups {
        ctx.docker.migrate(container(g)?, None, None, sink)?;
    }
    sink(LogEvent::success("migration を適用しました"));
    Ok(())
}

/// スタックが停止していれば起動する（検証操作でいちいち止められないように）。
pub fn ensure_stack(ctx: &Ctx, sink: &Sink) -> WtResult<()> {
    if !ctx.docker.stack_up() {
        sink(LogEvent::info("BE が停止しているため起動します"));
        ctx.docker.stack_start(sink)?;
        if !ctx.docker.stack_up() {
            return Err(WtError::new("BE の起動に失敗しました"));
        }
        sink(LogEvent::success("BE を起動しました"));
    }
    Ok(())
}

/// 比較で求めた分岐点まで巻き戻す。apps は (group, app, target) の並びで、
/// target は両ブランチ共通の最後の migration（無ければ "zero"）。
pub fn rollback_to_target(ctx: &Ctx, apps: &[(String, String, String)], sink: &Sink) -> WtResult<()> {
    ensure_stack(ctx, sink)?;
    for (grp, app, target) in apps {
        sink(LogEvent::info(format!("{grp}/{app} を {target} まで巻き戻します")));
        ctx.docker.migrate(container(grp)?, Some(app), Some(target), sink)?;
    }
    sink(LogEvent::success("分岐点まで巻き戻しました"));
    Ok(())
}

/// 影響アプリを base 時点まで巻き戻す。apps は (group, app, appdir) の並び。
pub fn rollback_to_base(
    ctx: &Ctx,
    worktree: &str,
    base: Option<&str>,
    apps: &[(String, String, String)],
    sink: &Sink,
) -> WtResult<()> {
    // (group, app) で重複排除
    let mut seen: Vec<(String, String)> = Vec::new();
    for (grp, app, appdir) in apps {
        if seen.iter().any(|(g, a)| g == grp && a == app) {
            continue;
        }
        seen.push((grp.clone(), app.clone()));
        let target = rollback_target(ctx, worktree, appdir, base);
        sink(LogEvent::info(format!("{grp}/{app} を {target} まで巻き戻します")));
        ctx.docker.migrate(container(grp)?, Some(app), Some(&target), sink)?;
    }
    sink(LogEvent::success("base まで巻き戻しました"));
    Ok(())
}

pub fn show(ctx: &Ctx, group_key: &str, app: &str) -> WtResult<String> {
    Ok(ctx.docker.showmigrations(container(group_key)?, app))
}
