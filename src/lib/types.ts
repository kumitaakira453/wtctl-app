// Rust 側 DTO（camelCase 直列化）と一致させること。

export type MountState = "main" | "worktree" | "down";

export interface Worktree {
  path: string;
  name: string;
  branch: string | null;
  head: string | null;
  locked: boolean;
  bare: boolean;
  detached: boolean;
}

export interface WorktreeEntry extends Worktree {
  isMain: boolean;
  created: boolean;
}

export interface ListResult {
  worktrees: WorktreeEntry[];
  mainPath: string;
}

export interface PrInfo {
  number: number;
  state: string; // "draft" | "open" | "merged" | "closed"
  url: string;
  title: string;
}

export interface BranchInfo {
  name: string;
  commitTs: number;
  commitRel: string;
  subject: string;
  hasWorktree: boolean;
  pr: PrInfo | null;
}

export interface WorktreeMeta {
  commitTs: number;
  commitRel: string;
  subject: string;
  ahead: number;
  dirty: boolean;
  hasUpstream: boolean;
  unpushed: number;
  behindRemote: number;
}

export interface ServiceMount {
  service: string;
  source: string;
  state: MountState;
  worktree: string | null;
  containerState: string; // "running" | "exited" | "missing" ...
  responding: boolean | null; // ポート持ちのみ。celery 等は null
}

export interface Migration {
  group: string;
  app: string;
  name: string;
  appdir: string;
  label: string;
}

export interface VerifyPlan {
  groups: string[];
  buildGroups: string[];
  fe: boolean;
  migrations: Migration[];
  base: string | null;
  error: string | null;
  hasBackend: boolean;
  isEmpty: boolean;
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  rel: string;
}

export interface FileChange {
  status: string; // "A" | "M" | "D" | "R" | "C" | "?"
  path: string;
  additions: number;
  deletions: number;
}

export interface ViteProcess {
  port: number;
  pid: number;
  worktree: string;
  lstart: string;
}

export interface MainFe {
  listening: boolean;
  responding: boolean;
}

export interface LiveResult {
  mounts: ServiceMount[];
  vites: ViteProcess[];
  mainFe: MainFe;
  mainFePort: number;
  stackUp: boolean;
}

export interface MetaEntry {
  path: string;
  meta: WorktreeMeta;
  plan: VerifyPlan;
}

export interface ConfigDto {
  repo: string | null;
  worktreeDir: string | null;
  configPath: string;
  stateDir: string;
}

export interface RepoStatus {
  configured: boolean;
  repo: string | null;
  worktreeDir: string | null;
  error: string | null;
}

export type LogKind = "cmd" | "out" | "info" | "success" | "warn" | "error";

export interface LogEvent {
  kind: LogKind;
  text: string;
}
