import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { useConfirm } from "../hooks/useConfirm";
import { useApp } from "../state/app";
import {
  loadingAtom,
  mainFeAtom,
  mainFePortAtom,
  sidebarOpenAtom,
  stackOpenAtom,
  stackUpAtom,
  themeAtom,
  updateCheckNonceAtom,
  updateStatusAtom,
} from "../state/atoms";
import { Icon } from "./Icon";
import { Button, IconButton, Spinner } from "./ui";

function UpdateCheck() {
  const status = useAtomValue(updateStatusAtom);
  const setNonce = useSetAtom(updateCheckNonceAtom);
  // 手動確認の完了時だけ結果を数秒フラッシュ表示する（最新です / 確認失敗）
  const [pending, setPending] = useState(false);
  const [flash, setFlash] = useState<null | "uptodate" | "error">(null);
  const check = () => {
    setFlash(null);
    setPending(true);
    setNonce((n) => n + 1);
  };

  useEffect(() => {
    if (!pending) return;
    if (status === "uptodate" || status === "error") {
      setPending(false);
      setFlash(status);
      const t = setTimeout(() => setFlash(null), 2500);
      return () => clearTimeout(t);
    }
  }, [status, pending]);

  if (status === "checking") {
    return (
      <span className="flex items-center gap-1.5 px-2 text-[12px]" style={{ color: "var(--wt-muted)" }}>
        <Spinner size={13} /> 確認中
      </span>
    );
  }
  if (status === "available") {
    return (
      <Button size="sm" variant="primary" icon="download" title="新しいバージョンがあります" onClick={check}>
        更新あり
      </Button>
    );
  }
  if (flash === "uptodate") {
    return (
      <span
        className="wt-fade flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium"
        style={{ color: "var(--wt-ok)", background: "color-mix(in srgb, var(--wt-ok) 14%, transparent)" }}
        title="お使いのバージョンが最新です"
      >
        <Icon name="check_circle" size={15} />
        最新です
      </span>
    );
  }
  if (flash === "error") {
    return (
      <Button size="sm" variant="ghost" icon="error" title="確認に失敗しました（クリックで再試行）" onClick={check}>
        確認失敗
      </Button>
    );
  }
  return (
    <Button size="sm" variant="ghost" icon="download" title="最新リリースを確認" onClick={check}>
      更新確認
    </Button>
  );
}

export function TopBar() {
  const stackUp = useAtomValue(stackUpAtom);
  const mainFe = useAtomValue(mainFeAtom);
  const port = useAtomValue(mainFePortAtom);
  const loading = useAtomValue(loadingAtom);
  const [theme, setTheme] = useAtom(themeAtom);
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const [stackOpen, setStackOpen] = useAtom(stackOpenAtom);
  const { run, refresh } = useApp();
  const confirm = useConfirm();

  const feLabel = mainFe.responding ? "稼働中" : mainFe.listening ? "応答なし" : "停止";
  const feColor = mainFe.responding ? "var(--wt-ok)" : mainFe.listening ? "var(--wt-warn)" : "var(--wt-muted)";

  return (
    <div
      data-tauri-drag-region
      className="wt-drag flex items-center gap-2 pr-4"
      style={{
        height: 52,
        // サイドバー非表示時は macOS の traffic lights と重ならないよう左を空ける
        paddingLeft: sidebarOpen ? 16 : 84,
        borderBottom: "1px solid var(--wt-border)",
        background: "var(--wt-bg)",
      }}
    >
      {/* 左パネル（worktree 一覧）表示トグル */}
      <IconButton
        icon={sidebarOpen ? "left_panel_close" : "left_panel_open"}
        title={sidebarOpen ? "worktree 一覧を隠す" : "worktree 一覧を表示"}
        active={!sidebarOpen}
        onClick={() => setSidebarOpen((v) => !v)}
      />

      {/* スタック状態 */}
      <div className="wt-no-drag flex h-[34px] items-center gap-2 rounded-lg pl-2.5 pr-1" style={{ background: "var(--wt-panel)" }}>
        <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: stackUp ? "var(--wt-ok)" : "var(--wt-danger)" }} />
        <span className="text-xs font-medium">{stackUp ? "スタック稼働" : "スタック停止"}</span>
        {stackUp ? (
          <IconButton
            icon="stop_circle"
            size={15}
            box={26}
            title="スタック停止（stop のみ）"
            onClick={async () => {
              if (await confirm("スタックを停止しますか？（stop のみ・DB は down しません）")) {
                await run("スタック停止", "stack_stop", {});
              }
            }}
          />
        ) : (
          <IconButton
            icon="play_circle"
            size={15}
            box={26}
            title="スタック起動"
            onClick={async () => {
              if (await confirm("スタックを起動しますか？（docker compose start）")) {
                await run("スタック起動", "stack_start", {});
              }
            }}
          />
        )}
      </div>

      {/* :3000 FE */}
      <div
        className={`wt-no-drag flex h-[34px] items-center gap-2 rounded-lg pl-2.5 ${mainFe.listening ? "pr-1" : "pr-3"}`}
        style={{ background: "var(--wt-panel)" }}
      >
        <span className="text-xs font-medium" style={{ color: "var(--wt-info)" }}>:{port}</span>
        <span className="text-xs" style={{ color: feColor }}>{feLabel}</span>
        {mainFe.listening && (
          <IconButton
            icon="power_settings_new"
            size={15}
            box={26}
            title={`:${port} の FE を停止`}
            onClick={async () => {
              if (await confirm(`:${port} のメイン FE を停止しますか？`)) {
                await run(`:${port} 停止`, "stop_main_fe", {});
              }
            }}
          />
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {loading && <Spinner size={14} />}
        <Button
          size="sm"
          variant="ghost"
          icon="settings_backup_restore"
          title="BE mount を main に戻す（FE は維持）"
          onClick={async () => {
            if (await confirm("BE mount を main に戻しますか？（FE は止めません）")) {
              await run("BE を main に復帰", "restore_be", {});
            }
          }}
        >
          BE戻す
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="restart_alt"
          title="全 BE を main に戻し FE も停止"
          onClick={async () => {
            if (await confirm("全 BE mount をメインへ戻し FE を停止しますか？（restore）")) {
              await run("restore", "restore", {});
            }
          }}
        >
          全戻す
        </Button>
        <IconButton icon="health_and_safety" title="health（停止/差し替え崩れを自動復旧）" onClick={() => run("health", "health_check", {})} />
        <IconButton icon="refresh" title="再読み込み" onClick={() => void refresh()} />
        <UpdateCheck />
        <IconButton
          icon={theme === "dark" ? "light_mode" : "dark_mode"}
          title="テーマ切替"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        />
        {/* 右パネル（スタック）表示トグル */}
        <IconButton
          icon={stackOpen ? "right_panel_close" : "right_panel_open"}
          title={stackOpen ? "スタックパネルを隠す" : "スタックパネルを表示"}
          active={!stackOpen}
          onClick={() => setStackOpen((v) => !v)}
        />
      </div>
    </div>
  );
}
