import { useState } from "react";
import { useConfirm } from "../hooks/useConfirm";
import { api, errorMessage } from "../lib/ipc";
import type { VerifyPlan } from "../lib/types";
import { useApp } from "../state/app";
import { Button, Modal } from "./ui";

export function MigrationModal({
  worktree,
  plan,
  onClose,
}: {
  worktree: string;
  plan: VerifyPlan;
  onClose: () => void;
}) {
  const { run } = useApp();
  const confirm = useConfirm();
  const [show, setShow] = useState<Record<string, string>>({});

  const migs = plan.migrations;

  const doShow = async (group: string, app: string) => {
    try {
      const text = await api.migrationShow(group, app);
      setShow((s) => ({ ...s, [`${group}/${app}`]: text }));
    } catch (e) {
      setShow((s) => ({ ...s, [`${group}/${app}`]: errorMessage(e) }));
    }
  };

  const rollback = async (group: string, app: string, appdir: string) => {
    const target = await api.rollbackTarget(worktree, appdir, plan.base);
    if (await confirm(`${group}/${app} を ${target} まで巻き戻しますか？`, true)) {
      await run(`rollback ${app}`, "migration_rollback", { group, app, target });
    }
  };

  return (
    <Modal title="migration" onClose={onClose} width={640}>
      {migs.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--wt-muted)" }}>
          この worktree に新規 migration はありません。
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--wt-muted)" }}>
              base: {plan.base ?? "?"} / {migs.length} 件
            </span>
            <Button
              variant="primary"
              icon="playlist_add_check"
              onClick={async () => {
                if (await confirm(`検出した全グループの migration を適用しますか？（${plan.groups.join(", ")}）`)) {
                  await run("migration 適用", "migration_apply_all", { groups: plan.groups });
                }
              }}
            >
              全グループ適用
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {migs.map((m) => {
              const key = `${m.group}/${m.app}`;
              return (
                <div
                  key={m.label}
                  className="rounded-lg p-3"
                  style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border)" }}
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[12px]">{m.name}</div>
                      <div className="text-[11px]" style={{ color: "var(--wt-muted)" }}>
                        {m.group} / {m.app}
                      </div>
                    </div>
                    <div className="ml-auto flex gap-1.5">
                      <Button size="sm" icon="visibility" onClick={() => doShow(m.group, m.app)}>
                        確認
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        icon="arrow_upward"
                        onClick={async () => {
                          if (await confirm(`${m.group}/${m.app} を適用しますか？`)) {
                            await run(`apply ${m.app}`, "migration_apply", { group: m.group, app: m.app });
                          }
                        }}
                      >
                        適用
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon="arrow_downward"
                        onClick={() => rollback(m.group, m.app, m.appdir)}
                      >
                        巻き戻し
                      </Button>
                    </div>
                  </div>
                  {show[key] != null && (
                    <pre
                      className="log-line mt-2 max-h-40 overflow-auto rounded p-2"
                      style={{ background: "var(--wt-bg)", color: "var(--wt-fg-dim)" }}
                    >
                      {show[key]}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
