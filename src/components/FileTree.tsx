import { useMemo, useState } from "react";
import type { FileChange } from "../lib/types";
import { Icon } from "./Icon";

const STATUS_COLOR: Record<string, string> = {
  A: "var(--wt-ok)",
  M: "var(--wt-warn)",
  D: "var(--wt-err)",
  R: "var(--wt-info)",
  C: "var(--wt-info)",
  "?": "var(--wt-muted)",
};

type Node = {
  name: string;
  path: string; // ディレクトリはパス接頭辞、ファイルは完全パス
  dir: boolean;
  children: Node[];
  file?: FileChange;
};

function buildTree(files: FileChange[]): Node[] {
  const root: Node = { name: "", path: "", dir: true, children: [] };
  for (const f of files) {
    const segs = f.path.split("/");
    let cur = root;
    for (let i = 0; i < segs.length; i++) {
      const isLeaf = i === segs.length - 1;
      const seg = segs[i];
      const path = segs.slice(0, i + 1).join("/");
      if (isLeaf) {
        cur.children.push({ name: seg, path: f.path, dir: false, children: [], file: f });
      } else {
        let next = cur.children.find((c) => c.dir && c.name === seg);
        if (!next) {
          next = { name: seg, path, dir: true, children: [] };
          cur.children.push(next);
        }
        cur = next;
      }
    }
  }
  // 単一子ディレクトリの連鎖を "a/b/c" に圧縮（VSCode 風）
  const compact = (node: Node): Node => {
    node.children = node.children.map(compact);
    while (node.dir && node.children.length === 1 && node.children[0].dir) {
      const only = node.children[0];
      node.name = `${node.name}/${only.name}`;
      node.path = only.path;
      node.children = only.children;
    }
    // ディレクトリ先・名前順
    node.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    return node;
  };
  return compact(root).children;
}

function countFiles(node: Node): number {
  return node.dir ? node.children.reduce((n, c) => n + countFiles(c), 0) : 1;
}

export function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: FileChange[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (path: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const rows: React.ReactNode[] = [];
  const walk = (nodes: Node[], depth: number) => {
    for (const node of nodes) {
      const pad = 8 + depth * 12;
      if (node.dir) {
        const open = !collapsed.has(node.path);
        rows.push(
          <button
            key={`d:${node.path}`}
            type="button"
            onClick={() => toggle(node.path)}
            className="flex w-full items-center gap-1 py-1 pr-2 text-left transition-colors"
            style={{ paddingLeft: pad }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--wt-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Icon name={open ? "expand_more" : "chevron_right"} size={14} style={{ color: "var(--wt-muted)" }} />
            <Icon name="folder" size={13} style={{ color: "var(--wt-muted)" }} />
            <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: "var(--wt-fg-dim)" }}>
              {node.name}
            </span>
            <span className="text-[10px]" style={{ color: "var(--wt-muted)" }}>
              {countFiles(node)}
            </span>
          </button>,
        );
        if (open) walk(node.children, depth + 1);
      } else {
        const f = node.file!;
        const on = f.path === selected;
        rows.push(
          <button
            key={`f:${node.path}`}
            type="button"
            onClick={() => onSelect(f.path)}
            className="flex w-full items-center gap-1.5 py-1 pr-2 text-left transition-colors"
            style={{ paddingLeft: pad + 14, background: on ? "var(--wt-active)" : "transparent" }}
            onMouseEnter={(e) => !on && (e.currentTarget.style.background = "var(--wt-hover)")}
            onMouseLeave={(e) => !on && (e.currentTarget.style.background = "transparent")}
            title={f.path}
          >
            <span
              className="w-3 shrink-0 text-center text-[10px] font-bold"
              style={{ color: STATUS_COLOR[f.status] ?? "var(--wt-muted)" }}
            >
              {f.status}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: on ? "var(--wt-fg)" : "var(--wt-fg-dim)" }}>
              {node.name}
            </span>
            <span className="shrink-0 font-mono text-[10px]">
              {f.additions > 0 && <span style={{ color: "var(--wt-ok)" }}>+{f.additions}</span>}
              {f.deletions > 0 && <span className="ml-1" style={{ color: "var(--wt-err)" }}>-{f.deletions}</span>}
            </span>
          </button>,
        );
      }
    }
  };
  walk(tree, 0);

  return <div className="flex flex-col">{rows}</div>;
}
