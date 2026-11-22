import { Outlet } from "react-router-dom";
import Header from "./Header";
import RecoveryBanner from "./RecoveryBanner";
import ActivityToast from "./ActivityToast";

export default function Layout() {
  return (
    <div className="flex flex-col w-full h-full">
      <Header />
      <RecoveryBanner />
      {/* Pages cap their own width; on a window wider than that they sit in
          the middle rather than against the left edge */}
      <main className="scrollbar-edge flex-1 overflow-y-auto p-6 [&>*]:mx-auto">
        <Outlet />
      </main>
      <ActivityToast />
    </div>
  );
}
