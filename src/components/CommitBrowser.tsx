import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { langForPath } from "../lib/highlight";
import { api } from "../lib/ipc";
import type { CommitInfo, FileChange } from "../lib/types";
import { browserCommitsWAtom, browserTreeWAtom, dataNonceAtom } from "../state/atoms";
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

// 一覧は merge-base..HEAD なので、分岐点から作業ツリーまでを見れば
// コミット済みと未コミットの両方を含むブランチ全体の差分になる。
const ALL: CommitInfo = {
  sha: "ALL",
  shortSha: "all",
  subject: "すべての差分（未コミット含む）",
  author: "",
  rel: "分岐点から作業ツリーまで",
  body: "",
};

const PSEUDO = new Set([WORKING.sha, ALL.sha]);

/// 一覧に疑似エントリを足す。作業ツリーは先頭、ブランチ全体はその次。
function withPseudo(log: CommitInfo[], dirty: boolean): CommitInfo[] {
  const list: CommitInfo[] = [];
  if (dirty) list.push(WORKING);
  // まとめる対象が 1 つしかないときは、その行と同じ内容になるので出さない。
  if (log.length + (dirty ? 1 : 0) > 1) list.push(ALL);
  return [...list, ...log];
}

/// 選択（anchor と shift 側の head）から diff の範囲を決める。
/// from は古い側、to は新しい側。一覧は新しい順なので添字は逆になる。
function rangeOf(commits: CommitInfo[], anchor: string | null, head: string | null): { from: string; to: string } | null {
  if (!anchor) return null;
  if (anchor === WORKING.sha) return { from: WORKING.sha, to: WORKING.sha };
  const real = commits.filter((c) => !PSEUDO.has(c.sha));
  if (anchor === ALL.sha) {
    // 一番古いコミットの第 1 親（= 分岐点）から作業ツリーまで
    const oldest = real[real.length - 1];
    return oldest ? { from: oldest.sha, to: WORKING.sha } : null;
  }
  const ai = commits.findIndex((c) => c.sha === anchor);
  const hi = head ? commits.findIndex((c) => c.sha === head) : -1;
  if (ai < 0) return null;
  if (hi < 0 || hi === ai) return { from: anchor, to: anchor };
  return { from: commits[Math.max(ai, hi)].sha, to: commits[Math.min(ai, hi)].sha };
}

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
  const nonce = useAtomValue(dataNonceAtom);
  const [commitsW, setCommitsW] = useAtom(browserCommitsWAtom);
  const [treeW, setTreeW] = useAtom(browserTreeWAtom);
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  // anchor は通常クリック、head は shift クリックの反対側。両方あれば範囲になる。
  const [anchor, setAnchor] = useState<string | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  // diff の前後文脈行数（-U）。ファイルを変えたら「変更のみ」に戻す。
  const [ctxLines, setCtxLines] = useState<number>(DIFF_CONTEXT_LEVELS[0].v);

  const selectFile = (p: string) => {
    setFile(p);
    setCtxLines(DIFF_CONTEXT_LEVELS[0].v);
  };

  // コミット列/ツリー列の合計が広がりすぎて diff が消える・右へはみ出すのを防ぐ。
  // 実コンテナ幅から diff の最小幅を差し引いた範囲にドラッグをクランプする。
  const rootRef = useRef<HTMLDivElement>(null);
  const MIN_DIFF = 260;
  const avail = () => rootRef.current?.clientWidth ?? 9999;
  const resizeCommits = (dx: number) =>
    setCommitsW((w) => clamp(w + dx, 150, Math.max(150, avail() - treeW - MIN_DIFF)));
  const resizeTree = (dx: number) =>
    setTreeW((w) => clamp(w + dx, 180, Math.max(180, avail() - commitsW - MIN_DIFF)));

  // 初期表示・ウィンドウ/パネル変更で幅が過大なら収める
  useEffect(() => {
    const fit = () => {
      const width = rootRef.current?.clientWidth;
      if (!width) return;
      setCommitsW((w) => clamp(w, 150, Math.max(150, width - 180 - MIN_DIFF)));
      setTreeW((w) => clamp(w, 180, Math.max(180, width - 150 - MIN_DIFF)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [setCommitsW, setTreeW]);

  useEffect(() => {
    let alive = true;
    setCommits(null);
    setAnchor(null);
    setHead(null);
    setFiles(null);
    setFile(null);
    setDiff(null);
    api.commitLog(path).then((log) => {
      if (!alive) return;
      const list = withPseudo(log, dirty);
      setCommits(list);
      setAnchor(list[0]?.sha ?? null);
    });
    return () => {
      alive = false;
    };
  }, [path, dirty]);

  const sel = rangeOf(commits ?? [], anchor, head);
  const selFrom = sel?.from ?? null;
  const selTo = sel?.to ?? null;

  useEffect(() => {
    if (!selFrom || !selTo) return;
    let alive = true;
    setFiles(null);
    setFile(null);
    setDiff(null);
    api.commitFiles(path, selFrom, selTo).then((fs) => {
      if (!alive) return;
      setFiles(fs);
      setFile(fs[0]?.path ?? null);
      setCtxLines(DIFF_CONTEXT_LEVELS[0].v);
    });
    return () => {
      alive = false;
    };
  }, [path, selFrom, selTo]);

  // 取り直しの合図が来たら、見ている位置を保ったまま中身を更新する。
  // 同じ worktree を開いたままだと上の effect は再実行されず、新しいコミットや
  // 作業ツリーの変更に追従できないため。
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const headRef = useRef(head);
  headRef.current = head;
  const fileRef = useRef(file);
  fileRef.current = file;
  const ctxRef = useRef(ctxLines);
  ctxRef.current = ctxLines;
  const seenNonce = useRef(nonce);

  useEffect(() => {
    if (seenNonce.current === nonce) return; // マウント直後は上の effect が取る
    seenNonce.current = nonce;
    let alive = true;
    void (async () => {
      const log = await api.commitLog(path);
      if (!alive) return;
      const list = withPseudo(log, dirty);
      setCommits(list);
      const has = (sha: string | null) => !!sha && list.some((c) => c.sha === sha);
      const nextAnchor = has(anchorRef.current) ? anchorRef.current : (list[0]?.sha ?? null);
      const nextHead = has(headRef.current) ? headRef.current : null;
      if (nextAnchor !== anchorRef.current || nextHead !== headRef.current) {
        // 選択が変わるときは、範囲を見ている effect が続きを取る
        setAnchor(nextAnchor);
        setHead(nextHead);
        return;
      }
      const next = rangeOf(list, nextAnchor, nextHead);
      if (!next) return;
      const fs = await api.commitFiles(path, next.from, next.to);
      if (!alive) return;
      setFiles(fs);
      const nextFile = fileRef.current && fs.some((f) => f.path === fileRef.current) ? fileRef.current : (fs[0]?.path ?? null);
      setFile(nextFile);
      if (!nextFile) {
        setDiff("");
        return;
      }
      const d = await api.commitDiff(path, next.from, next.to, nextFile, ctxRef.current);
      if (alive) setDiff(d);
    })();
    return () => {
      alive = false;
    };
  }, [nonce, path, dirty]);

  useEffect(() => {
    if (!selFrom || !selTo || !file) {
      setDiff(file ? null : "");
      return;
    }
    let alive = true;
    setDiff(null);
    api.commitDiff(path, selFrom, selTo, file, ctxLines).then((d) => {
      if (alive) setDiff(d);
    });
    return () => {
      alive = false;
    };
  }, [path, selFrom, selTo, file, ctxLines]);

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

  const current = commits.find((c) => c.sha === anchor) ?? null;
  const commitCount = commits.filter((c) => !PSEUDO.has(c.sha)).length;

  // shift クリックは anchor との間を選ぶ。疑似エントリは範囲に混ぜない
  // （作業ツリーやブランチ全体はコミットの並びの一部ではないため）。
  const onRowClick = (c: CommitInfo, e: React.MouseEvent) => {
    if (e.shiftKey && anchor && !PSEUDO.has(anchor) && !PSEUDO.has(c.sha)) {
      setHead(c.sha);
      return;
    }
    setAnchor(c.sha);
    setHead(null);
  };

  const anchorIdx = commits.findIndex((c) => c.sha === anchor);
  const headIdx = head ? commits.findIndex((c) => c.sha === head) : -1;
  const lo = headIdx >= 0 ? Math.min(anchorIdx, headIdx) : anchorIdx;
  const hi = headIdx >= 0 ? Math.max(anchorIdx, headIdx) : anchorIdx;
  const selectedCount = hi - lo + 1;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 min-w-0 overflow-hidden" style={{ borderTop: "1px solid var(--wt-border)" }}>
      {/* コミット一覧（可変幅） */}
      <div className="flex min-h-0 flex-col overflow-y-auto" style={{ width: commitsW, flexShrink: 0 }}>
        <ColHeader label={`コミット ${commitCount}`} />
        {commits.map((c, i) => {
          const on = i >= lo && i <= hi;
          const working = c.sha === WORKING.sha;
          const all = c.sha === ALL.sha;
          return (
            <button
              key={c.sha}
              type="button"
              title={PSEUDO.has(c.sha) ? undefined : "shift + クリックで範囲選択"}
              onClick={(e) => onRowClick(c, e)}
              className="flex flex-col gap-0.5 px-3 py-2 text-left transition-colors"
              style={{ background: on ? "var(--wt-active)" : "transparent" }}
              onMouseEnter={(e) => !on && (e.currentTarget.style.background = "var(--wt-hover)")}
              onMouseLeave={(e) => !on && (e.currentTarget.style.background = "transparent")}
            >
              <span
                className="line-clamp-2 text-[12.5px] font-medium"
                style={{ color: working ? "var(--wt-warn)" : all ? "var(--wt-info)" : "var(--wt-fg)" }}
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

      <Resizer onResize={resizeCommits} />

      {/* 右領域: コミット詳細 + (ファイルツリー | diff) */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 範囲を見ているときは、どこからどこまでかを出す（1 コミットの詳細は出せない） */}
        {sel && selectedCount > 1 && (
          <div className="shrink-0 px-4 py-2.5" style={{ borderBottom: "1px solid var(--wt-border)", background: "var(--wt-panel)" }}>
            <div className="text-[13px] font-semibold leading-snug">
              {anchor === ALL.sha ? "すべてのコミットの差分" : `${selectedCount} コミットをまとめた差分`}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[10.5px]" style={{ color: "var(--wt-muted)" }}>
              <span className="font-mono">{sel.from.slice(0, 10)}</span>
              <span>〜</span>
              <span className="font-mono">{sel.to.slice(0, 10)}</span>
            </div>
          </div>
        )}
        {current && selectedCount === 1 && current.sha !== WORKING.sha && current.sha !== ALL.sha && (
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

        <div className="flex min-h-0 min-w-0 flex-1">
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

          <Resizer onResize={resizeTree} />

          {/* diff（残り全幅） */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div
              className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 overflow-hidden px-3 py-1.5"
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
