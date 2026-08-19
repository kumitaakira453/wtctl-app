import { createContext, useContext } from "react";

export interface Step {
  id: string;
  title: string;
  cmd: string;
  args: Record<string, unknown>;
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
