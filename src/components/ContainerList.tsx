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

// mount 先（場所）。MAIN=稼働中の既定 → 緑、WT=差し替え中 → 琥珀。
const MOUNT_META: Record<MountState, { color: string; label: (m: ServiceMount) => string } | null> = {
  main: { color: "var(--wt-ok)", label: () => "MAIN" },
  worktree: { color: "var(--wt-warn)", label: (m) => `WT:${basename(m.worktree ?? "")}` },
  down: null,
};

// 実行状態（FE の 稼働中/応答なし/停止 と同等の health）。
function health(m: ServiceMount): { color: string; label: string } {
  if (m.containerState !== "running") return { color: "var(--wt-danger)", label: "停止" };
  if (m.responding === false) return { color: "var(--wt-warn)", label: "応答なし" };
  return { color: "var(--wt-ok)", label: "稼働中" };
}

export function ContainerList() {
  const mounts = useAtomValue(mountsAtom);
  const stackUp = useAtomValue(stackUpAtom);
  const selected = useAtomValue(selectedPathAtom);
  const [logOpen, setLogOpen] = useState(false);
  const byService = new Map(mounts.map((m) => [m.service, m]));
  // ログの初期タブは稼働中のサービス優先（無ければ bff）
  const defaultLog =
    KNOWN_SERVICES.find((s) => byService.get(s)?.containerState === "running") ?? KNOWN_SERVICES[0];

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
        {stackUp && (
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            title="docker ログを見る（タブで全サービス切替）"
            className="rounded-md p-1 transition-colors"
            style={{ color: "var(--wt-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--wt-fg)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--wt-muted)")}
          >
            <Icon name="terminal" size={16} />
          </button>
        )}
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
            const mount = MOUNT_META[m.state];
            const h = health(m);
            const port = SERVICE_PORT[svc];
            const mine = m.state === "worktree" && selected != null && samePath(m.worktree, selected);
            return (
              <div
                key={svc}
                className="flex items-center gap-2.5 px-4 py-2"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--wt-border)",
                  background: mine ? "var(--wt-accent-soft)" : "transparent",
                }}
              >
                <span
                  className="inline-block shrink-0 rounded-full"
                  style={{ width: 8, height: 8, background: h.color }}
                  title={h.label}
                />
                {/* 名前は切り詰めない。port/health は 2 行目に小さく置く */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-mono text-[12.5px] leading-tight" style={{ color: "var(--wt-fg)" }}>
                    {svc}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[10.5px]" style={{ color: "var(--wt-muted)" }}>
                    <span className="font-mono">{port ? `:${port}` : "—"}</span>
                    {h.label !== "稼働中" && <span style={{ color: h.color }}>{h.label}</span>}
                  </span>
                </div>
                {/* mount ピルは行右端に固定して位置を揃える */}
                {mount && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                    style={{ color: mount.color, border: `1px solid ${mount.color}` }}
                  >
                    {mount.label(m)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {logOpen && <LogsModal initial={defaultLog} onClose={() => setLogOpen(false)} />}
    </div>
  );
}
