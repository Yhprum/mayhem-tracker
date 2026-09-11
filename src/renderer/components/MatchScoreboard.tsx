import { useMemo, useState, type ReactNode } from "react";
import type { MatchDetail, ParsedParticipant } from "../lib/types";
import { parseParticipants, groupByTeam } from "../lib/participants";
import { getChampionName, useRuneData } from "../hooks/useChampions";
import { formatKDA, kdaRatio } from "../lib/format";
import { isAugmentQueue } from "../../shared/queues";
import {
  computeMatchScoreBreakdowns,
  scoreColor,
  type ScoreBreakdown,
  type ScoreComponent,
  type ScoreComponentKey,
} from "../../shared/opScore";
import ChampionIcon from "./ChampionIcon";
import AugmentIcon from "./AugmentIcon";
import ItemIcon from "./ItemIcon";
import { RuneSetupGrid } from "./RuneSetup";
import SummonerSpellIcon from "./SummonerSpellIcon";

const GRID_COLS =
  "grid-cols-[52px_140px_52px_76px_110px_110px_56px_56px_56px_176px_110px]";

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
    return computeMatchScoreBreakdowns(participants, classes);
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
          gameDuration={detail.game.game_duration}
          queueId={detail.game.queue_id}
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
  gameDuration,
  queueId,
}: {
  teamId: number;
  players: ParsedParticipant[];
  maxStats: { dmg: number; taken: number; gold: number; heal: number };
  champData: any;
  scores: Map<number, ScoreBreakdown>;
  patch?: string | null;
  gameDuration: number;
  queueId: number;
}) {
  const showAugments = isAugmentQueue(queueId);
  const isWin = players[0]?.win ?? false;
  const totals = useMemo(() => computeTeamTotals(players, scores), [players, scores]);

  return (
    <div className="rounded-lg border border-lol-border overflow-hidden">
      {/* Team header: name on the left, team totals filling the rest of the bar */}
      <div
        className={`px-3 py-1.5 border-b border-lol-border flex flex-wrap items-baseline gap-x-4 gap-y-1 ${isWin ? "bg-lol-win/10" : "bg-lol-loss/10"}`}
      >
        <span className={`text-xs font-bold ${isWin ? "text-lol-win" : "text-lol-loss"}`}>
          Team {teamId === 100 ? "1" : "2"} — {isWin ? "Victory" : "Defeat"}
        </span>
        <div className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <TeamStat label="Avg score">
            <span
              className={totals.avgScore != null ? scoreColor(totals.avgScore) : "text-lol-text"}
            >
              {totals.avgScore != null ? totals.avgScore.toFixed(1) : "-"}
            </span>
          </TeamStat>
          <TeamStat label="KDA">
            <span className="text-lol-text-bright">
              {formatKDA(totals.kills, totals.deaths, totals.assists)}
            </span>
          </TeamStat>
          <TeamStat label="Damage">
            <span className="text-red-400">{compact(totals.dmg)}</span>
          </TeamStat>
          <TeamStat label="Taken">
            <span className="text-sky-400">{compact(totals.taken)}</span>
          </TeamStat>
          <TeamStat label="Gold">
            <span className="text-lol-gold">{compact(totals.gold)}</span>
          </TeamStat>
          <TeamStat label="Heal">
            <span className="text-emerald-400">{compact(totals.heal)}</span>
          </TeamStat>
        </div>
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
        <span className="text-right">CS</span>
        <span>Items</span>
        <span>{showAugments ? "Augments" : "Runes"}</span>
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
          gameDuration={gameDuration}
          showAugments={showAugments}
        />
      ))}
    </div>
  );
}

function computeTeamTotals(players: ParsedParticipant[], scores: Map<number, ScoreBreakdown>) {
  const t = {
    kills: 0,
    deaths: 0,
    assists: 0,
    dmg: 0,
    taken: 0,
    gold: 0,
    heal: 0,
    avgScore: null as number | null,
  };
  let scoreSum = 0,
    scored = 0;

  for (const p of players) {
    t.kills += p.kills;
    t.deaths += p.deaths;
    t.assists += p.assists;
    t.dmg += p.totalDamageDealtToChampions;
    t.taken += p.totalDamageTaken;
    t.gold += p.goldEarned;
    t.heal += p.totalHeal;
    const s = scores.get(p.participantId);
    if (s) {
      scoreSum += s.score;
      scored++;
    }
  }
  if (scored > 0) t.avgScore = scoreSum / scored;
  return t;
}

function TeamStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[9px] uppercase tracking-wider text-lol-text">{label}</span>
      <span className="text-[11px] font-medium tabular-nums">{children}</span>
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
  gameDuration,
  showAugments,
}: {
  player: ParsedParticipant;
  maxStats: { dmg: number; taken: number; gold: number; heal: number };
  champData: any;
  score?: ScoreBreakdown;
  patch?: string | null;
  gameDuration: number;
  showAugments: boolean;
}) {
  const kda = kdaRatio(p.kills, p.deaths, p.assists);
  const runeData = useRuneData();

  return (
    <div
      className={`px-3 py-1.5 border-b border-lol-border/30 last:border-b-0 grid ${GRID_COLS} gap-2 items-center ${
        p.isSelf ? "border-l-2 border-l-lol-gold bg-lol-gold/5" : ""
      }`}
    >
      {/* Champion + spells; two 15px spells and the 2px gap match the 32px portrait */}
      <div className="flex items-center gap-0.5">
        <ChampionIcon championId={p.championId} size={32} />
        <div className="flex flex-col gap-0.5">
          <SummonerSpellIcon spellId={p.spell1Id} size={15} />
          <SummonerSpellIcon spellId={p.spell2Id} size={15} />
        </div>
      </div>

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
      <ScoreCell score={score} />

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

      {/* CS */}
      <div className="text-right text-[11px] text-lol-text-bright">
        <div>{p.cs}</div>
        <div className="text-[9px] text-lol-text">
          {p.cs / Math.max(gameDuration / 60, 1) > 0
            ? `${(p.cs / Math.max(gameDuration / 60, 1)).toFixed(1)} /min`
            : "CS"}
        </div>
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

      {/* Runes for standard queues; Arena/Mayhem show Augments instead — those
          modes have no rune page at all, so falling back to "runes present?"
          per player would silently show an empty grid for the whole lobby. */}
      <div className="flex items-center gap-1">
        {showAugments ? (
          p.augments.map((augId, i) => <AugmentIcon key={i} augmentId={augId} size={22} patch={patch} />)
        ) : (
          <RuneSetupGrid
            runeIds={p.runeIds}
            primaryStyle={p.primaryStyle}
            secondaryStyle={p.secondaryStyle}
            statShardIds={p.statShardIds}
            runeData={runeData}
            version={patch}
          />
        )}
      </div>
    </div>
  );
}

function ScoreCell({ score }: { score?: ScoreBreakdown }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  return (
    <div
      className={`text-center ${score ? "cursor-help" : ""}`}
      onMouseEnter={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAnchor(null)}
    >
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
      {score && anchor && <ScoreBreakdownTooltip breakdown={score} anchor={anchor} />}
    </div>
  );
}

const COMPONENT_LABELS: Record<ScoreComponentKey, string> = {
  kda: "KDA",
  kp: "Kill participation",
  dmg: "Damage dealt",
  taken: "Damage taken",
  heal: "Healing",
  gold: "Gold earned",
};

const compact = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString());

// How the player's stat and its full-credit reference read in the tooltip:
// kda/kp are graded against fixed caps, the rest against the lobby's best.
function componentValue(c: ScoreComponent): string {
  if (c.key === "kda") return `${c.value.toFixed(1)} (full at 8)`;
  if (c.key === "kp") return `${Math.round(c.value * 100)}% (full at 90%)`;
  return `${compact(c.value)} / ${compact(c.reference)}`;
}

function ScoreBreakdownTooltip({
  breakdown,
  anchor,
}: {
  breakdown: ScoreBreakdown;
  anchor: DOMRect;
}) {
  const rows =
    breakdown.components.length +
    (breakdown.multikill ? 1 : 0) +
    (breakdown.carry ? 1 : 0) +
    (breakdown.win > 0 ? 1 : 0);
  const width = 288;
  const height = 74 + rows * 20;
  // Fixed positioning escapes the team card's overflow-hidden; clamp to the
  // viewport so rows near the window edges stay readable.
  const left = Math.min(anchor.right + 10, window.innerWidth - width - 8);
  const top = Math.min(
    Math.max(anchor.top + anchor.height / 2 - height / 2, 8),
    window.innerHeight - height - 8,
  );
  const clamped = breakdown.raw !== breakdown.score && (breakdown.raw > 10 || breakdown.raw < 1);

  return (
    <div
      className="fixed z-50 pointer-events-none bg-lol-dark border border-lol-border rounded-lg px-3 py-2 shadow-lg text-left"
      style={{ left, top, width }}
    >
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-semibold text-lol-text-bright">Score breakdown</span>
        <span className="text-[10px] text-lol-text">
          {breakdown.cls ? `${breakdown.cls} weights` : "Standard weights"}
        </span>
      </div>
      {breakdown.components.map((c) => (
        <div key={c.key} className="grid grid-cols-[1fr_auto] gap-2 items-baseline leading-5">
          <span className="text-[11px] text-lol-text truncate">
            {COMPONENT_LABELS[c.key]}
            <span className="ml-1.5 text-[10px] text-lol-text/70">{componentValue(c)}</span>
          </span>
          <span className="text-[11px] tabular-nums text-lol-text-bright">
            {c.points.toFixed(1)}
            <span className="text-[10px] text-lol-text/70"> / {c.weight.toFixed(1)}</span>
          </span>
        </div>
      ))}
      {breakdown.multikill && (
        <div className="grid grid-cols-[1fr_auto] gap-2 items-baseline leading-5">
          <span className="text-[11px] text-lol-text">{breakdown.multikill.label} bonus</span>
          <span className="text-[11px] tabular-nums text-lol-text-bright">
            +{breakdown.multikill.points.toFixed(1)}
          </span>
        </div>
      )}
      {breakdown.carry && (
        <div className="grid grid-cols-[1fr_auto] gap-2 items-baseline leading-5">
          <span className="text-[11px] text-lol-text">
            Carry bonus
            <span className="ml-1.5 text-[10px] text-lol-text/70">
              {breakdown.carry.lead.toFixed(2)}× next best
            </span>
          </span>
          <span className="text-[11px] tabular-nums text-lol-text-bright">
            +{breakdown.carry.points.toFixed(1)}
          </span>
        </div>
      )}
      {breakdown.win > 0 && (
        <div className="grid grid-cols-[1fr_auto] gap-2 items-baseline leading-5">
          <span className="text-[11px] text-lol-text">Victory bonus</span>
          <span className="text-[11px] tabular-nums text-lol-text-bright">
            +{breakdown.win.toFixed(1)}
          </span>
        </div>
      )}
      <div className="mt-1 pt-1 border-t border-lol-border/50 grid grid-cols-[1fr_auto] gap-2 items-baseline">
        <span className="text-[11px] font-medium text-lol-text-bright">
          Total
          {clamped
            ? ` ${breakdown.raw.toFixed(2)}, ${breakdown.raw > 10 ? "capped" : "floored"} at`
            : ""}
        </span>
        <span className={`text-xs font-semibold tabular-nums ${scoreColor(breakdown.score)}`}>
          {breakdown.score.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
