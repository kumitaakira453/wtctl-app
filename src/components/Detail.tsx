import { openUrl } from "@tauri-apps/plugin-opener";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useConfirm } from "../hooks/useConfirm";
import { api } from "../lib/ipc";
import { formatSize, planChips, PR_COLOR } from "../lib/status";
import type { VerifyPlan } from "../lib/types";
import { useApp } from "../state/app";
import { disksAtom, metasAtom, prsAtom, selectedWorktreeAtom } from "../state/atoms";
import { BeGroupModal } from "./BeGroupModal";
import { FePanel } from "./FePanel";
import { Icon } from "./Icon";
import { MigrationModal } from "./MigrationModal";
import { MountsPanel } from "./MountsPanel";
import { Badge, Button } from "./ui";

export function Detail() {
  const wt = useAtomValue(selectedWorktreeAtom);
  const metas = useAtomValue(metasAtom);
  const prs = useAtomValue(prsAtom);
  const disks = useAtomValue(disksAtom);
  const { run } = useApp();
  const confirm = useConfirm();
  const [beGroupOpen, setBeGroupOpen] = useState(false);
  const [migPlan, setMigPlan] = useState<VerifyPlan | null>(null);

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
  const chips = planChips(plan);

  const getPlan = async (): Promise<VerifyPlan> => plan ?? (await api.planFor(path));

  const onVerify = async () => {
    const p = await getPlan();
    if (p.error) return;
    if (p.isEmpty) {
      if (!(await confirm(`${wt.name} に検証対象の差分がありません。それでも実行しますか？`))) return;
    }
    if (await confirm(`${wt.name} を検証（BE+FE）しますか？`)) {
      await run(`verify: ${wt.name}`, "verify", { path });
    }
  };

  const onBe = async () => {
    const p = await getPlan();
    if (p.hasBackend) {
      if (await confirm(`${wt.name} の BE を差し替えますか？（${p.groups.join(",")}）`)) {
        await run("BE 差し替え", "be_apply", { path, groups: p.groups, buildGroups: p.buildGroups });
      }
    } else {
      setBeGroupOpen(true);
    }
  };

  const onBeGroupPick = async (group: string) => {
    setBeGroupOpen(false);
    if (await confirm(`${wt.name} の ${group} を起動し直しますか？（差分なし・指定）`)) {
      await run("BE 差し替え", "be_apply", { path, groups: [group], buildGroups: [] });
    }
  };

  const onFe = async () => {
    if (await confirm(`${wt.name} の FE を :3000 で起動しますか？`)) {
      await run("FE 起動", "fe", { path });
    }
  };

  const onMigration = async () => setMigPlan(await getPlan());

  const removeAction = async (cmd: "delete_worktree" | "teardown_worktree", label: string) => {
    const dirty = await api.isDirty(path);
    const msg = dirty
      ? `${wt.name} に未コミット変更があります。破棄して${label}しますか？`
      : `${wt.name} を${label}しますか？`;
    if (await confirm(msg, dirty)) {
      await run(label, cmd, { path, force: dirty });
    }
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      {/* ヘッダ */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {wt.created && <Icon name="add_circle" size={16} style={{ color: "var(--wt-accent)" }} />}
          <span className="text-xl font-semibold tracking-tight">{wt.isMain ? "(main)" : wt.name}</span>
          {meta?.dirty && <Badge color="var(--wt-warn)" soft>● 変更あり</Badge>}
          {pr && (
            <button
              type="button"
              onClick={() => void openUrl(pr.url)}
              title="PR を開く"
              className="wt-no-drag"
            >
              <Badge color={PR_COLOR[pr.state]} soft>
                #{pr.number} {pr.state}
              </Badge>
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[12px]" style={{ color: "var(--wt-muted)" }}>
          <span className="font-mono">{wt.branch ?? wt.head ?? "?"}{meta && meta.ahead > 0 ? ` +${meta.ahead}` : ""}</span>
          {meta && <span>· {meta.commitRel}</span>}
          <span>· {formatSize(disks[path])}</span>
          {meta && !meta.hasUpstream && <Badge color="var(--wt-accent2, #a78bfa)">未 push</Badge>}
        </div>
        {meta?.subject && (
          <div className="mt-1 truncate text-[13px]" style={{ color: "var(--wt-fg-dim)" }}>
            {meta.subject}
          </div>
        )}
      </div>

      {/* プラン chips */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <Badge key={c} color={c === "変更なし" ? "var(--wt-muted)" : "var(--wt-accent)"} soft={c !== "変更なし"}>
            {c}
          </Badge>
        ))}
      </div>

      {/* アクション */}
      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="primary" icon="play_arrow" onClick={onVerify}>
          検証
        </Button>
        <Button icon="dns" onClick={onBe}>
          BE 差し替え
        </Button>
        <Button icon="web" onClick={onFe}>
          FE 起動
        </Button>
        <Button icon="database" onClick={onMigration} disabled={!plan || plan.migrations.length === 0}>
          migration
        </Button>
        <div className="flex-1" />
        {!wt.isMain && (
          <>
            <Button variant="ghost" icon="delete" onClick={() => removeAction("delete_worktree", "削除")}>
              削除
            </Button>
            <Button variant="ghost" icon="eject" onClick={() => removeAction("teardown_worktree", "撤去")}>
              撤去
            </Button>
          </>
        )}
      </div>

      {/* パネル */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <MountsPanel />
        <FePanel />
      </div>

      {beGroupOpen && <BeGroupModal onPick={onBeGroupPick} onClose={() => setBeGroupOpen(false)} />}
      {migPlan && <MigrationModal worktree={path} plan={migPlan} onClose={() => setMigPlan(null)} />}
    </div>
  );
}
