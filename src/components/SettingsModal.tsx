import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/ipc";
import { useApp } from "../state/app";
import { Button, Modal } from "./ui";
import { Icon } from "./Icon";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { reloadStatus, refresh } = useApp();
  const [repo, setRepo] = useState("");
  const [worktreeDir, setWorktreeDir] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getConfig().then((c) => {
      setRepo(c.repo ?? "");
      setWorktreeDir(c.worktreeDir ?? "");
      setConfigPath(c.configPath);
    });
  }, []);

  const pick = async (setter: (v: string) => void) => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") setter(dir);
  };

  const save = async () => {
    if (!repo.trim()) {
      setError("リポジトリのパスを指定してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.setConfig(repo.trim(), worktreeDir.trim() || null);
      reloadStatus();
      void refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const pathRow = (
    label: string,
    value: string,
    placeholder: string,
    setter: (v: string) => void,
    clearable: boolean,
  ) => (
    <div className="mb-4">
      <div className="mb-1.5 text-xs font-semibold" style={{ color: "var(--wt-muted)" }}>
        {label}
      </div>
      <div className="flex gap-2">
        {/* 入力欄ではなく「クリックでフォルダ選択」するボタンとして見せる */}
        <button
          type="button"
          onClick={() => pick(setter)}
          className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-left transition-colors"
          style={{ background: "var(--wt-panel-2)", border: "1px dashed var(--wt-border-strong)", minHeight: 40 }}
          title="クリックしてフォルダを選択"
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--wt-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--wt-panel-2)")}
        >
          <Icon name="folder_open" size={16} style={{ color: "var(--wt-muted)" }} />
          <span
            className="min-w-0 flex-1 truncate font-mono text-[12px]"
            style={{ color: value ? "var(--wt-fg)" : "var(--wt-muted)" }}
          >
            {value || placeholder}
          </span>
          <span className="shrink-0 text-[11px]" style={{ color: "var(--wt-accent)" }}>
            参照
          </span>
        </button>
        {clearable && value && (
          <Button icon="close" variant="ghost" onClick={() => setter("")} title="既定に戻す" />
        )}
      </div>
    </div>
  );

  return (
    <Modal title="設定" onClose={onClose} width={620}>
      {pathRow("wasurenai リポジトリ（必須）", repo, "未選択", setRepo, false)}
      {pathRow(
        "worktree 作成先（任意・既定は <repo>/.claude/worktrees）",
        worktreeDir,
        ".claude/worktrees（既定）",
        setWorktreeDir,
        true,
      )}

      {error && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg p-3 text-xs"
          style={{ background: "var(--wt-danger-soft)", color: "var(--wt-danger)" }}
        >
          <Icon name="error" size={16} />
          <span style={{ whiteSpace: "pre-wrap" }}>{error}</span>
        </div>
      )}

      <div className="mb-4 text-[11px]" style={{ color: "var(--wt-muted)" }}>
        設定ファイル: <span className="font-mono">{configPath}</span>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          キャンセル
        </Button>
        <Button variant="primary" icon="save" onClick={save} disabled={saving}>
          保存
        </Button>
      </div>
    </Modal>
  );
}
