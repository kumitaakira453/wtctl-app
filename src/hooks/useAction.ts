import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { errorMessage, runAction } from "../lib/ipc";
import type { Step } from "../state/app";
import { actionActiveAtom, actionOpenAtom, actionTabsAtom } from "../state/atoms";

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
      setActive(steps[0].id);
      let ok = true;
      for (const s of steps) {
        setActive(s.id);
        setTabs((tabs) => tabs.map((t) => (t.id === s.id ? { ...t, running: true } : t)));
        try {
          await runAction(s.cmd, s.args, (e) =>
            setTabs((tabs) => tabs.map((t) => (t.id === s.id ? { ...t, log: [...t.log, e] } : t))),
          );
          setTabs((tabs) => tabs.map((t) => (t.id === s.id ? { ...t, running: false, result: "ok" } : t)));
        } catch (err) {
          ok = false;
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
          break;
        }
      }
      afterDone();
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
