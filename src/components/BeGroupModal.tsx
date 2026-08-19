import { GROUPS } from "../lib/topology";
import { Modal } from "./ui";

/// 差分が無いときに、起動し直す BE グループを選ばせる。
export function BeGroupModal({
  onPick,
  onClose,
}: {
  onPick: (group: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="BE グループを選択（差分なし・指定起動）" onClose={onClose} width={480}>
      <div className="flex flex-col gap-2">
        {GROUPS.map((g) => (
          <button
            type="button"
            key={g.key}
            onClick={() => onPick(g.key)}
            className="rounded-lg px-3 py-2.5 text-left transition-colors"
            style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--wt-active)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--wt-panel)")}
          >
            <div className="text-sm font-medium">{g.key}</div>
            <div className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--wt-muted)" }}>
              {g.services.join(", ")}
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
