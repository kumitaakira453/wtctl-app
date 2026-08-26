import { useAtom } from "jotai";
import { confirmAtom } from "../state/atoms";
import { Button } from "./ui";

export function ConfirmHost() {
  const [req, setReq] = useAtom(confirmAtom);
  if (!req) return null;

  const done = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) done(false);
      }}
    >
      <div
        className="wt-fade rounded-2xl p-5"
        style={{
          width: 460,
          maxWidth: "92vw",
          background: "var(--wt-bg)",
          border: "1px solid var(--wt-border-strong)",
          boxShadow: "var(--wt-shadow)",
        }}
      >
        <div
          className="mb-5 text-sm leading-relaxed"
          style={{ color: req.danger ? "var(--wt-danger)" : "var(--wt-fg)" }}
        >
          {req.message}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => done(false)}>
            キャンセル
          </Button>
          <Button variant={req.danger ? "danger" : "primary"} onClick={() => done(true)}>
            {req.confirmLabel ?? "実行"}
          </Button>
        </div>
      </div>
    </div>
  );
}
