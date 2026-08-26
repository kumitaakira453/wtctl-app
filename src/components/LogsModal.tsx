import { useEffect, useMemo, useRef, useState } from "react";
import { ansiToSegments, logLineColor, stripAnsi } from "../lib/ansi";
import { api, startContainerLogs } from "../lib/ipc";
import { INFRA_SERVICES, KNOWN_SERVICES } from "../lib/topology";
import { Icon } from "./Icon";
import { Modal } from "./ui";

const TAIL = 500;
const MAX_LINES = 4000;
// celery ワーカーが起動ごとに吐く登録タスク一覧（`  . module.task`）。1 起動で百行以上、
// 再起動のたびに積まれて本来のログを埋めるため、連続分をまとめて 1 行に畳む。
const TASK_LINE = /^\s+\.\s+\S+$/;
const COLLAPSE_MIN = 5;

type Item = { kind: "line"; text: string } | { kind: "group"; at: number; lines: string[] };

/// ANSI エスケープを含む行はその色で、含まない行はレベル/HTTP ステータスで着色する。
function LogLine({ line }: { line: string }) {
  if (line.includes("\x1b[")) {
    return (
      <div className="log-line whitespace-pre-wrap" style={{ color: "var(--wt-fg-dim)" }}>
        {ansiToSegments(line).map((s, j) => (
          <span key={j} style={{ color: s.color, fontWeight: s.bold ? 600 : undefined }}>
            {s.text}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="log-line whitespace-pre-wrap" style={{ color: logLineColor(line) ?? "var(--wt-fg-dim)" }}>
      {stripAnsi(line) || " "}
    </div>
  );
}

/// 畳んだ登録タスク一覧。件数だけ見せ、必要なときに展開する。
function TaskGroup({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="log-line flex items-center gap-1 rounded px-1 text-left"
        style={{ color: "var(--wt-muted)" }}
      >
        <Icon name={open ? "expand_more" : "chevron_right"} size={13} />
        登録タスク {lines.length} 件
      </button>
      {open && lines.map((l, i) => <LogLine key={i} line={l} />)}
    </div>
  );
}

/// docker logs -f をタブごとに購読し、行を逐次表示する（lazydocker 相当のストリーミング）。
export function LogsModal({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [active, setActive] = useState(initial);
  const [lines, setLines] = useState<string[]>([]);
  const idRef = useRef<number | null>(null);
  const bufRef = useRef<string[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    bufRef.current = [];
    setLines([]);
    atBottomRef.current = true;
    // 破棄済みストリームの行を新しいバッファへ混ぜない。invoke の解決前に切り替えると
    // 停止要求が届く前に旧ストリームが tail 分を流し込み、履歴が二重に見えていた。
    startContainerLogs(active, TAIL, (text) => {
      if (!cancelled) bufRef.current.push(text);
    })
      .then((id) => {
        if (cancelled) void api.stopContainerLogs(id);
        else idRef.current = id;
      })
      .catch(() => {});
    // バッファを間引いて反映（描画ストーム防止）
    const flush = setInterval(() => {
      if (bufRef.current.length === 0) return;
      setLines((prev) => {
        const next = prev.concat(bufRef.current);
        bufRef.current = [];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    }, 200);
    return () => {
      cancelled = true;
      clearInterval(flush);
      if (idRef.current != null) {
        void api.stopContainerLogs(idRef.current);
        idRef.current = null;
      }
    };
  }, [active]);

  // 末尾付近にいるときだけ自動スクロール（上に遡って読んでいる間はジャンプしない）
  useEffect(() => {
    if (!atBottomRef.current) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // 登録タスク一覧の連続はグループにまとめ、それ以外はそのまま並べる。
  const items = useMemo(() => {
    const out: Item[] = [];
    let run: string[] = [];
    let runStart = 0;
    const flush = () => {
      if (run.length >= COLLAPSE_MIN) out.push({ kind: "group", at: runStart, lines: run });
      else for (const l of run) out.push({ kind: "line", text: l });
      run = [];
    };
    lines.forEach((line, i) => {
      if (TASK_LINE.test(stripAnsi(line))) {
        if (run.length === 0) runStart = i;
        run.push(line);
        return;
      }
      flush();
      out.push({ kind: "line", text: line });
    });
    flush();
    return out;
  }, [lines]);

  return (
    <Modal title="コンテナ ログ" onClose={onClose} width={880}>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {KNOWN_SERVICES.map((svc) => {
          const on = svc === active;
          return (
            <button
              type="button"
              key={svc}
              onClick={() => setActive(svc)}
              className="rounded-md px-2.5 py-1 font-mono text-[11.5px] font-medium transition-colors"
              style={{ background: on ? "var(--wt-active)" : "transparent", color: on ? "var(--wt-fg)" : "var(--wt-muted)" }}
            >
              {svc}
            </button>
          );
        })}
        {/* 基盤サービス: 差し替え対象ではないが不具合切り分けでログを見たい */}
        <span className="mx-1 h-4 w-px" style={{ background: "var(--wt-border)" }} />
        {INFRA_SERVICES.map((svc) => {
          const on = svc === active;
          return (
            <button
              type="button"
              key={svc}
              onClick={() => setActive(svc)}
              className="rounded-md px-2.5 py-1 font-mono text-[11.5px] transition-colors"
              style={{ background: on ? "var(--wt-active)" : "transparent", color: on ? "var(--wt-fg)" : "var(--wt-muted)" }}
            >
              {svc}
            </button>
          );
        })}
        <span className="ml-auto flex items-center gap-1.5 text-[11px]" style={{ color: "var(--wt-ok)" }}>
          <span className="wt-pulse inline-block rounded-full" style={{ width: 7, height: 7, background: "var(--wt-ok)" }} />
          live
        </span>
      </div>

      <div
        ref={bodyRef}
        onScroll={onScroll}
        className="h-[58vh] overflow-auto rounded-lg p-3"
        style={{ background: "var(--wt-bg)", border: "1px solid var(--wt-border)" }}
      >
        {lines.length === 0 ? (
          <div className="log-line" style={{ color: "var(--wt-muted)" }}>
            接続中…（コンテナ未起動ならログはありません）
          </div>
        ) : (
          items.map((it, i) =>
            it.kind === "group" ? (
              <TaskGroup key={`g${it.at}`} lines={it.lines} />
            ) : (
              <LogLine key={i} line={it.text} />
            ),
          )
        )}
      </div>
    </Modal>
  );
}
