import { useAtom, useAtomValue } from "jotai";
import { beActiveFor, feActiveFor, PR_COLOR } from "../lib/status";
import type { WorktreeEntry } from "../lib/types";
import { useApp } from "../state/app";
import {
  metasAtom,
  mountsAtom,
  type PrFilter,
  prFilterAtom,
  prsAtom,
  searchAtom,
  selectedPathAtom,
  sortModeAtom,
  visibleWorktreesAtom,
  vitesAtom,
} from "../state/atoms";
import { Icon } from "./Icon";
import { IconButton } from "./ui";

export function Sidebar({ onNew, onSettings }: { onNew: () => void; onSettings: () => void }) {
  const worktrees = useAtomValue(visibleWorktreesAtom);
  const [selected, setSelected] = useAtom(selectedPathAtom);
  const [search, setSearch] = useAtom(searchAtom);
  const [sort, setSort] = useAtom(sortModeAtom);
  const [prFilter, setPrFilter] = useAtom(prFilterAtom);
  const metas = useAtomValue(metasAtom);
  const mounts = useAtomValue(mountsAtom);
  const vites = useAtomValue(vitesAtom);
  const prs = useAtomValue(prsAtom);
  const { ensureDisk } = useApp();

  const select = (w: WorktreeEntry) => {
    setSelected(w.path);
    ensureDisk(w.path);
  };

  return (
    <div
      className="flex h-full flex-col"
      style={{ width: 320, background: "var(--wt-sidebar)", borderRight: "1px solid var(--wt-border)" }}
    >
      <div className="wt-drag flex items-center gap-2 px-4 pb-2" style={{ paddingTop: 30 }}>
        <Icon name="account_tree" size={20} style={{ color: "var(--wt-accent)" }} />
        <span className="text-[15px] font-semibold tracking-tight">wtctl</span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton icon="add" onClick={onNew} title="worktree を作成" size={20} />
        </div>
      </div>

      <div className="wt-no-drag px-3 pb-2">
        <div
          className="flex items-center gap-2 rounded-lg px-2.5"
          style={{ background: "var(--wt-panel-2)", border: "1px solid var(--wt-border)", height: 34 }}
        >
          <Icon name="search" size={16} style={{ color: "var(--wt-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="worktree を検索"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--wt-fg)" }}
          />
          <button
            type="button"
            onClick={() => setSort(sort === "recent" ? "name" : "recent")}
            title={`並び順: ${sort === "recent" ? "最終更新↓" : "名前↑"}`}
            className="wt-no-drag flex items-center"
            style={{ color: "var(--wt-muted)" }}
          >
            <Icon name={sort === "recent" ? "schedule" : "sort_by_alpha"} size={16} />
          </button>
        </div>
      </div>

      <div className="wt-no-drag flex flex-wrap gap-1 px-3 pb-2">
        {(
          [
            ["all", "全て", "var(--wt-muted)"],
            ["open", "Open", PR_COLOR.open],
            ["merged", "Merged", PR_COLOR.merged],
            ["closed", "Closed", PR_COLOR.closed],
            ["none", "PR無", "var(--wt-muted)"],
          ] as [PrFilter, string, string][]
        ).map(([k, label, color]) => {
          const on = prFilter === k;
          return (
            <button
              type="button"
              key={k}
              onClick={() => setPrFilter(k)}
              className="rounded-md px-2 py-0.5 text-[11px] transition-colors"
              style={{
                color,
                fontWeight: on ? 700 : 500,
                background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : "transparent",
                border: `1px solid ${on ? color : "var(--wt-border)"}`,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {worktrees.map((w) => {
          const meta = metas[w.path]?.meta;
          const active = beActiveFor(w.path, mounts);
          const fe = feActiveFor(w.path, vites);
          const pr = w.branch ? prs[w.branch] : undefined;
          const isSel = selected === w.path;
          return (
            <button
              type="button"
              key={w.path}
              onClick={() => select(w)}
              className="mb-0.5 w-full rounded-lg px-3 py-2 text-left transition-colors"
              style={{ background: isSel ? "var(--wt-active)" : "transparent" }}
              onMouseEnter={(e) => {
                if (!isSel) e.currentTarget.style.background = "var(--wt-hover)";
              }}
              onMouseLeave={(e) => {
                if (!isSel) e.currentTarget.style.background = "transparent";
              }}
            >
              <div className="flex items-center gap-1.5">
                {w.created && <Icon name="add_circle" size={13} style={{ color: "var(--wt-accent)" }} />}
                <span
                  className="truncate text-sm font-medium"
                  style={{ color: w.isMain ? "var(--wt-muted)" : "var(--wt-fg)" }}
                >
                  {w.isMain ? "(main)" : w.name}
                </span>
                {meta?.dirty && (
                  <span
                    title="未コミット変更あり"
                    className="rounded px-1 text-[9px] font-bold"
                    style={{ color: "var(--wt-warn)", background: "color-mix(in srgb, var(--wt-warn) 16%, transparent)" }}
                  >
                    変更あり
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {active && (
                    <span
                      className="rounded px-1 text-[9px] font-bold"
                      style={{ color: "var(--wt-warn)", background: "color-mix(in srgb, var(--wt-warn) 16%, transparent)" }}
                    >
                      BE
                    </span>
                  )}
                  {fe && (
                    <span
                      className="rounded px-1 text-[9px] font-bold"
                      style={{ color: "var(--wt-info)", background: "color-mix(in srgb, var(--wt-info) 16%, transparent)" }}
                    >
                      FE
                    </span>
                  )}
                </div>
              </div>
              {/* 直前のコミット件名 */}
              <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--wt-fg-dim)" }}>
                {meta?.subject || "—"}
              </div>
              {/* ブランチ + 相対時刻 */}
              <div className="mt-0.5 flex items-center gap-2">
                <span className="truncate font-mono text-[10px]" style={{ color: "var(--wt-muted)" }}>
                  {w.branch ?? w.head ?? "?"}
                  {meta && meta.ahead > 0 ? ` +${meta.ahead}` : ""}
                </span>
                <span className="ml-auto shrink-0 text-[10px]" style={{ color: "var(--wt-muted)" }}>
                  {meta?.commitRel ?? ""}
                </span>
              </div>
              {/* PR ステータス + タイトル */}
              {pr && (
                <div className="mt-1 flex items-center gap-1.5">
                  <span
                    className="shrink-0 rounded px-1 text-[9px] font-bold uppercase"
                    style={{ color: PR_COLOR[pr.state], border: `1px solid ${PR_COLOR[pr.state]}` }}
                  >
                    {pr.state}
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold" style={{ color: PR_COLOR[pr.state] }}>
                    #{pr.number}
                  </span>
                  <span className="truncate text-[10px]" style={{ color: "var(--wt-muted)" }}>
                    {pr.title}
                  </span>
                </div>
              )}
            </button>
          );
        })}
        {worktrees.length === 0 && (
          <div className="px-3 py-6 text-center text-xs" style={{ color: "var(--wt-muted)" }}>
            worktree がありません
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 px-3 py-2" style={{ borderTop: "1px solid var(--wt-border)" }}>
        <IconButton icon="settings" onClick={onSettings} title="設定" size={18} />
        <span className="ml-auto text-[10px]" style={{ color: "var(--wt-muted)" }}>
          {worktrees.length} worktrees
        </span>
      </div>
    </div>
  );
}
