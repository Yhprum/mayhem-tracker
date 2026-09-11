import { HashRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import MatchHistory from "./pages/MatchHistory";
import Champions from "./pages/Champions";
import Augments from "./pages/Augments";
import Friends from "./pages/Friends";
import FriendDetail from "./pages/FriendDetail";
import Trends from "./pages/Trends";
import Records from "./pages/Records";
import GlobalStats from "./pages/GlobalStats";
import Settings from "./pages/Settings";
import LiveGame from "./pages/LiveGame";
import HistorySection from "./pages/HistorySection";
import GlobalChampionDetail from "./pages/GlobalChampionDetail";
import ItemDetail from "./pages/ItemDetail";

function ScopedFriendDetail() {
  return <FriendDetail />;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/live" element={<LiveGame />} />
          <Route path="/" element={<MatchHistory />} />
          <Route path="/history/mayhem" element={<MatchHistory scope="mayhem" />} />
          <Route path="/history/rest" element={<MatchHistory scope="rest" />} />
          <Route path="/history/ranked" element={<MatchHistory scope="ranked" />} />
          <Route path="/history/normal" element={<MatchHistory scope="normal" />} />
          <Route path="/history/aram" element={<MatchHistory scope="aram" />} />
          <Route path="/history/arena" element={<MatchHistory scope="arena" />} />
          <Route
            path="/history/:scope/:section/champion/:championId"
            element={<GlobalChampionDetail />}
          />
          <Route path="/history/:scope/items/:itemId" element={<ItemDetail />} />
          <Route path="/history/:scope/:section/:key" element={<ScopedFriendDetail />} />
          <Route path="/history/:scope/:section" element={<HistorySection />} />
          <Route path="/champions" element={<Champions />} />
          <Route path="/augments" element={<Augments />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/friends/:key" element={<FriendDetail />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/records" element={<Records />} />
          <Route path="/global" element={<GlobalStats />} />
          <Route path="/global/champion/:championId" element={<GlobalChampionDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
