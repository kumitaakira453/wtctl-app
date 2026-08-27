import { openUrl } from "@tauri-apps/plugin-opener";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../hooks/useConfirm";
import { api } from "../lib/ipc";
import { feActiveFor, formatSize, PR_COLOR, samePath } from "../lib/status";
import type { VerifyPlan } from "../lib/types";
import { useApp } from "../state/app";
import {
  actionBusyAtom,
  detailTabAtom,
  disksAtom,
  metasAtom,
  mountsAtom,
  prsAtom,
  selectedPathAtom,
  selectedWorktreeAtom,
  vitesAtom,
  worktreesAtom,
} from "../state/atoms";
import type { ReactNode } from "react";
import { ClaudeMark } from "./ClaudeMark";
import { ClaudeSessions } from "./ClaudeSessions";
import { CommitBrowser } from "./CommitBrowser";
import { Icon } from "./Icon";
import { Badge, Button } from "./ui";
import { VerifyScheme } from "./VerifyScheme";

export function Detail() {
  const wt = useAtomValue(selectedWorktreeAtom);
  const metas = useAtomValue(metasAtom);
  const prs = useAtomValue(prsAtom);
  const disks = useAtomValue(disksAtom);
  const mounts = useAtomValue(mountsAtom);
  const vites = useAtomValue(vitesAtom);
  const { run, runScheme } = useApp();
  const confirm = useConfirm();
  const setWorktrees = useSetAtom(worktreesAtom);
  const setSelected = useSetAtom(selectedPathAtom);
  const [scheme, setScheme] = useState<VerifyPlan | null>(null);
  const [tab, setTab] = useAtom(detailTabAtom);
  // 起動・停止・検証は同じスタックを触るので、実行中は新しい操作を受け付けない。
  const busy = useAtomValue(actionBusyAtom);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  if (!wt) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--wt-muted)" }}>
        worktree を選択してください
      </div>
    );
  }

  const path = wt.path;
  const entry = metas[path];
  const plan = entry?.plan;
  const meta = entry?.meta;
  const pr = wt.branch ? prs[wt.branch] : undefined;
  const hasMenu = !wt.isMain || (plan?.migrations.length ?? 0) > 0;
  // この worktree 固有の稼働状況（選択で変わる。グローバルなスタックパネルとは別）
  const beHere = mounts.filter((m) => m.state === "worktree" && samePath(m.worktree, path)).map((m) => m.service);
  const feHere = feActiveFor(path, vites);

  const openScheme = async () => setScheme(plan ?? (await api.planFor(path)));

  const removeAction = async (cmd: "delete_worktree" | "teardown_worktree", label: string) => {
    setMenu(false);
    const dirty = await api.isDirty(path);
    const msg = dirty
      ? `${wt.name} に未コミット変更があります。破棄して${label}しますか？`
      : `${wt.name} を${label}しますか？`;
    if (!(await confirm(msg, dirty, label))) return;
    const ok = await run(label, cmd, { path, force: dirty });
    if (ok) {
      // 成功時は一覧から即座に除去し選択を外す（フル更新も afterDone で走る）
      setWorktrees((list) => list.filter((w) => w.path !== path));
      setSelected(null);
    }
  };

  const rollbackMigration = async () => {
    setMenu(false);
    const p = plan ?? (await api.planFor(path));
    if (p.migrations.length === 0) return;
    if (await confirm(`${wt.name} の migration を base まで巻き戻しますか？`, true, "巻き戻す")) {
      await runScheme([
        {
          id: "rollback",
          title: "migration 戻し",
          cmd: "migration_rollback_to_base",
          args: {
            worktree: path,
            base: p.base,
            apps: p.migrations.map((m) => ({ group: m.group, app: m.app, appdir: m.appdir })),
          },
        },
      ]);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ヘッダ + 操作（固定・非スクロール） */}
      <div className="shrink-0 px-5 pb-4 pt-5">
        <div className="flex items-center gap-2">
          {wt.created && <Icon name="add_circle" size={16} style={{ color: "var(--wt-accent)" }} />}
          <span className="text-xl font-semibold tracking-tight">{wt.isMain ? "(main)" : wt.name}</span>
          {meta?.dirty && <Badge color="var(--wt-warn)" soft>● 変更あり</Badge>}
          {pr && (
            <button type="button" onClick={() => void openUrl(pr.url)} title="PR を開く" className="wt-no-drag">
              <Badge color={PR_COLOR[pr.state]} soft>
                #{pr.number} {pr.state}
              </Badge>
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[12px]" style={{ color: "var(--wt-muted)" }}>
          <span className="font-mono">
            {wt.branch ?? wt.head ?? "?"}
            {meta && meta.ahead > 0 ? ` +${meta.ahead}` : ""}
          </span>
          {meta && <span>· {meta.commitRel}</span>}
          <span>· {formatSize(disks[path])}</span>
          {meta && !meta.hasUpstream && <Badge color="var(--wt-accent2, #a78bfa)">未 push</Badge>}
        </div>
        {meta?.subject && (
          <div className="mt-1 truncate text-[13px]" style={{ color: "var(--wt-fg-dim)" }}>
            {meta.subject}
          </div>
        )}
        {/* この worktree 固有の稼働状況（タブで変わる） */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {wt.isMain ? (
            <span className="text-[12px]" style={{ color: "var(--wt-muted)" }}>
              メインチェックアウト（既定の稼働）
            </span>
          ) : beHere.length === 0 && !feHere ? (
            <span className="text-[12px]" style={{ color: "var(--wt-muted)" }}>
              この worktree は BE に未差し替え（main が稼働中）
            </span>
          ) : (
            <>
              {beHere.length > 0 && (
                <Badge color="var(--wt-warn)" soft>
                  ● BE 稼働（{beHere.join(", ")}）
                </Badge>
              )}
              {feHere && (
                <Badge color="var(--wt-info)" soft>
                  ▤ FE :3000 稼働
                </Badge>
              )}
            </>
          )}
        </div>
      </div>

      {/* アクション: 検証と操作を左に隣接配置し、右側にプランのラベルを置く */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-4">
        <Button
          variant="primary"
          icon="play_arrow"
          disabled={busy}
          title={busy ? "他の操作の実行中です" : undefined}
          onClick={openScheme}
        >
          検証
        </Button>
        <div className="relative" ref={menuRef}>
          <Button
            variant="default"
            disabled={!hasMenu || busy}
            onClick={() => setMenu((v) => !v)}
            title={busy ? "他の操作の実行中です" : hasMenu ? "その他の操作" : "操作はありません"}
          >
            操作
            <Icon name="expand_more" size={16} style={{ opacity: 0.7 }} />
          </Button>
          {menu && hasMenu && (
            <div
              className="wt-fade absolute left-0 z-20 mt-1 w-60 overflow-hidden rounded-xl py-1"
              style={{ background: "var(--wt-bg)", border: "1px solid var(--wt-border-strong)", boxShadow: "var(--wt-shadow)" }}
            >
              {plan && plan.migrations.length > 0 && (
                <MenuItem icon="undo" label="migration を base へ戻す" onClick={rollbackMigration} />
              )}
              {!wt.isMain && (
                <>
                  <MenuItem icon="delete" label="worktree を削除" onClick={() => removeAction("delete_worktree", "削除")} />
                  <MenuItem
                    icon="drive_file_move"
                    label="削除してメインで開く"
                    onClick={() => removeAction("teardown_worktree", "撤去")}
                  />
                </>
              )}
            </div>
          )}
        </div>
        <span className="mx-0.5 h-5 w-px" style={{ background: "var(--wt-border)" }} />
        <PlanChips plan={plan} />
      </div>

      {/* タブ: 差分 / Claude セッション */}
      <div className="flex shrink-0 items-center gap-4 px-5">
        <TabButton icon="difference" label="差分" on={tab === "diff"} onClick={() => setTab("diff")} />
        <TabButton
          node={<ClaudeMark size={16} />}
          label="Claude セッション"
          on={tab === "claude"}
          onClick={() => setTab("claude")}
        />
      </div>
      <div className="min-h-0 flex-1">
        {tab === "diff" ? (
          <CommitBrowser path={path} dirty={!!meta?.dirty} />
        ) : (
          <ClaudeSessions path={path} />
        )}
      </div>

      {scheme && <VerifyScheme worktree={wt} plan={scheme} onClose={() => setScheme(null)} />}
    </div>
  );
}

/// 検証対象（BE グループ / FE / migration）を色分けラベルで示す。
function PlanChips({ plan }: { plan: VerifyPlan | undefined }) {
  if (!plan) {
    return <span className="text-[12px]" style={{ color: "var(--wt-muted)" }}>…</span>;
  }
  if (plan.error) {
    return <Badge color="var(--wt-danger)" soft>検出エラー</Badge>;
  }
  const empty = plan.groups.length === 0 && !plan.fe && plan.migrations.length === 0;
  if (empty) {
    return <span className="text-[12px]" style={{ color: "var(--wt-muted)" }}>変更なし</span>;
  }
  const migTip = plan.migrations.map((m) => `↑ ${m.group}/${m.app}: ${m.name}`).join("\n");
  return (
    <>
      {plan.groups.map((g) => (
        <span key={g} style={{ cursor: "default" }}>
          <Badge color="var(--wt-warn)" soft>
            BE {g}
            {plan.buildGroups.includes(g) ? " +build" : ""}
          </Badge>
        </span>
      ))}
      {plan.fe && (
        <span style={{ cursor: "default" }}>
          <Badge color="var(--wt-info)" soft>
            FE
          </Badge>
        </span>
      )}
      {plan.migrations.length > 0 && (
        <span style={{ cursor: "default" }} title={`適用される migration（進める）\n${migTip}`}>
          <Badge color="var(--wt-ok)" soft>
            migration ×{plan.migrations.length}
          </Badge>
        </span>
      )}
    </>
  );
}

function TabButton({
  icon,
  node,
  label,
  on,
  onClick,
}: {
  icon?: string;
  node?: ReactNode;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 py-2 text-[13px] font-medium transition-colors"
      style={{
        color: on ? "var(--wt-fg)" : "var(--wt-muted)",
        borderBottom: `2px solid ${on ? "var(--wt-accent)" : "transparent"}`,
      }}
    >
      {node ?? <Icon name={icon!} size={16} />}
      {label}
    </button>
  );
}

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors"
      style={{ color: "var(--wt-fg)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--wt-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={16} style={{ color: "var(--wt-muted)" }} />
      {label}
    </button>
  );
}
