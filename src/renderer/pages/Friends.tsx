import { Fragment, useMemo, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useIpc } from "../hooks/useIpc";
import { useViewState } from "../hooks/useViewState";
import { useSort } from "../hooks/useSort";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import { MIN_SHARED_GAMES, type TeammateStats, type FriendCombo } from "../lib/types";
import ChampionIcon from "../components/ChampionIcon";
import SummonerIcon from "../components/SummonerIcon";
import WinRateBar from "../components/WinRateBar";
import SortHeader from "../components/SortHeader";
import { LOCALE, formatDecimal, formatTimeAgo, kdaRatio, kdaColor } from "../lib/format";
import { PARTY_SIZES, partyLabel } from "../lib/constants";
import { matchesSearch } from "../lib/search";
import Kda from "../components/Kda";
import RiotId from "../components/RiotId";
import SearchInput from "../components/SearchInput";
import FilterMenu from "../components/FilterMenu";
import MinGamesFilter from "../components/MinGamesFilter";
import SeasonSelect from "../components/SeasonSelect";
import {
  getLastFriendsFilters,
  rememberFriendsFilters,
  type FriendSortKey,
  type FriendsFilters,
  type FriendsMode,
} from "../lib/friendFilters";

// The page asks two questions with one table layout: one row per player for
// "who do I play best with", one row per party of friends for "how does this
// group do". The request follows the open view, and each response is tagged
// with the view it belongs to so a stale answer can't fill the other table.
type Payload =
  | { mode: "players"; players: TeammateStats[] }
  | { mode: "groups"; combos: FriendCombo[] };

// The stats both views sort and filter on: a player aggregates their own
// games, a group the games its members sat in together.
interface StatRow {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  lastPlayed: number;
}

// Same walkthrough for both views — only what a row reads as (its name, or any
// member of the group) differs.
function filterSort<T extends StatRow>(
  rows: T[],
  matches: (row: T) => boolean,
  search: string,
  minGames: number | undefined,
  sortKey: FriendSortKey,
  sortDir: "asc" | "desc",
): T[] {
  const filtered = rows.filter(
    (row) => (minGames === undefined || row.games >= minGames) && matches(row),
  );

  filtered.sort((a, b) => {
    let av: number, bv: number;
    switch (sortKey) {
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
    return sortDir === "desc" ? bv - av : av - bv;
  });

  return filtered;
}

export default function Friends() {
  const navigate = useNavigate();
  const location = useLocation();
  const champData = useChampionData();
  // A player's or group's page hands the filters back when it opens this one,
  // so returning from it lands on the same view without remembering filters.
  // A history back has no state to hand back, so the view the page last had is
  // kept in memory too.
  const carried =
    (location.state as { filters?: FriendsFilters } | null)?.filters ?? getLastFriendsFilters();
  const [season, setSeason] = useViewState<string | undefined>("friends.season", carried?.season);
  // Undefined counts every game; a size counts only the games with that many
  // players including us (2 = duo, 5 = full team).
  const [partySize, setPartySize] = useViewState<number | undefined>(
    "friends.partySize",
    carried?.partySize,
  );
  const party = partyLabel(partySize);
  // Which of the two tables is open.
  const [mode, setMode] = useViewState<FriendsMode>("friends.mode", carried?.mode ?? "players");

  // The request follows the mode, so switching views also refetches: each view
  // shows the exact data the backend holds for it, never the other's rows.
  const { data, refetch } = useIpc<Payload>(
    () =>
      mode === "players"
        ? window.api
            .getTeammateStats(season, partySize)
            .then((players): Payload => ({ mode: "players", players }))
        : window.api
            .getFriendCombos(season, partySize)
            .then((combos): Payload => ({ mode: "groups", combos })),
    [season, partySize, mode],
  );

  // The list holds everyone we've played with; this decides who counts as a
  // friend, and it starts and resets at MIN_SHARED_GAMES rather than off.
  const [search, setSearch] = useViewState("friends.search", carried?.search ?? "");
  const [minGames, setMinGames] = useViewState<number | undefined>(
    "friends.minGames",
    carried?.minGames ?? MIN_SHARED_GAMES,
  );
  const sort = useSort<FriendSortKey>("friends", carried?.sortKey ?? "games", carried?.sortDir);
  const { sortKey, sortDir } = sort;

  // Everything a row's page needs to hand back when it returns here.
  const filters: FriendsFilters = useMemo(
    () => ({ season, partySize, minGames, search, mode, sortKey, sortDir }),
    [season, partySize, minGames, search, mode, sortKey, sortDir],
  );

  // Keep this view for the next time the page opens, whatever route brings it
  // back: a history back returns to the entry we left, without any state.
  useEffect(() => {
    rememberFriendsFilters(filters);
  }, [filters]);

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  // Only a payload for the open view may fill its table: while the first
  // request for a view is in flight the rows are simply not there yet.
  const sorted = useMemo(() => {
    if (!data) return { players: [], combos: [] };
    return {
      players:
        data.mode === "players"
          ? filterSort(
              data.players,
              (t) => matchesSearch(t.name, search),
              search,
              minGames,
              sortKey,
              sortDir,
            )
          : [],
      // A group answers to any of its members: searching "X" finds the trio
      // us + X + Y as well as the duo us + X.
      combos:
        data.mode === "groups"
          ? filterSort(
              data.combos,
              (c) => c.friends.some((f) => matchesSearch(f.name, search)),
              search,
              minGames,
              sortKey,
              sortDir,
            )
          : [],
    };
  }, [data, search, minGames, sortKey, sortDir]);

  const noun = mode === "players" ? "players" : "groups";
  const rows = mode === "players" ? sorted.players : sorted.combos;
  // The slider spans the counts the current view can show, whatever the other
  // view holds.
  const maxGames = data
    ? Math.max(0, ...(data.mode === "players" ? data.players : data.combos).map((row) => row.games))
    : 0;

  // Not just the first load: right after switching views the payload in hand is
  // the other view's, and it must not fill this table.
  if (!data || data.mode !== mode) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-lol-text-bright">Friends</h1>
          <span className="text-sm text-lol-text">
            {rows.length.toLocaleString(LOCALE)} {noun} · {minGames ?? 1}+ games{" "}
            {party ? `as a ${party.toLowerCase()}` : "together"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {(["players", "groups"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                title={
                  m === "players"
                    ? "One row per friend, with their overall stats"
                    : "One row per group of friends you queue with"
                }
                className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                  mode === m
                    ? "bg-lol-gold/20 text-lol-gold border-lol-gold/50"
                    : "text-lol-text border-lol-border bg-lol-card hover:border-lol-border/80"
                }`}
              >
                {m === "players" ? "Players" : "Groups"}
              </button>
            ))}
          </div>
          <select
            value={partySize ?? ""}
            onChange={(e) =>
              setPartySize(e.target.value === "" ? undefined : Number(e.target.value))
            }
            aria-label="Party size"
            title="Only count games with this many friends on your team"
            className="select w-44"
          >
            <option value="">All party sizes</option>
            {PARTY_SIZES.map((p) => (
              <option key={p.size} value={p.size}>
                {p.label} · {p.friends} {p.friends === 1 ? "friend" : "friends"}
              </option>
            ))}
          </select>
          <FilterMenu
            active={
              (season !== undefined ? 1 : 0) +
              (minGames !== MIN_SHARED_GAMES ? 1 : 0) +
              (partySize !== undefined ? 1 : 0)
            }
            onReset={() => {
              setSeason(undefined);
              setMinGames(MIN_SHARED_GAMES);
              setPartySize(undefined);
            }}
          >
            <SeasonSelect value={season} onChange={setSeason} label="Set" />
            <MinGamesFilter value={minGames} onChange={setMinGames} max={maxGames} />
          </FilterMenu>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Search ${mode === "players" ? "player" : "group"}...`}
          />
        </div>
      </div>

      {mode === "players" ? (
        <div className="bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
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
              {sorted.players.map((t, i) => {
                const avgKills = t.games > 0 ? t.kills / t.games : 0;
                const avgDeaths = t.games > 0 ? t.deaths / t.games : 0;
                const avgAssists = t.games > 0 ? t.assists / t.games : 0;
                const ratio =
                  avgDeaths > 0 ? (avgKills + avgAssists) / avgDeaths : avgKills + avgAssists;
                const ratioStr = kdaRatio(t.kills, t.deaths, t.assists);

                return (
                  <tr
                    key={t.key}
                    onClick={() =>
                      navigate(`/friends/${encodeURIComponent(t.key)}`, {
                        state: { filters, partySize },
                      })
                    }
                    className="border-t border-lol-border/50 hover:bg-lol-card-hover cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 text-xs text-lol-text text-right tabular-nums">
                      {i + 1}
                    </td>
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
                    <td className="px-3 py-2 text-sm text-lol-text">
                      {formatTimeAgo(t.lastPlayed)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sorted.players.length === 0 && (
            <div className="py-8 text-center text-sm text-lol-text">
              {partySize !== undefined ? "No players match these filters" : "No players found"}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
          <table className="w-full">
            <thead className="bg-lol-dark/50">
              <tr>
                <th className="px-3 py-2 text-right text-xs font-medium text-lol-text uppercase tracking-wider w-12">
                  #
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider">
                  Group
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-lol-text uppercase tracking-wider w-24">
                  Party
                </th>
                <SortHeader {...sort} numeric label="Games" field="games" className="w-24" />
                <SortHeader {...sort} numeric label="Win Rate" field="winRate" className="w-32" />
                <SortHeader {...sort} label="Group KDA" field="kda" className="w-32" />
                <SortHeader {...sort} label="Last Played" field="lastPlayed" className="w-32" />
              </tr>
            </thead>
            <tbody>
              {sorted.combos.map((combo, i) => {
                // The group's combined line per game: each member's kills,
                // deaths and assists summed across every game it sat together.
                const avgKills = combo.kills / combo.games;
                const avgDeaths = combo.deaths / combo.games;
                const avgAssists = combo.assists / combo.games;
                const ratio =
                  avgDeaths > 0 ? (avgKills + avgAssists) / avgDeaths : avgKills + avgAssists;
                const ratioStr = kdaRatio(combo.kills, combo.deaths, combo.assists);

                return (
                  <tr
                    key={combo.key}
                    onClick={() =>
                      navigate(`/friends/${encodeURIComponent(combo.key)}`, {
                        // The group is a party of its own size: that is what
                        // keeps its page to the games this exact set played.
                        state: { filters, partySize: combo.friends.length + 1 },
                      })
                    }
                    title="Every game this group played together"
                    className="border-t border-lol-border/50 hover:bg-lol-card-hover cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 text-xs text-lol-text text-right tabular-nums">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex -space-x-2 shrink-0">
                          {combo.friends.map((f) => (
                            <SummonerIcon
                              key={f.key}
                              iconId={f.profileIcon}
                              size={24}
                              lazy
                              className="ring-2 ring-lol-card"
                            />
                          ))}
                        </div>
                        <span className="text-sm text-lol-text-bright truncate">
                          {combo.friends.map((f, fi) => (
                            <Fragment key={f.key}>
                              {fi > 0 && <span className="text-lol-text"> + </span>}
                              <RiotId id={f.name} />
                            </Fragment>
                          ))}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center rounded-full border border-lol-gold/40 bg-lol-gold/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-lol-gold">
                        {partyLabel(combo.friends.length + 1) ?? "Team+"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-lol-text-bright text-right tabular-nums">
                      {combo.games.toLocaleString(LOCALE)}
                    </td>
                    <td className="px-3 py-2 w-32">
                      <WinRateBar wins={combo.wins} total={combo.games} />
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
                    <td className="px-3 py-2 text-sm text-lol-text">
                      {formatTimeAgo(combo.lastPlayed)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sorted.combos.length === 0 && (
            <div className="py-8 text-center text-sm text-lol-text">
              {partySize !== undefined ? "No groups match these filters" : "No groups found"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
