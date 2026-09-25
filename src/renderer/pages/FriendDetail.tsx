import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useIpc } from "../hooks/useIpc";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import type {
  TeammateChampionStats,
  TeammateDetail,
  TeammateMatch,
  MatchDetail,
} from "../lib/types";
import ChampionIcon from "../components/ChampionIcon";
import SummonerIcon from "../components/SummonerIcon";
import MatchScoreboard from "../components/MatchScoreboard";
import ScoreCell from "../components/ScoreCell";
import StatBars from "../components/StatBars";
import WinRateBar from "../components/WinRateBar";
import { formatDuration, formatTimeAgo, kdaRatio, kdaColor, kdaHighlight } from "../lib/format";
import { scoreColor } from "../../shared/opScore";
import Kda from "../components/Kda";

export default function FriendDetail() {
  const { key = "" } = useParams();
  const champData = useChampionData();
  const { data, loading, refetch } = useIpc<TeammateDetail | null>(
    () => window.api.getTeammateDetail(key),
    [key],
  );
  const [puuids, setPuuids] = useState<string[] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    window.api.getAllSummonerPuuids().then(setPuuids);
  }, []);

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  const toggleExpand = useCallback(
    async (gameId: number) => {
      if (expandedId === gameId) {
        setExpandedId(null);
        setDetail(null);
        return;
      }
      setExpandedId(gameId);
      setDetailLoading(true);
      try {
        setDetail(await window.api.getMatchDetail(gameId));
      } finally {
        setDetailLoading(false);
      }
    },
    [expandedId],
  );

  if (loading) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  if (!data) {
    return (
      <div className="max-w-6xl space-y-4">
        <BackLink />
        <div className="bg-lol-card rounded-xl border border-lol-border/60 p-8 text-center text-lol-text">
          No games found with this player.
        </div>
      </div>
    );
  }

  const { player, matches } = data;
  const losses = player.games - player.wins;
  const avg = (total: number) => (player.games > 0 ? (total / player.games).toFixed(1) : "0.0");
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
      <BackLink />

      <div className="grid grid-cols-[1fr_22rem] gap-4 items-stretch">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <SummonerIcon iconId={player.profileIcon} size={56} />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-lol-text-bright truncate">{player.name}</h1>
              <span className="text-sm text-lol-text">
                {player.games} games together · last played {formatTimeAgo(player.lastPlayed)}
              </span>
            </div>
          </div>

          {/* items-center keeps the columns at content height, so the dividers
              stop short of the card's top and bottom edges */}
          <div className="flex-1 flex items-center bg-lol-card rounded-xl border border-lol-border/60 divide-x divide-lol-border/60">
            <div className="flex-1 px-4 py-2.5">
              <div className="text-[11px] text-lol-text uppercase tracking-wider">Record</div>
              <div className="text-xl font-bold text-lol-text-bright">
                {player.wins}W <span className="text-lol-text/60">{losses}L</span>
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
                {avgScore != null ? avgScore.toFixed(1) : "—"}
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
          <SharedGameRow
            key={m.game_id}
            match={m}
            champData={champData}
            friendName={player.name}
            expanded={expandedId === m.game_id}
            detail={expandedId === m.game_id ? detail : null}
            detailLoading={expandedId === m.game_id && detailLoading}
            puuids={puuids}
            onToggle={() => toggleExpand(m.game_id)}
          />
        ))}
      </div>
    </div>
  );
}

function ChampionRow({ champ, champData }: { champ: TeammateChampionStats; champData: any }) {
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

function BackLink() {
  return (
    <Link
      to="/friends"
      className="inline-flex items-center gap-1.5 text-xs text-lol-text hover:text-lol-text-bright transition-colors"
    >
      <span aria-hidden>←</span> Friends
    </Link>
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
  champData: any;
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
          {label}
        </div>
        <div className="text-xs text-lol-text-bright truncate">
          {getChampionName(champData, championId)}
        </div>
      </div>
      <div className="w-20 shrink-0">
        <div className="text-xs text-lol-text-bright">
          <Kda kills={kills} deaths={deaths} assists={assists} />
        </div>
        <div className={`text-[10px] ${kdaHighlight(kda)}`}>{kda} KDA</div>
      </div>
      <ScoreCell score={score} badge={badge} />
      <StatBars damage={damage} taken={taken} heal={heal} max={max} className="w-32" />
    </div>
  );
}

function SharedGameRow({
  match,
  champData,
  friendName,
  expanded,
  detail,
  detailLoading,
  puuids,
  onToggle,
}: {
  match: TeammateMatch;
  champData: any;
  friendName: string;
  expanded: boolean;
  detail: MatchDetail | null;
  detailLoading: boolean;
  puuids: string[] | null;
  onToggle: () => void;
}) {
  const isWin = !!match.win;
  const accent = isWin ? "bg-lol-win" : "bg-lol-loss";
  const tint = isWin ? "from-lol-win/12 to-lol-win/[0.04]" : "from-lol-loss/12 to-lol-loss/[0.04]";
  // Both bars scale off the same game bests, so the two sides are comparable
  const max = {
    dmg: match.game_max_dmg,
    taken: match.game_max_taken,
    heal: match.game_max_heal,
  };

  return (
    <div>
      <button
        onClick={onToggle}
        className={`relative overflow-hidden w-full flex items-center gap-4 pl-4 pr-3 py-2.5 border border-lol-border/60 bg-lol-card hover:bg-lol-card-hover transition-colors text-left ${
          expanded ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className={`absolute left-0 inset-y-0 w-[3px] ${accent}`} />
        <span className={`absolute inset-0 pointer-events-none bg-gradient-to-r ${tint}`} />
        <div
          className={`text-xs font-bold shrink-0 w-8 ${isWin ? "text-lol-win" : "text-lol-loss"}`}
        >
          {isWin ? "WIN" : "LOSS"}
        </div>

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
        <div className="text-xs text-lol-text text-right shrink-0">
          <div className="tabular-nums">{formatDuration(match.game_duration)}</div>
          <div>{formatTimeAgo(match.game_creation)}</div>
        </div>
      </button>

      {expanded && (
        <div className="mb-1 bg-lol-card rounded-b-lg border border-t-0 border-lol-border/60 p-3">
          {detailLoading ? (
            <div className="text-sm text-lol-text text-center py-4">Loading...</div>
          ) : detail ? (
            <MatchScoreboard detail={detail} champData={champData} puuids={puuids} />
          ) : null}
        </div>
      )}
    </div>
  );
}
