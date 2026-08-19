//! 合成ルート相当。config からリポジトリを解決し、各アダプタを束ねた Ctx を作る。

use crate::error::WtResult;
use crate::infra::config;
use crate::infra::docker::Docker;
use crate::infra::fs::Fs;
use crate::infra::gh::Gh;
use crate::infra::git::Git;
use crate::infra::http::Http;
use crate::infra::process::Process;
use crate::infra::state::State;

pub struct Ctx {
    pub repo: String,
    pub worktree_dir: String,
    pub git: Git,
    pub docker: Docker,
    pub state: State,
    pub process: Process,
    pub http: Http,
    pub fs: Fs,
    pub gh: Gh,
}

impl Ctx {
    pub fn load() -> WtResult<Ctx> {
        let repo = config::resolve_repo()?;
        let worktree_dir = config::resolve_worktree_dir(&repo);
        let state = State::new(&config::state_dir().to_string_lossy())?;
        let docker = Docker::new(&repo, &state.override_path());
        let git = Git::new(&repo);
        Ok(Ctx {
            repo,
            worktree_dir,
            git,
            docker,
            state,
            process: Process,
            http: Http,
            fs: Fs,
            gh: Gh,
        })
    }
}
