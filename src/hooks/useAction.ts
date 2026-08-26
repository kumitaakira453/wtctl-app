import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { errorMessage, runAction } from "../lib/ipc";
import type { Step } from "../state/app";
import { actionActiveAtom, actionOpenAtom, actionTabsAtom } from "../state/atoms";

/// 成功したタブを畳むまでの猶予。完了したことが目視できる程度に置く。
const AUTO_CLOSE_MS = 2500;

/// 検証スキーム等の複数ステップを順に実行し、各ステップをタブに分けてログを保持する。
/// 完了後に afterDone（ダッシュボード更新）を呼ぶ。1 ステップ失敗で以降は中断。
export function useActionRunner(afterDone: () => void) {
  const setOpen = useSetAtom(actionOpenAtom);
  const setTabs = useSetAtom(actionTabsAtom);
  const setActive = useSetAtom(actionActiveAtom);

  const runScheme = useCallback(
    async (steps: Step[]): Promise<boolean> => {
      if (steps.length === 0) return true;
      setOpen(true);
      // タブは置き換えず upsert する: 別操作（BE 起動と FE 起動など）のログが
      // 後の操作で上書きされないよう、既存タブを残したまま今回のステップを追加/更新する。
      const CAP = 12;
      setTabs((prev) => {
        const incoming = new Set(steps.map((s) => s.id));
        const kept = prev.filter((t) => !incoming.has(t.id));
        const fresh = steps.map((s) => ({ id: s.id, title: s.title, log: [], running: false, result: null }));
        // 新規タブは末尾。上限超過時は古い（=先頭側）タブから間引く。
        return [...kept, ...fresh].slice(-CAP);
      });
      const runOne = async (s: Step): Promise<boolean> => {
        setTabs((tabs) => tabs.map((t) => (t.id === s.id ? { ...t, running: true } : t)));
        try {
          await runAction(s.cmd, s.args, (e) =>
            setTabs((tabs) => tabs.map((t) => (t.id === s.id ? { ...t, log: [...t.log, e] } : t))),
          );
          setTabs((tabs) => tabs.map((t) => (t.id === s.id ? { ...t, running: false, result: "ok" } : t)));
          return true;
        } catch (err) {
          setTabs((tabs) =>
            tabs.map((t) =>
              t.id === s.id
                ? {
                    ...t,
                    running: false,
                    result: "error",
                    log: [...t.log, { kind: "error", text: errorMessage(err) }],
                  }
                : t,
            ),
          );
          return false;
        }
      };

      // parallel 指定のステップは直列の列を待たずに先行させる（FE 起動は BE 差し替え・
      // migration に依存しないため、npm ci の待ち時間を BE の recreate と重ねられる）。
      const independent = steps.filter((s) => s.parallel);
      const chain = steps.filter((s) => !s.parallel);
      // 進行の主線は直列の列なので、そちらを初期表示にする。
      setActive((chain[0] ?? steps[0]).id);
      const spawned = independent.map((s) => runOne(s));

      const serial = (async () => {
        for (const s of chain) {
          setActive(s.id);
          // 直列の列は依存関係があるため、1 つ失敗したら以降は実行しない。
          if (!(await runOne(s))) return false;
        }
        return true;
      })();

      const results = await Promise.all([serial, ...spawned]);
      const ok = results.every(Boolean);
      afterDone();
      // 完了して成功したタブは自動で閉じる。実行中でないタブが残っていると
      // 進行中の操作が紛れて分かりにくいため。失敗タブは原因を追えるよう残す。
      if (ok) {
        const doneIds = new Set(steps.map((s) => s.id));
        setTimeout(() => {
          setTabs((tabs) => {
            const rest = tabs.filter((t) => !(doneIds.has(t.id) && !t.running && t.result === "ok"));
            if (rest.length === 0) {
              setOpen(false);
            } else {
              setActive((cur) => (rest.some((t) => t.id === cur) ? cur : rest[rest.length - 1].id));
            }
            return rest;
          });
        }, AUTO_CLOSE_MS);
      }
      return ok;
    },
    [afterDone, setActive, setOpen, setTabs],
  );

  const run = useCallback(
    (title: string, cmd: string, args: Record<string, unknown>) =>
      runScheme([{ id: title, title, cmd, args }]),
    [runScheme],
  );

  return { run, runScheme };
}
