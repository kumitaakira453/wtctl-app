import { useAtomValue } from "jotai";
import { repoStatusAtom } from "../state/atoms";
import { Icon } from "./Icon";
import { Button } from "./ui";

export function FirstRun({ onOpenSettings }: { onOpenSettings: () => void }) {
  const status = useAtomValue(repoStatusAtom);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div
        className="wt-fade w-[520px] max-w-full rounded-2xl p-8 text-center"
        style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border)" }}
      >
        <div className="mb-4 flex justify-center">
          <Icon name="account_tree" size={48} style={{ color: "var(--wt-accent)" }} />
        </div>
        <div className="text-lg font-semibold">wtctl へようこそ</div>
        <div className="mt-2 text-sm leading-relaxed" style={{ color: "var(--wt-fg-dim)" }}>
          はじめに wasurenai リポジトリの場所を設定してください。
          worktree の BE を Docker コンテナに差し替えて動作確認できるようになります。
        </div>
        {status?.error && (
          <div
            className="mt-4 rounded-lg p-3 text-left text-xs"
            style={{ background: "var(--wt-danger-soft)", color: "var(--wt-danger)", whiteSpace: "pre-wrap" }}
          >
            {status.error}
          </div>
        )}
        <div className="mt-6 flex justify-center">
          <Button variant="primary" icon="settings" onClick={onOpenSettings}>
            リポジトリを設定
          </Button>
        </div>
      </div>
    </div>
  );
}
