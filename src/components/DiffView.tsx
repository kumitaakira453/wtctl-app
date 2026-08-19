import { useMemo } from "react";
import { highlightLine } from "../lib/highlight";

type Row = {
  kind: "add" | "del" | "ctx" | "hunk" | "meta";
  text: string;
  oldNo: number | null;
  newNo: number | null;
};

/// unified diff テキストを行種別 + 行番号付きに分解する。
function parse(diff: string): Row[] {
  const rows: Row[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldNo = parseInt(m[1], 10);
        newNo = parseInt(m[2], 10);
      }
      rows.push({ kind: "hunk", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity ") ||
      line.startsWith("rename ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode")
    ) {
      rows.push({ kind: "meta", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo++ });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, newNo: null });
    } else if (line.startsWith("\\")) {
      rows.push({ kind: "meta", text: line, oldNo: null, newNo: null });
    } else {
      rows.push({ kind: "ctx", text: line.replace(/^ /, ""), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  while (rows.length && rows[rows.length - 1].text === "" && rows[rows.length - 1].kind === "ctx") {
    rows.pop();
  }
  return rows;
}

const BG: Record<Row["kind"], string> = {
  add: "var(--wt-diff-add)",
  del: "var(--wt-diff-del)",
  ctx: "transparent",
  hunk: "var(--wt-hover)",
  meta: "transparent",
};

const SIGN: Record<Row["kind"], string> = { add: "+", del: "-", ctx: " ", hunk: "", meta: "" };
const SIGN_COLOR: Record<Row["kind"], string> = {
  add: "var(--wt-ok)",
  del: "var(--wt-err)",
  ctx: "var(--wt-muted)",
  hunk: "var(--wt-muted)",
  meta: "var(--wt-muted)",
};

export function DiffView({ diff, lang }: { diff: string; lang: string | null }) {
  const rows = useMemo(() => parse(diff), [diff]);
  const highlighted = useMemo(
    () =>
      rows.map((r) =>
        r.kind === "hunk" || r.kind === "meta" ? escapeHtml(r.text) : highlightLine(r.text, lang),
      ),
    [rows, lang],
  );

  if (!diff.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-[12px]" style={{ color: "var(--wt-muted)" }}>
        差分はありません（バイナリ / 内容変更なし）
      </div>
    );
  }

  return (
    <div className="hljs-diff h-full overflow-auto font-mono text-[11.5px] leading-[1.6]">
      <table className="w-full border-collapse" style={{ tableLayout: "auto" }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: BG[r.kind] }}>
              <td
                className="select-none px-2 text-right align-top"
                style={{ color: "var(--wt-muted)", width: 44, minWidth: 44, opacity: 0.55 }}
              >
                {r.oldNo ?? ""}
              </td>
              <td
                className="select-none px-2 text-right align-top"
                style={{ color: "var(--wt-muted)", width: 44, minWidth: 44, opacity: 0.55 }}
              >
                {r.newNo ?? ""}
              </td>
              <td className="select-none px-1 text-center align-top" style={{ color: SIGN_COLOR[r.kind], width: 16 }}>
                {SIGN[r.kind]}
              </td>
              <td
                className="whitespace-pre-wrap break-all pr-3 align-top"
                style={{ color: r.kind === "hunk" || r.kind === "meta" ? "var(--wt-muted)" : "var(--wt-fg-dim)" }}
                dangerouslySetInnerHTML={{ __html: highlighted[i] || " " }}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
