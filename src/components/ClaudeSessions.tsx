import { openUrl } from "@tauri-apps/plugin-opener";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { highlightCode, langForPath } from "../lib/highlight";
import { api } from "../lib/ipc";
import { renderMarkdown } from "../lib/markdown";
import type { ClaudeBlock, ClaudeMessage, ClaudeSession } from "../lib/types";
import { ClaudeMark } from "./ClaudeMark";
import { DiffView } from "./DiffView";
import { Icon } from "./Icon";
import { Spinner } from "./ui";

const PREVIEW_LINES = 6;

/// 数行のプレビューを出し、続きはアコーディオンで開く（Claude Desktop 風のツール表示）。
/// lang を渡すと本文を highlight.js でシンタックスハイライトする。
function ToolBlock({
  icon,
  label,
  body,
  color,
  lang,
}: {
  icon: string;
  label: string;
  body: string;
  color: string;
  lang?: string;
}) {
  const [open, setOpen] = useState(false);
  const lines = body.length ? body.split("\n") : [];
  const hasMore = lines.length > PREVIEW_LINES;
  const shown = open || !hasMore ? body : lines.slice(0, PREVIEW_LINES).join("\n");
  return (
    <div className="my-1 min-w-0 rounded-md" style={{ border: "1px solid var(--wt-border)", background: "var(--wt-panel)" }}>
      <div className="flex items-center gap-1.5 px-2 py-1 text-[11.5px] font-medium" style={{ color }}>
        <Icon name={icon} size={13} />
        {label}
      </div>
      {body.length > 0 && (
        <pre
          className="hljs-diff overflow-x-auto whitespace-pre-wrap break-all px-2.5 pb-1.5 font-mono text-[11px] leading-[1.5]"
          style={{ color: "var(--wt-fg-dim)", maxHeight: open ? 320 : undefined, overflowY: open ? "auto" : "hidden" }}
          {...(lang
            ? { dangerouslySetInnerHTML: { __html: highlightCode(shown, lang) } }
            : { children: shown })}
        />
      )}
      {hasMore && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="px-2.5 pb-1.5 text-[11px]"
          style={{ color: "var(--wt-info)" }}
        >
          {open ? "折りたたむ" : `全て表示（${lines.length} 行）`}
        </button>
      )}
    </div>
  );
}

/// 1 行で完結する軽量ツール（Read / Grep / Glob / Web / 予約）を Claude Desktop 風に
/// コンパクト表示する。長い場合は 1 行目のみ・省略し、全文は title で見せる。
function InlineTool({ icon, prefix, text, color }: { icon: string; prefix?: string; text: string; color: string }) {
  const first = text.split("\n")[0];
  return (
    <div className="flex min-w-0 items-center gap-1.5 py-0.5 text-[11.5px]" title={text}>
      <Icon name={icon} size={13} style={{ color, flexShrink: 0 }} />
      {prefix && (
        <span className="shrink-0 font-medium" style={{ color }}>
          {prefix}
        </span>
      )}
      <span className="truncate font-mono" style={{ color: "var(--wt-fg-dim)" }}>
        {first}
      </span>
    </div>
  );
}

function relTime(iso: string): string {
  if (!iso) return "";
  return iso.replace("T", " ").slice(0, 16);
}

/// MCP ツール名（mcp__server__Tool-name）は末尾のツール名だけを見せる。
function prettyToolName(name: string | null): string {
  if (!name) return "ツール";
  const raw = name.startsWith("mcp__") ? name.split("__").pop() ?? name : name;
  return raw.replace(/[-_]/g, " ");
}

/// markdown 内リンクのクリックは webview 遷移させず外部で開く。
function onMdClick(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest("a");
  if (a && a.getAttribute("href")) {
    e.preventDefault();
    void openUrl(a.getAttribute("href")!);
  }
}

function Collapsible({ icon, label, body, color }: { icon: string; label: string; body: string; color: string }) {
  return (
    <details className="my-1 rounded-md" style={{ border: "1px solid var(--wt-border)", background: "var(--wt-panel)" }}>
      <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-[11.5px]" style={{ color }}>
        <Icon name={icon} size={13} />
        {label}
      </summary>
      <pre
        className="max-h-72 overflow-auto whitespace-pre-wrap break-all px-2.5 pb-2 font-mono text-[11px] leading-[1.5]"
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
      return (
        <div
          className="md hljs-diff min-w-0"
          onClick={onMdClick}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }}
        />
      );
    case "command":
      return (
        <div
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[12px]"
          style={{ background: "var(--wt-accent-soft)", color: "var(--wt-accent)" }}
        >
          <Icon name="terminal" size={13} />
          {b.text}
        </div>
      );
    case "interrupted":
      return (
        <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--wt-warn)" }}>
          <Icon name="stop_circle" size={13} />
          {b.text}
        </div>
      );
    case "edit":
      return (
        <div className="my-1 min-w-0 overflow-hidden rounded-md" style={{ border: "1px solid var(--wt-border)", background: "var(--wt-panel)" }}>
          <div className="flex items-center gap-1.5 px-2 py-1 text-[11.5px] font-medium" style={{ color: "var(--wt-warn)" }}>
            <Icon name="edit" size={13} />
            {b.name ?? "edit"}
          </div>
          <div style={{ maxHeight: 340, overflow: "auto" }}>
            <DiffView diff={b.text} lang={b.name ? langForPath(b.name) : null} />
          </div>
        </div>
      );
    case "skill":
      return <Collapsible icon="extension" label={`スキル: ${b.name ?? ""}`} body={b.text} color="var(--wt-accent)" />;
    case "thinking":
      return <ToolBlock icon="neurology" label="思考" body={b.text} color="var(--wt-muted)" />;
    case "bash":
      return <ToolBlock icon="terminal" label={b.name ?? "コマンド"} body={b.text} color="var(--wt-accent)" lang="bash" />;
    case "read":
      return <InlineTool icon="description" prefix="読み取り" text={b.text} color="var(--wt-info)" />;
    case "search":
      return <InlineTool icon="search" prefix={b.name ?? "検索"} text={b.text} color="var(--wt-info)" />;
    case "web":
      return <InlineTool icon="public" prefix={b.name === "search" ? "Web 検索" : "Web 取得"} text={b.text} color="var(--wt-info)" />;
    case "wait":
      return <InlineTool icon="schedule" prefix="再開予約" text={b.text} color="var(--wt-muted)" />;
    case "question":
      return <ToolBlock icon="quiz" label="ユーザーへの質問" body={b.text} color="var(--wt-accent)" />;
    case "todo":
      return <ToolBlock icon="checklist" label="タスクリスト" body={b.text} color="var(--wt-info)" />;
    case "task":
      return <ToolBlock icon="smart_toy" label={b.name ? `エージェント: ${b.name}` : "サブタスク"} body={b.text} color="var(--wt-accent)" />;
    case "tool_use":
      return <ToolBlock icon="build" label={prettyToolName(b.name)} body={b.text} color="var(--wt-info)" />;
    case "tool_result":
      return <ToolBlock icon="subdirectory_arrow_right" label="結果" body={b.text} color="var(--wt-muted)" />;
    case "image":
      return <div className="text-[12px]" style={{ color: "var(--wt-muted)" }}>［画像］</div>;
    default:
      return null;
  }
}

function MessageRow({ m }: { m: ClaudeMessage }) {
  const isUser = m.role === "user";
  const hasSpeech = m.blocks.some((b) => b.kind === "text" || b.kind === "command");
  // 人間の発話 / Claude の応答のみヘッダを出す。ツール結果だけのターンは淡く続ける。
  const header = isUser ? (hasSpeech ? "You" : null) : "Claude";
  const headerColor = isUser ? "var(--wt-accent)" : "var(--wt-fg-dim)";
  return (
    <div className="min-w-0 px-4 py-2.5" style={{ borderBottom: "1px solid var(--wt-border)" }}>
      {header && (
        <div className="mb-1 flex items-center gap-1.5">
          {header === "Claude" && <ClaudeMark size={13} />}
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: headerColor }}>
            {header}
          </span>
          <span className="ml-0.5 text-[10px]" style={{ color: "var(--wt-muted)" }}>{relTime(m.timestamp)}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        {m.blocks.map((b, i) => (
          <Block key={i} b={b} />
        ))}
      </div>
    </div>
  );
}

/// 会話を仮想スクロールで描画（長いセッションでも軽い）。session ごとに remount して
/// マウント時に最下部（最新）へスクロールする。行の高さは measureElement で動的計測。
function Transcript({ msgs }: { msgs: ClaudeMessage[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: msgs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
  });

  useEffect(() => {
    if (msgs.length) virt.scrollToIndex(msgs.length - 1, { align: "end" });
    // マウント時のみ最下部へ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = virt.getVirtualItems();
  return (
    <div ref={parentRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div style={{ height: virt.getTotalSize(), width: "100%", position: "relative" }}>
        {items.map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virt.measureElement}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
          >
            <MessageRow m={msgs[vi.index]} />
          </div>
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
  // 手動再読み込み用。ライブ追尾はしないので進行中セッションはこれで取り直す。
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setSessions(null);
    setMsgs(null);
    api.claudeSessions(path).then((s) => {
      if (!alive) return;
      setSessions(s);
      setActive((prev) => (prev && s.some((x) => x.id === prev) ? prev : (s[0]?.id ?? null)));
    });
    return () => {
      alive = false;
    };
  }, [path, nonce]);

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
  }, [path, active, nonce]);

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
                <Icon name="forum" size={11} />
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
          <div className="flex shrink-0 items-center gap-3 px-4 py-2" style={{ borderBottom: "1px solid var(--wt-border)", background: "var(--wt-panel)" }}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{current.title}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[10.5px]" style={{ color: "var(--wt-muted)" }}>
                <span className="font-mono">{current.id.slice(0, 8)}</span>
                {current.branch && <span>· {current.branch}</span>}
                <span>· {relTime(current.started)} 〜 {relTime(current.lastActive)}</span>
                <span className="rounded px-1.5" style={{ border: "1px solid var(--wt-border)" }}>read-only</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNonce((n) => n + 1)}
              title="セッションを再読み込み（進行中の会話の新着を取得）"
              className="shrink-0 rounded-md p-1.5 transition-colors"
              style={{ color: "var(--wt-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--wt-fg)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--wt-muted)")}
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>
        )}
        {msgs === null ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Spinner size={16} />
          </div>
        ) : (
          <Transcript key={`${active}:${nonce}`} msgs={msgs} />
        )}
      </div>
    </div>
  );
}
