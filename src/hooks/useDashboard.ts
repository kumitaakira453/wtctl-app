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

  return { refresh, refreshLive, ensureDisk };
}
