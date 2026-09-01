import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/ipc";
import { PR_COLOR } from "../lib/status";
import type { BranchInfo } from "../lib/types";
import { useApp } from "../state/app";
import { Icon } from "./Icon";
import { Badge, Button, Modal, Spinner } from "./ui";

type SortKey = "recent" | "oldest" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "更新が新しい" },
  { key: "oldest", label: "更新が古い" },
  { key: "name", label: "名前" },
];

// PR の状態で絞る選択肢。"none" は PR が無いブランチ。
const PR_STATES: { key: string; label: string }[] = [
  { key: "draft", label: "draft" },
  { key: "open", label: "open" },
  { key: "merged", label: "merged" },
  { key: "closed", label: "closed" },
  { key: "none", label: "PR なし" },
];

/// 押すと有効・もう一度押すと解除するフィルタのチップ。
function FilterChip({
  on,
  onClick,
  children,
  color = "var(--wt-accent)",
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
      style={{
        color: on ? color : "var(--wt-muted)",
        border: `1px solid ${on ? color : "var(--wt-border)"}`,
        background: on ? "color-mix(in srgb, currentColor 12%, transparent)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}

export function BranchPicker({ onClose }: { onClose: () => void }) {
  const { run } = useApp();
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [q, setQ] = useState("");
  // worktree が既にあるブランチは作成できないので、既定では隠しておく。
  const [hideWt, setHideWt] = useState(true);
  const [prStates, setPrStates] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("recent");

  useEffect(() => {
    api.getBranches().then(setBranches).catch(() => setBranches([]));
  }, []);

  const all = branches ?? [];

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = all.filter((b) => {
      if (query && !b.name.toLowerCase().includes(query)) return false;
      if (hideWt && b.hasWorktree) return false;
      if (prStates.size > 0 && !prStates.has(b.pr ? b.pr.state : "none")) return false;
      return true;
    });
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "oldest") sorted.sort((a, b) => a.commitTs - b.commitTs);
    else sorted.sort((a, b) => b.commitTs - a.commitTs);
    return sorted;
  }, [all, q, hideWt, prStates, sort]);

  const create = async (branch: string) => {
    onClose();
    await run(`worktree 作成: ${branch}`, "create_worktree", { branch });
  };

  const canCreateNew = q.trim() && !all.some((b) => b.name === q.trim());
  // 既定のフィルタで何件隠れているかを示す（黙って消えていると探しても見つからない）。
  const hiddenByWt = hideWt ? all.filter((b) => b.hasWorktree).length : 0;
  const togglePr = (key: string) =>
    setPrStates((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Modal title="worktree を作成" onClose={onClose} width={640}>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ブランチを検索、または新規ブランチ名を入力"
        className="mb-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border-strong)", color: "var(--wt-fg)" }}
      />

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <FilterChip on={hideWt} onClick={() => setHideWt((v) => !v)}>
          作成済みを隠す
        </FilterChip>
        <span className="mx-0.5 h-4 w-px" style={{ background: "var(--wt-border)" }} />
        {PR_STATES.map((p) => (
          <FilterChip
            key={p.key}
            on={prStates.has(p.key)}
            onClick={() => togglePr(p.key)}
            color={p.key === "none" ? "var(--wt-muted)" : PR_COLOR[p.key]}
          >
            {p.label}
          </FilterChip>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <Icon name="sort" size={14} style={{ color: "var(--wt-muted)" }} />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md px-1.5 py-0.5 text-[11px] outline-none"
            style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border)", color: "var(--wt-fg-dim)" }}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2 text-[11px]" style={{ color: "var(--wt-muted)" }}>
        <span>{filtered.length} 件</span>
        {hiddenByWt > 0 && <span>· 作成済み {hiddenByWt} 件を非表示</span>}
        {prStates.size > 0 && (
          <button type="button" onClick={() => setPrStates(new Set())} style={{ color: "var(--wt-info)" }}>
            PR 絞り込みを解除
          </button>
        )}
      </div>

      {canCreateNew && (
        <button
          type="button"
          onClick={() => create(q.trim())}
          className="mb-3 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left"
          style={{ background: "var(--wt-accent-soft)", border: "1px solid var(--wt-accent)" }}
        >
          <span className="text-sm">
            新規ブランチ <span className="font-mono font-semibold">{q.trim()}</span> を origin/develop から作成
          </span>
        </button>
      )}

      {branches === null ? (
        <div className="flex items-center gap-2 py-6 text-sm" style={{ color: "var(--wt-muted)" }}>
          <Spinner size={14} /> ブランチを取得中…
        </div>
      ) : (
        <div className="flex max-h-[52vh] flex-col gap-1 overflow-y-auto">
          {filtered.map((b) => (
            <div
              key={b.name}
              className="flex items-center gap-2 rounded-lg px-3 py-2"
              style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[12px] font-medium">{b.name}</span>
                  {b.hasWorktree && <Badge color="var(--wt-muted)">WT あり</Badge>}
                  {b.pr && (
                    <Badge color={PR_COLOR[b.pr.state]}>
                      #{b.pr.number} {b.pr.state}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--wt-muted)" }}>
                  {b.commitRel} · {b.subject}
                </div>
              </div>
              <Button
                size="sm"
                variant={b.hasWorktree ? "ghost" : "primary"}
                disabled={b.hasWorktree}
                onClick={() => create(b.name)}
              >
                {b.hasWorktree ? "作成済" : "作成"}
              </Button>
            </div>
          ))}
          {filtered.length === 0 && !canCreateNew && (
            <div className="py-6 text-center text-sm" style={{ color: "var(--wt-muted)" }}>
              条件に一致するブランチがありません
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
