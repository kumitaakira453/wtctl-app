//! 検証プランの構築（純粋ロジック）。
//!
//! worktree の変更パス集合から、差し替える BE グループ・FE の要否・依存 rebuild の要否・
//! 新規 migration を導出する。副作用を持たない。

use std::collections::HashSet;

use crate::domain::models::{Migration, VerifyPlan};
use crate::domain::topology::GROUPS;

pub fn build_plan(changed_paths: &HashSet<String>, base: Option<String>) -> VerifyPlan {
    let mut groups: HashSet<String> = HashSet::new();
    let mut build_groups: HashSet<String> = HashSet::new();
    let mut fe = false;

    for path in changed_paths {
        for g in GROUPS {
            if path.starts_with(&format!("{}/", g.src)) {
                groups.insert(g.key.to_string());
            }
        }
        if path.starts_with("frontend/") {
            fe = true;
        }
    }

    for g in GROUPS {
        if changed_paths.contains(&format!("{}/uv.lock", g.src))
            || changed_paths.contains(&format!("{}/pyproject.toml", g.src))
        {
            build_groups.insert(g.key.to_string());
        }
    }

    let migrations = detect_migrations(changed_paths);

    let mut groups: Vec<String> = groups.into_iter().collect();
    groups.sort();
    let mut build_groups: Vec<String> = build_groups.into_iter().collect();
    build_groups.sort();

    VerifyPlan::new(groups, build_groups, fe, migrations, base)
}

fn detect_migrations(changed_paths: &HashSet<String>) -> Vec<Migration> {
    let mut migs: Vec<Migration> = Vec::new();
    for path in changed_paths {
        if !path.contains("/migrations/") || !path.ends_with(".py") {
            continue;
        }
        if !path.starts_with("backend/") {
            continue;
        }
        let (appdir, fname) = match path.split_once("/migrations/") {
            Some(v) => v,
            None => continue,
        };
        if fname.contains('/') || fname == "__init__.py" {
            continue;
        }
        let g = match group_for_appdir(appdir) {
            Some(k) => k,
            None => continue,
        };
        let app = appdir.rsplit('/').next().unwrap_or(appdir).to_string();
        let name = fname.trim_end_matches(".py").to_string();
        migs.push(Migration::new(g, app, name, appdir.to_string()));
    }
    migs.sort_by(|a, b| (&a.group, &a.app, &a.name).cmp(&(&b.group, &b.app, &b.name)));
    migs
}

fn group_for_appdir(appdir: &str) -> Option<String> {
    for g in GROUPS {
        if appdir.starts_with(g.src) {
            return Some(g.key.to_string());
        }
    }
    None
}
