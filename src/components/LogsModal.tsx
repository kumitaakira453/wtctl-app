import { useEffect, useRef, useState } from "react";
import { stripAnsi } from "../lib/ansi";
import { api, startContainerLogs } from "../lib/ipc";
import { KNOWN_SERVICES } from "../lib/topology";
import { Modal } from "./ui";

const TAIL = 500;
const MAX_LINES = 4000;

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
    startContainerLogs(active, TAIL, (text) => bufRef.current.push(text))
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
          <pre className="log-line" style={{ color: "var(--wt-fg-dim)" }}>
            {lines.map((l) => stripAnsi(l)).join("\n")}
          </pre>
        )}
      </div>
    </Modal>
  );
}
