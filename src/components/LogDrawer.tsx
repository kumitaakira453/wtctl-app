import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { stripAnsi, TONE_COLOR, toneOf } from "../lib/ansi";
import { actionActiveAtom, actionOpenAtom, actionTabsAtom } from "../state/atoms";
import { Icon } from "./Icon";
import { IconButton, Spinner } from "./ui";

export function LogDrawer() {
  const [open, setOpen] = useAtom(actionOpenAtom);
  const [tabs, setTabs] = useAtom(actionTabsAtom);
  const [active, setActive] = useAtom(actionActiveAtom);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  const closeTab = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    if (rest.length === 0) {
      setOpen(false);
      setTabs([]);
      return;
    }
    if (active === id) {
      // 閉じたタブの隣を選択
      const next = rest[Math.min(idx, rest.length - 1)];
      setActive(next.id);
    }
    setTabs(rest);
  };

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
      className="wt-fade flex shrink-0 flex-col"
      style={{
        height: "38%",
        minHeight: 200,
        background: "var(--wt-sidebar)",
        borderTop: "1px solid var(--wt-border-strong)",
      }}
    >
      <div className="flex items-center gap-1 px-2" style={{ borderBottom: "1px solid var(--wt-border)" }}>
        {/* タブ */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1.5">
          {tabs.map((t) => {
            const on = t.id === current.id;
            return (
              <div
                key={t.id}
                role="button"
                onClick={() => setActive(t.id)}
                className="group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md py-1 pl-2.5 pr-1 text-[12px] font-medium transition-colors"
                style={{ background: on ? "var(--wt-active)" : "transparent", color: on ? "var(--wt-fg)" : "var(--wt-muted)" }}
              >
                {t.running ? (
                  <Spinner size={11} />
                ) : (
                  <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: dot(t) }} />
                )}
                <span>{t.title}</span>
                <span
                  role="button"
                  title="このタブを閉じる"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.id);
                  }}
                  className="grid h-4 w-4 place-items-center rounded opacity-0 transition-opacity hover:bg-[var(--wt-hover)] group-hover:opacity-100"
                  style={{ color: "var(--wt-muted)" }}
                >
                  <Icon name="close" size={12} />
                </span>
              </div>
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
