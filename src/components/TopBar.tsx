import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useConfirm } from "../hooks/useConfirm";
import { useApp } from "../state/app";
import {
  loadingAtom,
  mainFeAtom,
  mainFePortAtom,
  stackUpAtom,
  themeAtom,
  updateCheckNonceAtom,
  updateStatusAtom,
} from "../state/atoms";
import { Button, IconButton, Spinner } from "./ui";

function UpdateCheck() {
  const status = useAtomValue(updateStatusAtom);
  const setNonce = useSetAtom(updateCheckNonceAtom);
  const check = () => setNonce((n) => n + 1);

  if (status === "checking") {
    return (
      <span className="flex items-center gap-1.5 px-2 text-[12px]" style={{ color: "var(--wt-muted)" }}>
        <Spinner size={13} /> 確認中
      </span>
    );
  }
  if (status === "available") {
    return (
      <Button size="sm" variant="primary" icon="upgrade" title="新しいバージョンがあります" onClick={check}>
        更新あり
      </Button>
    );
  }
  const tip = status === "uptodate" ? "最新です（クリックで再確認）" : status === "error" ? "確認に失敗（再試行）" : "最新リリースを確認";
  return (
    <Button size="sm" variant="ghost" icon="upgrade" title={tip} onClick={check}>
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
  const { run, refresh } = useApp();
  const confirm = useConfirm();

  const feLabel = mainFe.responding ? "稼働中" : mainFe.listening ? "応答なし" : "停止";
  const feColor = mainFe.responding ? "var(--wt-ok)" : mainFe.listening ? "var(--wt-warn)" : "var(--wt-muted)";

  return (
    <div
      className="wt-drag flex items-center gap-2 px-4"
      style={{ height: 52, borderBottom: "1px solid var(--wt-border)", background: "var(--wt-bg)" }}
    >
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
      </div>
    </div>
  );
}
