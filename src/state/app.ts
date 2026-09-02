import { createContext, useContext } from "react";
import type { ActionScope } from "../lib/types";

// backend のロック有無と対応させる（"be" = run_stack_action を使うコマンド、
// "fe" = Vite プロセス、"other" = git 等のどちらにも属さない操作）。
const FE_CMDS = new Set(["fe", "fe_main", "stop_main_fe"]);
const BE_CMDS = new Set([
  "verify",
  "be_apply",
  "restore",
  "restore_be",
  "stack_start",
  "stack_stop",
  "health_check",
  "delete_worktree",
  "teardown_worktree",
  "migration_apply_all",
  "migration_rollback_to_base",
]);

export function scopeOf(cmd: string): ActionScope {
  if (FE_CMDS.has(cmd)) return "fe";
  if (BE_CMDS.has(cmd)) return "be";
  return "other";
}

export interface Step {
  id: string;
  title: string;
  cmd: string;
  args: Record<string, unknown>;
  /// 他ステップに依存せず、直列の列とは並行に走らせる（例: FE 起動は BE 差し替えを待たない）。
  parallel?: boolean;
}

export type RunFn = (
  title: string,
  cmd: string,
  args: Record<string, unknown>,
) => Promise<boolean>;

export interface AppApi {
  run: RunFn;
  runScheme: (steps: Step[]) => Promise<boolean>;
  refresh: () => Promise<void>;
  refreshLive: () => Promise<void>;
  ensureDisk: (path: string) => void;
  reloadStatus: () => void;
}

export const AppContext = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const c = useContext(AppContext);
  if (!c) throw new Error("AppContext が未提供です");
  return c;
}
