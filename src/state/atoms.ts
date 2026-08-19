import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type {
  LogEvent,
  MainFe,
  MetaEntry,
  PrInfo,
  RepoStatus,
  ServiceMount,
  ViteProcess,
  WorktreeEntry,
} from "../lib/types";

export type Theme = "dark" | "light";
export type SortMode = "recent" | "name";

// 再起動しても保持されるよう localStorage に永続化する。
export const themeAtom = atomWithStorage<Theme>("wtctl.theme", "dark", undefined, {
  getOnInit: true,
});

export const repoStatusAtom = atom<RepoStatus | null>(null);

// 更新チェック（mdglow 準拠）: nonce をインクリメントすると再チェック、status は結果表示用。
export type UpdateStatus = "idle" | "checking" | "available" | "uptodate" | "error";
export const updateCheckNonceAtom = atom(0);
export const updateStatusAtom = atom<UpdateStatus>("idle");

export const worktreesAtom = atom<WorktreeEntry[]>([]);
export const mainPathAtom = atom<string>("");
export const mountsAtom = atom<ServiceMount[]>([]);
export const vitesAtom = atom<ViteProcess[]>([]);
export const mainFeAtom = atom<MainFe>({ listening: false, responding: false });
export const mainFePortAtom = atom<number>(3000);
export const stackUpAtom = atom<boolean>(false);
export const metasAtom = atom<Record<string, MetaEntry>>({});
export const prsAtom = atom<Record<string, PrInfo>>({});
export const disksAtom = atom<Record<string, number>>({});

export const selectedPathAtom = atom<string | null>(null);
export const sortModeAtom = atomWithStorage<SortMode>("wtctl.sortMode", "recent", undefined, {
  getOnInit: true,
});
export const searchAtom = atom<string>("");
export const loadingAtom = atom<boolean>(false);
export const stackCollapsedAtom = atomWithStorage<boolean>("wtctl.stackCollapsed", false, undefined, {
  getOnInit: true,
});

// 左（worktree 一覧）／右（スタック）パネルの表示 ON/OFF（永続化）
export const sidebarOpenAtom = atomWithStorage<boolean>("wtctl.sidebarOpen", true, undefined, {
  getOnInit: true,
});
export const stackOpenAtom = atomWithStorage<boolean>("wtctl.stackOpen", true, undefined, {
  getOnInit: true,
});

// 差分ビューアの各カラム幅（ドラッグで可変・永続化）
export const browserCommitsWAtom = atomWithStorage<number>("wtctl.browser.commitsW", 210, undefined, {
  getOnInit: true,
});
export const browserTreeWAtom = atomWithStorage<number>("wtctl.browser.treeW", 300, undefined, {
  getOnInit: true,
});

export type PrFilter = "all" | "open" | "merged" | "closed" | "none";
export const prFilterAtom = atom<PrFilter>("all");

/// 検索＋PR フィルタ＋ソート済みの worktree 一覧（(main) は常に先頭・常に表示）。
export const visibleWorktreesAtom = atom((get) => {
  const list = [...get(worktreesAtom)];
  const q = get(searchAtom).trim().toLowerCase();
  const metas = get(metasAtom);
  const prs = get(prsAtom);
  const sort = get(sortModeAtom);
  const prFilter = get(prFilterAtom);
  const filtered = list.filter((w) => {
    if (q && !(w.name.toLowerCase().includes(q) || (w.branch ?? "").toLowerCase().includes(q))) {
      return false;
    }
    if (prFilter !== "all" && !w.isMain) {
      const st = w.branch ? prs[w.branch]?.state : undefined;
      if (prFilter === "open") return st === "open" || st === "draft";
      if (prFilter === "none") return !st;
      return st === prFilter;
    }
    return true;
  });
  filtered.sort((a, b) => {
    // (main) は並び順に関わらず常に先頭固定
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    if (sort === "name") return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    const ta = metas[a.path]?.meta.commitTs ?? 0;
    const tb = metas[b.path]?.meta.commitTs ?? 0;
    return tb - ta;
  });
  return filtered;
});

/// 現在選択中の worktree。
export const selectedWorktreeAtom = atom((get) => {
  const sel = get(selectedPathAtom);
  return get(worktreesAtom).find((w) => w.path === sel) ?? null;
});

// --- 確認ダイアログ ---
export interface ConfirmRequest {
  message: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}
export const confirmAtom = atom<ConfirmRequest | null>(null);

// --- アクション実行（タブ付きログドロワー） ---
// 検証スキームは複数ステップ（BE / migration / FE）を順に実行し、各ステップを
// タブに分けてログを保持する（後のステップで前のログが消えない）。
export interface ActionTab {
  id: string;
  title: string;
  log: LogEvent[];
  running: boolean;
  result: "ok" | "error" | null;
}
export const actionOpenAtom = atom(false);
export const actionTabsAtom = atom<ActionTab[]>([]);
export const actionActiveAtom = atom<string>("");
