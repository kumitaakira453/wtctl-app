import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { api } from "../lib/ipc";
import { feActiveFor, samePath } from "../lib/status";
import { GROUPS } from "../lib/topology";
import type { MigrationCompare, VerifyPlan, WorktreeEntry } from "../lib/types";
import { useApp, type Step } from "../state/app";
import { actionBusyAtom, mountsAtom, vitesAtom } from "../state/atoms";
import { Icon } from "./Icon";
import { Badge, Button, CheckBox, Modal, Spinner } from "./ui";

/// 全幅・均一な行。左にチェック、右に任意の trailing 要素。
function Row({
  on,
  onToggle,
  label,
  sub,
  chips,
  disabled,
  trailing,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  sub?: string;
  chips?: React.ReactNode;
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
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-[13px] font-medium">{label}</span>
          {chips}
          {sub && <span className="truncate text-[11px]" style={{ color: "var(--wt-muted)" }}>{sub}</span>}
        </span>
        {trailing}
      </div>
      {children}
    </div>
  );
}

/// migration を group/app ごとにまとめたツリー表示。各 app の適用件数も示す。
/// 分岐点を挟んで、巻き戻す分と適用する分を上下に並べる。
/// どこまで戻ってどこから進むのかが 1 本の線で追えるようにする。
function MigrationTree({ compares }: { compares: MigrationCompare[] }) {
  return (
    <div className="flex flex-col gap-2">
      {compares.map((c) => (
        <div key={`${c.group}/${c.app}`}>
          <div className="flex items-center gap-1.5 text-[11px]">
            <Icon name="folder" size={12} style={{ color: "var(--wt-muted)" }} />
            <span className="font-mono" style={{ color: "var(--wt-fg-dim)" }}>
              {c.group}/{c.app}
            </span>
            {c.rollback.length === 0 && c.apply.length === 0 && (
              <span style={{ color: "var(--wt-muted)" }}>変更なし</span>
            )}
          </div>
          <div className="ml-2 flex flex-col gap-0.5 pl-2" style={{ borderLeft: "1px solid var(--wt-border)" }}>
            {c.rollback.map((name) => (
              <div key={name} className="flex items-center gap-1.5 font-mono text-[11px]">
                <Icon name="arrow_downward" size={11} style={{ color: "var(--wt-danger)" }} />
                <span className="truncate" style={{ color: "var(--wt-danger)" }}>{name}</span>
              </div>
            ))}
            {/* 分岐点。ここまで戻せば両ブランチが揃う */}
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              <Icon name="call_split" size={11} style={{ color: "var(--wt-muted)" }} />
              <span className="truncate" style={{ color: "var(--wt-muted)" }}>
                {c.forkPoint ?? "zero"}
              </span>
              <span className="shrink-0" style={{ color: "var(--wt-muted)", opacity: 0.7 }}>
                分岐点{c.common.length > 0 ? `（共通 ${c.common.length}）` : ""}
              </span>
            </div>
            {c.apply.map((name) => (
              <div key={name} className="flex items-center gap-1.5 font-mono text-[11px]">
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
  // migrate は適用済みを再実行しても何も起きないので、事前の適用状況チェックはしない
  // （showmigrations を待つと開くたびに数秒かかる）。
  const [migration, setMigration] = useState(plan.migrations.length > 0);
  // venv は流用が効いていると作り直されない。合わなくなったときに手で作り直せるようにする。
  const [renewVenv, setRenewVenv] = useState(false);
  const [reuseVenv, setReuseVenv] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .getConfig()
      .then((c) => alive && setReuseVenv(c.reuseVenv))
      .catch(() => alive && setReuseVenv(false));
    return () => {
      alive = false;
    };
  }, []);

  const migGroups = Array.from(new Set(plan.migrations.map((m) => m.group)));

  // 巻き戻しの要否は差し替え中のブランチとの比較で決まる。開くのを待たせないよう後から出す。
  const [compares, setCompares] = useState<MigrationCompare[] | null>(null);
  useEffect(() => {
    if (plan.migrations.length === 0) {
      setCompares([]);
      return;
    }
    let alive = true;
    api
      .migrationCompare(worktree.path)
      .then((c) => alive && setCompares(c))
      .catch(() => alive && setCompares([]));
    return () => {
      alive = false;
    };
  }, [worktree.path, plan]);

  const rollbackApps = (compares ?? []).filter((c) => c.rollback.length > 0);

  const migrationSub =
    plan.migrations.length === 0 ? "新規 migration なし" : `${plan.migrations.length} 件（${migGroups.join(", ")}）`;

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
    // 巻き戻しは差し替えより前。コンテナが切り替わると戻す先の migration ファイルが
    // 消えて `migrate <app> <名前>` が引けなくなる。
    if (migration && rollbackApps.length > 0) {
      steps.push({
        id: "migration-rollback",
        title: "migration 巻き戻し",
        cmd: "migration_rollback_to_target",
        args: {
          apps: rollbackApps.map((c) => ({
            group: c.group,
            app: c.app,
            target: c.forkPoint ?? "zero",
          })),
        },
      });
    }
    if (groups.size > 0) {
      steps.push({
        id: "be",
        title: "BE 差し替え",
        cmd: "be_apply",
        args: {
          path: worktree.path,
          groups: [...groups],
          buildGroups: [...builds].filter((g) => groups.has(g)),
          renewVenv,
        },
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
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--wt-muted)" }}>
            BE 差し替え
          </span>
          {/* `-V` は「その差し替え 1 回・対象サービス全部」に効くので、
              グループ単位の build とは別にここへ置く */}
          <button
            type="button"
            disabled={reuseVenv === false}
            onClick={() => setRenewVenv((v) => !v)}
            className="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
            style={{
              color: renewVenv || reuseVenv === false ? "var(--wt-warn)" : "var(--wt-muted)",
              border: `1px solid ${renewVenv || reuseVenv === false ? "var(--wt-warn)" : "var(--wt-border)"}`,
              background:
                renewVenv || reuseVenv === false ? "color-mix(in srgb, currentColor 12%, transparent)" : "transparent",
              opacity: reuseVenv === false ? 0.6 : 1,
              cursor: reuseVenv === false ? "default" : "pointer",
            }}
            title={
              reuseVenv === false
                ? "設定で venv の流用が無効なので、常に作り直します"
                : "venv をイメージから作り直す（依存が合わなくなったときの復旧。数分かかります）"
            }
          >
            venv を作り直す
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {GROUPS.map((g) => {
            const on = groups.has(g.key);
            const inDiff = plan.groups.includes(g.key);
            const done = swapped.has(g.key);
            return (
              <Row
                key={g.key}
                on={on}
                onToggle={() => setGroups((s) => toggle(s, g.key))}
                label={g.key}
                chips={
                  <>
                    {inDiff && <Badge color="var(--wt-warn)" soft>差分あり</Badge>}
                    {done && <Badge color="var(--wt-ok)" soft>差し替え済み</Badge>}
                  </>
                }
                sub={inDiff || done ? undefined : g.services.join(", ")}
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
            chips={feRunning ? <Badge color="var(--wt-ok)" soft>起動済み</Badge> : undefined}
            sub=":3000 で Vite"
          />
          <Row
            on={migration}
            onToggle={() => setMigration((v) => !v)}
            disabled={plan.migrations.length === 0}
            label="migration を適用"
            sub={migrationSub}
          >
            {migration && plan.migrations.length > 0 && (
              <div className="px-3 pb-2" style={{ borderTop: "1px solid var(--wt-border)" }}>
                <div className="mt-2 mb-1.5 flex items-center gap-1.5 text-[11px]">
                  <Icon name="arrow_upward" size={13} style={{ color: "var(--wt-ok)" }} />
                  <span style={{ color: "var(--wt-fg-dim)" }}>
                    <b>{plan.migrations.length}</b> 件を適用（進める）
                  </span>
                </div>
                {compares === null ? (
                  <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--wt-muted)" }}>
                    <Spinner size={11} /> 差分を確認中…
                  </div>
                ) : (
                  <MigrationTree compares={compares} />
                )}
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
