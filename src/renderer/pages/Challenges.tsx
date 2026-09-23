import { useEffect, useMemo, useState } from "react";
import { useLcuStatus } from "../hooks/useLcuStatus";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import type { ChallengeProgress, ChallengesData, ChallengesResult } from "../lib/types";
import ChallengeToken from "../components/ChallengeToken";
import ChampionIcon from "../components/ChampionIcon";
import { AwardIcon, ChevronDownIcon } from "../components/icons";
import { LOCALE } from "../lib/format";
import {
  CHALLENGE_LEVEL_COLORS as LEVEL_COLORS,
  challengeLevelName as levelName,
  formatChallengeValue as formatValue,
} from "../lib/challenges";
import { challengeFraction } from "../../shared/challenges";

// Snapshot days are stored as YYYY-MM-DD, which is a key, not a date to read.
function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
  });
}

function percentileLabel(challenge: ChallengeProgress): string | null {
  if (challenge.level === "NONE" || challenge.percentile >= 100) return null;
  return `top ${challenge.percentile.toFixed(1)}%`;
}

// Points are on every tier and already shown as the challenge's own value, so
// the only reward worth a line is the kind you can wear.
function rewardNote(challenge: ChallengeProgress): string | null {
  const title = challenge.nextRewards.find((r) => r.category === "TITLE" && r.name);
  if (!title) return null;
  return `${levelName(challenge.nextLevel)} unlocks the "${title.name}" title`;
}

// How far through the current tier. The distance left to the next one is read
// off the empty remainder, so no row spells that out in figures.
function TierBar({
  challenge,
  className = "",
}: {
  challenge: ChallengeProgress;
  className?: string;
}) {
  const fraction = challengeFraction(
    challenge.value,
    challenge.currentThreshold,
    challenge.nextThreshold,
  );
  // Coloured by the tier being worked toward, so the bar fills into the colour
  // it's about to become.
  const color = LEVEL_COLORS[challenge.nextLevel ?? challenge.level];

  return (
    <div className={`h-1.5 rounded-full bg-lol-border/70 overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${fraction * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}

// Progress since the baseline snapshot. It sits alone in its slot: next to a
// tier name it read as the distance to that tier, which it is not.
function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null || delta <= 0) return null;
  return (
    <span className="text-[11px] font-medium text-lol-win whitespace-nowrap">
      +{formatValue(delta)}
    </span>
  );
}

// ---- Champion progress ----

// Which champions a per-champion challenge still wants, and which it already
// has. Alphabetical both ways, so a particular champion can be looked up rather
// than hunted for.
function ChampionProgress({ completedIds }: { completedIds: number[] }) {
  const champData = useChampionData();
  const [showEarned, setShowEarned] = useState(false);

  const { remaining, earned } = useMemo(() => {
    const done = new Set(completedIds);
    // Champion data is the roster; a completed id missing from it (a champion
    // released since the cache was written) still belongs in the count.
    const ids = [...new Set([...Object.keys(champData).map(Number), ...completedIds])];
    const byName = (a: number, b: number) =>
      getChampionName(champData, a).localeCompare(getChampionName(champData, b));
    return {
      remaining: ids.filter((id) => !done.has(id)).sort(byName),
      earned: ids.filter((id) => done.has(id)).sort(byName),
    };
  }, [champData, completedIds]);

  const grid = (ids: number[], done: boolean) => (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <ChampionIcon
          key={id}
          championId={id}
          size={52}
          rounded={false}
          title={getChampionName(champData, id)}
          // The ones still to earn are the actionable half of this grid, so they
          // stay legible; the ring is what marks the others done.
          className={done ? "ring-2 ring-lol-gold/70" : "opacity-70"}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-3 pt-1">
      <div className="text-[11px] uppercase tracking-wider text-lol-text">
        Champions left ({remaining.length})
      </div>
      {remaining.length > 0 ? (
        grid(remaining, false)
      ) : (
        <div className="text-sm text-lol-text">Every champion done.</div>
      )}

      <button
        onClick={() => setShowEarned((open) => !open)}
        className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-lol-text hover:text-lol-text-bright transition-colors cursor-pointer"
      >
        <ChevronDownIcon
          className={`w-3 h-3 transition-transform ${showEarned ? "" : "-rotate-90"}`}
        />
        Champions earned ({earned.length})
      </button>
      {showEarned && grid(earned, true)}
    </div>
  );
}

// ---- Challenge rows ----

function ChallengeRow({ challenge }: { challenge: ChallengeProgress }) {
  const [expanded, setExpanded] = useState(false);
  const champions = challenge.completedChampionIds;
  const percentile = percentileLabel(challenge);
  const reward = rewardNote(challenge);
  const maxed = challenge.nextThreshold == null;

  return (
    <div className="px-4 py-3 border-t border-lol-border/40 first:border-t-0">
      <div className="flex items-start gap-3">
        <ChallengeToken
          iconPath={challenge.iconPath}
          size={36}
          dim={challenge.level === "NONE"}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-lol-text-bright truncate">
              {challenge.name}
            </span>
            <span
              className="text-[11px] font-semibold uppercase tracking-wider shrink-0"
              style={{ color: LEVEL_COLORS[challenge.level] }}
            >
              {levelName(challenge.level)}
            </span>
            {percentile && <span className="text-[11px] text-lol-text shrink-0">{percentile}</span>}
          </div>
          <div className="text-xs text-lol-text mt-0.5">{challenge.description}</div>
          {reward && <div className="text-[11px] text-lol-gold mt-1">{reward}</div>}
          <TierBar challenge={challenge} className="mt-2" />
        </div>
        {/* Centred against the whole row rather than pinned to its top: the
            left column runs to three lines and the numbers only two */}
        <div className="text-right shrink-0 w-28 self-center">
          <div className="text-sm text-lol-text-bright tabular-nums">
            {maxed ? (
              formatValue(challenge.value)
            ) : (
              <>
                {formatValue(challenge.value)}
                <span className="text-lol-text"> / {formatValue(challenge.nextThreshold!)}</span>
              </>
            )}
          </div>
          {/* A finished challenge still earns progress, and the client still
              reports it, so the badge shows there too */}
          <div className="mt-0.5 flex items-center justify-end gap-1.5">
            {maxed && <span className="text-[11px] text-lol-text">Complete</span>}
            <DeltaBadge delta={challenge.delta} />
          </div>
          {champions && (
            <button
              onClick={() => setExpanded((open) => !open)}
              className="mt-1 flex items-center justify-end gap-1 ml-auto text-[11px] text-lol-gold hover:text-lol-gold-light transition-colors cursor-pointer"
            >
              <ChevronDownIcon
                className={`w-3 h-3 transition-transform ${expanded ? "" : "-rotate-90"}`}
              />
              Champions
            </button>
          )}
        </div>
      </div>
      {champions && expanded && (
        <div className="mt-3 pl-12">
          <ChampionProgress completedIds={champions} />
        </div>
      )}
    </div>
  );
}

function GroupCard({ group }: { group: ChallengesData["groups"][number] }) {
  const { summary } = group;
  const maxed = summary.nextThreshold == null;

  return (
    <div className="bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-white/[0.02] border-b border-lol-border/60">
        <ChallengeToken iconPath={summary.iconPath} size={32} dim={summary.level === "NONE"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-lol-text-bright">{summary.name}</h2>
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: LEVEL_COLORS[summary.level] }}
            >
              {levelName(summary.level)}
            </span>
          </div>
          {/* As wide as the rows underneath, so a full bar reads as full */}
          <TierBar challenge={summary} className="mt-1.5" />
        </div>
        <div className="flex items-center gap-2 text-right text-xs text-lol-text tabular-nums">
          <span>
            {maxed
              ? "Maxed"
              : `${formatValue(summary.value)} / ${formatValue(summary.nextThreshold!)}`}
          </span>
          <DeltaBadge delta={summary.delta} />
        </div>
      </div>
      <div>
        {group.challenges.map((challenge) => (
          <ChallengeRow key={challenge.id} challenge={challenge} />
        ))}
      </div>
    </div>
  );
}

// ---- Headline cards ----

function CapstoneCard({ capstone, since }: { capstone: ChallengeProgress; since: string | null }) {
  const percentile = percentileLabel(capstone);

  return (
    <div className="relative overflow-hidden bg-lol-card rounded-xl border border-lol-border/60 p-5">
      <span className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full blur-2xl bg-lol-gold/[0.07]" />
      <div className="relative flex items-center gap-5">
        <ChallengeToken iconPath={capstone.iconPath} size={72} dim={capstone.level === "NONE"} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-lol-text">{capstone.name}</div>
          <div className="flex items-baseline gap-3 mt-0.5">
            <span className="text-2xl font-bold" style={{ color: LEVEL_COLORS[capstone.level] }}>
              {levelName(capstone.level)}
            </span>
            <span className="text-sm text-lol-text tabular-nums">
              {formatValue(capstone.value)}
              {capstone.nextThreshold != null && ` / ${formatValue(capstone.nextThreshold)}`}
            </span>
            {percentile && <span className="text-xs text-lol-text">{percentile}</span>}
            <DeltaBadge delta={capstone.delta} />
          </div>
          <TierBar challenge={capstone} className="mt-2.5" />
          {since && capstone.delta != null && (
            <div className="text-[11px] text-lol-text/70 mt-1">
              Green figures are progress since {formatDay(since)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerBar({ data }: { data: ChallengesData }) {
  const { player } = data;
  return (
    <div className="flex items-center gap-4 bg-lol-card rounded-xl border border-lol-border/60 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-lol-gold/10 text-lol-gold">
          <AwardIcon className="w-3.5 h-3.5" />
        </span>
        <div>
          <div className="text-sm font-semibold" style={{ color: LEVEL_COLORS[player.level] }}>
            {levelName(player.level)}
          </div>
          <div className="text-[11px] text-lol-text">
            {player.points.toLocaleString(LOCALE)} points
            {player.pointsUntilNextRank > 0 &&
              ` · ${player.pointsUntilNextRank.toLocaleString(LOCALE)} to next rank`}
          </div>
        </div>
      </div>
      {player.percentile < 100 && (
        <div className="text-[11px] text-lol-text border-l border-lol-border/60 pl-4">
          top {player.percentile.toFixed(1)}% overall
        </div>
      )}
      {player.title && (
        <div className="text-[11px] text-lol-text border-l border-lol-border/60 pl-4">
          Title: <span className="text-lol-gold">{player.title}</span>
        </div>
      )}
      {data.equipped.length > 0 && (
        <div className="flex items-center gap-2 ml-auto">
          {data.equipped.map((challenge) => (
            <ChallengeToken
              key={challenge.id}
              iconPath={challenge.iconPath}
              size={28}
              dim={challenge.level === "NONE"}
              title={challenge.name}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SeasonalCard({ challenges }: { challenges: ChallengeProgress[] }) {
  const [open, setOpen] = useState(false);
  if (challenges.length === 0) return null;

  return (
    <div className="bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <ChevronDownIcon
          className={`w-3.5 h-3.5 text-lol-text transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span className="text-sm font-semibold text-lol-text-bright">Past seasons</span>
        <span className="text-[11px] text-lol-text">{challenges.length}</span>
      </button>
      {open && (
        <div className="border-t border-lol-border/60">
          {challenges.map((challenge) => (
            <div
              key={challenge.id}
              className="flex items-center gap-3 px-4 py-2.5 border-t border-lol-border/40 first:border-t-0"
            >
              <ChallengeToken
                iconPath={challenge.iconPath}
                size={28}
                dim={challenge.level === "NONE"}
              />
              <span className="text-xs text-lol-text-bright truncate flex-1 min-w-0">
                {challenge.name}
              </span>
              <span
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: LEVEL_COLORS[challenge.level] }}
              >
                {levelName(challenge.level)}
              </span>
              <span className="text-[11px] text-lol-text tabular-nums w-24 text-right">
                {formatValue(challenge.value)}
                {challenge.nextThreshold != null && ` / ${formatValue(challenge.nextThreshold)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Page ----

export default function Challenges() {
  const status = useLcuStatus();
  const [result, setResult] = useState<ChallengesResult | null>(null);

  // No refresh control, because there is nothing for one to do: the stored
  // snapshot lands at once, a live read starts behind it, and the client is
  // asked again on every status change. Challenge values only move by playing
  // games, and the end of one is a status change.
  useEffect(() => {
    let active = true;
    window.api.getChallenges().then((stored) => {
      if (active) setResult(stored);
    });
    const unsub = window.api.onChallengesChanged((live) => {
      if (active) setResult(live);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [status]);

  const data = result?.data ?? null;
  const waiting = result == null || (result.pending && data == null);

  const header = <h1 className="text-xl font-bold text-lol-text-bright">Challenges</h1>;

  if (waiting) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  if (!data) {
    return (
      <div className="max-w-7xl space-y-4">
        {header}
        <div className="bg-lol-card rounded-xl border border-lol-border/60 py-16 text-center text-sm text-lol-text">
          Challenge progress comes from the League client, and it isn't running.
          <br />
          Start it and this fills in. After that the last reading stays here.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl space-y-4">
      {header}
      <PlayerBar data={data} />
      {data.capstone && <CapstoneCard capstone={data.capstone} since={data.since} />}
      {data.groups.map((group) => (
        <GroupCard key={group.summary.id} group={group} />
      ))}
      <SeasonalCard challenges={data.seasonal} />
    </div>
  );
}
