import { useAtomValue } from "jotai";
import { useState } from "react";
import { normalizePath, samePath } from "../lib/status";
import { KNOWN_SERVICES, SERVICE_PORT } from "../lib/topology";
import type { MountState, ServiceMount } from "../lib/types";
import { mountsAtom, selectedPathAtom, stackUpAtom } from "../state/atoms";
import { Icon } from "./Icon";
import { LogsModal } from "./LogsModal";

function basename(p: string): string {
  return normalizePath(p).split("/").pop() ?? p;
}

const STATE_META: Record<MountState, { color: string; label: (m: ServiceMount) => string }> = {
  main: { color: "var(--wt-ok)", label: () => "MAIN" },
  worktree: { color: "var(--wt-warn)", label: (m) => `WT:${basename(m.worktree ?? "")}` },
  down: { color: "var(--wt-muted)", label: () => "停止" },
};

export function ContainerList() {
  const mounts = useAtomValue(mountsAtom);
  const stackUp = useAtomValue(stackUpAtom);
  const selected = useAtomValue(selectedPathAtom);
  const [logService, setLogService] = useState<string | null>(null);
  const byService = new Map(mounts.map((m) => [m.service, m]));

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--wt-border)" }}
      >
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--wt-muted)" }}>
          BE コンテナ
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-[11px]"
          style={{ color: stackUp ? "var(--wt-ok)" : "var(--wt-muted)" }}
        >
          <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: stackUp ? "var(--wt-ok)" : "var(--wt-muted)" }} />
          {stackUp ? "稼働中" : "停止中"}
        </span>
      </div>

      {!stackUp ? (
        <div className="px-4 py-6 text-center text-sm" style={{ color: "var(--wt-muted)" }}>
          スタックが停止しています
        </div>
      ) : (
        <div>
          {KNOWN_SERVICES.map((svc, i) => {
            const m = byService.get(svc);
            if (!m) return null;
            const meta = STATE_META[m.state];
            const port = SERVICE_PORT[svc];
            const mine = m.state === "worktree" && selected != null && samePath(m.worktree, selected);
            return (
              <div
                key={svc}
                className="group flex items-center gap-3 px-4 py-2"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--wt-border)",
                  background: mine ? "var(--wt-accent-soft)" : "transparent",
                }}
              >
                <span className="inline-block shrink-0 rounded-full" style={{ width: 8, height: 8, background: meta.color }} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" style={{ color: "var(--wt-fg)" }}>
                  {svc}
                </span>
                <span className="shrink-0 font-mono text-[11px]" style={{ color: "var(--wt-muted)", width: 42, textAlign: "right" }}>
                  {port ? `:${port}` : "—"}
                </span>
                <span
                  className="shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold"
                  style={{ color: meta.color, border: `1px solid ${meta.color}`, minWidth: 88, textAlign: "center" }}
                >
                  {meta.label(m)}
                </span>
                <button
                  type="button"
                  onClick={() => setLogService(svc)}
                  title="docker ログを見る"
                  className="shrink-0 rounded-md p-1 transition-colors"
                  style={{ color: "var(--wt-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--wt-fg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--wt-muted)")}
                >
                  <Icon name="terminal" size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {logService && <LogsModal service={logService} onClose={() => setLogService(null)} />}
    </div>
  );
}
