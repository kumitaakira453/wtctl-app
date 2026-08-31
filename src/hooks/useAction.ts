import { useSetAtom } from "jotai";
import { useCallback, useRef } from "react";
import { errorMessage, runAction } from "../lib/ipc";
import type { Step } from "../state/app";
import { actionActiveAtom, actionOpenAtom, actionTabsAtom } from "../state/atoms";

/// 成功したタブを畳むまでの猶予。完了したことが目視できる程度に置く。
const AUTO_CLOSE_MS = 2500;
/// 保持するログタブの上限。超えたら古い方から間引く。
const TAB_CAP = 12;
/// 実行中に弾いたことを伝えるタブ。毎回同じ id で上書きし、増やさない。
const BLOCKED_TAB = "blocked";

/// 検証スキーム等の複数ステップを順に実行し、各ステップをタブに分けてログを保持する。
/// 完了後に afterDone（ダッシュボード更新）を呼ぶ。1 ステップ失敗で以降は中断。
export function useActionRunner(afterDone: () => void) {
  const setOpen = useSetAtom(actionOpenAtom);
  const setTabs = useSetAtom(actionTabsAtom);
  const setActive = useSetAtom(actionActiveAtom);
  // 実行中フラグは ref で持つ。再レンダリングを待たずに同一 tick の二重呼び出しも弾く。
  const busyRef = useRef(false);

  const runScheme = useCallback(
    async (steps: Step[]): Promise<boolean> => {
      if (steps.length === 0) return true;
      // ボタンの無効化をすり抜けた経路でも二重実行させない（同じサービスの同時 recreate 防止）。
      // 黙って捨てると「押しても効かない」と受け取られ、CLI や手動 docker から叩かれて
      // 起動と停止が重なる。弾いたことは必ずログに出す。
      if (busyRef.current) {
        setOpen(true);
        setTabs((prev) =>
          [
            ...prev.filter((t) => t.id !== BLOCKED_TAB),
            {
              id: BLOCKED_TAB,
              title: "受付不可",
              log: [{ kind: "error" as const, text: "他の操作を実行中です。完了してから再実行してください。" }],
              running: false,
              result: "error" as const,
            },
          ].slice(-TAB_CAP),
        );
        setActive(BLOCKED_TAB);
        return false;
      }
      busyRef.current = true;
      setOpen(true);
      // タブは置き換えず upsert する: 別操作（BE 起動と FE 起動など）のログが
      // 後の操作で上書きされないよう、既存タブを残したまま今回のステップを追加/更新する。
      setTabs((prev) => {
        const incoming = new Set(steps.map((s) => s.id));
        // 前回の「受付不可」は、新しい操作が通った時点で用済みなので落とす。
        const kept = prev.filter((t) => !incoming.has(t.id) && t.id !== BLOCKED_TAB);
        const fresh = steps.map((s) => ({ id: s.id, title: s.title, log: [], running: false, result: null }));
        // 新規タブは末尾。上限超過時は古い（=先頭側）タブから間引く。
        return [...kept, ...fresh].slice(-TAB_CAP);
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
      busyRef.current = false;
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
