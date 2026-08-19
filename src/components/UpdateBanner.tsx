import { openUrl } from "@tauri-apps/plugin-opener";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { updateInfoAtom } from "../state/atoms";
import { Icon } from "./Icon";
import { Button, IconButton } from "./ui";

const DISMISS_KEY = "wtctl.updateDismissed";

/// 新しいリリースが見つかったら起動時に上部でサジェストする（同一バージョンは一度閉じたら出さない）。
export function UpdateBanner() {
  const info = useAtomValue(updateInfoAtom);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY));

  if (!info?.updateAvailable || !info.latest) return null;
  if (dismissed === info.latest) return null;

  const close = () => {
    localStorage.setItem(DISMISS_KEY, info.latest ?? "");
    setDismissed(info.latest);
  };

  return (
    <div
      className="wt-fade flex items-center gap-2 py-2 pr-4"
      style={{
        background: "var(--wt-accent-soft)",
        borderBottom: "1px solid var(--wt-accent)",
        paddingLeft: 80, // macOS の信号機ボタンを避ける
      }}
    >
      <Icon name="rocket_launch" size={17} style={{ color: "var(--wt-accent)" }} />
      <span className="text-[13px]">
        新しいバージョン <span className="font-semibold">{info.latest}</span> が利用可能です
        <span style={{ color: "var(--wt-muted)" }}>（現在 v{info.current}）</span>
      </span>
      <div className="ml-auto flex items-center gap-1">
        {info.url && (
          <Button size="sm" variant="primary" icon="download" onClick={() => void openUrl(info.url!)}>
            ダウンロード
          </Button>
        )}
        <IconButton icon="close" size={16} title="閉じる" onClick={close} />
      </div>
    </div>
  );
}
