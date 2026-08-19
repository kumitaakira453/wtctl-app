import { useState } from "react";
import { GROUPS } from "../lib/topology";
import type { VerifyPlan, WorktreeEntry } from "../lib/types";
import { useApp, type Step } from "../state/app";
import { Icon } from "./Icon";
import { Button, Modal } from "./ui";

function Check({
  on,
  onToggle,
  label,
  sub,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  sub?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors"
      style={{ background: on ? "var(--wt-accent-soft)" : "var(--wt-panel)", border: `1px solid ${on ? "var(--wt-accent)" : "var(--wt-border)"}`, opacity: disabled ? 0.5 : 1 }}
    >
      <span
        className="grid h-4 w-4 shrink-0 place-items-center rounded"
        style={{ background: on ? "var(--wt-accent)" : "transparent", border: `1.5px solid ${on ? "var(--wt-accent)" : "var(--wt-border-strong)"}` }}
      >
        {on && <Icon name="check" size={12} style={{ color: "var(--wt-accent-fg)" }} />}
      </span>
      <span className="min-w-0">
        <span className="text-[13px] font-medium">{label}</span>
        {sub && <span className="ml-2 text-[11px]" style={{ color: "var(--wt-muted)" }}>{sub}</span>}
      </span>
    </button>
  );
}

/// 検証スキーム: BE グループ / FE / migration をトグルして一括実行する。
export function VerifyScheme({
  worktree,
  plan,
  onClose,
}: {
  worktree: WorktreeEntry;
  plan: VerifyPlan;
  onClose: () => void;
}) {
  const { runScheme } = useApp();
  const [groups, setGroups] = useState<Set<string>>(new Set(plan.groups));
  const [builds, setBuilds] = useState<Set<string>>(new Set(plan.buildGroups));
  const [fe, setFe] = useState(plan.fe);
  const [migration, setMigration] = useState(plan.migrations.length > 0);

  const migGroups = Array.from(new Set(plan.migrations.map((m) => m.group)));

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const run = async () => {
    const steps: Step[] = [];
    if (groups.size > 0) {
      steps.push({
        id: "be",
        title: "BE 差し替え",
        cmd: "be_apply",
        args: {
          path: worktree.path,
          groups: [...groups],
          buildGroups: [...builds].filter((g) => groups.has(g)),
        },
      });
    }
    if (migration && migGroups.length > 0) {
      steps.push({
        id: "migration",
        title: "migration 適用",
        cmd: "migration_apply_all",
        args: { groups: migGroups },
      });
    }
    if (fe) {
      steps.push({ id: "fe", title: "FE 起動", cmd: "fe", args: { path: worktree.path } });
    }
    onClose();
    await runScheme(steps);
  };

  const nothing = groups.size === 0 && !fe && !migration;

  return (
    <Modal title={`検証スキーム — ${worktree.name}`} onClose={onClose} width={560}>
      <div className="mb-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--wt-muted)" }}>
          BE 差し替え
        </div>
        <div className="flex flex-col gap-1.5">
          {GROUPS.map((g) => {
            const on = groups.has(g.key);
            const inDiff = plan.groups.includes(g.key);
            return (
              <div key={g.key} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Check
                    on={on}
                    onToggle={() => setGroups((s) => toggle(s, g.key))}
                    label={g.key}
                    sub={inDiff ? "差分あり" : g.services.join(", ")}
                  />
                </div>
                {on && (
                  <button
                    type="button"
                    onClick={() => setBuilds((s) => toggle(s, g.key))}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium"
                    style={{
                      color: builds.has(g.key) ? "var(--wt-warn)" : "var(--wt-muted)",
                      border: `1px solid ${builds.has(g.key) ? "var(--wt-warn)" : "var(--wt-border)"}`,
                    }}
                    title="依存を再ビルド（uv.lock/pyproject 変更時）"
                  >
                    build
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-1.5">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--wt-muted)" }}>
          その他
        </div>
        <Check on={fe} onToggle={() => setFe((v) => !v)} label="FE を起動" sub=":3000 で Vite" />
        <Check
          on={migration}
          onToggle={() => setMigration((v) => !v)}
          disabled={plan.migrations.length === 0}
          label="migration を適用"
          sub={
            plan.migrations.length === 0
              ? "新規 migration なし"
              : `${plan.migrations.length} 件（${migGroups.join(", ")}）`
          }
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "var(--wt-muted)" }}>
          選択したステップを上から順に実行します
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="primary" icon="play_arrow" onClick={run} disabled={nothing}>
            実行
          </Button>
        </div>
      </div>
    </Modal>
  );
}
