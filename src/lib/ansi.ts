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

export const TONE_COLOR: Record<Tone, string> = {
  cmd: "var(--wt-info)",
  out: "var(--wt-fg-dim)",
  info: "var(--wt-fg-dim)",
  success: "var(--wt-ok)",
  warn: "var(--wt-warn)",
  error: "var(--wt-danger)",
};
