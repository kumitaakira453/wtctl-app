//! ドメインモデル（フロントへそのまま渡す DTO）。camelCase で直列化する。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MountState {
    Main,
    Worktree,
    Down,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub locked: bool,
    pub bare: bool,
    pub detached: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: i64,
    /// "draft" | "open" | "merged" | "closed"
    pub state: String,
    pub url: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub commit_ts: i64,
    pub commit_rel: String,
    pub subject: String,
    pub has_worktree: bool,
    pub pr: Option<PrInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeMeta {
    pub commit_ts: i64,
    pub commit_rel: String,
    pub subject: String,
    pub ahead: i64,
    pub dirty: bool,
    pub has_upstream: bool,
    pub unpushed: i64,
    pub behind_remote: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMount {
    pub service: String,
    pub source: String,
    pub state: MountState,
    pub worktree: Option<String>,
    /// docker の State.Status（"running" / "exited" / "missing" など）。
    pub container_state: String,
    /// ポートを持つサービスの HTTP 応答有無（celery 等は None）。
    pub responding: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Migration {
    pub group: String,
    pub app: String,
    pub name: String,
    pub appdir: String,
    pub label: String,
}

impl Migration {
    pub fn new(group: String, app: String, name: String, appdir: String) -> Self {
        let label = format!("{group}/{app}:{name}");
        Self { group, app, name, appdir, label }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyPlan {
    pub groups: Vec<String>,
    pub build_groups: Vec<String>,
    pub fe: bool,
    pub migrations: Vec<Migration>,
    pub base: Option<String>,
    pub error: Option<String>,
    pub has_backend: bool,
    pub is_empty: bool,
}

impl VerifyPlan {
    pub fn new(
        groups: Vec<String>,
        build_groups: Vec<String>,
        fe: bool,
        migrations: Vec<Migration>,
        base: Option<String>,
    ) -> Self {
        let has_backend = !groups.is_empty();
        let is_empty = groups.is_empty() && !fe;
        Self { groups, build_groups, fe, migrations, base, error: None, has_backend, is_empty }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViteProcess {
    pub port: u16,
    pub pid: i64,
    pub worktree: String,
    pub lstart: String,
}
