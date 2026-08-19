import { useEffect, useState } from "react";
import { api } from "../lib/ipc";
import type { CommitInfo, FileChange } from "../lib/types";
import { DiffView } from "./DiffView";
import { Icon } from "./Icon";
import { Spinner } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  A: "var(--wt-ok)",
  M: "var(--wt-warn)",
  D: "var(--wt-err)",
  R: "var(--wt-info)",
  C: "var(--wt-info)",
  "?": "var(--wt-muted)",
};

const WORKING: CommitInfo = {
  sha: "WORKING",
  shortSha: "変更",
  subject: "未コミットの変更",
  author: "",
  rel: "作業ツリー",
};

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}
function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}

/// GitHub 風: コミット一覧 → 変更ファイル一覧 → 選択ファイルの diff。
export function CommitBrowser({ path, dirty }: { path: string; dirty: boolean }) {
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [sha, setSha] = useState<string | null>(null);
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  // コミット一覧（path 切替でリセット）
  useEffect(() => {
    let alive = true;
    setCommits(null);
    setSha(null);
    setFiles(null);
    setFile(null);
    setDiff(null);
    api.commitLog(path).then((log) => {
      if (!alive) return;
      const list = dirty ? [WORKING, ...log] : log;
      setCommits(list);
      setSha(list[0]?.sha ?? null);
    });
    return () => {
      alive = false;
    };
  }, [path, dirty]);

  // 選択コミットのファイル一覧
  useEffect(() => {
    if (!sha) return;
    let alive = true;
    setFiles(null);
    setFile(null);
    setDiff(null);
    api.commitFiles(path, sha).then((fs) => {
      if (!alive) return;
      setFiles(fs);
      setFile(fs[0]?.path ?? null);
    });
    return () => {
      alive = false;
    };
  }, [path, sha]);

  // 選択ファイルの diff
  useEffect(() => {
    if (!sha || !file) {
      setDiff(file ? null : "");
      return;
    }
    let alive = true;
    setDiff(null);
    api.commitDiff(path, sha, file).then((d) => {
      if (alive) setDiff(d);
    });
    return () => {
      alive = false;
    };
  }, [path, sha, file]);

  if (commits === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={18} />
      </div>
    );
  }
  if (commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[12px]" style={{ color: "var(--wt-muted)" }}>
        develop との差分コミットはありません
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0" style={{ borderTop: "1px solid var(--wt-border)" }}>
      {/* コミット一覧 */}
      <div
        className="flex w-[236px] shrink-0 flex-col overflow-y-auto"
        style={{ borderRight: "1px solid var(--wt-border)" }}
      >
        <ColHeader label={`コミット ${commits.length - (dirty ? 1 : 0)}`} />
        {commits.map((c) => {
          const on = c.sha === sha;
          const working = c.sha === "WORKING";
          return (
            <button
              key={c.sha}
              type="button"
              onClick={() => setSha(c.sha)}
              className="flex flex-col gap-0.5 px-3 py-2 text-left transition-colors"
              style={{ background: on ? "var(--wt-active)" : "transparent" }}
              onMouseEnter={(e) => !on && (e.currentTarget.style.background = "var(--wt-hover)")}
              onMouseLeave={(e) => !on && (e.currentTarget.style.background = "transparent")}
            >
              <span className="truncate text-[12.5px] font-medium" style={{ color: working ? "var(--wt-warn)" : "var(--wt-fg)" }}>
                {c.subject}
              </span>
              <span className="flex items-center gap-1.5 text-[10.5px]" style={{ color: "var(--wt-muted)" }}>
                <span className="font-mono">{c.shortSha}</span>
                {c.author && <span>· {c.author}</span>}
                <span>· {c.rel}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ファイル一覧 */}
      <div
        className="flex w-[280px] shrink-0 flex-col overflow-y-auto"
        style={{ borderRight: "1px solid var(--wt-border)" }}
      >
        <ColHeader label={files ? `ファイル ${files.length}` : "ファイル"} />
        {files === null ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size={16} />
          </div>
        ) : files.length === 0 ? (
          <div className="px-3 py-3 text-[11.5px]" style={{ color: "var(--wt-muted)" }}>
            変更ファイルなし
          </div>
        ) : (
          files.map((f) => {
            const on = f.path === file;
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => setFile(f.path)}
                className="flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
                style={{ background: on ? "var(--wt-active)" : "transparent" }}
                onMouseEnter={(e) => !on && (e.currentTarget.style.background = "var(--wt-hover)")}
                onMouseLeave={(e) => !on && (e.currentTarget.style.background = "transparent")}
                title={f.path}
              >
                <span
                  className="grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] font-bold"
                  style={{ color: STATUS_COLOR[f.status] ?? "var(--wt-muted)" }}
                >
                  {f.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px]">
                  <span style={{ color: "var(--wt-muted)" }}>{dirname(f.path)}</span>
                  <span style={{ color: "var(--wt-fg)" }}>{basename(f.path)}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px]">
                  {f.additions > 0 && <span style={{ color: "var(--wt-ok)" }}>+{f.additions}</span>}
                  {f.deletions > 0 && <span className="ml-1" style={{ color: "var(--wt-err)" }}>-{f.deletions}</span>}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* diff */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ColHeader label={file ? basename(file) : "差分"} mono={!!file} />
        <div className="min-h-0 flex-1">
          {diff === null ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size={16} />
            </div>
          ) : (
            <DiffView diff={diff} />
          )}
        </div>
      </div>
    </div>
  );
}

function ColHeader({ label, mono }: { label: string; mono?: boolean }) {
  return (
    <div
      className="sticky top-0 z-10 flex items-center gap-1.5 px-3 py-1.5"
      style={{ background: "var(--wt-bg)", borderBottom: "1px solid var(--wt-border)" }}
    >
      <Icon name="commit" size={13} style={{ color: "var(--wt-muted)", display: "none" }} />
      <span
        className={`truncate text-[11px] font-semibold uppercase tracking-wide ${mono ? "font-mono normal-case" : ""}`}
        style={{ color: "var(--wt-muted)" }}
      >
        {label}
      </span>
    </div>
  );
}
