import { useCallback, useEffect, useRef, useState } from "react";
import { stripAnsi } from "../lib/ansi";
import { api, errorMessage } from "../lib/ipc";
import { KNOWN_SERVICES } from "../lib/topology";
import { Icon } from "./Icon";
import { IconButton, Modal, Spinner } from "./ui";

const POLL_MS = 1500;
const TAIL = 500;

/// コンテナ docker logs をタブで切り替え、アクティブなタブをライブ追尾（ポーリング）する。
export function LogsModal({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [active, setActive] = useState(initial);
  const [text, setText] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (service: string) => {
    setLoading(true);
    try {
      setText(await api.containerLogs(service, TAIL));
    } catch (e) {
      setText(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // タブ切替時に即読込
  useEffect(() => {
    setText(null);
    void load(active);
  }, [active, load]);

  // 追尾中は定期的に再取得
  useEffect(() => {
    if (!follow) return;
    const id = setInterval(() => void load(active), POLL_MS);
    return () => clearInterval(id);
  }, [follow, active, load]);

  // 追尾中は末尾へ自動スクロール
  useEffect(() => {
    if (!follow) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, follow]);

  return (
    <Modal title="コンテナ ログ" onClose={onClose} width={880}>
      {/* タブ */}
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
        <div className="ml-auto flex items-center gap-1">
          {loading && <Spinner size={12} />}
          <button
            type="button"
            onClick={() => setFollow((v) => !v)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
            style={{
              color: follow ? "var(--wt-accent)" : "var(--wt-muted)",
              border: `1px solid ${follow ? "var(--wt-accent)" : "var(--wt-border)"}`,
            }}
            title="ライブ追尾"
          >
            <Icon name={follow ? "pause" : "play_arrow"} size={13} />
            {follow ? "追尾中" : "停止中"}
          </button>
          <IconButton icon="refresh" onClick={() => void load(active)} title="更新" size={16} />
        </div>
      </div>

      <div
        ref={bodyRef}
        className="h-[58vh] overflow-auto rounded-lg p-3"
        style={{ background: "var(--wt-bg)", border: "1px solid var(--wt-border)" }}
      >
        {text === null ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--wt-muted)" }}>
            <Spinner size={13} /> 取得中…
          </div>
        ) : text.trim() ? (
          <pre className="log-line" style={{ color: "var(--wt-fg-dim)" }}>
            {stripAnsi(text)}
          </pre>
        ) : (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--wt-muted)" }}>
            <Icon name="inbox" size={16} /> ログがありません（コンテナ未起動の可能性）
          </div>
        )}
      </div>
    </Modal>
  );
}
