import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { stripAnsi, TONE_COLOR, toneOf } from "../lib/ansi";
import { actionActiveAtom, actionOpenAtom, actionTabsAtom } from "../state/atoms";
import { IconButton, Spinner } from "./ui";

export function LogDrawer() {
  const [open, setOpen] = useAtom(actionOpenAtom);
  const tabs = useAtomValue(actionTabsAtom);
  const [active, setActive] = useAtom(actionActiveAtom);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [current?.log]);

  if (!open || !current) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(current.log.map((l) => stripAnsi(l.text)).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const dot = (t: (typeof tabs)[number]) =>
    t.running ? "var(--wt-info)" : t.result === "ok" ? "var(--wt-ok)" : t.result === "error" ? "var(--wt-danger)" : "var(--wt-muted)";

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
      <div className="flex items-center gap-1 px-2" style={{ borderBottom: "1px solid var(--wt-border)" }}>
        {/* タブ */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1.5">
          {tabs.map((t) => {
            const on = t.id === current.id;
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => setActive(t.id)}
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors"
                style={{ background: on ? "var(--wt-active)" : "transparent", color: on ? "var(--wt-fg)" : "var(--wt-muted)" }}
              >
                {t.running ? (
                  <Spinner size={11} />
                ) : (
                  <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: dot(t) }} />
                )}
                {t.title}
              </button>
            );
          })}
        </div>
        <IconButton icon={copied ? "check" : "content_copy"} onClick={copy} title="このタブのログをコピー" size={17} />
        <IconButton icon="close" onClick={() => setOpen(false)} title="閉じる" size={18} />
      </div>
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3" style={{ background: "var(--wt-bg)" }}>
        {current.log.length === 0 && (
          <div className="log-line" style={{ color: "var(--wt-muted)" }}>
            {current.running ? "実行中…" : "準備中…"}
          </div>
        )}
        {current.log.map((line, i) => {
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
