import { useAtomValue } from "jotai";
import { normalizePath, samePath } from "../lib/status";
import { KNOWN_SERVICES, SERVICE_PORT } from "../lib/topology";
import type { ServiceMount } from "../lib/types";
import { mountsAtom, selectedPathAtom, stackUpAtom } from "../state/atoms";
import { Panel } from "./ui";

function basename(p: string): string {
  return normalizePath(p).split("/").pop() ?? p;
}

function target(m: ServiceMount): { label: string; color: string } {
  if (m.state === "main") return { label: "MAIN", color: "var(--wt-ok)" };
  if (m.state === "worktree")
    return { label: `WT:${basename(m.worktree ?? "")}`, color: "var(--wt-warn)" };
  return { label: "down", color: "var(--wt-danger)" };
}

export function MountsPanel() {
  const mounts = useAtomValue(mountsAtom);
  const stackUp = useAtomValue(stackUpAtom);
  const selected = useAtomValue(selectedPathAtom);
  const byService = new Map(mounts.map((m) => [m.service, m]));

  return (
    <Panel title="BE サービス mount / ポート">
      {!stackUp ? (
        <div className="text-sm" style={{ color: "var(--wt-muted)" }}>
          スタック停止中
        </div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {KNOWN_SERVICES.map((svc) => {
              const m = byService.get(svc);
              if (!m) return null;
              const t = target(m);
              const port = SERVICE_PORT[svc];
              const mine = m.state === "worktree" && selected && samePath(m.worktree, selected);
              return (
                <tr key={svc} style={{ background: mine ? "var(--wt-accent-soft)" : "transparent" }}>
                  <td className="py-1 pr-2 font-mono text-[12px]" style={{ color: "var(--wt-fg-dim)" }}>
                    {svc}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono text-[12px]" style={{ color: "var(--wt-muted)" }}>
                    {port ?? "—"}
                  </td>
                  <td className="py-1 text-right font-mono text-[12px] font-semibold" style={{ color: t.color }}>
                    {t.label}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
