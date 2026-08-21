import { HashRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import MatchHistory from "./pages/MatchHistory";
import Champions from "./pages/Champions";
import Augments from "./pages/Augments";
import Friends from "./pages/Friends";
import FriendDetail from "./pages/FriendDetail";
import Trends from "./pages/Trends";
import GlobalStats from "./pages/GlobalStats";
import GlobalChampionDetail from "./pages/GlobalChampionDetail";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MatchHistory />} />
          <Route path="/champions" element={<Champions />} />
          <Route path="/augments" element={<Augments />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/friends/:key" element={<FriendDetail />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/global" element={<GlobalStats />} />
          <Route path="/global/champion/:championId" element={<GlobalChampionDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
