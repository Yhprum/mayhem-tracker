import { useMemo } from "react";
import type { MatchDetail, ParsedParticipant } from "../lib/types";
import { parseParticipants, groupByTeam } from "../lib/participants";
import { getChampionName } from "../hooks/useChampions";
import { formatKDA, kdaRatio } from "../lib/format";
import { computeMatchScores, scoreColor, type PlayerScore } from "../../shared/opScore";
import ChampionIcon from "./ChampionIcon";
import AugmentIcon from "./AugmentIcon";
import ItemIcon from "./ItemIcon";

const GRID_COLS = "grid-cols-[40px_minmax(80px,1fr)_52px_76px_110px_110px_56px_56px_176px_100px]";

export default function MatchScoreboard({
  detail,
  champData,
  puuids,
}: {
  detail: MatchDetail;
  champData: any;
  puuids: string[] | null;
}) {
  const participants = useMemo(
    () => parseParticipants(detail.participants, puuids),
    [detail, puuids],
  );
  const teams = useMemo(() => groupByTeam(participants), [participants]);
  const scores = useMemo(() => {
    const classes: Record<number, string | undefined> = {};
    for (const p of participants) classes[p.championId] = champData?.[p.championId]?.class;
    return computeMatchScores(participants, classes);
  }, [participants, champData]);

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
          scores={scores}
          patch={detail.game.game_version}
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
  scores,
  patch,
}: {
  teamId: number;
  players: ParsedParticipant[];
  maxStats: { dmg: number; taken: number; gold: number; heal: number };
  champData: any;
  scores: Map<number, PlayerScore>;
  patch?: string | null;
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
        <span className="text-center">Score</span>
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
        <PlayerRow
          key={p.participantId}
          player={p}
          maxStats={maxStats}
          champData={champData}
          score={scores.get(p.participantId)}
          patch={patch}
        />
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
  score,
  patch,
}: {
  player: ParsedParticipant;
  maxStats: { dmg: number; taken: number; gold: number; heal: number };
  champData: any;
  score?: PlayerScore;
  patch?: string | null;
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

      {/* Score */}
      <div className="text-center">
        <div
          className={`text-[11px] font-semibold ${score ? scoreColor(score.score) : "text-lol-text"}`}
        >
          {score ? score.score.toFixed(1) : "-"}
        </div>
        {score?.badge && (
          <div
            className={`text-[9px] font-bold leading-[15px] px-1 rounded w-fit mx-auto ${
              score.badge === "MVP"
                ? "bg-amber-400/20 text-amber-300"
                : "bg-purple-500/20 text-purple-400"
            }`}
          >
            {score.badge}
          </div>
        )}
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
        color="bg-red-400/50"
      />

      {/* Damage taken */}
      <ScoreboardBar value={p.totalDamageTaken} max={maxStats.taken} color="bg-sky-400/50" />

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
          <ItemIcon key={i} itemId={itemId} size={22} patch={patch} />
        ))}
        <div className="ml-0.5">
          <ItemIcon itemId={p.items[6] ?? 0} size={22} patch={patch} />
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
