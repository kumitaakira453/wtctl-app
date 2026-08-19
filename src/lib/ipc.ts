import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  CommitInfo,
  ConfigDto,
  FileChange,
  ListResult,
  LiveResult,
  LogEvent,
  MetaEntry,
  PrInfo,
  RepoStatus,
  VerifyPlan,
} from "./types";

/// 読み取り系コマンド。
export const api = {
  getConfig: () => invoke<ConfigDto>("get_config"),
  setConfig: (repo: string, worktreeDir: string | null) =>
    invoke<void>("set_config", { repo, worktreeDir }),
  repoStatus: () => invoke<RepoStatus>("repo_status"),
  listWorktrees: () => invoke<ListResult>("list_worktrees"),
  getLive: () => invoke<LiveResult>("get_live"),
  getMetas: (paths: string[]) => invoke<MetaEntry[]>("get_metas", { paths }),
  planFor: (path: string) => invoke<VerifyPlan>("plan_for", { path }),
  getBranches: () => invoke<BranchInfo[]>("get_branches"),
  getPullRequests: () => invoke<Record<string, PrInfo>>("get_pull_requests"),
  diskSize: (path: string) => invoke<number>("disk_size", { path }),
  isDirty: (path: string) => invoke<boolean>("is_dirty", { path }),
  migrationShow: (group: string, app: string) =>
    invoke<string>("migration_show", { group, app }),
  stopContainerLogs: (id: number) => invoke<void>("stop_container_logs", { id }),
  rollbackTarget: (worktree: string, appdir: string, base: string | null) =>
    invoke<string>("rollback_target", { worktree, appdir, base }),
  commitLog: (path: string) => invoke<CommitInfo[]>("commit_log", { path }),
  commitFiles: (path: string, sha: string) =>
    invoke<FileChange[]>("commit_files", { path, sha }),
  commitDiff: (path: string, sha: string, file: string) =>
    invoke<string>("commit_diff", { path, sha, file }),
};

/// アクション系コマンド。実行ログを onLog で逐次受け取り、完了時に resolve / 失敗で reject。
export function runAction(
  cmd: string,
  args: Record<string, unknown>,
  onLog: (e: LogEvent) => void,
): Promise<void> {
  const channel = new Channel<LogEvent>();
  channel.onmessage = onLog;
  return invoke<void>(cmd, { ...args, channel });
}

/// docker logs -f を開始し、行ごとに onLine を呼ぶ。停止用の stream id を返す。
export function startContainerLogs(
  service: string,
  tail: number,
  onLine: (text: string) => void,
): Promise<number> {
  const channel = new Channel<LogEvent>();
  channel.onmessage = (e) => onLine(e.text);
  return invoke<number>("start_container_logs", { service, tail, channel });
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
