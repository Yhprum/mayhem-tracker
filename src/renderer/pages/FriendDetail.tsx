import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useExpandedMatch } from "../hooks/useExpandedMatch";
import { useIpc } from "../hooks/useIpc";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import type {
  ChampionData,
  TeammateChampionStats,
  TeammateDetail,
  TeammateMatch,
} from "../lib/types";
import BackToFriends from "../components/BackToFriends";
import ChampionIcon from "../components/ChampionIcon";
import SummonerIcon from "../components/SummonerIcon";
import ScoreCell from "../components/ScoreCell";
import SharedGameRow from "../components/SharedGameRow";
import StatBars from "../components/StatBars";
import WinRateBar from "../components/WinRateBar";
import {
  LOCALE,
  formatDecimal,
  formatTimeAgo,
  kdaRatio,
  kdaColor,
  kdaHighlight,
  scoreColor,
} from "../lib/format";
import Kda from "../components/Kda";
import RiotId from "../components/RiotId";

export default function FriendDetail() {
  const { key = "" } = useParams();
  const champData = useChampionData();
  const { data, loading, refetch } = useIpc<TeammateDetail | null>(
    () => window.api.getTeammateDetail(key),
    [key],
  );
  const expansion = useExpandedMatch();

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  // Only before the first answer: a refetch after a new game keeps showing the
  // page it is about to update. null is an answer too ("no games together"), so
  // the check can't be on data alone.
  if (loading && !data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  if (!data) {
    return (
      <div className="max-w-6xl space-y-4">
        <BackToFriends />
        <div className="bg-lol-card rounded-xl border border-lol-border/60 p-8 text-center text-lol-text">
          No games found with this player.
        </div>
      </div>
    );
  }

  const { player, matches } = data;
  const losses = player.games - player.wins;
  const avg = (total: number) => formatDecimal(player.games > 0 ? total / player.games : 0);
  const ratio =
    player.deaths > 0
      ? (player.kills + player.assists) / player.deaths
      : player.kills + player.assists;
  // Their score is computed per game rather than stored, so average what we have
  const scored = matches.filter((m) => m.friend.score != null);
  const avgScore = scored.length
    ? scored.reduce((sum, m) => sum + (m.friend.score ?? 0), 0) / scored.length
    : null;
  const mvps = matches.filter((m) => m.friend.score_badge === "MVP").length;
  const aces = matches.filter((m) => m.friend.score_badge === "ACE").length;

  return (
    <div className="max-w-6xl space-y-4">
      <BackToFriends />

      <div className="grid grid-cols-[1fr_22rem] gap-4 items-stretch">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <SummonerIcon iconId={player.profileIcon} size={56} />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-lol-text-bright truncate">
                <RiotId id={player.name} />
              </h1>
              <span className="text-sm text-lol-text">
                {player.games.toLocaleString(LOCALE)} games together · last played{" "}
                {formatTimeAgo(player.lastPlayed)}
              </span>
            </div>
          </div>

          {/* items-center keeps the columns at content height, so the dividers
              stop short of the card's top and bottom edges */}
          <div className="flex-1 flex items-center bg-lol-card rounded-xl border border-lol-border/60 divide-x divide-lol-border/60">
            <div className="flex-1 px-4 py-2.5">
              <div className="text-[11px] text-lol-text uppercase tracking-wider">Record</div>
              <div className="text-xl font-bold text-lol-text-bright">
                {player.wins.toLocaleString(LOCALE)}W{" "}
                <span className="text-lol-text/60">{losses.toLocaleString(LOCALE)}L</span>
              </div>
              <div className="mt-1">
                <WinRateBar wins={player.wins} total={player.games} />
              </div>
            </div>
            <div className="flex-1 px-4 py-2.5">
              <div className="text-[11px] text-lol-text uppercase tracking-wider">Their KDA</div>
              <div className={`text-xl font-bold ${kdaColor(ratio)}`}>
                {kdaRatio(player.kills, player.deaths, player.assists)}
              </div>
              <div className="text-xs text-lol-text mt-1">
                <Kda
                  kills={avg(player.kills)}
                  deaths={avg(player.deaths)}
                  assists={avg(player.assists)}
                />{" "}
                per game
              </div>
            </div>
            <div className="flex-1 px-4 py-2.5">
              <div className="text-[11px] text-lol-text uppercase tracking-wider">
                Their Avg Score
              </div>
              <div
                className={`text-xl font-bold ${avgScore != null ? scoreColor(avgScore) : "text-lol-text"}`}
              >
                {avgScore != null ? formatDecimal(avgScore) : "—"}
              </div>
              <div className="text-xs text-lol-text mt-1">
                {mvps} MVP · {aces} ACE
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
          <div className="px-3 py-2 border-b border-lol-border/60 flex items-center justify-between">
            <span className="text-[11px] text-lol-text uppercase tracking-wider">
              Their Champions
            </span>
            <span className="text-[11px] text-lol-text">{player.champions.length}</span>
          </div>
          {/* Sets the height of the whole top block — the stat card stretches
              to match it — then scrolls */}
          <div className="max-h-44 overflow-y-auto divide-y divide-lol-border/40">
            {player.champions.map((c) => (
              <ChampionRow key={c.champion_id} champ={c} champData={champData} />
            ))}
          </div>
        </div>
      </div>

      <h2 className="text-sm font-semibold text-lol-text-bright uppercase tracking-wider pt-1">
        Games Played Together
      </h2>

      <div className="space-y-1">
        {matches.map((m) => (
          <SharedGameRow key={m.game_id} match={m} champData={champData} expansion={expansion}>
            <GameBlocks match={m} champData={champData} friendName={player.name} />
          </SharedGameRow>
        ))}
      </div>
    </div>
  );
}

function ChampionRow({
  champ,
  champData,
}: {
  champ: TeammateChampionStats;
  champData: ChampionData;
}) {
  const ratio =
    champ.deaths > 0 ? (champ.kills + champ.assists) / champ.deaths : champ.kills + champ.assists;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <ChampionIcon championId={champ.champion_id} size={26} />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-lol-text-bright truncate">
          {getChampionName(champData, champ.champion_id)}
        </div>
        <div className="text-[10px] text-lol-text">
          {champ.games} {champ.games === 1 ? "game" : "games"} ·{" "}
          <span className={kdaColor(ratio)}>
            {kdaRatio(champ.kills, champ.deaths, champ.assists)} KDA
          </span>
        </div>
      </div>
      <div className="w-28 shrink-0">
        <WinRateBar wins={champ.wins} total={champ.games} />
      </div>
    </div>
  );
}

function PlayerBlock({
  label,
  championId,
  champData,
  kills,
  deaths,
  assists,
  score,
  badge,
  damage,
  taken,
  heal,
  max,
}: {
  label: string;
  championId: number;
  champData: ChampionData;
  kills: number;
  deaths: number;
  assists: number;
  score: number | null;
  badge: "MVP" | "ACE" | null;
  damage: number;
  taken: number;
  heal: number;
  max: { dmg: number; taken: number; heal: number };
}) {
  const kda = kdaRatio(kills, deaths, assists);

  return (
    <div className="flex items-center gap-2 min-w-0">
      <ChampionIcon championId={championId} size={32} />
      <div className="min-w-0 w-24">
        <div className="text-[10px] text-lol-text uppercase tracking-wider truncate" title={label}>
          <RiotId id={label} />
        </div>
        <div className="text-xs text-lol-text-bright truncate">
          {getChampionName(champData, championId)}
        </div>
      </div>
      <div className="w-20 shrink-0">
        <div className="text-xs text-lol-text-bright">
          <Kda kills={kills} deaths={deaths} assists={assists} />
        </div>
        <div className={`text-[10px] ${kdaHighlight(kills, deaths, assists)}`}>{kda} KDA</div>
      </div>
      <ScoreCell score={score} badge={badge} />
      <StatBars damage={damage} taken={taken} heal={heal} max={max} className="w-32" />
    </div>
  );
}

function GameBlocks({
  match,
  champData,
  friendName,
}: {
  match: TeammateMatch;
  champData: ChampionData;
  friendName: string;
}) {
  // Both bars scale off the same game bests, so the two sides are comparable
  const max = {
    dmg: match.game_max_dmg,
    taken: match.game_max_taken,
    heal: match.game_max_heal,
  };

  return (
    <>
      <PlayerBlock
        label="You"
        championId={match.champion_id}
        champData={champData}
        kills={match.kills}
        deaths={match.deaths}
        assists={match.assists}
        score={match.score}
        badge={match.score_badge}
        damage={match.total_damage_dealt}
        taken={match.total_damage_taken}
        heal={match.total_heal}
        max={max}
      />

      <span className="w-px self-stretch bg-lol-border/60 shrink-0" />

      <PlayerBlock
        label={friendName}
        championId={match.friend.champion_id}
        champData={champData}
        kills={match.friend.kills}
        deaths={match.friend.deaths}
        assists={match.friend.assists}
        score={match.friend.score}
        badge={match.friend.score_badge}
        damage={match.friend.total_damage_dealt}
        taken={match.friend.total_damage_taken}
        heal={match.friend.total_heal}
        max={max}
      />

      <div className="flex-1" />
    </>
  );
}
