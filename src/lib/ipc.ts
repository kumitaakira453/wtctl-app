import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  ConfigDto,
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
  containerLogs: (service: string, tail: number) =>
    invoke<string>("container_logs", { service, tail }),
  rollbackTarget: (worktree: string, appdir: string, base: string | null) =>
    invoke<string>("rollback_target", { worktree, appdir, base }),
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

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
