import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../hooks/useConfirm";
import { useApp } from "../state/app";
import {
  beBusyAtom,
  feBusyAtom,
  loadingAtom,
  mainFeAtom,
  mainFePortAtom,
  sidebarOpenAtom,
  stackUpAtom,
  themeAtom,
  updateCheckNonceAtom,
  updateStatusAtom,
} from "../state/atoms";
import { ContainerList } from "./ContainerList";
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

  // 手動確認の完了を検出してフラッシュをセット
  useEffect(() => {
    if (pending && (status === "uptodate" || status === "error")) {
      setPending(false);
      setFlash(status);
    }
  }, [status, pending]);

  // フラッシュは一定時間で自動的に消す（検出 effect とは分離。同一 effect だと
  // pending 変化で cleanup が走りタイマーが消えてフラッシュが固定化するため）
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

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
  const { run, refresh } = useApp();
  const confirm = useConfirm();
  // 起動・停止・検証・health は同じスタックを触るので、実行中は互いに受け付けない。
  const beBusy = useAtomValue(beBusyAtom);

  // スタック詳細（BE コンテナ一覧）はツールバーから popover で開く
  const [stackPop, setStackPop] = useState(false);
  const stackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!stackPop) return;
    const onDown = (e: MouseEvent) => {
      if (stackRef.current && !stackRef.current.contains(e.target as Node)) setStackPop(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [stackPop]);

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

      {/* スタック（BE）: ラベルをクリックで詳細 popover、右のボタンで起動/停止 */}
      <div className="wt-no-drag relative" ref={stackRef}>
        <div className="flex h-[34px] items-center gap-1 rounded-lg pl-1 pr-1" style={{ background: "var(--wt-panel)" }}>
          <button
            type="button"
            onClick={() => setStackPop((v) => !v)}
            title="BE コンテナの詳細を表示"
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors"
            style={{ background: stackPop ? "var(--wt-active)" : "transparent" }}
          >
            <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: stackUp ? "var(--wt-ok)" : "var(--wt-muted)" }} />
            <Icon name="dns" size={15} style={{ color: "var(--wt-muted)" }} />
            <span className="text-xs font-medium">BE</span>
            <Icon name="expand_more" size={14} style={{ color: "var(--wt-muted)", opacity: 0.6 }} />
          </button>
          <StackToggle
            up={stackUp}
            onStart={() => run("BE 起動", "stack_start", {})}
            onStop={async () => {
              if (await confirm("BE を停止しますか？（stop のみ・DB は down しません）", false, "停止")) {
                await run("BE 停止", "stack_stop", {});
              }
            }}
            startTitle="BE 起動"
            stopTitle="BE 停止（stop のみ）"
            scope="be"
          />
        </div>
        {stackPop && (
          <div
            className="wt-fade absolute left-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl"
            style={{ width: 360, background: "var(--wt-bg)", border: "1px solid var(--wt-border-strong)", boxShadow: "var(--wt-shadow)" }}
          >
            <div className="p-2">
              <ContainerList />
            </div>
          </div>
        )}
      </div>

      {/* FE (:3000 固定): 起動/停止 のみ。無指定起動 = main の FE 起動 */}
      <div className="wt-no-drag flex h-[34px] items-center gap-1.5 rounded-lg pl-2 pr-1" style={{ background: "var(--wt-panel)" }}>
        <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: feColor }} />
        <Icon name="language" size={15} style={{ color: "var(--wt-muted)" }} />
        <span className="text-xs font-medium">FE</span>
        <StackToggle
          up={mainFe.listening}
          onStart={() => run("FE 起動", "fe_main", {})}
          onStop={async () => {
            if (await confirm(`FE（:${port}）を停止しますか？`, false, "停止")) {
              await run("FE 停止", "stop_main_fe", {});
            }
          }}
          startTitle={`FE を :${port} で起動（main）`}
          stopTitle={`FE（:${port}）を停止`}
          scope="fe"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {loading && <Spinner size={14} />}
        <IconButton
          icon="health_and_safety"
          disabled={beBusy}
          title={beBusy ? "BE の操作を実行中です" : "health（停止/差し替え崩れを自動復旧）"}
          onClick={() => run("health", "health_check", {})}
        />
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

/// 起動/停止の統一トグル（BE / FE 共通。停止中=▶起動 / 稼働中=■停止）。
/// 処理中はスピナー表示にして二度押し・逆操作を防ぐ。
function StackToggle({
  up,
  onStart,
  onStop,
  startTitle,
  stopTitle,
  scope,
}: {
  up: boolean;
  onStart: () => void | Promise<unknown>;
  onStop: () => void | Promise<unknown>;
  startTitle: string;
  stopTitle: string;
  scope: "be" | "fe";
}) {
  const [busy, setBusy] = useState(false);
  // 自分が実行中でなくても、他の操作（別サービスの起動停止・検証）が走っている間は
  // 同じスタックを触るため受け付けない。
  // 見るのは自分が触る資源だけ。BE の起動停止は FE の起動中でも通すべきなので、
  // 全体の実行中フラグでは判断しない。
  const otherBusy = useAtomValue(scope === "be" ? beBusyAtom : feBusyAtom);
  const go = async (fn: () => void | Promise<unknown>) => {
    if (busy || otherBusy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  if (busy) {
    return (
      <span className="inline-flex items-center justify-center" style={{ width: 26, height: 26 }}>
        <Spinner size={14} />
      </span>
    );
  }
  return up ? (
    <IconButton
      icon="stop"
      size={15}
      box={26}
      disabled={otherBusy}
      title={otherBusy ? `${scope.toUpperCase()} の操作を実行中です` : stopTitle}
      onClick={() => go(onStop)}
    />
  ) : (
    <IconButton
      icon="play_arrow"
      size={15}
      box={26}
      disabled={otherBusy}
      title={otherBusy ? `${scope.toUpperCase()} の操作を実行中です` : startTitle}
      onClick={() => go(onStart)}
    />
  );
}
