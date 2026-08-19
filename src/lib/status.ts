import { SERVICE_PORT } from "./topology";
import type { ServiceMount, VerifyPlan, ViteProcess } from "./types";

export function normalizePath(p: string): string {
  return p.replace(/\/+$/, "");
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizePath(a) === normalizePath(b);
}

/// この worktree に差し替え中の BE があるか。
export function beActiveFor(path: string, mounts: ServiceMount[]): boolean {
  return mounts.some((m) => m.state === "worktree" && samePath(m.worktree, path));
}

export function feActiveFor(path: string, vites: ViteProcess[]): boolean {
  return vites.some((v) => samePath(v.worktree, path));
}

export function bePortsFor(path: string, mounts: ServiceMount[]): number[] {
  return mounts
    .filter((m) => m.state === "worktree" && samePath(m.worktree, path))
    .map((m) => SERVICE_PORT[m.service])
    .filter((p): p is number => p != null);
}

export function fePortsFor(path: string, vites: ViteProcess[]): number[] {
  return vites.filter((v) => samePath(v.worktree, path)).map((v) => v.port);
}

/// プランを短い chip 文字列の配列にする。
export function planChips(plan: VerifyPlan | undefined): string[] {
  if (!plan) return [];
  if (plan.error) return ["detect error"];
  const chips: string[] = [];
  if (plan.groups.length) {
    const suffix = plan.buildGroups.length ? "+build" : "";
    chips.push(`be(${plan.groups.join(",")})${suffix}`);
  }
  if (plan.fe) chips.push("fe");
  if (plan.migrations.length) chips.push(`mig×${plan.migrations.length}`);
  if (!chips.length) chips.push("変更なし");
  return chips;
}

export const PR_COLOR: Record<string, string> = {
  draft: "var(--wt-muted)",
  open: "var(--wt-ok)",
  merged: "var(--wt-accent2, #a78bfa)",
  closed: "var(--wt-danger)",
};

export function formatSize(bytes: number | undefined): string {
  if (bytes == null) return "—";
  let v = bytes;
  for (const unit of ["B", "K", "M", "G", "T"]) {
    if (v < 1024 || unit === "T") {
      return unit === "B" || unit === "K" ? `${Math.round(v)}${unit}` : `${v.toFixed(1)}${unit}`;
    }
    v /= 1024;
  }
  return `${v.toFixed(1)}T`;
}
