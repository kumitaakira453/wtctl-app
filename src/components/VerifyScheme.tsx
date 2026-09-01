import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { api } from "../lib/ipc";
import { feActiveFor, samePath } from "../lib/status";
import { GROUPS } from "../lib/topology";
import type { VerifyPlan, WorktreeEntry } from "../lib/types";
import { useApp, type Step } from "../state/app";
import { actionBusyAtom, mountsAtom, vitesAtom } from "../state/atoms";
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
function MigrationTree({
  migrations,
  applied,
}: {
  migrations: { group: string; app: string; name: string; label: string }[];
  applied: Set<string>;
}) {
  // 表示順を保ったまま group/app でまとめる
  const tree: { key: string; group: string; app: string; names: { name: string; done: boolean }[] }[] = [];
  for (const m of migrations) {
    const key = `${m.group}/${m.app}`;
    let node = tree.find((t) => t.key === key);
    if (!node) {
      node = { key, group: m.group, app: m.app, names: [] };
      tree.push(node);
    }
    node.names.push({ name: m.name, done: applied.has(m.label) });
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
            {node.names.map((n, i) => (
              <div key={n.name} className="flex items-center gap-1.5 font-mono text-[11px]">
                <span style={{ color: "var(--wt-muted)", opacity: 0.6 }}>{i + 1}.</span>
                <Icon
                  name={n.done ? "check" : "arrow_upward"}
                  size={11}
                  style={{ color: n.done ? "var(--wt-muted)" : "var(--wt-ok)" }}
                />
                <span
                  className="truncate"
                  style={{ color: n.done ? "var(--wt-muted)" : "var(--wt-fg-dim)" }}
                >
                  {n.name}
                </span>
                {n.done && <span style={{ color: "var(--wt-muted)" }}>適用済み</span>}
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
  const mounts = useAtomValue(mountsAtom);
  const vites = useAtomValue(vitesAtom);

  // すでにこの worktree で動いているものは作業が済んでいるので既定では選ばない。
  // 選択自体は残すので、作り直したいときは手で入れ直せる。
  const swapped = new Set(
    GROUPS.filter((g) =>
      g.services.every((svc) =>
        mounts.some((m) => m.service === svc && m.state === "worktree" && samePath(m.worktree, worktree.path)),
      ),
    ).map((g) => g.key),
  );
  const feRunning = feActiveFor(worktree.path, vites);

  const [groups, setGroups] = useState<Set<string>>(() => new Set(plan.groups.filter((g) => !swapped.has(g))));
  const [builds, setBuilds] = useState<Set<string>>(new Set(plan.buildGroups));
  const [fe, setFe] = useState(plan.fe && !feRunning);
  const [migration, setMigration] = useState(plan.migrations.length > 0);

  // 適用済み migration は showmigrations で判定する（差し替え前は判定できず未適用扱い）。
  const [applied, setApplied] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (plan.migrations.length === 0) {
      setApplied(new Set());
      return;
    }
    let alive = true;
    const apps = Array.from(new Map(plan.migrations.map((m) => [`${m.group}/${m.app}`, m])).values()).map((m) => ({
      group: m.group,
      app: m.app,
    }));
    api
      .migrationApplied(apps)
      .then((labels) => alive && setApplied(new Set(labels)))
      .catch(() => alive && setApplied(new Set()));
    return () => {
      alive = false;
    };
  }, [plan]);

  const pending = plan.migrations.filter((m) => !applied?.has(m.label));
  const doneCount = plan.migrations.length - pending.length;
  // 判定が届いた時点で既定を決める。以降はユーザーの選択を上書きしない。
  useEffect(() => {
    if (applied) setMigration(pending.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  const migGroups = Array.from(new Set(pending.map((m) => m.group)));

  const migrationSub =
    plan.migrations.length === 0
      ? "新規 migration なし"
      : applied === null
        ? "適用状況を確認中…"
        : pending.length === 0
          ? `${plan.migrations.length} 件すべて適用済み`
          : `${pending.length} 件（${migGroups.join(", ")}）${doneCount > 0 ? ` · 適用済み ${doneCount} 件` : ""}`;

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
            const done = swapped.has(g.key);
            const sub = done
              ? inDiff
                ? "差分あり · この worktree に差し替え済み"
                : "この worktree に差し替え済み"
              : inDiff
                ? "差分あり"
                : g.services.join(", ");
            return (
              <Row
                key={g.key}
                on={on}
                onToggle={() => setGroups((s) => toggle(s, g.key))}
                label={g.key}
                sub={sub}
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
          <Row
            on={fe}
            onToggle={() => setFe((v) => !v)}
            label="FE を起動"
            sub={feRunning ? ":3000 で Vite · この worktree で起動済み" : ":3000 で Vite"}
          />
          <Row
            on={migration}
            onToggle={() => setMigration((v) => !v)}
            disabled={plan.migrations.length === 0 || pending.length === 0}
            label="migration を適用"
            sub={migrationSub}
          >
            {plan.migrations.length > 0 && (
              <div className="px-3 pb-2" style={{ borderTop: "1px solid var(--wt-border)" }}>
                <div className="mt-2 mb-1.5 flex items-center gap-1.5 text-[11px]">
                  <Icon
                    name={pending.length > 0 ? "arrow_upward" : "check"}
                    size={13}
                    style={{ color: pending.length > 0 ? "var(--wt-ok)" : "var(--wt-muted)" }}
                  />
                  <span style={{ color: "var(--wt-fg-dim)" }}>
                    {pending.length > 0 ? (
                      <>
                        <b>{pending.length}</b> 件を適用（進める）
                        {doneCount > 0 && <span style={{ color: "var(--wt-muted)" }}> · {doneCount} 件は適用済み</span>}
                      </>
                    ) : (
                      <span style={{ color: "var(--wt-muted)" }}>すべて適用済みのため実行しません</span>
                    )}
                  </span>
                </div>
                <MigrationTree migrations={plan.migrations} applied={applied ?? new Set()} />
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
