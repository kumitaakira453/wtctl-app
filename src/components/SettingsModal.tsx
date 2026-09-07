import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/ipc";
import { useApp } from "../state/app";
import { Button, CheckBox, Modal } from "./ui";
import { Icon } from "./Icon";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { reloadStatus, refresh } = useApp();
  const [repo, setRepo] = useState("");
  const [worktreeDir, setWorktreeDir] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [shareNodeModules, setShareNodeModules] = useState(false);
  const [reuseVenv, setReuseVenv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getConfig().then((c) => {
      setRepo(c.repo ?? "");
      setWorktreeDir(c.worktreeDir ?? "");
      setConfigPath(c.configPath);
      setShareNodeModules(c.shareNodeModules);
      setReuseVenv(c.reuseVenv);
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
      await api.setConfig(repo.trim(), worktreeDir.trim() || null, shareNodeModules, reuseVenv);
      reloadStatus();
      void refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleRow = (on: boolean, onToggle: () => void, label: string, help: string) => (
    <div
      role="button"
      onClick={onToggle}
      className="cursor-pointer rounded-lg px-3 py-2.5"
      style={{
        background: on ? "var(--wt-accent-soft)" : "var(--wt-panel)",
        border: `1px solid ${on ? "var(--wt-accent)" : "var(--wt-border)"}`,
      }}
    >
      {/* チェックと見出しを同じ 1 行に入れ、縦位置は items-center に任せる */}
      <div className="flex items-center gap-2.5">
        <CheckBox on={on} />
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      {/* 説明はチェック幅 + gap の分だけ字下げして見出しに揃える */}
      <div className="mt-1 pl-[26px] text-[11px] leading-relaxed" style={{ color: "var(--wt-muted)" }}>
        {help}
      </div>
    </div>
  );

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

      {/* 依存を毎回入れ直すのは重いので、同じ定義なら流用を選べるようにする */}
      <div className="mb-4">
        <div className="mb-1.5 text-xs font-semibold" style={{ color: "var(--wt-muted)" }}>
          依存の使い回し（速度優先）
        </div>
        <div className="flex flex-col gap-1.5">
          {toggleRow(
            shareNodeModules,
            () => setShareNodeModules((v) => !v),
            "FE: node_modules をメインと共有（symlink）",
            "lockfile がメインと一致するときだけ共有し、違えば従来どおり npm ci します。新しい worktree の初回 FE 起動が数分から一瞬になります。",
          )}
          {toggleRow(
            reuseVenv,
            () => setReuseVenv((v) => !v),
            "BE: venv を作り直さず流用",
            "依存定義（uv.lock / pyproject）とイメージが前回と同じときだけ流用します。差し替えごとの venv コピー（1 コンテナ 516MB）が無くなります。合わなくなったら ModuleNotFoundError で出るので、外して検証を 1 回流せば直ります。",
          )}
        </div>
      </div>

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
