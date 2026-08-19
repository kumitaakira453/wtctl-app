import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/ipc";
import { PR_COLOR } from "../lib/status";
import type { BranchInfo } from "../lib/types";
import { useApp } from "../state/app";
import { Badge, Button, Modal, Spinner } from "./ui";

export function BranchPicker({ onClose }: { onClose: () => void }) {
  const { run } = useApp();
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.getBranches().then(setBranches).catch(() => setBranches([]));
  }, []);

  const filtered = useMemo(() => {
    const list = branches ?? [];
    const query = q.trim().toLowerCase();
    return query ? list.filter((b) => b.name.toLowerCase().includes(query)) : list;
  }, [branches, q]);

  const create = async (branch: string) => {
    onClose();
    await run(`worktree 作成: ${branch}`, "create_worktree", { branch });
  };

  const canCreateNew = q.trim() && !filtered.some((b) => b.name === q.trim());

  return (
    <Modal title="worktree を作成" onClose={onClose} width={640}>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ブランチを検索、または新規ブランチ名を入力"
        className="mb-3 w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border-strong)", color: "var(--wt-fg)" }}
      />

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
              一致するブランチがありません
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
