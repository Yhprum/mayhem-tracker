import { Outlet } from "react-router-dom";
import Header from "./Header";
import Sidebar from "./Sidebar";
import RecoveryBanner from "./RecoveryBanner";
import ActivityToast from "./ActivityToast";
import { WindowControls, useUpdates } from "./NavChrome";
import { useSettingStore } from "../hooks/useSettingStore";
import { navLayout } from "../lib/navigation";

export default function Layout() {
  const sidebar = useSettingStore(navLayout) === "sidebar";
  const updates = useUpdates();

  // The page keeps its place in the tree in both layouts, so switching from
  // Settings leaves that page as it was rather than mounting it afresh
  return (
    <div className={`flex w-full h-full ${sidebar ? "" : "flex-col"}`}>
      {sidebar ? (
        <Sidebar update={updates.available} onUpdate={updates.open} />
      ) : (
        <Header update={updates.available} onUpdate={updates.open} />
      )}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {sidebar && (
          <div className="titlebar-drag h-11 shrink-0 flex justify-end border-b border-lol-border/60">
            <WindowControls />
          </div>
        )}
        <RecoveryBanner />
        {/* Pages cap their own width; on a window wider than that they sit in
            the middle rather than against the left edge */}
        <main className="scrollbar-edge flex-1 overflow-y-auto p-6 [&>*]:mx-auto">
          <Outlet />
        </main>
      </div>
      <ActivityToast />
      {updates.dialogs}
    </div>
  );
}
