import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { BranchPicker } from "./components/BranchPicker";
import { ConfirmHost } from "./components/ConfirmHost";
import { Detail } from "./components/Detail";
import { FirstRun } from "./components/FirstRun";
import { LogDrawer } from "./components/LogDrawer";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { Spinner } from "./components/ui";
import { useActionRunner } from "./hooks/useAction";
import { useDashboard } from "./hooks/useDashboard";
import { api } from "./lib/ipc";
import { AppContext } from "./state/app";
import { repoStatusAtom, themeAtom } from "./state/atoms";

export default function App() {
  const theme = useAtomValue(themeAtom);
  const status = useAtomValue(repoStatusAtom);
  const setStatusOnly = useSetAtom(repoStatusAtom);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  const configured = status?.configured ?? false;
  const dash = useDashboard(configured);
  const run = useActionRunner(() => void dash.refresh());

  const reloadStatus = useCallback(() => {
    api.repoStatus().then(setStatusOnly).catch(() => {});
  }, [setStatusOnly]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    reloadStatus();
  }, [reloadStatus]);

  const appApi = {
    run,
    refresh: dash.refresh,
    refreshLive: dash.refreshLive,
    ensureDisk: dash.ensureDisk,
    reloadStatus,
  };

  return (
    <AppContext.Provider value={appApi}>
      <div className="flex h-full flex-col" style={{ background: "var(--wt-bg)", color: "var(--wt-fg)" }}>
        <UpdateBanner />
        <div className="flex min-h-0 flex-1">
          {status === null ? (
            <div className="flex h-full w-full items-center justify-center">
              <Spinner size={22} />
            </div>
          ) : !configured ? (
            <div className="h-full w-full">
              <FirstRun onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          ) : (
            <>
              <Sidebar onNew={() => setBranchOpen(true)} onSettings={() => setSettingsOpen(true)} />
              <div className="relative flex min-w-0 flex-1 flex-col">
                <TopBar />
                <div className="min-h-0 flex-1">
                  <Detail />
                </div>
                <LogDrawer />
              </div>
            </>
          )}
        </div>

        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
        {branchOpen && <BranchPicker onClose={() => setBranchOpen(false)} />}
        <ConfirmHost />
      </div>
    </AppContext.Provider>
  );
}
