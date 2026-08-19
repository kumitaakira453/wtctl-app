import { useEffect, useMemo, useState } from "react";
import { highlightCode } from "../lib/highlight";
import { api } from "../lib/ipc";
import type { ClaudeBlock, ClaudeMessage, ClaudeSession } from "../lib/types";
import { Icon } from "./Icon";
import { Spinner } from "./ui";

function relTime(iso: string): string {
  if (!iso) return "";
  return iso.replace("T", " ").slice(0, 16);
}

/// テキストを軽量 markdown 描画（フェンスコードはハイライト、インライン code は等幅）。
function renderText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const fence = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{renderInline(text.slice(last, m.index))}</span>);
    const lang = m[1] || "";
    const code = m[2].replace(/\n$/, "");
    parts.push(
      <pre
        key={key++}
        className="hljs-diff my-1.5 overflow-x-auto rounded-md p-2.5 font-mono text-[11.5px] leading-[1.55]"
        style={{ background: "var(--wt-panel-2)", border: "1px solid var(--wt-border)" }}
        dangerouslySetInnerHTML={{ __html: highlightCode(code, lang) }}
      />,
    );
    last = fence.lastIndex;
  }
  if (last < text.length) parts.push(<span key={key++}>{renderInline(text.slice(last))}</span>);
  return parts;
}

/// インライン `code` のみ等幅化。それ以外は改行保持で素通し。
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    parts.push(
      <code
        key={key++}
        className="rounded px-1 font-mono text-[12px]"
        style={{ background: "var(--wt-panel-2)", color: "var(--wt-fg)" }}
      >
        {m[1]}
      </code>,
    );
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return <span className="whitespace-pre-wrap">{parts}</span>;
}

function Collapsible({ icon, label, body, color }: { icon: string; label: string; body: string; color: string }) {
  return (
    <details className="my-1 rounded-md" style={{ border: "1px solid var(--wt-border)", background: "var(--wt-panel)" }}>
      <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-[11.5px]" style={{ color }}>
        <Icon name={icon} size={13} />
        {label}
      </summary>
      <pre
        className="max-h-64 overflow-auto whitespace-pre-wrap break-all px-2.5 pb-2 font-mono text-[11px] leading-[1.5]"
        style={{ color: "var(--wt-fg-dim)" }}
      >
        {body}
      </pre>
    </details>
  );
}

function Block({ b }: { b: ClaudeBlock }) {
  switch (b.kind) {
    case "text":
      return <div className="text-[13px] leading-relaxed" style={{ color: "var(--wt-fg)" }}>{renderText(b.text)}</div>;
    case "thinking":
      return <Collapsible icon="neurology" label="思考" body={b.text} color="var(--wt-muted)" />;
    case "tool_use":
      return <Collapsible icon="build" label={`ツール: ${b.name ?? ""}`} body={b.text} color="var(--wt-info)" />;
    case "tool_result":
      return <Collapsible icon="subdirectory_arrow_right" label="結果" body={b.text} color="var(--wt-muted)" />;
    case "image":
      return <div className="text-[12px]" style={{ color: "var(--wt-muted)" }}>［画像］</div>;
    default:
      return null;
  }
}

function MessageRow({ m }: { m: ClaudeMessage }) {
  const isUser = m.role === "user";
  const hasHumanText = m.blocks.some((b) => b.kind === "text");
  // ツール結果だけの user ターンは "Claude 実行" 側の文脈として淡く扱う
  const label = isUser ? (hasHumanText ? "You" : "ツール結果") : "Claude";
  const labelColor = isUser ? (hasHumanText ? "var(--wt-accent)" : "var(--wt-muted)") : "var(--wt-fg-dim)";
  return (
    <div className="px-4 py-2.5" style={{ borderBottom: "1px solid var(--wt-border)" }}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: labelColor }}>
          {label}
        </span>
        <span className="text-[10px]" style={{ color: "var(--wt-muted)" }}>{relTime(m.timestamp)}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {m.blocks.map((b, i) => (
          <Block key={i} b={b} />
        ))}
      </div>
    </div>
  );
}

/// worktree に紐づく Claude Code セッション一覧と会話（read-only）。
export function ClaudeSessions({ path }: { path: string }) {
  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ClaudeMessage[] | null>(null);

  useEffect(() => {
    let alive = true;
    setSessions(null);
    setActive(null);
    setMsgs(null);
    api.claudeSessions(path).then((s) => {
      if (!alive) return;
      setSessions(s);
      setActive(s[0]?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setMsgs(null);
    api.claudeTranscript(path, active).then((m) => {
      if (alive) setMsgs(m);
    });
    return () => {
      alive = false;
    };
  }, [path, active]);

  const current = useMemo(() => sessions?.find((s) => s.id === active) ?? null, [sessions, active]);

  if (sessions === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={18} />
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px]" style={{ color: "var(--wt-muted)" }}>
        この worktree を作業ディレクトリにした Claude Code セッションはまだありません
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden" style={{ borderTop: "1px solid var(--wt-border)" }}>
      {/* セッション一覧 */}
      <div className="flex w-[280px] shrink-0 flex-col overflow-y-auto" style={{ borderRight: "1px solid var(--wt-border)" }}>
        <div className="sticky top-0 z-10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--wt-muted)", background: "var(--wt-bg)", borderBottom: "1px solid var(--wt-border)" }}>
          セッション {sessions.length}
        </div>
        {sessions.map((s) => {
          const on = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className="flex flex-col gap-0.5 px-3 py-2 text-left transition-colors"
              style={{ background: on ? "var(--wt-active)" : "transparent" }}
              onMouseEnter={(e) => !on && (e.currentTarget.style.background = "var(--wt-hover)")}
              onMouseLeave={(e) => !on && (e.currentTarget.style.background = "transparent")}
            >
              <span className="line-clamp-2 text-[12.5px] font-medium" style={{ color: "var(--wt-fg)" }}>
                {s.title}
              </span>
              <span className="flex items-center gap-1.5 text-[10.5px]" style={{ color: "var(--wt-muted)" }}>
                <Icon name="chat" size={11} />
                {s.userCount}/{s.assistantCount}
                <span>· {relTime(s.lastActive)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* 会話ビュー */}
      <div className="flex min-w-0 flex-1 flex-col">
        {current && (
          <div className="shrink-0 px-4 py-2" style={{ borderBottom: "1px solid var(--wt-border)", background: "var(--wt-panel)" }}>
            <div className="truncate text-[13px] font-semibold">{current.title}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[10.5px]" style={{ color: "var(--wt-muted)" }}>
              <span className="font-mono">{current.id.slice(0, 8)}</span>
              {current.branch && <span>· {current.branch}</span>}
              <span>· {relTime(current.started)} 〜 {relTime(current.lastActive)}</span>
              <span className="rounded px-1.5" style={{ border: "1px solid var(--wt-border)" }}>read-only</span>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {msgs === null ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size={16} />
            </div>
          ) : (
            msgs.map((m, i) => <MessageRow key={i} m={m} />)
          )}
        </div>
      </div>
    </div>
  );
}
