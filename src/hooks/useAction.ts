import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { errorMessage, runAction } from "../lib/ipc";
import type { RunFn } from "../state/app";
import {
  actionLogAtom,
  actionOpenAtom,
  actionResultAtom,
  actionRunningAtom,
  actionTitleAtom,
} from "../state/atoms";

/// ストリーミングアクションを実行し、ログドロワーの状態を更新する。
/// 完了後に afterDone（ダッシュボード更新）を呼ぶ。
export function useActionRunner(afterDone: () => void): RunFn {
  const setOpen = useSetAtom(actionOpenAtom);
  const setTitle = useSetAtom(actionTitleAtom);
  const setRunning = useSetAtom(actionRunningAtom);
  const setResult = useSetAtom(actionResultAtom);
  const setLog = useSetAtom(actionLogAtom);

  return useCallback<RunFn>(
    async (title, cmd, args) => {
      setLog([]);
      setResult(null);
      setTitle(title);
      setRunning(true);
      setOpen(true);
      try {
        await runAction(cmd, args, (e) => setLog((l) => [...l, e]));
        setResult("ok");
      } catch (e) {
        setLog((l) => [...l, { kind: "error", text: errorMessage(e) }]);
        setResult("error");
      } finally {
        setRunning(false);
        afterDone();
      }
    },
    [afterDone, setLog, setOpen, setResult, setRunning, setTitle],
  );
}
