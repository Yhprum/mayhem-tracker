import { HashRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import MatchHistory from "./pages/MatchHistory";
import LiveGame from "./pages/LiveGame";
import Champions from "./pages/Champions";
import Augments from "./pages/Augments";
import Friends from "./pages/Friends";
import FriendDetail from "./pages/FriendDetail";
import Trends from "./pages/Trends";
import Records from "./pages/Records";
import SeasonRecap from "./pages/SeasonRecap";
import Challenges from "./pages/Challenges";
import GlobalStats from "./pages/GlobalStats";
import GlobalChampionDetail from "./pages/GlobalChampionDetail";
import Settings from "./pages/Settings";
import GameCard from "./pages/GameCard";
import SeasonCard from "./pages/SeasonCard";
import { GAME_CARD_ROUTE, SEASON_CARD_ROUTE } from "../shared/card";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MatchHistory />} />
          <Route path="/live" element={<LiveGame />} />
          <Route path="/champions" element={<Champions />} />
          <Route path="/augments" element={<Augments />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/friends/:key" element={<FriendDetail />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/records" element={<Records />} />
          <Route path="/season" element={<SeasonRecap />} />
          <Route path="/challenges" element={<Challenges />} />
          <Route path="/global" element={<GlobalStats />} />
          <Route path="/global/champion/:championId" element={<GlobalChampionDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        {/* Outside the layout: these are drawn to be captured as images, not
            to be navigated to, so they carry no sidebar or title bar. */}
        <Route path={`${GAME_CARD_ROUTE}/:gameId`} element={<GameCard />} />
        <Route path={`${SEASON_CARD_ROUTE}/:seasonId`} element={<SeasonCard />} />
      </Routes>
    </HashRouter>
  );
}
