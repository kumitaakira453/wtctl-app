import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { api, errorMessage } from "../lib/ipc";
import {
  disksAtom,
  loadingAtom,
  mainFeAtom,
  mainFePortAtom,
  mainPathAtom,
  metasAtom,
  mountsAtom,
  prsAtom,
  selectedPathAtom,
  stackUpAtom,
  vitesAtom,
  worktreesAtom,
} from "../state/atoms";

/// ダッシュボードのデータ読み込みと定期更新を司る。
// ウィンドウ復帰の連打で取り直しを繰り返さないための最小間隔。
const FOCUS_REFRESH_MIN_MS = 10000;

export function useDashboard(enabled: boolean) {
  const setWorktrees = useSetAtom(worktreesAtom);
  const setMainPath = useSetAtom(mainPathAtom);
  const setMounts = useSetAtom(mountsAtom);
  const setVites = useSetAtom(vitesAtom);
  const setMainFe = useSetAtom(mainFeAtom);
  const setMainFePort = useSetAtom(mainFePortAtom);
  const setStackUp = useSetAtom(stackUpAtom);
  const setMetas = useSetAtom(metasAtom);
  const setPrs = useSetAtom(prsAtom);
  const [disks, setDisks] = useAtom(disksAtom);
  const [selected, setSelected] = useAtom(selectedPathAtom);
  const setLoading = useSetAtom(loadingAtom);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const disksRef = useRef(disks);
  disksRef.current = disks;

  const refreshLive = useCallback(async () => {
    try {
      const live = await api.getLive();
      setMounts(live.mounts);
      setVites(live.vites);
      setMainFe(live.mainFe);
      setMainFePort(live.mainFePort);
      setStackUp(live.stackUp);
    } catch {
      /* スタック未起動などは無視 */
    }
  }, [setMounts, setVites, setMainFe, setMainFePort, setStackUp]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // (1) git だけで即座に一覧を出す
      const list = await api.listWorktrees();
      setWorktrees(list.worktrees);
      setMainPath(list.mainPath);
      if (!selectedRef.current || !list.worktrees.some((w) => w.path === selectedRef.current)) {
        const first = list.worktrees.find((w) => !w.isMain) ?? list.worktrees[0];
        setSelected(first?.path ?? null);
      }
      // (2) live（docker / vite / :3000）
      await refreshLive();
      // (3) plan / meta は Rust 側で並列収集
      const paths = list.worktrees.map((w) => w.path);
      api
        .getMetas(paths)
        .then((entries) => {
          const map: Record<string, (typeof entries)[number]> = {};
          for (const e of entries) map[e.path] = e;
          setMetas(map);
        })
        .catch(() => {});
      // (4) PR はバックグラウンドで
      api.getPullRequests().then(setPrs).catch(() => {});
    } catch (e) {
      console.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [refreshLive, setLoading, setMainPath, setMetas, setPrs, setSelected, setWorktrees]);

  const ensureDisk = useCallback(
    (path: string) => {
      if (path in disksRef.current) return;
      api
        .diskSize(path)
        .then((size) => setDisks((d) => ({ ...d, [path]: size })))
        .catch(() => {});
    },
    [setDisks],
  );

  // 初回ロード + live の定期更新（15s）
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const id = setInterval(() => void refreshLive(), 15000);
    return () => clearInterval(id);
  }, [enabled, refresh, refreshLive]);

  // ウィンドウに戻ったとき取り直す。裏に回っている間にブランチや docker の状態が
  // 変わっているのが普通なので、戻った時点の表示を信じられるようにする。
  // 戻る操作は連続しがちなので、短い間隔での再取得は間引く。
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        const now = Date.now();
        if (now - last < FOCUS_REFRESH_MIN_MS) return;
        last = now;
        void refresh();
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled, refresh]);

  return { refresh, refreshLive, ensureDisk };
}
