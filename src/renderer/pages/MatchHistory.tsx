import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useMatches } from "../hooks/useMatches";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import { useIpc } from "../hooks/useIpc";
import { useLcuStatus } from "../hooks/useLcuStatus";
import { useBackfill } from "../hooks/useBackfill";
import type {
  MatchListItem,
  MatchDetail,
  DashboardData,
  MatchFilterOptions,
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
import StatCard from "../components/StatCard";
import SummonerIcon from "../components/SummonerIcon";
import WinRateBar from "../components/WinRateBar";
import { ArrowDownIcon, StarIcon, SwordsIcon, ZapIcon } from "../components/icons";
import {
  formatDuration,
  formatTimeAgo,
  formatKDA,
  kdaRatio,
  kdaColor,
  formatPatch,
} from "../lib/format";
import { queueLabel } from "../components/QueueSelect";
import { scoreColor } from "../../shared/opScore";

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

const SELECT_CLASS = "select";

export default function MatchHistory() {
  const [championFilter, setChampionFilter] = useState<number | undefined>(undefined);
  const [patchFilter, setPatchFilter] = useState<string | undefined>(undefined);
  const [queueFilter, setQueueFilter] = useState<number | undefined>(undefined);
  const [accountFilter, setAccountFilter] = useState<string | undefined>(undefined);
  const [multikillFilter, setMultikillFilter] = useState<MultikillType[]>([]);
  const [sort, setSort] = useState<MatchSort | undefined>(undefined);
  const [sortDir, setSortDir] = useState<MatchSortDir>("desc");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
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

  const toggleMultikill = useCallback((kind: MultikillType) => {
    setMultikillFilter((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }, []);
  const champData = useChampionData();
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
  const [filterOptions, setFilterOptions] = useState<MatchFilterOptions>({
    patches: [],
    champions: [],
    queues: [],
    accounts: [],
    hasFavorites: false,
  });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    match: MatchListItem;
  } | null>(null);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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
        .then(setFilterOptions),
    [championFilter, patchFilter, queueFilter, accountFilter],
  );

  useEffect(() => {
    fetchOptions();

    const unsub = window.api.onGamesUpdated(() => {
      refetchDashboard();
      fetchOptions();
    });
    return unsub;
  }, [fetchOptions, refetchDashboard]);

  // Clear a selection if new data leaves it without any matching games
  useEffect(() => {
    if (filterOptions.champions.length === 0 && filterOptions.patches.length === 0) return;
    if (championFilter !== undefined && !filterOptions.champions.includes(championFilter)) {
      setChampionFilter(undefined);
    }
    if (patchFilter !== undefined && !filterOptions.patches.includes(patchFilter)) {
      setPatchFilter(undefined);
    }
    if (queueFilter !== undefined && !filterOptions.queues.includes(queueFilter)) {
      setQueueFilter(undefined);
    }
    if (
      accountFilter !== undefined &&
      !filterOptions.accounts.some((a) => a.puuid === accountFilter)
    ) {
      setAccountFilter(undefined);
    }
    // Settles rather than loops: clearing a filter sets it to undefined, and
    // the undefined branch does nothing on the re-run.
  }, [filterOptions, championFilter, patchFilter, queueFilter, accountFilter]);

  // Unfavoriting the last game takes the toggle button away with it, so the
  // filter can't be left on with no way to turn it off.
  useEffect(() => {
    if (!filterOptions.hasFavorites) setFavoritesOnly(false);
  }, [filterOptions.hasFavorites]);

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
      // The first favorite reveals the toggle button, the last one hides it
      fetchOptions();
    },
    [reload, fetchOptions],
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
                {avgKills}
                <Slash />
                {avgDeaths}
                <Slash />
                {avgAssists}
              </span>
            }
            subtext={
              <span className={kdaColor(kdaValue)}>
                {kdaRatio(dashboard.totalKills, dashboard.totalDeaths, dashboard.totalAssists)} KDA
              </span>
            }
          >
            <div className="text-[11px] text-lol-text">
              {dashboard.totalKills} / {dashboard.totalDeaths} / {dashboard.totalAssists} total
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
              className={SELECT_CLASS}
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
            className={SELECT_CLASS}
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
            className={SELECT_CLASS}
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
              className={SELECT_CLASS}
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
              className={SELECT_CLASS}
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

      <div className="space-y-1">
        {matches.map((m) => (
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
        ))}
      </div>

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
        </ContextMenu>
      )}
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
function Slash() {
  return <span className="text-lol-text/40 mx-0.5">/</span>;
}

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

function AugmentGrid({ augmentIds }: { augmentIds: number[] }) {
  if (augmentIds.length === 0) return null;
  // Classic can grant bonus augments; spill past 4 into a third column so the
  // grid stays two rows tall and rows keep a uniform height.
  const cols = augmentIds.length > 4 ? "grid-cols-3" : "grid-cols-2";
  return (
    <div className={`grid ${cols} gap-0.5 w-fit`}>
      {augmentIds.map((id, i) => (
        <AugmentIcon key={i} augmentId={id} size={22} />
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
        <div className="w-24 shrink-0">
          <div className="text-sm text-lol-text-bright truncate">
            {getChampionName(champData, match.champion_id)}
          </div>
        </div>
        <div className="w-24 shrink-0">
          <div className="text-sm text-lol-text-bright">
            {formatKDA(match.kills, match.deaths, match.assists)}
          </div>
          <div
            className={`text-xs ${parseFloat(kda) >= 3 || kda === "Perfect" ? "text-lol-gold" : "text-lol-text"}`}
          >
            {kda} KDA
          </div>
        </div>

        {/* Score */}
        <div className="w-10 shrink-0 text-center">
          {match.score != null && !isRemake && (
            <>
              <div className={`text-sm font-semibold ${scoreColor(match.score)}`}>
                {match.score.toFixed(1)}
              </div>
              {match.score_badge ? (
                <div
                  className={`text-[9px] font-bold leading-[15px] px-1 rounded w-fit mx-auto ${
                    match.score_badge === "MVP"
                      ? "bg-amber-400/20 text-amber-300"
                      : "bg-purple-500/20 text-purple-400"
                  }`}
                >
                  {match.score_badge}
                </div>
              ) : (
                <div className="text-[10px] text-lol-text uppercase tracking-wider">score</div>
              )}
            </>
          )}
        </div>

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
          <AugmentGrid augmentIds={augmentIds} />
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
          <div>{formatDuration(match.game_duration)}</div>
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
