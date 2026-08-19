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

/// 検索フィルタ＋ソート済みの worktree 一覧。
export const visibleWorktreesAtom = atom((get) => {
  const list = [...get(worktreesAtom)];
  const q = get(searchAtom).trim().toLowerCase();
  const metas = get(metasAtom);
  const sort = get(sortModeAtom);
  const filtered = q
    ? list.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          (w.branch ?? "").toLowerCase().includes(q),
      )
    : list;
  filtered.sort((a, b) => {
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

// --- アクション実行（ログドロワー） ---
export const actionOpenAtom = atom(false);
export const actionTitleAtom = atom("");
export const actionRunningAtom = atom(false);
export const actionResultAtom = atom<"ok" | "error" | null>(null);
export const actionLogAtom = atom<LogEvent[]>([]);
