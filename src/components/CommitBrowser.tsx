import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { langForPath } from "../lib/highlight";
import { api } from "../lib/ipc";
import type { CommitInfo, FileChange } from "../lib/types";
import { browserCommitsWAtom, browserTreeWAtom } from "../state/atoms";
import { DiffView } from "./DiffView";
import { FileTree } from "./FileTree";
import { Spinner } from "./ui";

const WORKING: CommitInfo = {
  sha: "WORKING",
  shortSha: "working",
  subject: "未コミットの変更",
  author: "",
  rel: "作業ツリー",
  body: "",
};

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// diff の前後文脈行数（-U）。全体は十分大きな値でファイル全体を表示。
const DIFF_CONTEXT_LEVELS = [
  { label: "変更のみ", v: 3 },
  { label: "広め", v: 25 },
  { label: "全体", v: 100000 },
] as const;

/// 縦のドラッグハンドル。onResize には前回からの増分 dx を渡す。
function Resizer({ onResize }: { onResize: (dx: number) => void }) {
  const last = useRef(0);
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    last.current = e.clientX;
    const onMove = (ev: MouseEvent) => {
      onResize(ev.clientX - last.current);
      last.current = ev.clientX;
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative shrink-0 self-stretch"
      style={{ width: 6, cursor: "col-resize" }}
    >
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 transition-colors group-hover:bg-[var(--wt-accent)]"
        style={{ width: 1, background: "var(--wt-border)" }}
      />
    </div>
  );
}

/// GitHub / ChatGPT デスクトップ風: コミット一覧 → コミット詳細 → ファイルツリー → 色付き diff。
/// 各カラム幅はドラッグで可変（永続化）。
export function CommitBrowser({ path, dirty }: { path: string; dirty: boolean }) {
  const [commitsW, setCommitsW] = useAtom(browserCommitsWAtom);
  const [treeW, setTreeW] = useAtom(browserTreeWAtom);
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [sha, setSha] = useState<string | null>(null);
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  // diff の前後文脈行数（-U）。ファイルを変えたら「変更のみ」に戻す。
  const [ctxLines, setCtxLines] = useState<number>(DIFF_CONTEXT_LEVELS[0].v);

  const selectFile = (p: string) => {
    setFile(p);
    setCtxLines(DIFF_CONTEXT_LEVELS[0].v);
  };

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
      setCtxLines(DIFF_CONTEXT_LEVELS[0].v);
    });
    return () => {
      alive = false;
    };
  }, [path, sha]);

  useEffect(() => {
    if (!sha || !file) {
      setDiff(file ? null : "");
      return;
    }
    let alive = true;
    setDiff(null);
    api.commitDiff(path, sha, file, ctxLines).then((d) => {
      if (alive) setDiff(d);
    });
    return () => {
      alive = false;
    };
  }, [path, sha, file, ctxLines]);

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

  const current = commits.find((c) => c.sha === sha) ?? null;
  const commitCount = commits.length - (dirty ? 1 : 0);

  return (
    <div className="flex h-full min-h-0" style={{ borderTop: "1px solid var(--wt-border)" }}>
      {/* コミット一覧（可変幅） */}
      <div className="flex min-h-0 flex-col overflow-y-auto" style={{ width: commitsW, flexShrink: 0 }}>
        <ColHeader label={`コミット ${commitCount}`} />
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
              <span
                className="line-clamp-2 text-[12.5px] font-medium"
                style={{ color: working ? "var(--wt-warn)" : "var(--wt-fg)" }}
              >
                {c.subject}
              </span>
              <span className="flex items-center gap-1.5 truncate text-[10.5px]" style={{ color: "var(--wt-muted)" }}>
                <span className="font-mono">{c.shortSha}</span>
                {c.author && <span>· {c.author}</span>}
                <span>· {c.rel}</span>
              </span>
            </button>
          );
        })}
      </div>

      <Resizer onResize={(dx) => setCommitsW((w) => clamp(w + dx, 150, 460))} />

      {/* 右領域: コミット詳細 + (ファイルツリー | diff) */}
      <div className="flex min-w-0 flex-1 flex-col">
        {current && current.sha !== "WORKING" && (
          <div className="shrink-0 px-4 py-2.5" style={{ borderBottom: "1px solid var(--wt-border)", background: "var(--wt-panel)" }}>
            <div className="text-[13px] font-semibold leading-snug">{current.subject}</div>
            {current.body && (
              <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-relaxed" style={{ color: "var(--wt-fg-dim)" }}>
                {current.body}
              </div>
            )}
            <div className="mt-1.5 flex items-center gap-2 text-[10.5px]" style={{ color: "var(--wt-muted)" }}>
              <span className="font-mono">{current.shortSha}</span>
              {current.author && <span>· {current.author}</span>}
              <span>· {current.rel}</span>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* ファイルツリー（可変幅） */}
          <div className="flex min-h-0 flex-col overflow-y-auto" style={{ width: treeW, flexShrink: 0 }}>
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
              <FileTree files={files} selected={file} onSelect={selectFile} />
            )}
          </div>

          <Resizer onResize={(dx) => setTreeW((w) => clamp(w + dx, 180, 560))} />

          {/* diff（残り全幅） */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div
              className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5"
              style={{ background: "var(--wt-bg)", borderBottom: "1px solid var(--wt-border)" }}
            >
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold"
                style={{ color: "var(--wt-muted)" }}
              >
                {file ? basename(file) : "差分"}
              </span>
              {file && (
                <div className="flex shrink-0 items-center overflow-hidden rounded-md" style={{ border: "1px solid var(--wt-border)" }}>
                  {DIFF_CONTEXT_LEVELS.map((lv, i) => {
                    const on = ctxLines === lv.v;
                    return (
                      <button
                        key={lv.v}
                        type="button"
                        onClick={() => setCtxLines(lv.v)}
                        title={lv.v >= 100000 ? "ファイル全体を表示" : `前後 ${lv.v} 行の文脈を表示`}
                        className="px-2 py-0.5 text-[10.5px] font-medium transition-colors"
                        style={{
                          background: on ? "var(--wt-accent-soft)" : "transparent",
                          color: on ? "var(--wt-accent)" : "var(--wt-muted)",
                          borderLeft: i === 0 ? "none" : "1px solid var(--wt-border)",
                        }}
                      >
                        {lv.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1">
              {diff === null ? (
                <div className="flex h-full items-center justify-center">
                  <Spinner size={16} />
                </div>
              ) : (
                <DiffView diff={diff} lang={file ? langForPath(file) : null} />
              )}
            </div>
          </div>
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
      <span
        className={`truncate text-[11px] font-semibold uppercase tracking-wide ${mono ? "font-mono normal-case" : ""}`}
        style={{ color: "var(--wt-muted)" }}
      >
        {label}
      </span>
    </div>
  );
}
