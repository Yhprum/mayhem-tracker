import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useMatches } from "../hooks/useMatches";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import { useIpc } from "../hooks/useIpc";
import { useLcuStatus } from "../hooks/useLcuStatus";
import { useBackfill } from "../hooks/useBackfill";
import { useViewState } from "../hooks/useViewState";
import { EMPTY_FILTER_OPTIONS } from "../hooks/useFilterOptions";
import type {
  MatchListItem,
  MatchDetail,
  DashboardData,
  MatchFilterOptions,
  MatchSession,
  MatchSort,
  MatchSortDir,
  MultikillType,
  LcuStatus,
  BackfillProgress,
} from "../lib/types";
import ChampionIcon from "../components/ChampionIcon";
import AugmentIcon from "../components/AugmentIcon";
import ItemIcon from "../components/ItemIcon";
import MatchScoreboard from "../components/MatchScoreboard";
import MultikillBadge from "../components/MultikillBadge";
import StatBars from "../components/StatBars";
import ScoreCell from "../components/ScoreCell";
import StatCard from "../components/StatCard";
import SummonerIcon from "../components/SummonerIcon";
import SummonerSpellIcon from "../components/SummonerSpellIcon";
import WinRateBar from "../components/WinRateBar";
import {
  ArrowDownIcon,
  CopyIcon,
  ImageIcon,
  StarIcon,
  SwordsIcon,
  ZapIcon,
} from "../components/icons";
import { ExportImageMessage, useGameImageExport } from "../components/ExportImage";
import {
  LOCALE,
  formatDateTime,
  formatDuration,
  formatPlaytime,
  formatTimeAgo,
  formatKDA,
  kdaRatio,
  kdaColor,
  kdaHighlight,
  formatPatch,
} from "../lib/format";
import { queueLabel } from "../components/QueueSelect";
import { scoreColor } from "../../shared/opScore";
import {
  SESSION_GROUPING_SETTING,
  parseSessionGrouping,
  sessionDay,
  sessionKey,
  sessionWeek,
  type SessionGrouping,
} from "../../shared/session";
import Kda from "../components/Kda";

// An empty list means something different depending on whether we're still
// waiting on the client, mid-import, or genuinely out of games.
function emptyStateMessage(
  status: LcuStatus,
  backfill: { running: boolean; progress: BackfillProgress | null },
) {
  if (backfill.running) {
    const p = backfill.progress;
    return p && p.total > 0
      ? `Importing your match history — ${p.current} of ${p.total} games checked...`
      : "Importing your match history...";
  }
  if (status !== "connected" && status !== "ingame") {
    return "Waiting for the League client. Once it's open, your Mayhem games import automatically.";
  }
  return "No ARAM Mayhem games found yet. New games are recorded as you play.";
}

// The unselected state is the default sort (date), so it isn't listed here
const SORT_OPTIONS: { value: MatchSort; label: string }[] = [
  { value: "score", label: "Score" },
  { value: "kda", label: "KDA" },
  { value: "kills", label: "Kills" },
  { value: "duration", label: "Duration" },
  { value: "damageDealt", label: "Damage Dealt" },
  { value: "damageTaken", label: "Damage Taken" },
  { value: "healing", label: "Healing" },
];

interface Session {
  // Doubles as the React key and as what the database's totals are looked up by
  key: string;
  label: string;
  matches: MatchListItem[];
  // Games in the whole session, which is more than `matches` holds until the
  // list has been scrolled to the end of the session
  games: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  avgScore: number | null;
}

// Expects a date-ordered list (either direction); remakes count toward the
// session's size but stay out of its record and averages.
//
// Rows are pooled by key rather than by runs of neighbours, so the games from a
// patch that no longer sit together — an older game missing its version can
// land between two that have it — still read as the one session the totals
// below the header describe.
function groupIntoSessions(matches: MatchListItem[], grouping: SessionGrouping): Session[] {
  const sessions = new Map<string, Session>();
  const scores = new Map<string, { sum: number; games: number }>();

  for (const m of matches) {
    const key = sessionKey(m, grouping);
    let session = sessions.get(key);
    if (!session) {
      session = {
        key,
        label: sessionLabel(m, grouping),
        matches: [],
        games: 0,
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        avgScore: null,
      };
      sessions.set(key, session);
      scores.set(key, { sum: 0, games: 0 });
    }
    session.matches.push(m);
    session.games++;
    if (m.is_remake) continue;
    if (m.win) session.wins++;
    else session.losses++;
    session.kills += m.kills;
    session.deaths += m.deaths;
    session.assists += m.assists;
    if (m.score != null) {
      const score = scores.get(key)!;
      score.sum += m.score;
      score.games++;
    }
  }

  for (const session of sessions.values()) {
    const score = scores.get(session.key)!;
    if (score.games > 0) session.avgScore = score.sum / score.games;
  }
  return [...sessions.values()];
}

function sessionLabel(match: MatchListItem, grouping: SessionGrouping): string {
  if (grouping === "patch") {
    return match.game_version ? `Patch ${formatPatch(match.game_version)}` : "Unknown patch";
  }
  if (grouping === "week") return weekLabel(sessionWeek(match.game_creation));
  return dayLabel(sessionDay(match.game_creation));
}

function dayLabel(day: number): string {
  const d = new Date(day);
  const today = new Date(sessionDay(Date.now()));
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(LOCALE, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== today.getFullYear() && { year: "numeric" }),
  });
}

// Weeks run Monday to Sunday, and are named by the Monday that opens them.
function weekLabel(week: number): string {
  const d = new Date(week);
  const thisWeek = new Date(sessionWeek(Date.now()));
  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(thisWeek.getDate() - 7);
  if (d.toDateString() === thisWeek.toDateString()) return "This week";
  if (d.toDateString() === lastWeek.toDateString()) return "Last week";
  const start = d.toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== thisWeek.getFullYear() && { year: "numeric" }),
  });
  return `Week of ${start}`;
}

export default function MatchHistory() {
  const [championFilter, setChampionFilter] = useViewState<number | undefined>(
    "matches.champion",
    undefined,
  );
  const [patchFilter, setPatchFilter] = useViewState<string | undefined>(
    "matches.patch",
    undefined,
  );
  const [queueFilter, setQueueFilter] = useViewState<number | undefined>(
    "matches.queue",
    undefined,
  );
  const [accountFilter, setAccountFilter] = useViewState<string | undefined>(
    "matches.account",
    undefined,
  );
  const [multikillFilter, setMultikillFilter] = useViewState<MultikillType[]>(
    "matches.multikills",
    [],
  );
  const [sort, setSort] = useViewState<MatchSort | undefined>("matches.sort", undefined);
  const [sortDir, setSortDir] = useViewState<MatchSortDir>("matches.sortDir", "desc");
  const [favoritesOnly, setFavoritesOnly] = useViewState("matches.favorites", false);
  const { matches, loading, hasMore, loadMore, reload } = useMatches({
    championId: championFilter,
    patch: patchFilter,
    queue: queueFilter,
    account: accountFilter,
    sort,
    sortDir,
    multikills: multikillFilter,
    favorites: favoritesOnly,
  });

  const toggleMultikill = useCallback(
    (kind: MultikillType) => {
      setMultikillFilter((prev) =>
        prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
      );
    },
    [setMultikillFilter],
  );
  const champData = useChampionData();
  // Read once on mount, which is every time the page is opened: coming back
  // from Settings is what changes it.
  const { data: storedGrouping } = useIpc<string | null>(
    () => window.api.getSetting(SESSION_GROUPING_SETTING),
    [],
  );
  const grouping = parseSessionGrouping(storedGrouping);
  const { data: dashboard, refetch: refetchDashboard } = useIpc<DashboardData>(
    () =>
      window.api.getDashboard({
        championId: championFilter,
        patch: patchFilter,
        queue: queueFilter,
        account: accountFilter,
      }),
    [championFilter, patchFilter, queueFilter, accountFilter],
  );
  // The list arrives a page at a time, so the rows on screen describe the page
  // rather than the day. These cover every game the filters match.
  const { data: sessionTotals, refetch: refetchSessions } = useIpc<MatchSession[]>(
    () =>
      window.api.getMatchSessions({
        championId: championFilter,
        patch: patchFilter,
        queue: queueFilter,
        account: accountFilter,
        multikills: multikillFilter,
        favorites: favoritesOnly,
      }),
    [championFilter, patchFilter, queueFilter, accountFilter, multikillFilter, favoritesOnly],
  );

  // Null until the first answer. The effects below drop selections the data no
  // longer supports, and an empty stand-in would read as data supporting none.
  const [loadedOptions, setLoadedOptions] = useState<MatchFilterOptions | null>(null);
  const filterOptions = loadedOptions ?? EMPTY_FILTER_OPTIONS;
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    match: MatchListItem;
  } | null>(null);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // One instance for the page: both of the right-click menu's image items
  // report through the same message
  const exporting = useGameImageExport();
  const [puuids, setPuuids] = useState<string[] | null>(null);
  const [profile, setProfile] = useState<{
    name: string | null;
    profileIcon: number | null;
  } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const lcuStatus = useLcuStatus();
  const backfill = useBackfill();

  useEffect(() => {
    window.api.getAllSummonerPuuids().then(setPuuids);
  }, []);

  // The name and icon can change under us as new games arrive
  useEffect(() => {
    const load = () => window.api.getProfile().then(setProfile);
    load();
    return window.api.onGamesUpdated(load);
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const fetchOptions = useCallback(
    () =>
      window.api
        .getMatchFilterOptions({
          championId: championFilter,
          patch: patchFilter,
          queue: queueFilter,
          account: accountFilter,
        })
        .then(setLoadedOptions),
    [championFilter, patchFilter, queueFilter, accountFilter],
  );

  useEffect(() => {
    fetchOptions();

    const unsub = window.api.onGamesUpdated(() => {
      refetchDashboard();
      refetchSessions();
      fetchOptions();
    });
    return unsub;
  }, [fetchOptions, refetchDashboard, refetchSessions]);

  // Clear a selection if new data leaves it without any matching games
  useEffect(() => {
    if (!loadedOptions) return;
    if (championFilter !== undefined && !loadedOptions.champions.includes(championFilter)) {
      setChampionFilter(undefined);
    }
    if (patchFilter !== undefined && !loadedOptions.patches.includes(patchFilter)) {
      setPatchFilter(undefined);
    }
    if (queueFilter !== undefined && !loadedOptions.queues.includes(queueFilter)) {
      setQueueFilter(undefined);
    }
    if (
      accountFilter !== undefined &&
      !loadedOptions.accounts.some((a) => a.puuid === accountFilter)
    ) {
      setAccountFilter(undefined);
    }
    // Settles rather than loops: clearing a filter sets it to undefined, and
    // the undefined branch does nothing on the re-run.
  }, [
    loadedOptions,
    championFilter,
    patchFilter,
    queueFilter,
    accountFilter,
    setChampionFilter,
    setPatchFilter,
    setQueueFilter,
    setAccountFilter,
  ]);

  // Unfavoriting the last game takes the toggle button away with it, so the
  // filter can't be left on with no way to turn it off.
  const hasFavorites = loadedOptions?.hasFavorites;
  useEffect(() => {
    if (hasFavorites === false) setFavoritesOnly(false);
  }, [hasFavorites, setFavoritesOnly]);

  const championOptions = useMemo(
    () =>
      filterOptions.champions
        .map((id) => ({ id, name: getChampionName(champData, id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [filterOptions.champions, champData],
  );

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
        const d = await window.api.getMatchDetail(gameId);
        setDetail(d);
      } finally {
        setDetailLoading(false);
      }
    },
    [expandedId],
  );

  const handleToggleFavorite = useCallback(
    async (match: MatchListItem) => {
      setContextMenu(null);
      await window.api.toggleFavorite(match.game_id);
      reload();
      // With the favorites filter on, this changed which games are in the list
      refetchSessions();
      // The first favorite reveals the toggle button, the last one hides it
      fetchOptions();
    },
    [reload, refetchSessions, fetchOptions],
  );

  const avgKills =
    dashboard && dashboard.totalGames > 0
      ? (dashboard.totalKills / dashboard.totalGames).toFixed(1)
      : "0";
  const avgDeaths =
    dashboard && dashboard.totalGames > 0
      ? (dashboard.totalDeaths / dashboard.totalGames).toFixed(1)
      : "0";
  const avgAssists =
    dashboard && dashboard.totalGames > 0
      ? (dashboard.totalAssists / dashboard.totalGames).toFixed(1)
      : "0";
  const kdaValue =
    dashboard && dashboard.totalDeaths > 0
      ? (dashboard.totalKills + dashboard.totalAssists) / dashboard.totalDeaths
      : Infinity;
  // With one account selected, the profile card is about that account — not
  // whichever one played most recently.
  const selectedAccount = accountFilter
    ? filterOptions.accounts.find((a) => a.puuid === accountFilter)
    : undefined;
  const profileShown = selectedAccount
    ? { name: selectedAccount.name, profileIcon: selectedAccount.profileIcon }
    : profile;

  // Session headers only make sense when the list reads in time order; any
  // other sort interleaves sessions, so those render flat.
  const isDateSort = !sort || sort === "date";
  const sessions = useMemo(() => {
    if (!isDateSort || grouping === "none") return null;
    const grouped = groupIntoSessions(matches, grouping);
    if (!sessionTotals) return grouped;

    // The rows stay as they are; only the header totals come from the database,
    // so a session that is half-loaded still reports all of itself.
    const byKey = new Map(sessionTotals.map((total) => [total.key, total]));
    return grouped.map((session) => {
      const total = byKey.get(session.key);
      if (!total) return session;
      return {
        ...session,
        games: total.games,
        wins: total.wins,
        losses: total.losses,
        kills: total.kills,
        deaths: total.deaths,
        assists: total.assists,
        avgScore:
          total.scored_games > 0 && total.score_sum != null
            ? total.score_sum / total.scored_games
            : null,
      };
    });
  }, [isDateSort, grouping, matches, sessionTotals]);

  const totalMultikills = dashboard
    ? dashboard.multikills.doubles +
      dashboard.multikills.triples +
      dashboard.multikills.quadras +
      dashboard.multikills.pentas
    : 0;

  return (
    <div className="max-w-7xl space-y-4">
      {/* Stat Cards */}
      {dashboard && dashboard.totalGames > 0 && (
        <div className="grid grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] gap-4 items-stretch">
          <ProfileCard profile={profileShown} dashboard={dashboard} />

          <StatCard
            label="Avg Score"
            accent="gold"
            icon={<StarIcon className="w-3 h-3" />}
            value={
              dashboard.avgScore != null ? (
                <span className={scoreColor(dashboard.avgScore)}>
                  {dashboard.avgScore.toFixed(1)}
                  <span className="text-sm font-semibold text-lol-text/60"> / 10</span>
                </span>
              ) : (
                "—"
              )
            }
            subtext={<ScoreMeter score={dashboard.avgScore} />}
          >
            <BadgeCounts
              mvps={dashboard.mvps}
              aces={dashboard.aces}
              scoredWins={dashboard.scoredWins}
              scoredLosses={dashboard.scoredLosses}
            />
          </StatCard>

          <StatCard
            label="Avg KDA"
            accent="sky"
            icon={<SwordsIcon className="w-3 h-3" />}
            value={
              /* Three numbers where the other cards show one — a notch smaller
                 keeps it on one line in the narrowest column */
              <span className="text-xl">
                <Kda kills={avgKills} deaths={avgDeaths} assists={avgAssists} />
              </span>
            }
            subtext={
              <span className={kdaColor(kdaValue)}>
                {kdaRatio(dashboard.totalKills, dashboard.totalDeaths, dashboard.totalAssists)} KDA
              </span>
            }
          >
            <div className="text-[11px] text-lol-text">
              <Kda
                kills={dashboard.totalKills}
                deaths={dashboard.totalDeaths}
                assists={dashboard.totalAssists}
              />{" "}
              total
            </div>
          </StatCard>

          <StatCard
            label="Multikills"
            accent="purple"
            icon={<ZapIcon className="w-3 h-3" />}
            value={totalMultikills}
          >
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  {
                    kind: "doubles",
                    label: "D",
                    name: "double",
                    value: dashboard.multikills.doubles,
                    color: "text-sky-400",
                  },
                  {
                    kind: "triples",
                    label: "T",
                    name: "triple",
                    value: dashboard.multikills.triples,
                    color: "text-amber-400",
                  },
                  {
                    kind: "quadras",
                    label: "Q",
                    name: "quadra",
                    value: dashboard.multikills.quadras,
                    color: "text-purple-400",
                  },
                  {
                    kind: "pentas",
                    label: "P",
                    name: "penta",
                    value: dashboard.multikills.pentas,
                    color: "text-red-400",
                  },
                ] as {
                  kind: MultikillType;
                  label: string;
                  name: string;
                  value: number;
                  color: string;
                }[]
              ).map(({ kind, label, name, value, color }) => {
                const active = multikillFilter.includes(kind);
                return (
                  <button
                    key={label}
                    onClick={() => toggleMultikill(kind)}
                    title={`Only show games with a ${name} kill`}
                    className={`text-center rounded-md border px-1 py-0.5 transition-colors ${
                      active
                        ? "border-lol-gold/60 bg-lol-gold/10"
                        : "border-transparent hover:border-lol-border hover:bg-white/5"
                    }`}
                  >
                    <div className={`text-base font-bold ${color}`}>{value}</div>
                    <div className="text-[10px] text-lol-text">{label}</div>
                  </button>
                );
              })}
            </div>
          </StatCard>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-lol-text-bright">Match History</h1>
        <div className="flex items-center gap-2">
          {filterOptions.hasFavorites && (
            <button
              onClick={() => setFavoritesOnly((v) => !v)}
              title={favoritesOnly ? "Showing favorites only" : "Only show favorites"}
              className={`flex items-center rounded-lg border px-2 py-1.5 transition-colors ${
                favoritesOnly
                  ? "border-lol-gold/60 bg-lol-gold/10 text-amber-400"
                  : "border-lol-border bg-lol-card text-lol-text hover:border-lol-gold/60 hover:text-lol-text-bright"
              }`}
            >
              {/* h-5 matches the selects' line-height so the boxes end up the same height */}
              <span className="flex h-5 items-center">
                <StarIcon className="h-3.5 w-3.5" fill={favoritesOnly ? "currentColor" : "none"} />
              </span>
            </button>
          )}
          {/* A single-account database doesn't need an account dropdown */}
          {(filterOptions.accounts.length > 1 || accountFilter !== undefined) && (
            <select
              value={accountFilter ?? ""}
              onChange={(e) => setAccountFilter(e.target.value === "" ? undefined : e.target.value)}
              className="select"
            >
              <option value="">All Accounts</option>
              {filterOptions.accounts.map((a) => (
                <option key={a.puuid} value={a.puuid}>
                  {a.name ?? "Unknown account"}
                </option>
              ))}
            </select>
          )}
          <select
            value={championFilter ?? ""}
            onChange={(e) =>
              setChampionFilter(e.target.value === "" ? undefined : Number(e.target.value))
            }
            className="select"
          >
            <option value="">All Champions</option>
            {championOptions.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={patchFilter ?? ""}
            onChange={(e) => setPatchFilter(e.target.value === "" ? undefined : e.target.value)}
            className="select"
          >
            <option value="">All Patches</option>
            {filterOptions.patches.map((p) => (
              <option key={p} value={p}>
                Patch {formatPatch(p)}
              </option>
            ))}
          </select>
          {(filterOptions.queues.length > 1 || queueFilter !== undefined) && (
            <select
              value={queueFilter ?? ""}
              onChange={(e) =>
                setQueueFilter(e.target.value === "" ? undefined : Number(e.target.value))
              }
              className="select"
            >
              <option value="">All Queues</option>
              {filterOptions.queues.map((q) => (
                <option key={q} value={q}>
                  {queueLabel(q)}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1">
            <select
              value={sort ?? ""}
              onChange={(e) => {
                setSort(e.target.value === "" ? undefined : (e.target.value as MatchSort));
                setSortDir("desc");
              }}
              className="select"
            >
              <option value="">Sort</option>
              {SORT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              title={
                !sort || sort === "date"
                  ? sortDir === "desc"
                    ? "Newest first"
                    : "Oldest first"
                  : sortDir === "desc"
                    ? "Highest first"
                    : "Lowest first"
              }
              className="flex items-center rounded-lg border border-lol-border bg-lol-card px-2 py-1.5 text-lol-text transition-colors hover:border-lol-gold/60 hover:text-lol-text-bright"
            >
              {/* h-5 matches the selects' line-height so the boxes end up the same height */}
              <span className="flex h-5 items-center">
                <ArrowDownIcon
                  className={`h-3.5 w-3.5 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`}
                />
              </span>
            </button>
          </div>
        </div>
      </div>

      {matches.length === 0 && !loading && (
        <div className="bg-lol-card rounded-xl border border-lol-border/60 p-8 text-center text-lol-text">
          {championFilter !== undefined ||
          patchFilter !== undefined ||
          queueFilter !== undefined ||
          accountFilter !== undefined ||
          multikillFilter.length > 0 ||
          favoritesOnly
            ? "No games match the current filters."
            : emptyStateMessage(lcuStatus, backfill)}
        </div>
      )}

      {(() => {
        const renderMatch = (m: MatchListItem) => (
          <GameRow
            key={m.game_id}
            match={m}
            champData={champData}
            expanded={expandedId === m.game_id}
            detail={expandedId === m.game_id ? detail : null}
            detailLoading={expandedId === m.game_id && detailLoading}
            puuids={puuids}
            onToggle={() => toggleExpand(m.game_id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, match: m });
            }}
          />
        );
        return sessions ? (
          <div className="space-y-4">
            {sessions.map((s) => (
              <div key={s.key}>
                <SessionHeader session={s} />
                <div className="space-y-1">{s.matches.map(renderMatch)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">{matches.map(renderMatch)}</div>
        );
      })()}

      {hasMore && <div ref={sentinelRef} className="h-1" />}
      {loading && matches.length > 0 && (
        <div className="text-center py-3 text-sm text-lol-text">Loading...</div>
      )}

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <button
            onClick={() => handleToggleFavorite(contextMenu.match)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-lol-text-bright hover:bg-white/5 text-left"
          >
            <span className={contextMenu.match.favorite ? "text-amber-400" : "text-lol-text"}>
              {contextMenu.match.favorite ? "★" : "☆"}
            </span>
            {contextMenu.match.favorite ? "Remove from Favorites" : "Add to Favorites"}
          </button>
          <button
            onClick={() => {
              const gameId = contextMenu.match.game_id;
              setContextMenu(null);
              void exporting.run(gameId, "copy");
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-lol-text-bright hover:bg-white/5 text-left"
          >
            <CopyIcon className="h-3.5 w-3.5 text-lol-text" />
            Copy Image
          </button>
          <button
            onClick={() => {
              const gameId = contextMenu.match.game_id;
              setContextMenu(null);
              void exporting.run(gameId, "save");
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-lol-text-bright hover:bg-white/5 text-left"
          >
            <ImageIcon className="h-3.5 w-3.5 text-lol-text" />
            Export as PNG
          </button>
        </ContextMenu>
      )}

      <ExportImageMessage message={exporting.message} />
    </div>
  );
}

// The identity half of the top row: who we are, how the record stands, and how
// the last handful of games went.
function ProfileCard({
  profile,
  dashboard,
}: {
  profile: { name: string | null; profileIcon: number | null } | null;
  dashboard: DashboardData;
}) {
  const losses = dashboard.totalGames - dashboard.wins;
  // Oldest on the left so the strip reads left-to-right in time
  const pips = dashboard.recentForm.slice().reverse();

  return (
    <div className="relative flex flex-col gap-3 overflow-hidden bg-lol-card rounded-xl border border-lol-border/60 p-4">
      <span className="pointer-events-none absolute -top-20 -left-10 h-48 w-64 rounded-full bg-lol-gold/[0.07] blur-3xl" />

      <div className="relative flex items-center gap-3">
        <SummonerIcon
          iconId={profile?.profileIcon ?? null}
          size={40}
          className="ring-2 ring-lol-gold/30"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-lol-text-bright truncate">
            {profile?.name ?? "Summoner"}
          </div>
          {/* The totals below pool every tracked account, so say when the name
              above only accounts for part of them */}
          <div className="text-[11px] text-lol-text truncate">
            {dashboard.totalGames} {dashboard.totalGames === 1 ? "game" : "games"}
            {dashboard.totalDuration > 0 && ` · ${formatPlaytime(dashboard.totalDuration)} played`}
            {dashboard.accounts > 1 && ` · ${dashboard.accounts} accounts`}
          </div>
        </div>
      </div>

      <div className="relative mt-auto">
        <div className="flex items-end justify-between gap-3 mb-1.5">
          <div className="text-2xl font-bold leading-none">
            <span className="text-lol-win">{dashboard.wins}W</span>{" "}
            <span className="text-lol-loss/70">{losses}L</span>
          </div>
          <div
            className="flex items-end gap-[3px]"
            title={`Last ${pips.length} ${pips.length === 1 ? "game" : "games"}`}
          >
            {pips.map((g) => (
              <span
                key={g.game_id}
                className={`h-4 w-[5px] rounded-full ${g.win ? "bg-lol-win" : "bg-lol-loss/70"}`}
              />
            ))}
          </div>
        </div>
        <WinRateBar wins={dashboard.wins} total={dashboard.totalGames} />
      </div>
    </div>
  );
}

// Muted separators keep the three averages on one line in a narrow card
// 0-10 track for the average score, warming up as the score climbs
function ScoreMeter({ score }: { score: number | null }) {
  return (
    <div className="h-1.5 rounded-full bg-lol-border/60 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-lol-gold transition-all"
        style={{ width: `${Math.min(100, Math.max(0, (score ?? 0) * 10))}%` }}
      />
    </div>
  );
}

// MVP is the best player on the winning team and ACE the best on the losing
// one, so each rate is out of the games that could have produced it.
function BadgeCounts({
  mvps,
  aces,
  scoredWins,
  scoredLosses,
}: {
  mvps: number;
  aces: number;
  scoredWins: number;
  scoredLosses: number;
}) {
  const rate = (n: number, of: number) => (of > 0 ? `${((n / of) * 100).toFixed(1)}%` : "—");

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
      <span className="rounded bg-amber-400/20 px-1 text-[9px] font-bold leading-[15px] text-amber-300">
        MVP
      </span>
      <span className="text-xs font-semibold text-lol-text-bright">{mvps}</span>
      <span className="text-[11px] text-lol-text" title="Share of wins">
        {rate(mvps, scoredWins)}
      </span>

      <span className="rounded bg-purple-500/20 px-1 text-[9px] font-bold leading-[15px] text-purple-400">
        ACE
      </span>
      <span className="text-xs font-semibold text-lol-text-bright">{aces}</span>
      <span className="text-[11px] text-lol-text" title="Share of losses">
        {rate(aces, scoredLosses)}
      </span>
    </div>
  );
}

function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", onClose);
    window.addEventListener("contextmenu", onClose, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("contextmenu", onClose, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Keep the menu inside the viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${y - rect.height}px`;
  }, [x, y]);

  return (
    <div
      ref={ref}
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-44 py-1 bg-lol-card border border-lol-border rounded-md shadow-lg shadow-black/40"
    >
      {children}
    </div>
  );
}

// One play session's date and combined record, sitting above its rows. A
// session of nothing but remakes has no record to show, so only the count
// survives there.
function SessionHeader({ session }: { session: Session }) {
  const played = session.wins + session.losses;
  const ratio = session.deaths > 0 ? (session.kills + session.assists) / session.deaths : Infinity;

  return (
    <div className="flex items-baseline gap-3 px-1 pb-1.5">
      <span className="text-sm font-semibold text-lol-text-bright">{session.label}</span>
      <span className="text-xs text-lol-text">
        {session.games} {session.games === 1 ? "game" : "games"}
      </span>
      {played > 0 && (
        <>
          <span className="text-xs font-semibold">
            <span className="text-lol-win">{session.wins}W</span>{" "}
            <span className="text-lol-loss/70">{session.losses}L</span>
          </span>
          <span
            className={`text-xs ${kdaColor(ratio)}`}
            title={formatKDA(session.kills, session.deaths, session.assists)}
          >
            {kdaRatio(session.kills, session.deaths, session.assists)} KDA
          </span>
          {session.avgScore != null && (
            <span className={`text-xs font-semibold ${scoreColor(session.avgScore)}`}>
              {session.avgScore.toFixed(1)}
              <span className="font-normal text-lol-text"> score</span>
            </span>
          )}
        </>
      )}
      <span className="flex-1 self-center border-t border-lol-border/40" />
    </div>
  );
}

interface GameRowProps {
  match: MatchListItem;
  champData: any;
  expanded: boolean;
  detail: MatchDetail | null;
  detailLoading: boolean;
  puuids: string[] | null;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function parseAugmentIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw.split(",").map(Number).filter(Boolean);
}

function AugmentGrid({ augmentIds, patch }: { augmentIds: number[]; patch?: string | null }) {
  if (augmentIds.length === 0) return null;
  // Classic can grant bonus augments; spill past 4 into a third column so the
  // grid stays two rows tall and rows keep a uniform height.
  const cols = augmentIds.length > 4 ? "grid-cols-3" : "grid-cols-2";
  return (
    <div className={`grid ${cols} gap-0.5 w-fit`}>
      {augmentIds.map((id, i) => (
        <AugmentIcon key={i} augmentId={id} size={22} patch={patch} />
      ))}
    </div>
  );
}

function GameRow({
  match,
  champData,
  expanded,
  detail,
  detailLoading,
  puuids,
  onToggle,
  onContextMenu,
}: GameRowProps) {
  const isRemake = !!match.is_remake;
  const isWin = !!match.win;
  const isFavorite = !!match.favorite;
  const kda = kdaRatio(match.kills, match.deaths, match.assists);
  const augmentIds = parseAugmentIds(match.augment_ids);

  const accent = isFavorite
    ? "bg-amber-400"
    : isRemake
      ? "bg-white/25"
      : isWin
        ? "bg-lol-win"
        : "bg-lol-loss";
  const tint = isRemake
    ? "from-white/[0.03] to-white/[0.01]"
    : isWin
      ? "from-lol-win/12 to-lol-win/[0.04]"
      : "from-lol-loss/12 to-lol-loss/[0.04]";

  return (
    <div>
      <button
        onClick={onToggle}
        onContextMenu={onContextMenu}
        className={`relative overflow-hidden w-full flex items-center gap-3 pl-4 pr-3 py-2.5 border border-lol-border/60 bg-lol-card hover:bg-lol-card-hover transition-colors text-left ${
          expanded ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className={`absolute left-0 inset-y-0 w-[3px] ${accent}`} />
        <span className={`absolute inset-0 pointer-events-none bg-gradient-to-r ${tint}`} />
        <div
          className={`text-xs font-bold shrink-0 ${isRemake ? "text-gray-500 w-8" : isWin ? "text-lol-win w-8" : "text-lol-loss w-8"}`}
        >
          {isRemake ? "RMK" : isWin ? "WIN" : "LOSS"}
        </div>
        <ChampionIcon championId={match.champion_id} size={36} />
        {/* Two 17px spells + the 2px gap match the portrait's 36px height */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <SummonerSpellIcon spellId={match.spell1} size={17} />
          <SummonerSpellIcon spellId={match.spell2} size={17} />
        </div>
        <div className="w-24 shrink-0">
          <div className="text-sm text-lol-text-bright truncate">
            {getChampionName(champData, match.champion_id)}
          </div>
        </div>
        <div className="w-24 shrink-0">
          <div className="text-sm text-lol-text-bright">
            <Kda kills={match.kills} deaths={match.deaths} assists={match.assists} />
          </div>
          <div className={`text-xs ${kdaHighlight(kda)}`}>{kda} KDA</div>
        </div>

        {/* Score — a remake is scored by nothing, so it shows none */}
        <ScoreCell score={isRemake ? null : match.score} badge={match.score_badge} />

        {/* Stat bars */}
        <StatBars
          damage={match.total_damage_dealt}
          taken={match.total_damage_taken}
          heal={match.total_heal}
          max={{
            dmg: match.game_max_dmg,
            taken: match.game_max_taken,
            heal: match.game_max_heal,
          }}
          className="w-40"
        />

        {/* Augments – reserve 3 columns so mixed-queue lists stay aligned */}
        <div className="w-[70px] shrink-0">
          <AugmentGrid augmentIds={augmentIds} patch={match.game_version} />
        </div>

        {/* Items – 3x2 grid, no trinket (slot 6) */}
        <div className="shrink-0 grid grid-cols-3 gap-0.5">
          {[match.item0, match.item1, match.item2, match.item3, match.item4, match.item5].map(
            (itemId, i) => (
              <ItemIcon key={i} itemId={itemId ?? 0} size={22} patch={match.game_version} />
            ),
          )}
        </div>

        <div className="flex-1 min-w-0">
          <MultikillBadge
            doubles={match.double_kills}
            triples={match.triple_kills}
            quadras={match.quadra_kills}
            pentas={match.penta_kills}
          />
        </div>
        <div className="text-xs text-lol-text text-right shrink-0">
          <div className="tabular-nums">{formatDuration(match.game_duration)}</div>
          <div className="w-fit ml-auto" title={formatDateTime(match.game_creation)}>
            {formatTimeAgo(match.game_creation)}
          </div>
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
