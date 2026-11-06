import { useMemo, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useIpc } from "../hooks/useIpc";
import { useViewState } from "../hooks/useViewState";
import { useSort } from "../hooks/useSort";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import {
  MIN_GROUP_MEMBER_GAMES,
  MIN_SHARED_GAMES,
  type FriendsLink,
  type TeammateGroup,
  type TeammateStats,
} from "../lib/types";
import { GROUP_SIZES, groupSize } from "../lib/groups";
import ChampionIcon from "../components/ChampionIcon";
import SummonerIcon from "../components/SummonerIcon";
import WinRateBar from "../components/WinRateBar";
import SortHeader from "../components/SortHeader";
import { LOCALE, formatDecimal, formatTimeAgo, kdaRatio, kdaColor } from "../lib/format";
import { matchesSearch } from "../lib/search";
import Kda from "../components/Kda";
import RiotId from "../components/RiotId";
import SearchInput from "../components/SearchInput";
import FilterMenu, { FilterField } from "../components/FilterMenu";
import MinGamesFilter from "../components/MinGamesFilter";
import SeasonSelect from "../components/SeasonSelect";

type View = FriendsLink["view"];
type PlayerSortKey = "games" | "winRate" | "kda" | "lastPlayed";
type GroupSortKey = "size" | "games" | "winRate" | "kda" | "lastPlayed";

const VIEWS: { key: View; label: string; title?: string }[] = [
  { key: "players", label: "Players" },
  {
    key: "groups",
    label: "Groups",
    title: `Each game counts once, for everyone on your team you've played ${MIN_GROUP_MEMBER_GAMES}+ games with`,
  },
];

function groupRatio(group: TeammateGroup): number {
  const takedowns = group.kills + group.assists;
  return group.deaths > 0 ? takedowns / group.deaths : takedowns;
}

export default function Friends() {
  const link = (useLocation().state ?? null) as FriendsLink | null;
  const [season, setSeason] = useViewState<string | undefined>("friends.season", undefined);
  const [view, setView] = useViewState<View>(
    "friends.view",
    link?.view ?? "players",
    link === null,
  );
  const { data: players, refetch: refetchPlayers } = useIpc<TeammateStats[]>(
    () => window.api.getTeammateStats(season),
    [season],
  );
  const { data: groups, refetch: refetchGroups } = useIpc<TeammateGroup[]>(
    () => window.api.getTeammateGroups(season),
    [season],
  );
  const [search, setSearch] = useViewState("friends.search", "");
  // The list holds everyone we've played with; this decides who counts as a
  // friend there and which groups are listed, without changing who is in a
  // group. It starts and resets at MIN_SHARED_GAMES rather than off.
  const [minGames, setMinGames] = useViewState<number | undefined>(
    "friends.minGames",
    MIN_SHARED_GAMES,
  );
  const [size, setSize] = useViewState<number | undefined>("friends.groupSize", undefined);
  const playerSort = useSort<PlayerSortKey>("friends", "games");
  const groupSort = useSort<GroupSortKey>("friends.groups", "games");
  const { sortKey: playerSortKey, sortDir: playerSortDir } = playerSort;
  const { sortKey: groupSortKey, sortDir: groupSortDir } = groupSort;

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => {
      refetchPlayers();
      refetchGroups();
    });
    return unsub;
  }, [refetchPlayers, refetchGroups]);

  const sortedPlayers = useMemo(() => {
    if (!players) return [];
    let filtered = players.filter(
      (t) => (minGames === undefined || t.games >= minGames) && matchesSearch(t.name, search),
    );

    filtered.sort((a, b) => {
      let av: number, bv: number;
      switch (playerSortKey) {
        case "winRate":
          av = a.games > 0 ? a.wins / a.games : 0;
          bv = b.games > 0 ? b.wins / b.games : 0;
          break;
        case "kda":
          av = a.deaths > 0 ? (a.kills + a.assists) / a.deaths : a.kills + a.assists;
          bv = b.deaths > 0 ? (b.kills + b.assists) / b.deaths : b.kills + b.assists;
          break;
        case "lastPlayed":
          av = a.lastPlayed;
          bv = b.lastPlayed;
          break;
        default:
          av = a.games;
          bv = b.games;
      }
      return playerSortDir === "desc" ? bv - av : av - bv;
    });

    return filtered;
  }, [players, search, minGames, playerSortKey, playerSortDir]);

  const sortedGroups = useMemo(() => {
    if (!groups) return [];
    const filtered = groups.filter(
      (g) =>
        (minGames === undefined || g.games >= minGames) &&
        (size === undefined || groupSize(g) === size) &&
        g.members.some((m) => matchesSearch(m.name, search)),
    );

    filtered.sort((a, b) => {
      let av: number, bv: number;
      switch (groupSortKey) {
        case "size":
          av = groupSize(a);
          bv = groupSize(b);
          break;
        case "winRate":
          av = a.wins / a.games;
          bv = b.wins / b.games;
          break;
        case "kda":
          av = groupRatio(a);
          bv = groupRatio(b);
          break;
        case "lastPlayed":
          av = a.lastPlayed;
          bv = b.lastPlayed;
          break;
        default:
          av = a.games;
          bv = b.games;
      }
      return groupSortDir === "desc" ? bv - av : av - bv;
    });

    return filtered;
  }, [groups, search, minGames, size, groupSortKey, groupSortDir]);

  if (!players || !groups) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  const showGroups = view === "groups";
  const listed = showGroups ? sortedGroups : sortedPlayers;

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-lol-text-bright">Friends</h1>
          <span className="text-sm text-lol-text">
            {listed.length.toLocaleString(LOCALE)} {showGroups ? "groups" : "players"} ·{" "}
            {minGames ?? 1}+ games together
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                title={v.title}
                aria-pressed={view === v.key}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  view === v.key
                    ? "bg-lol-gold/20 text-lol-gold border-lol-gold/50"
                    : "text-lol-text border-lol-border bg-lol-card hover:border-lol-border/80"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <FilterMenu
            active={
              (season !== undefined ? 1 : 0) +
              (minGames !== MIN_SHARED_GAMES ? 1 : 0) +
              (showGroups && size !== undefined ? 1 : 0)
            }
            onReset={() => {
              setSeason(undefined);
              setMinGames(MIN_SHARED_GAMES);
              setSize(undefined);
            }}
          >
            <SeasonSelect value={season} onChange={setSeason} label="Set" />
            {showGroups && (
              <FilterField label="Group size">
                <select
                  value={size ?? ""}
                  onChange={(e) =>
                    setSize(e.target.value === "" ? undefined : Number(e.target.value))
                  }
                  className="select w-full"
                >
                  <option value="">All sizes</option>
                  {Object.entries(GROUP_SIZES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </FilterField>
            )}
            <MinGamesFilter
              value={minGames}
              onChange={setMinGames}
              max={Math.max(...(showGroups ? groups : players).map((row) => row.games))}
            />
          </FilterMenu>
          <SearchInput value={search} onChange={setSearch} placeholder="Search player..." />
        </div>
      </div>

      <div className="bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
        {showGroups ? (
          <GroupsTable groups={sortedGroups} sort={groupSort} />
        ) : (
          <PlayersTable players={sortedPlayers} sort={playerSort} />
        )}
        {listed.length === 0 && (
          <div className="py-8 text-center text-sm text-lol-text">
            No {showGroups ? "groups" : "players"} found
          </div>
        )}
      </div>
    </div>
  );
}

function PlayersTable({
  players,
  sort,
}: {
  players: TeammateStats[];
  sort: ReturnType<typeof useSort<PlayerSortKey>>;
}) {
  const navigate = useNavigate();
  const champData = useChampionData();

  return (
    <table className="w-full">
      <thead className="bg-lol-dark/50">
        <tr>
          <th className="px-3 py-2 text-right text-xs font-medium text-lol-text uppercase tracking-wider w-12">
            #
          </th>
          <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider">
            Player
          </th>
          <SortHeader {...sort} numeric label="Games" field="games" className="w-24" />
          <SortHeader {...sort} numeric label="Win Rate" field="winRate" className="w-32" />
          <SortHeader {...sort} label="Their KDA" field="kda" className="w-32" />
          <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider w-36">
            Top Champions
          </th>
          <SortHeader {...sort} label="Last Played" field="lastPlayed" className="w-32" />
        </tr>
      </thead>
      <tbody>
        {players.map((t, i) => {
          const avgKills = t.games > 0 ? t.kills / t.games : 0;
          const avgDeaths = t.games > 0 ? t.deaths / t.games : 0;
          const avgAssists = t.games > 0 ? t.assists / t.games : 0;
          const ratio = avgDeaths > 0 ? (avgKills + avgAssists) / avgDeaths : avgKills + avgAssists;
          const ratioStr = kdaRatio(t.kills, t.deaths, t.assists);

          return (
            <tr
              key={t.key}
              onClick={() => navigate(`/friends/${encodeURIComponent(t.key)}`)}
              className="border-t border-lol-border/50 hover:bg-lol-card-hover cursor-pointer transition-colors"
            >
              <td className="px-3 py-2 text-xs text-lol-text text-right tabular-nums">{i + 1}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <SummonerIcon iconId={t.profileIcon} size={28} lazy />
                  <span className="text-sm text-lol-text-bright">
                    <RiotId id={t.name} />
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 text-sm text-lol-text-bright text-right tabular-nums">
                {t.games.toLocaleString(LOCALE)}
              </td>
              <td className="px-3 py-2 w-32">
                <WinRateBar wins={t.wins} total={t.games} />
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col">
                  <span className={`text-sm ${kdaColor(ratio)}`}>{ratioStr}</span>
                  <span className="text-[10px] text-lol-text">
                    <Kda
                      kills={formatDecimal(avgKills)}
                      deaths={formatDecimal(avgDeaths)}
                      assists={formatDecimal(avgAssists)}
                    />
                  </span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1">
                  {t.champions.slice(0, 3).map((c) => (
                    <div key={c.champion_id} className="relative group">
                      <ChampionIcon championId={c.champion_id} size={24} />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-lol-dark border border-lol-border rounded px-2 py-1 text-[10px] text-lol-text-bright whitespace-nowrap z-10">
                        {getChampionName(champData, c.champion_id)} ({c.games})
                      </div>
                    </div>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2 text-sm text-lol-text">{formatTimeAgo(t.lastPlayed)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function GroupsTable({
  groups,
  sort,
}: {
  groups: TeammateGroup[];
  sort: ReturnType<typeof useSort<GroupSortKey>>;
}) {
  const navigate = useNavigate();

  return (
    <table className="w-full">
      <thead className="bg-lol-dark/50">
        <tr>
          <th className="px-3 py-2 text-right text-xs font-medium text-lol-text uppercase tracking-wider w-12">
            #
          </th>
          <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider">
            Group
          </th>
          <SortHeader {...sort} label="Size" field="size" className="w-20" />
          <SortHeader {...sort} numeric label="Games" field="games" className="w-20" />
          <SortHeader {...sort} numeric label="Win Rate" field="winRate" className="w-32" />
          <SortHeader {...sort} label="Group KDA" field="kda" className="w-28" />
          <SortHeader {...sort} label="Last Played" field="lastPlayed" className="w-28" />
        </tr>
      </thead>
      <tbody>
        {groups.map((g, i) => {
          // A per-player average, so groups of different sizes compare
          const lines = g.games * groupSize(g);
          return (
            <tr
              key={g.key}
              onClick={() => navigate(`/friends/groups/${encodeURIComponent(g.key)}`)}
              className="border-t border-lol-border/50 hover:bg-lol-card-hover cursor-pointer transition-colors"
            >
              <td className="px-3 py-2 text-xs text-lol-text text-right tabular-nums">{i + 1}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2.5">
                  {/* Wide enough for a full team, so the names line up down the table */}
                  <div className="flex w-19 shrink-0 -space-x-3">
                    {g.members.map((m) => (
                      <SummonerIcon
                        key={m.key}
                        iconId={m.profileIcon}
                        size={28}
                        lazy
                        className="ring-2 ring-lol-card"
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-2.5 text-xs text-lol-text-bright">
                    {g.members.map((m) => (
                      <span key={m.key}>
                        <RiotId id={m.name} />
                      </span>
                    ))}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 text-sm text-lol-text">{GROUP_SIZES[groupSize(g)]}</td>
              <td className="px-3 py-2 text-sm text-lol-text-bright text-right tabular-nums">
                {g.games.toLocaleString(LOCALE)}
              </td>
              <td className="px-3 py-2 w-32">
                <WinRateBar wins={g.wins} total={g.games} />
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col">
                  <span className={`text-sm ${kdaColor(groupRatio(g))}`}>
                    {kdaRatio(g.kills, g.deaths, g.assists)}
                  </span>
                  <span className="text-[10px] text-lol-text">
                    <Kda
                      kills={formatDecimal(g.kills / lines)}
                      deaths={formatDecimal(g.deaths / lines)}
                      assists={formatDecimal(g.assists / lines)}
                    />
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 text-sm text-lol-text">{formatTimeAgo(g.lastPlayed)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
