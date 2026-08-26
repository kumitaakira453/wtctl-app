import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { confirmAtom } from "../state/atoms";

/// message を提示し、OK/キャンセルの真偽を Promise で返す。
/// confirmLabel には実際に起きる操作を書く（「実行」のような汎用語を避ける）。
export function useConfirm(): (
  message: string,
  danger?: boolean,
  confirmLabel?: string,
) => Promise<boolean> {
  const setConfirm = useSetAtom(confirmAtom);
  return useCallback(
    (message: string, danger = false, confirmLabel?: string) =>
      new Promise<boolean>((resolve) => {
        setConfirm({ message, danger, confirmLabel, resolve });
      }),
    [setConfirm],
  );
}
