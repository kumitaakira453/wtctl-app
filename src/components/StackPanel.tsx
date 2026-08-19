import { useAtom, useAtomValue } from "jotai";
import { stackCollapsedAtom, stackUpAtom } from "../state/atoms";
import { ContainerList } from "./ContainerList";
import { FePanel } from "./FePanel";
import { Icon } from "./Icon";

/// グローバルな共有スタック（BE コンテナ / FE :3000）。per-worktree の詳細とは別ブロックとして
/// TopBar 直下に常設し、どの worktree を選んでいても同じ状態を示す。
export function StackPanel() {
  const stackUp = useAtomValue(stackUpAtom);
  const [collapsed, setCollapsed] = useAtom(stackCollapsedAtom);

  return (
    <div style={{ borderBottom: "1px solid var(--wt-border)", background: "var(--wt-sidebar)" }}>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
      >
        <Icon name={collapsed ? "chevron_right" : "expand_more"} size={18} style={{ color: "var(--wt-muted)" }} />
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--wt-fg-dim)" }}>
          スタック
        </span>
        <span className="text-[11px]" style={{ color: "var(--wt-muted)" }}>
          全 worktree 共通
        </span>
        <span
          className="ml-auto inline-flex items-center gap-1.5 text-[11px]"
          style={{ color: stackUp ? "var(--wt-ok)" : "var(--wt-muted)" }}
        >
          <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: stackUp ? "var(--wt-ok)" : "var(--wt-muted)" }} />
          {stackUp ? "稼働中" : "停止中"}
        </span>
      </button>
      {!collapsed && (
        <div className="grid gap-4 px-4 pb-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <ContainerList />
          <FePanel />
        </div>
      )}
    </div>
  );
}
