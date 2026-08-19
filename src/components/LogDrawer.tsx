import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { stripAnsi, TONE_COLOR, toneOf } from "../lib/ansi";
import {
  actionLogAtom,
  actionOpenAtom,
  actionResultAtom,
  actionRunningAtom,
  actionTitleAtom,
} from "../state/atoms";
import { Icon } from "./Icon";
import { IconButton, Spinner } from "./ui";

export function LogDrawer() {
  const [open, setOpen] = useAtom(actionOpenAtom);
  const title = useAtomValue(actionTitleAtom);
  const running = useAtomValue(actionRunningAtom);
  const result = useAtomValue(actionResultAtom);
  const log = useAtomValue(actionLogAtom);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  if (!open) return null;

  const copy = async () => {
    const text = log.map((l) => stripAnsi(l.text)).join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const status = running
    ? { icon: null, color: "var(--wt-info)", label: "実行中…" }
    : result === "ok"
      ? { icon: "check_circle", color: "var(--wt-ok)", label: "完了" }
      : result === "error"
        ? { icon: "error", color: "var(--wt-danger)", label: "失敗" }
        : { icon: null, color: "var(--wt-muted)", label: "" };

  return (
    <div
      className="wt-fade absolute inset-x-0 bottom-0 z-40 flex flex-col"
      style={{
        height: "46%",
        background: "var(--wt-sidebar)",
        borderTop: "1px solid var(--wt-border-strong)",
        boxShadow: "0 -10px 30px rgba(0,0,0,0.25)",
      }}
    >
      <div
        className="flex items-center gap-2.5 px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--wt-border)" }}
      >
        {running ? <Spinner /> : status.icon && <Icon name={status.icon} size={18} style={{ color: status.color }} />}
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs" style={{ color: status.color }}>
          {status.label}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            icon={copied ? "check" : "content_copy"}
            onClick={copy}
            title="ログをコピー"
            size={17}
          />
          <IconButton icon="close" onClick={() => setOpen(false)} title="閉じる" size={18} />
        </div>
      </div>
      <div
        ref={bodyRef}
        className="flex-1 overflow-y-auto px-4 py-3"
        style={{ background: "var(--wt-bg)" }}
      >
        {log.length === 0 && <div className="log-line" style={{ color: "var(--wt-muted)" }}>準備中…</div>}
        {log.map((line, i) => {
          const tone = toneOf(line.kind, line.text);
          return (
            <div key={i} className="log-line" style={{ color: TONE_COLOR[tone] }}>
              {line.kind === "cmd" ? "› " : ""}
              {stripAnsi(line.text)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
