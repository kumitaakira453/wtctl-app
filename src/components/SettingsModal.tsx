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

  const field = (
    label: string,
    value: string,
    setter: (v: string) => void,
    placeholder: string,
  ) => (
    <div className="mb-4">
      <div className="mb-1.5 text-xs font-semibold" style={{ color: "var(--wt-muted)" }}>
        {label}
      </div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setter(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg px-3 py-2 font-mono text-[12px] outline-none"
          style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border-strong)", color: "var(--wt-fg)" }}
        />
        <Button icon="folder_open" variant="default" onClick={() => pick(setter)} title="フォルダを選択">
          参照
        </Button>
      </div>
    </div>
  );

  return (
    <Modal title="設定" onClose={onClose} width={620}>
      {field("wasurenai リポジトリ（必須）", repo, setRepo, "/absolute/path/to/wasurenai")}
      {field(
        "worktree 作成先（任意・既定は <repo>/.claude/worktrees）",
        worktreeDir,
        setWorktreeDir,
        ".claude/worktrees",
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
