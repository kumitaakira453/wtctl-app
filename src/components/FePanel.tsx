import { useAtomValue } from "jotai";
import { normalizePath } from "../lib/status";
import { mainFeAtom, mainFePortAtom, vitesAtom } from "../state/atoms";
import { Panel } from "./ui";

function basename(p: string): string {
  return normalizePath(p).split("/").pop() ?? p;
}

export function FePanel() {
  const vites = useAtomValue(vitesAtom);
  const mainFe = useAtomValue(mainFeAtom);
  const port = useAtomValue(mainFePortAtom);

  const tracked = vites.find((v) => v.port === port);
  let occupant: string;
  let state: { label: string; color: string };
  if (tracked) {
    occupant = basename(tracked.worktree);
    state = { label: "稼働中", color: "var(--wt-ok)" };
  } else if (mainFe.listening) {
    occupant = "(外部/メイン)";
    state = mainFe.responding
      ? { label: "稼働中", color: "var(--wt-ok)" }
      : { label: "応答なし", color: "var(--wt-warn)" };
  } else {
    occupant = "—";
    state = { label: "停止", color: "var(--wt-muted)" };
  }

  return (
    <Panel title="FE dev server（:3000）">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-mono font-semibold" style={{ color: "var(--wt-info)" }}>
          :{port}
        </span>
        <span style={{ color: "var(--wt-fg-dim)" }}>{occupant}</span>
        <span className="ml-auto font-semibold" style={{ color: state.color }}>
          {state.label}
        </span>
      </div>
      <div className="mt-1 font-mono text-[11px]" style={{ color: "var(--wt-muted)" }}>
        http://localhost:{port}/
      </div>
      <div className="mt-1 text-[10px]" style={{ color: "var(--wt-muted)" }}>
        常に :{port} で単一起動（並行しない・起動時に既存を停止）
      </div>
    </Panel>
  );
}
