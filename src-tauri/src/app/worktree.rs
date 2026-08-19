//! ブランチを指定して worktree を新規作成する。作成した worktree は state に記録し、
//! 既存の worktree と区別できるようにする。

use std::path::Path;

use crate::app::ctx::Ctx;
use crate::error::{WtError, WtResult};
use crate::event::{LogEvent, Sink};

pub fn create(ctx: &Ctx, branch: &str, sink: &Sink) -> WtResult<()> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(WtError::new("ブランチ名が空です"));
    }
    let main = ctx.git.main_path()?;
    let name = branch.replace('/', "-");
    let path = Path::new(&ctx.worktree_dir).join(&name).to_string_lossy().to_string();
    if Path::new(&path).exists() {
        return Err(WtError::new(format!("作成先が既に存在します: {path}")));
    }

    if ctx.git.ref_exists(&main, branch) {
        sink(LogEvent::info(format!("既存ブランチ {branch} を {path} に worktree 追加")));
        ctx.git.worktree_add(&main, &path, branch, None, sink)?;
    } else {
        let base = "origin/develop";
        sink(LogEvent::info(format!(
            "新規ブランチ {branch} を {base} から作成して worktree 追加"
        )));
        ctx.git.worktree_add(&main, &path, branch, Some(base), sink)?;
    }

    ctx.state.mark_created(&path)?;
    sink(LogEvent::success(format!("worktree 作成: {path}")));
    Ok(())
}
