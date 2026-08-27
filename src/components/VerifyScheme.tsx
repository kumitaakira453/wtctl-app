import { useAtomValue } from "jotai";
import { useState } from "react";
import { GROUPS } from "../lib/topology";
import type { VerifyPlan, WorktreeEntry } from "../lib/types";
import { useApp, type Step } from "../state/app";
import { actionBusyAtom } from "../state/atoms";
import { Icon } from "./Icon";
import { Button, Modal } from "./ui";

function CheckBox({ on }: { on: boolean }) {
  return (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center rounded"
      style={{
        background: on ? "var(--wt-accent)" : "transparent",
        border: `1.5px solid ${on ? "var(--wt-accent)" : "var(--wt-border-strong)"}`,
      }}
    >
      {on && <Icon name="check" size={12} style={{ color: "var(--wt-accent-fg)" }} />}
    </span>
  );
}

/// 全幅・均一な行。左にチェック、右に任意の trailing 要素。
function Row({
  on,
  onToggle,
  label,
  sub,
  disabled,
  trailing,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  sub?: string;
  disabled?: boolean;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg"
      style={{
        background: on ? "var(--wt-accent-soft)" : "var(--wt-panel)",
        border: `1px solid ${on ? "var(--wt-accent)" : "var(--wt-border)"}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div
        role="button"
        onClick={disabled ? undefined : onToggle}
        className="flex items-center gap-2.5 px-3 py-2"
        style={{ cursor: disabled ? "default" : "pointer" }}
      >
        <CheckBox on={on} />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-[13px] font-medium">{label}</span>
          {sub && <span className="ml-2 text-[11px]" style={{ color: "var(--wt-muted)" }}>{sub}</span>}
        </span>
        {trailing}
      </div>
      {children}
    </div>
  );
}

/// migration を group/app ごとにまとめたツリー表示。各 app の適用件数も示す。
function MigrationTree({ migrations }: { migrations: { group: string; app: string; name: string; label: string }[] }) {
  // 表示順を保ったまま group/app でまとめる
  const tree: { key: string; group: string; app: string; names: string[] }[] = [];
  for (const m of migrations) {
    const key = `${m.group}/${m.app}`;
    let node = tree.find((t) => t.key === key);
    if (!node) {
      node = { key, group: m.group, app: m.app, names: [] };
      tree.push(node);
    }
    node.names.push(m.name);
  }
  return (
    <div className="flex flex-col gap-1.5">
      {tree.map((node) => (
        <div key={node.key}>
          <div className="flex items-center gap-1.5 text-[11px]">
            <Icon name="folder" size={12} style={{ color: "var(--wt-muted)" }} />
            <span className="font-mono" style={{ color: "var(--wt-fg-dim)" }}>
              {node.group}/{node.app}
            </span>
            <span style={{ color: "var(--wt-muted)" }}>({node.names.length})</span>
          </div>
          <div className="ml-2 flex flex-col gap-0.5 pl-2" style={{ borderLeft: "1px solid var(--wt-border)" }}>
            {node.names.map((name, i) => (
              <div key={name} className="flex items-center gap-1.5 font-mono text-[11px]">
                <span style={{ color: "var(--wt-muted)", opacity: 0.6 }}>{i + 1}.</span>
                <Icon name="arrow_upward" size={11} style={{ color: "var(--wt-ok)" }} />
                <span className="truncate" style={{ color: "var(--wt-fg-dim)" }}>{name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
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
  // 実行中に別の検証を重ねると同じサービスを同時に recreate してしまう。
  const busy = useAtomValue(actionBusyAtom);
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
    // FE は docker に依存しないので BE 差し替え・migration を待たずに先行させる。
    if (fe) {
      steps.push({ id: "fe", title: "FE 起動", cmd: "fe", args: { path: worktree.path }, parallel: true });
    }
    if (groups.size > 0) {
      steps.push({
        id: "be",
        title: "BE 差し替え",
        cmd: "be_apply",
        args: { path: worktree.path, groups: [...groups], buildGroups: [...builds].filter((g) => groups.has(g)) },
      });
    }
    if (migration && migGroups.length > 0) {
      steps.push({ id: "migration", title: "migration 適用", cmd: "migration_apply_all", args: { groups: migGroups } });
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
              <Row
                key={g.key}
                on={on}
                onToggle={() => setGroups((s) => toggle(s, g.key))}
                label={g.key}
                sub={inDiff ? "差分あり" : g.services.join(", ")}
                trailing={
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (on) setBuilds((s) => toggle(s, g.key));
                    }}
                    disabled={!on}
                    className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
                    style={{
                      color: builds.has(g.key) ? "var(--wt-warn)" : "var(--wt-muted)",
                      border: `1px solid ${builds.has(g.key) ? "var(--wt-warn)" : "var(--wt-border)"}`,
                      opacity: on ? 1 : 0.35,
                      cursor: on ? "pointer" : "default",
                    }}
                    title="依存を再ビルド（uv.lock/pyproject 変更時）"
                  >
                    build
                  </button>
                }
              />
            );
          })}
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--wt-muted)" }}>
          その他
        </div>
        <div className="flex flex-col gap-1.5">
          <Row on={fe} onToggle={() => setFe((v) => !v)} label="FE を起動" sub=":3000 で Vite" />
          <Row
            on={migration}
            onToggle={() => setMigration((v) => !v)}
            disabled={plan.migrations.length === 0}
            label="migration を適用"
            sub={plan.migrations.length === 0 ? "新規 migration なし" : `${plan.migrations.length} 件（${migGroups.join(", ")}）`}
          >
            {migration && plan.migrations.length > 0 && (
              <div className="px-3 pb-2" style={{ borderTop: "1px solid var(--wt-border)" }}>
                <div className="mt-2 mb-1.5 flex items-center gap-1.5 text-[11px]">
                  <Icon name="arrow_upward" size={13} style={{ color: "var(--wt-ok)" }} />
                  <span style={{ color: "var(--wt-fg-dim)" }}>
                    <b>{plan.migrations.length}</b> 件を適用（進める）
                  </span>
                </div>
                <MigrationTree migrations={plan.migrations} />
              </div>
            )}
          </Row>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "var(--wt-muted)" }}>
          {busy ? "他の操作の実行中です" : "選択したステップを上から順に実行します"}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="primary" icon="play_arrow" onClick={run} disabled={nothing || busy}>
            実行
          </Button>
        </div>
      </div>
    </Modal>
  );
}
