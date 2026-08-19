import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { updateCheckNonceAtom, updateStatusAtom } from "../state/atoms";
import { Icon } from "./Icon";

type Phase = "hidden" | "available" | "downloading" | "error";

// 起動時に最新版を確認し、更新があれば右下に通知を出す（mdglow と同方式）。
// 「更新して再起動」でワンクリック DL＋インストール→再起動。
export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [update, setUpdate] = useState<Update | null>(null);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const nonce = useAtomValue(updateCheckNonceAtom);
  const setStatus = useSetAtom(updateStatusAtom);

  useEffect(() => {
    // Tauri 環境以外（dev のブラウザ等）では静かに無効化
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    void (async () => {
      setStatus("checking");
      try {
        const u = await check();
        if (cancelled) return;
        if (u) {
          setUpdate(u);
          setPhase("available");
          setStatus("available");
        } else {
          setStatus("uptodate");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce, setStatus]);

  const runUpdate = async () => {
    if (!update) return;
    setPhase("downloading");
    setError(null);
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
        } else if (e.event === "Progress") {
          downloaded += e.data.chunkLength;
          setPct(total > 0 ? Math.round((downloaded / total) * 100) : 0);
        }
      });
      await relaunch();
    } catch (err) {
      setError(String(err));
      setPhase("error");
    }
  };

  if (phase === "hidden" || !update) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[320px] overflow-hidden rounded-xl"
      style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border-strong)", boxShadow: "var(--wt-shadow)" }}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
          style={{ background: "var(--wt-accent-soft)", color: "var(--wt-accent)" }}
        >
          <Icon name="rocket_launch" size={18} fill />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">新しいバージョン {update.version} が利用できます</div>
          <div className="mt-0.5 text-[11px]" style={{ color: "var(--wt-muted)" }}>
            現在 v{update.currentVersion}
          </div>
          {update.body && phase === "available" && (
            <p
              className="mt-2 line-clamp-3 whitespace-pre-line text-[11px] leading-relaxed"
              style={{ color: "var(--wt-fg-dim)" }}
            >
              {update.body}
            </p>
          )}
          {phase === "error" && (
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--wt-danger)" }}>
              更新に失敗しました: {error}
            </p>
          )}

          {phase === "downloading" ? (
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--wt-hover)" }}>
                <div
                  className="h-full transition-[width] duration-150"
                  style={{ width: `${pct}%`, background: "var(--wt-accent)" }}
                />
              </div>
              <div className="mt-1.5 text-[11px]" style={{ color: "var(--wt-muted)" }}>
                ダウンロード中… {pct}%
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={runUpdate}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition hover:opacity-90"
                style={{ background: "var(--wt-accent)", color: "var(--wt-accent-fg)" }}
              >
                {phase === "error" ? "再試行" : "更新して再起動"}
              </button>
              <button
                type="button"
                onClick={() => setPhase("hidden")}
                className="rounded-lg px-3 py-1.5 text-[12px] transition"
                style={{ color: "var(--wt-muted)" }}
              >
                後で
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
