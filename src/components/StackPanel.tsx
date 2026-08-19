import { useAtomValue } from "jotai";
import { stackUpAtom } from "../state/atoms";
import { ContainerList } from "./ContainerList";
import { FePanel } from "./FePanel";

/// グローバルな共有スタック（BE コンテナ / FE :3000）を右カラムに常設する。
/// per-worktree の詳細（中央）とは別ブロック。どの worktree を選んでも同じ状態を示す。
/// ログドロワーは中央下部のみを覆うため、ここは常に見える。
export function StackPanel() {
  const stackUp = useAtomValue(stackUpAtom);
  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      style={{ width: 340, flexShrink: 0, borderLeft: "1px solid var(--wt-border)", background: "var(--wt-sidebar)" }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--wt-border)" }}
      >
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
      </div>
      <div className="flex flex-col gap-3 p-3">
        <ContainerList />
        <FePanel />
      </div>
    </div>
  );
}
