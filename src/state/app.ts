import { createContext, useContext } from "react";

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
