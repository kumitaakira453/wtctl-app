import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { confirmAtom } from "../state/atoms";

/// message を提示し、OK/キャンセルの真偽を Promise で返す。
export function useConfirm(): (message: string, danger?: boolean) => Promise<boolean> {
  const setConfirm = useSetAtom(confirmAtom);
  return useCallback(
    (message: string, danger = false) =>
      new Promise<boolean>((resolve) => {
        setConfirm({ message, danger, resolve });
      }),
    [setConfirm],
  );
}
