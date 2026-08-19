import type { LogKind } from "./types";

// docker/npm 出力に含まれる ANSI エスケープ（ESC [ … m）を除去する。
// 色は kind と見出し語で付け直すため、生の色コードは落とす。
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

export type Tone = "cmd" | "out" | "info" | "success" | "warn" | "error";

// `out` 行は見出し語のヒューリスティックで軽く色付けする。それ以外は kind をそのまま使う。
export function toneOf(kind: LogKind, text: string): Tone {
  if (kind !== "out") return kind;
  const t = text.toLowerCase();
  if (/\b(error|failed|fatal|traceback|exception)\b/.test(t)) return "error";
  if (/\b(warn|warning|deprecat)\b/.test(t)) return "warn";
  if (/(✓|done|success|ready|listening|compiled|healthy)/.test(t)) return "success";
  return "out";
}

// --- ANSI SGR（色）を解釈してセグメント化する（ターミナル同様に色付け） ---
const SGR = new RegExp(`${String.fromCharCode(27)}\\[([0-9;]*)m`, "g");

// ダーク/ライト両対応の見やすいパレット。
const FG: Record<number, string> = {
  30: "#6b7280", 31: "#f87171", 32: "#4ade80", 33: "#eab308",
  34: "#60a5fa", 35: "#c084fc", 36: "#22d3ee", 37: "#d4d4d4",
  90: "#9ca3af", 91: "#fca5a5", 92: "#86efac", 93: "#fde047",
  94: "#93c5fd", 95: "#d8b4fe", 96: "#67e8f9", 97: "#f5f5f5",
};

export interface AnsiSeg {
  text: string;
  color?: string;
  bold: boolean;
}

export function ansiToSegments(text: string): AnsiSeg[] {
  const segs: AnsiSeg[] = [];
  let last = 0;
  let color: string | undefined;
  let bold = false;
  SGR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SGR.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), color, bold });
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    for (const c of codes) {
      if (c === 0) {
        color = undefined;
        bold = false;
      } else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) color = undefined;
      else if (FG[c] != null) color = FG[c];
      // 背景色などその他は無視（除去）
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last), color, bold });
  return segs;
}

export const TONE_COLOR: Record<Tone, string> = {
  cmd: "var(--wt-info)",
  out: "var(--wt-fg-dim)",
  info: "var(--wt-fg-dim)",
  success: "var(--wt-ok)",
  warn: "var(--wt-warn)",
  error: "var(--wt-danger)",
};
