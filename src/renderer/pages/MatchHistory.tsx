import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useMatches } from "../hooks/useMatches";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import { useIpc } from "../hooks/useIpc";
import type { MatchListItem, MatchDetail, DashboardData, ParsedParticipant } from "../lib/types";
import { parseParticipants, groupByTeam } from "../lib/participants";
import ChampionIcon from "../components/ChampionIcon";
import AugmentIcon from "../components/AugmentIcon";
import ItemIcon from "../components/ItemIcon";
import MultikillBadge from "../components/MultikillBadge";
import StatCard from "../components/StatCard";
import { formatDuration, formatTimeAgo, formatKDA, kdaRatio } from "../lib/format";

export default function MatchHistory() {
  const { matches, total, loading, hasMore, loadMore } = useMatches();
  const champData = useChampionData();
  const { data: dashboard, refetch: refetchDashboard } = useIpc<DashboardData>(() =>
    window.api.getDashboard(),
  );
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [puuids, setPuuids] = useState<string[] | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.api.getAllSummonerPuuids().then(setPuuids);
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

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetchDashboard());
    return unsub;
  }, [refetchDashboard]);

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
  const winRate =
    dashboard && dashboard.totalGames > 0
      ? ((dashboard.wins / dashboard.totalGames) * 100).toFixed(1) + "%"
      : "0%";

  return (
    <div className="max-w-7xl space-y-4">
      {/* Stat Cards */}
      {dashboard && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Total Games" value={dashboard.totalGames} />
          <StatCard label="Win Rate" value={winRate} />
          <StatCard label="Avg KDA" value={`${avgKills} / ${avgDeaths} / ${avgAssists}`} />
          <div className="bg-lol-card rounded-xl border border-lol-border p-4">
            <div className="text-xs text-lol-text uppercase tracking-wider mb-1">Multikills</div>
            <div className="grid grid-cols-4 gap-1">
              {[
                { label: "D", value: dashboard.multikills.doubles, color: "text-sky-400" },
                { label: "T", value: dashboard.multikills.triples, color: "text-amber-400" },
                { label: "Q", value: dashboard.multikills.quadras, color: "text-purple-400" },
                { label: "P", value: dashboard.multikills.pentas, color: "text-red-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <div className={`text-lg font-bold ${color}`}>{value}</div>
                  <div className="text-[10px] text-lol-text">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-lol-text-bright">Match History</h1>
        <span className="text-sm text-lol-text">{total} games</span>
      </div>

      {matches.length === 0 && !loading && (
        <div className="bg-lol-card rounded-xl border border-lol-border p-8 text-center text-lol-text">
          No ARAM Mayhem games found. Connect to the League client and click Refresh.
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
          />
        ))}
      </div>

      {hasMore && <div ref={sentinelRef} className="h-1" />}
      {loading && matches.length > 0 && (
        <div className="text-center py-3 text-sm text-lol-text">Loading...</div>
      )}
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
}

function parseAugmentIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw.split(",").map(Number).filter(Boolean);
}

function StatBar({
  value,
  max,
  color,
  label,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-lol-text w-6 text-right shrink-0">{label}</span>
      <div className="flex-1 h-3.5 bg-white/5 rounded-sm overflow-hidden relative">
        <div className={`h-full rounded-sm ${color}`} style={{ width: `${pct}%` }} />
        <span className="absolute inset-0 flex items-center justify-end pr-1 text-[10px] font-medium text-white/90 leading-none">
          {value > 0 ? (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value) : ""}
        </span>
      </div>
    </div>
  );
}

function AugmentGrid({ augmentIds }: { augmentIds: number[] }) {
  if (augmentIds.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-0.5">
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
}: GameRowProps) {
  const isRemake = !!match.is_remake;
  const isWin = !!match.win;
  const kda = kdaRatio(match.kills, match.deaths, match.assists);
  const augmentIds = parseAugmentIds(match.augment_ids);

  return (
    <div>
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left ${
          isRemake
            ? "bg-white/[0.03] border-white/10 hover:bg-white/[0.06]"
            : isWin
              ? "bg-lol-win/5 border-lol-win/20 hover:bg-lol-win/10"
              : "bg-lol-loss/5 border-lol-loss/20 hover:bg-lol-loss/10"
        }`}
      >
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

        {/* Stat bars */}
        <div className="w-40 shrink-0 space-y-0.5">
          <StatBar
            value={match.total_damage_dealt}
            max={match.game_max_dmg}
            color="bg-red-500/80"
            label="DMG"
          />
          <StatBar
            value={match.total_damage_taken}
            max={match.game_max_taken}
            color="bg-sky-500/80"
            label="TKN"
          />
          <StatBar
            value={match.total_heal}
            max={match.game_max_heal}
            color="bg-emerald-500/80"
            label="HEL"
          />
        </div>

        {/* Augments */}
        <div className="w-12 shrink-0">
          <AugmentGrid augmentIds={augmentIds} />
        </div>

        {/* Items – 3x2 grid, no trinket (slot 6) */}
        <div className="shrink-0 grid grid-cols-3 gap-0.5">
          {[match.item0, match.item1, match.item2, match.item3, match.item4, match.item5].map(
            (itemId, i) => (
              <ItemIcon key={i} itemId={itemId ?? 0} size={22} />
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
        <div className="mb-1 bg-lol-card rounded-b-lg border border-t-0 border-lol-border p-3">
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

/* ── Scoreboard grid layout ─────────────────────────────────── */

const GRID_COLS = "grid-cols-[40px_minmax(80px,1fr)_76px_110px_110px_56px_56px_176px_100px]";

function MatchScoreboard({
  detail,
  champData,
  puuids,
}: {
  detail: MatchDetail;
  champData: any;
  puuids: string[] | null;
}) {
  const participants = useMemo(
    () => (detail.raw ? parseParticipants(detail.raw, puuids) : []),
    [detail, puuids],
  );
  const teams = useMemo(() => groupByTeam(participants), [participants]);

  const gameMaxStats = useMemo(() => {
    let dmg = 0,
      taken = 0,
      gold = 0,
      heal = 0;
    for (const p of participants) {
      if (p.totalDamageDealtToChampions > dmg) dmg = p.totalDamageDealtToChampions;
      if (p.totalDamageTaken > taken) taken = p.totalDamageTaken;
      if (p.goldEarned > gold) gold = p.goldEarned;
      if (p.totalHeal > heal) heal = p.totalHeal;
    }
    return { dmg: dmg || 1, taken: taken || 1, gold: gold || 1, heal: heal || 1 };
  }, [participants]);

  if (participants.length === 0) {
    return (
      <div className="text-sm text-lol-text text-center py-4">Full game data not available.</div>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from(teams.entries()).map(([teamId, players]) => (
        <TeamScoreboard
          key={teamId}
          teamId={teamId}
          players={players}
          maxStats={gameMaxStats}
          champData={champData}
        />
      ))}
    </div>
  );
}

function TeamScoreboard({
  teamId,
  players,
  maxStats,
  champData,
}: {
  teamId: number;
  players: ParsedParticipant[];
  maxStats: { dmg: number; taken: number; gold: number; heal: number };
  champData: any;
}) {
  const isWin = players[0]?.win ?? false;

  return (
    <div className="rounded-lg border border-lol-border overflow-hidden">
      {/* Team header */}
      <div
        className={`px-3 py-1.5 border-b border-lol-border ${isWin ? "bg-lol-win/10" : "bg-lol-loss/10"}`}
      >
        <span className={`text-xs font-bold ${isWin ? "text-lol-win" : "text-lol-loss"}`}>
          Team {teamId === 100 ? "1" : "2"} — {isWin ? "Victory" : "Defeat"}
        </span>
      </div>

      {/* Column headers */}
      <div
        className={`px-3 py-1 border-b border-lol-border/50 grid ${GRID_COLS} gap-2 items-center text-[10px] text-lol-text uppercase tracking-wider`}
      >
        <span></span>
        <span>Player</span>
        <span className="text-center">KDA</span>
        <span className="text-center">Damage</span>
        <span className="text-center">Taken</span>
        <span className="text-right">Gold</span>
        <span className="text-right">Heal</span>
        <span>Items</span>
        <span>Augments</span>
      </div>

      {/* Player rows */}
      {players.map((p) => (
        <PlayerRow key={p.participantId} player={p} maxStats={maxStats} champData={champData} />
      ))}
    </div>
  );
}

function ScoreboardBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-4 bg-white/5 rounded-sm overflow-hidden relative">
      <div className={`h-full rounded-sm ${color}`} style={{ width: `${pct}%` }} />
      <span className="absolute inset-0 flex items-center justify-end pr-1 text-[10px] font-medium text-white/90 leading-none">
        {value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
      </span>
    </div>
  );
}

function PlayerRow({
  player: p,
  maxStats,
  champData,
}: {
  player: ParsedParticipant;
  maxStats: { dmg: number; taken: number; gold: number; heal: number };
  champData: any;
}) {
  const kda = kdaRatio(p.kills, p.deaths, p.assists);

  return (
    <div
      className={`px-3 py-1.5 border-b border-lol-border/30 last:border-b-0 grid ${GRID_COLS} gap-2 items-center ${
        p.isSelf ? "border-l-2 border-l-lol-gold bg-lol-gold/5" : ""
      }`}
    >
      {/* Champion */}
      <ChampionIcon championId={p.championId} size={32} />

      {/* Player name */}
      <div className="min-w-0">
        <div
          className={`text-xs truncate ${p.isSelf ? "text-lol-gold font-semibold" : "text-lol-text-bright"}`}
        >
          {p.summonerName}
        </div>
        <div className="text-[10px] text-lol-text truncate">
          {getChampionName(champData, p.championId)}
        </div>
      </div>

      {/* KDA */}
      <div className="text-center">
        <div className="text-[11px] text-lol-text-bright">
          {formatKDA(p.kills, p.deaths, p.assists)}
        </div>
        <div
          className={`text-[10px] ${parseFloat(kda) >= 3 || kda === "Perfect" ? "text-lol-gold" : "text-lol-text"}`}
        >
          {kda}
        </div>
      </div>

      {/* Damage dealt */}
      <ScoreboardBar
        value={p.totalDamageDealtToChampions}
        max={maxStats.dmg}
        color="bg-red-500/80"
      />

      {/* Damage taken */}
      <ScoreboardBar value={p.totalDamageTaken} max={maxStats.taken} color="bg-sky-500/80" />

      {/* Gold */}
      <div className="text-right text-[11px] text-lol-gold">
        {p.goldEarned >= 1000 ? `${(p.goldEarned / 1000).toFixed(1)}k` : p.goldEarned}
      </div>

      {/* Heal */}
      <div className="text-right text-[11px] text-emerald-400">
        {p.totalHeal >= 1000 ? `${(p.totalHeal / 1000).toFixed(1)}k` : p.totalHeal}
      </div>

      {/* Items */}
      <div className="flex gap-0.5">
        {p.items.slice(0, 6).map((itemId, i) => (
          <ItemIcon key={i} itemId={itemId} size={22} />
        ))}
        <div className="ml-0.5">
          <ItemIcon itemId={p.items[6] ?? 0} size={22} />
        </div>
      </div>

      {/* Augments */}
      <div className="flex gap-0.5">
        {p.augments.map((augId, i) => (
          <AugmentIcon key={i} augmentId={augId} size={22} />
        ))}
      </div>
    </div>
  );
}
