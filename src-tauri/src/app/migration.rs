//! migration の適用・巻き戻し・確認。
//!
//! worktree の差分から新規 migration 群は一意に決まるため、操作は「適用（進める）」と
//! 「base へ巻き戻す」の 2 方向に集約する。

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

/// 指定 migration のうち、DB に適用済みのものの label を返す。
/// showmigrations の `[X] name` を適用済みとみなす。コンテナ停止時は空になり、
/// 「未適用」として扱われる（差し替え前は判定できないため安全側）。
pub fn applied(ctx: &Ctx, apps: &[(String, String)]) -> WtResult<Vec<String>> {
    let mut done: Vec<String> = Vec::new();
    // 同じ (group, app) で showmigrations を何度も叩かないようまとめる
    let mut seen: Vec<(String, String)> = Vec::new();
    for (grp, app) in apps {
        if seen.iter().any(|(g, a)| g == grp && a == app) {
            continue;
        }
        seen.push((grp.clone(), app.clone()));
        let out = ctx.docker.showmigrations(container(grp)?, app);
        for line in out.lines() {
            let t = line.trim();
            let name = match t.strip_prefix("[X]") {
                Some(rest) => rest.trim(),
                None => continue,
            };
            if name.is_empty() {
                continue;
            }
            done.push(format!("{grp}/{app}:{name}"));
        }
    }
    Ok(done)
}
