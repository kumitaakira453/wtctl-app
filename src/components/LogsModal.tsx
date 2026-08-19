import { useCallback, useEffect, useRef, useState } from "react";
import { stripAnsi } from "../lib/ansi";
import { api, errorMessage } from "../lib/ipc";
import { Icon } from "./Icon";
import { IconButton, Modal, Spinner } from "./ui";

/// コンテナの docker logs を表示する（末尾 tail 行・手動更新）。
export function LogsModal({ service, onClose }: { service: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setText(await api.containerLogs(service, 400));
    } catch (e) {
      setText(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <Modal title={`ログ — ${service}`} onClose={onClose} width={820}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "var(--wt-muted)" }}>
          直近 400 行（docker logs）
        </span>
        <IconButton icon="refresh" onClick={() => void load()} title="更新" size={17} />
      </div>
      <div
        ref={bodyRef}
        className="max-h-[60vh] overflow-auto rounded-lg p-3"
        style={{ background: "var(--wt-bg)", border: "1px solid var(--wt-border)" }}
      >
        {loading && text === null ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--wt-muted)" }}>
            <Spinner size={13} /> 取得中…
          </div>
        ) : text && text.trim() ? (
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
