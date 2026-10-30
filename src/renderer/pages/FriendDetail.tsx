import { Fragment, useState, useEffect, useCallback } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { useIpc } from "../hooks/useIpc";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import type {
  ChampionData,
  FriendDetail as FriendDetailData,
  FriendGame,
  FriendGameMember,
  FriendMemberStats,
  MatchDetail,
  TeammateChampionStats,
} from "../lib/types";
import ChampionIcon from "../components/ChampionIcon";
import SummonerIcon from "../components/SummonerIcon";
import MatchScoreboard from "../components/MatchScoreboard";
import ScoreCell from "../components/ScoreCell";
import StatBars from "../components/StatBars";
import WinRateBar from "../components/WinRateBar";
import {
  LOCALE,
  formatDecimal,
  formatDuration,
  formatTimeAgo,
  kdaRatio,
  kdaColor,
  kdaHighlight,
  scoreColor,
} from "../lib/format";
import { partyLabel } from "../lib/constants";
import type { FriendsFilters } from "../lib/friendFilters";
import Kda from "../components/Kda";
import RiotId from "../components/RiotId";

// One friend's or one group's page. A single friend is a set of one, so the
// same layout covers the player view, a duo, a trio and a full team: only how
// many member blocks a game row draws changes with the size of the set.
export default function FriendDetail() {
  const { key = "" } = useParams();
  const location = useLocation();
  // The Friends list hands back the filters it was showing, so this page's
  // games are the ones the row counted and returning lands on the same view.
  const state = location.state as { filters?: FriendsFilters; partySize?: number } | null;
  const filters = state?.filters;
  const partySize = state?.partySize;
  const season = filters?.season;
  const champData = useChampionData();
  const { data, loading, refetch } = useIpc<FriendDetailData | null>(
    () => window.api.getFriendDetail(key, season, partySize),
    [key, season, partySize],
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

  // Only before the first answer: a refetch after a new game keeps showing the
  // page it is about to update. null is an answer too ("no games together"), so
  // the check can't be on data alone.
  if (loading && !data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  if (!data) {
    return (
      <div className="max-w-6xl space-y-4">
        <BackLink filters={filters} />
        <div className="bg-lol-card rounded-xl border border-lol-border/60 p-8 text-center text-lol-text">
          {key.includes("\u0000")
            ? "No games found with this group."
            : "No games found with this player."}
        </div>
      </div>
    );
  }

  const { group, members, matches } = data;
  const single = members.length === 1;
  const losses = group.games - group.wins;
  // A group is a party of its own size; a single friend's page shows the party
  // the list was filtered to, when it was.
  const party = partyLabel(single ? partySize : members.length + 1);
  const groupRatio =
    group.deaths > 0 ? (group.kills + group.assists) / group.deaths : group.kills + group.assists;

  // Their scores are computed per game rather than stored, so average every
  // member's line, and count the badges across the same lines.
  const lines = matches.flatMap((m) => m.members);
  const scored = lines.filter((l) => l.score != null);
  const avgScore = scored.length
    ? scored.reduce((sum, l) => sum + (l.score ?? 0), 0) / scored.length
    : null;
  const mvps = lines.filter((l) => l.score_badge === "MVP").length;
  const aces = lines.filter((l) => l.score_badge === "ACE").length;

  const avg = (total: number) => formatDecimal(group.games > 0 ? total / group.games : 0);
  const memberById = new Map(members.map((m) => [m.key, m]));

  return (
    <div className="max-w-6xl space-y-4">
      <BackLink filters={filters} />

      <div className="grid grid-cols-[1fr_22rem] gap-4 items-stretch">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {single ? (
              <SummonerIcon iconId={group.friends[0]?.profileIcon ?? null} size={56} />
            ) : (
              <div className="flex -space-x-2 shrink-0">
                {group.friends.map((f) => (
                  <SummonerIcon
                    key={f.key}
                    iconId={f.profileIcon}
                    size={52}
                    className="ring-2 ring-lol-dark"
                  />
                ))}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-lol-text-bright truncate">
                {group.friends.map((f, i) => (
                  <Fragment key={f.key}>
                    {i > 0 && <span className="text-lol-text"> + </span>}
                    <RiotId id={f.name} />
                  </Fragment>
                ))}
              </h1>
              <span className="text-sm text-lol-text">
                {group.games.toLocaleString(LOCALE)} games{" "}
                {party ? `as a ${party.toLowerCase()}` : "together"} · last played{" "}
                {formatTimeAgo(group.lastPlayed)}
              </span>
            </div>
          </div>

          {/* items-center keeps the columns at content height, so the dividers
              stop short of the card's top and bottom edges */}
          <div className="flex-1 flex items-center bg-lol-card rounded-xl border border-lol-border/60 divide-x divide-lol-border/60">
            <div className="flex-1 px-4 py-2.5">
              <div className="text-[11px] text-lol-text uppercase tracking-wider">Record</div>
              <div className="text-xl font-bold text-lol-text-bright">
                {group.wins.toLocaleString(LOCALE)}W{" "}
                <span className="text-lol-text/60">{losses.toLocaleString(LOCALE)}L</span>
              </div>
              <div className="mt-1">
                <WinRateBar wins={group.wins} total={group.games} />
              </div>
            </div>
            <div className="flex-1 px-4 py-2.5">
              <div className="text-[11px] text-lol-text uppercase tracking-wider">
                {single ? "Their KDA" : "Group KDA"}
              </div>
              <div className={`text-xl font-bold ${kdaColor(groupRatio)}`}>
                {kdaRatio(group.kills, group.deaths, group.assists)}
              </div>
              <div className="text-xs text-lol-text mt-1">
                <Kda
                  kills={avg(group.kills)}
                  deaths={avg(group.deaths)}
                  assists={avg(group.assists)}
                />{" "}
                per game
              </div>
            </div>
            <div className="flex-1 px-4 py-2.5">
              <div className="text-[11px] text-lol-text uppercase tracking-wider">
                {single ? "Their Avg Score" : "Group Avg Score"}
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
              {single ? "Their Champions" : "Members"}
            </span>
            <span className="text-[11px] text-lol-text">
              {single ? members[0].champions.length : members.length}
            </span>
          </div>
          {/* Sets the height of the whole top block — the stat card stretches
              to match it — then scrolls */}
          <div className="max-h-44 overflow-y-auto divide-y divide-lol-border/40">
            {single
              ? members[0].champions.map((c) => (
                  <ChampionRow key={c.champion_id} champ={c} champData={champData} />
                ))
              : members.map((member) => (
                  <MemberRow key={member.key} member={member} champData={champData} />
                ))}
          </div>
        </div>
      </div>

      <h2 className="text-sm font-semibold text-lol-text-bright uppercase tracking-wider pt-1">
        {party ? `${party} Games` : "Games Played Together"}
      </h2>

      <div className="space-y-1">
        {matches.map((m) => (
          <SharedGameRow
            key={m.game_id}
            match={m}
            memberById={memberById}
            single={single}
            champData={champData}
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

function BackLink({ filters }: { filters?: FriendsFilters }) {
  return (
    <Link
      to="/friends"
      state={filters ? { filters } : undefined}
      className="inline-flex items-center gap-1.5 text-xs text-lol-text hover:text-lol-text-bright transition-colors"
    >
      <span aria-hidden>←</span> Friends
    </Link>
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

// One member of a group in the side panel: who they are, how they did, and the
// champions they brought to the games the page covers.
function MemberRow({ member, champData }: { member: FriendMemberStats; champData: ChampionData }) {
  const ratio =
    member.deaths > 0
      ? (member.kills + member.assists) / member.deaths
      : member.kills + member.assists;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <SummonerIcon iconId={member.profileIcon} size={26} lazy />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-lol-text-bright truncate">
          <RiotId id={member.name} />
        </div>
        <div className="text-[10px] text-lol-text">
          {member.games} {member.games === 1 ? "game" : "games"} ·{" "}
          <span className={kdaColor(ratio)}>
            {kdaRatio(member.kills, member.deaths, member.assists)} KDA
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {member.champions.slice(0, 3).map((c) => (
          <div key={c.champion_id} className="relative group">
            <ChampionIcon championId={c.champion_id} size={22} />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-lol-dark border border-lol-border rounded px-2 py-1 text-[10px] text-lol-text-bright whitespace-nowrap z-10">
              {getChampionName(champData, c.champion_id)} ({c.games})
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The full block the single-friend view has always drawn: champion, name, KDA,
// score, and the game-best damage bars.
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

// One line of a game row, ours or a member's, in the shape PlayerBlock draws.
interface PlayerLine {
  key: string;
  label: string;
  championId: number;
  kills: number;
  deaths: number;
  assists: number;
  score: number | null;
  badge: "MVP" | "ACE" | null;
  damage: number;
  taken: number;
  heal: number;
}

// A group's game row: our own line, then one block per member, two to a line.
// A team of four friends would run past the page in a single row, so the blocks
// wrap below at the same size as the single-friend view instead of shrinking.
function SharedGameRow({
  match,
  memberById,
  single,
  champData,
  expanded,
  detail,
  detailLoading,
  puuids,
  onToggle,
}: {
  match: FriendGame;
  memberById: Map<string, FriendMemberStats>;
  single: boolean;
  champData: ChampionData;
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

  // Our own line and every member's, in the order the member panel lists them.
  // The single-friend view draws the two side by side; a group draws the same
  // blocks two to a line so a full team still fits the width of the page.
  const players: PlayerLine[] = [
    {
      key: "you",
      label: "You",
      championId: match.champion_id,
      kills: match.kills,
      deaths: match.deaths,
      assists: match.assists,
      score: match.score,
      badge: match.score_badge,
      damage: match.total_damage_dealt,
      taken: match.total_damage_taken,
      heal: match.total_heal,
    },
    ...match.members.map((line: FriendGameMember) => ({
      key: line.key,
      label: memberById.get(line.key)?.name ?? "Friend",
      championId: line.champion_id,
      kills: line.kills,
      deaths: line.deaths,
      assists: line.assists,
      score: line.score,
      badge: line.score_badge,
      damage: line.total_damage_dealt,
      taken: line.total_damage_taken,
      heal: line.total_heal,
    })),
  ];

  const renderPlayer = ({ key, ...player }: PlayerLine) => (
    <PlayerBlock key={key} {...player} champData={champData} max={max} />
  );

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

        {single ? (
          <>
            {players.map((player, i) => (
              <Fragment key={player.key}>
                {i === 1 && <span className="w-px self-stretch bg-lol-border/60 shrink-0" />}
                {renderPlayer(player)}
              </Fragment>
            ))}
            <div className="flex-1" />
          </>
        ) : (
          <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-6 gap-y-2">
            {players.map(renderPlayer)}
          </div>
        )}

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
