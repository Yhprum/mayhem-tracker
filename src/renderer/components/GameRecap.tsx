import { type ReactNode } from "react";
import type {
  ChampionData,
  GameRecap as GameRecapData,
  RecapChallenge,
  RecapPlacement,
  RecapSessionGame,
} from "../lib/types";
import { getChampionName } from "../hooks/useChampions";
import {
  LOCALE,
  formatCompact,
  formatDuration,
  formatKDA,
  formatPlaytime,
  formatTimeAgo,
  kdaColor,
  kdaRatio,
  winRatePercent,
  scoreColor,
} from "../lib/format";
import {
  CHALLENGE_LEVEL_COLORS,
  challengeLevelName,
  formatChallengeValue,
} from "../lib/challenges";
import { ordinal } from "../../shared/text";
import { queueLabel } from "./QueueSelect";
import ChallengeToken from "./ChallengeToken";
import ChampionIcon from "./ChampionIcon";
import ItemIcon from "./ItemIcon";
import AugmentIcon from "./AugmentIcon";
import MatchScoreboard from "./MatchScoreboard";
import MultikillBadge from "./MultikillBadge";
import { ScoreBadge } from "./ScoreCell";
import WinRateBar from "./WinRateBar";
import { ACCENTS, type StatAccent } from "./StatCard";
import {
  AwardIcon,
  FlameIcon,
  MapPinIcon,
  MedalIcon,
  SparklesIcon,
  StarIcon,
  SwordsIcon,
  TimerIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "./icons";
import Kda from "./Kda";

// A stat against the average of every game on record. Small differences aren't
// worth colouring, so anything inside a tenth of the average reads as neutral.
function Delta({ value, average, format }: { value: number; average: number; format?: "compact" }) {
  if (average <= 0) return null;
  const diff = value - average;
  const meaningful = Math.abs(diff) > average * 0.1;
  const text = format === "compact" ? formatCompact(Math.abs(diff)) : Math.abs(diff).toFixed(1);

  return (
    <span
      className={!meaningful ? "text-lol-text" : diff > 0 ? "text-lol-win" : "text-lol-loss/80"}
    >
      {diff >= 0 ? "+" : "-"}
      {text} vs avg
    </span>
  );
}

export default function GameRecap({
  recap,
  champData,
  puuids,
  heading,
}: {
  recap: GameRecapData;
  champData: ChampionData;
  puuids: string[] | null;
  heading?: ReactNode;
}) {
  const { detail, career, champion, session, streak } = recap;
  const stats = detail.stats;
  const isRemake = !!detail.game.is_remake;
  const isWin = !!stats?.win;
  const items = [
    stats?.item0,
    stats?.item1,
    stats?.item2,
    stats?.item3,
    stats?.item4,
    stats?.item5,
  ];
  const kills = stats?.kills ?? 0;
  const deaths = stats?.deaths ?? 0;
  const assists = stats?.assists ?? 0;

  return (
    <div className="space-y-4">
      {heading}

      {/* The headline: what happened, on what, where, and how well */}
      <div
        className={`relative overflow-hidden rounded-xl border p-5 ${
          isRemake
            ? "border-lol-border/60 bg-lol-card"
            : isWin
              ? "border-lol-win/30 bg-lol-win/[0.06]"
              : "border-lol-loss/30 bg-lol-loss/[0.06]"
        }`}
      >
        <span
          className={`pointer-events-none absolute -top-24 -left-10 h-56 w-72 rounded-full blur-3xl ${
            isRemake ? "bg-white/[0.03]" : isWin ? "bg-lol-win/10" : "bg-lol-loss/10"
          }`}
        />

        <div className="relative flex flex-wrap items-center gap-5">
          <ChampionIcon
            championId={stats?.champion_id ?? 0}
            size={72}
            className={`ring-2 ${isWin ? "ring-lol-win/40" : "ring-lol-loss/40"}`}
          />

          <div className="min-w-0">
            <div className="flex items-baseline gap-3">
              <span
                className={`text-2xl font-bold tracking-wide ${
                  isRemake ? "text-lol-text" : isWin ? "text-lol-win" : "text-lol-loss"
                }`}
              >
                {isRemake ? "REMAKE" : isWin ? "VICTORY" : "DEFEAT"}
              </span>
              {recap.scoreBadge && <ScoreBadge badge={recap.scoreBadge} large />}
            </div>
            <div className="mt-1 text-sm text-lol-text-bright">
              {getChampionName(champData, stats?.champion_id ?? 0)}
              <span className="mx-2 text-lol-text/40">·</span>
              <Kda kills={kills} deaths={deaths} assists={assists} />
              <span
                className={`ml-2 ${kdaColor(deaths === 0 ? Infinity : (kills + assists) / deaths)}`}
              >
                {kdaRatio(kills, deaths, assists)} KDA
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-lol-text">
              {recap.mapName && (
                <span className="inline-flex items-center gap-1 rounded-md border border-lol-border bg-white/5 px-1.5 py-0.5 text-lol-text-bright">
                  <MapPinIcon className="h-3 w-3" />
                  {recap.mapName}
                </span>
              )}
              <span>{queueLabel(detail.game.queue_id)}</span>
              <span className="text-lol-text/40">·</span>
              <span>{formatDuration(detail.game.game_duration)}</span>
              <span className="text-lol-text/40">·</span>
              <span>{formatTimeAgo(detail.game.game_creation)}</span>
            </div>
          </div>

          <div className="ml-auto flex flex-col items-end gap-2">
            {recap.score != null && (
              <div className="text-right">
                <div className={`text-3xl font-bold leading-none ${scoreColor(recap.score)}`}>
                  {recap.score.toFixed(1)}
                  <span className="text-base font-semibold text-lol-text/50"> / 10</span>
                </div>
                <div className="mt-1 text-[11px]">
                  {career.avgScore != null && (
                    <Delta value={recap.score} average={career.avgScore} />
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center gap-0.5">
              {items.map((itemId, i) => (
                <ItemIcon key={i} itemId={itemId ?? 0} size={26} patch={detail.game.game_version} />
              ))}
            </div>
            {recap.detail.augments.length > 0 && (
              <div className="flex items-center gap-0.5">
                {recap.detail.augments.map((augment) => (
                  <AugmentIcon
                    key={augment.slot}
                    augmentId={augment.augment_id}
                    size={26}
                    patch={detail.game.game_version}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="relative mt-4 flex flex-wrap items-start gap-4">
          <HeadlineStat
            label="Damage"
            value={formatCompact(stats?.total_damage_dealt ?? 0)}
            delta={
              <Delta
                value={stats?.total_damage_dealt ?? 0}
                average={career.avgDamage}
                format="compact"
              />
            }
          />
          <HeadlineStat
            label="Taken"
            value={formatCompact(stats?.total_damage_taken ?? 0)}
            delta={
              <Delta
                value={stats?.total_damage_taken ?? 0}
                average={career.avgTaken}
                format="compact"
              />
            }
          />
          <HeadlineStat
            label="Healing"
            value={formatCompact(stats?.total_heal ?? 0)}
            delta={
              <Delta value={stats?.total_heal ?? 0} average={career.avgHeal} format="compact" />
            }
          />
          <HeadlineStat
            label="Gold"
            value={formatCompact(stats?.gold_earned ?? 0)}
            delta={
              <Delta value={stats?.gold_earned ?? 0} average={career.avgGold} format="compact" />
            }
          />
          <HeadlineStat label="Best spree" value={String(stats?.largest_killing_spree ?? 0)} />
          <div className="ml-auto self-center">
            <MultikillBadge
              doubles={stats?.double_kills ?? 0}
              triples={stats?.triple_kills ?? 0}
              quadras={stats?.quadra_kills ?? 0}
              pentas={stats?.penta_kills ?? 0}
            />
          </div>
        </div>
      </div>

      {recap.milestones.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recap.milestones.map((milestone) => (
            <div
              key={milestone.key}
              className="flex items-center gap-2 rounded-lg border border-lol-gold/30 bg-lol-gold/10 px-3 py-2"
              title={milestone.detail}
            >
              <SparklesIcon className="h-4 w-4 shrink-0 text-lol-gold" />
              <div>
                <div className="text-xs font-semibold text-lol-gold-light">{milestone.label}</div>
                <div className="text-[10px] text-lol-text">{milestone.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {recap.placements.length > 0 && (
        <Panel
          title="Where it lands"
          subtitle={`among ${career.games.toLocaleString(LOCALE)} recorded games`}
          icon={<MedalIcon className="h-3 w-3" />}
          accent="gold"
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {recap.placements.map((placement) => (
              <PlacementCard key={placement.key} placement={placement} recap={recap} />
            ))}
          </div>
        </Panel>
      )}

      {recap.challenges.length > 0 && (
        <Panel
          title="Challenge progress"
          subtitle={`${recap.challenges.length} moved by this game`}
          icon={<AwardIcon className="h-3 w-3" />}
          accent="purple"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recap.challenges.map((challenge) => (
              <ChallengeCard key={challenge.id} challenge={challenge} />
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          title="This session"
          subtitle={sessionSubtitle(session.games.length, session.duration)}
          icon={<TimerIcon className="h-3 w-3" />}
          accent="sky"
        >
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <div className="text-2xl font-bold leading-none">
                <span className="text-lol-win">{session.wins}W</span>{" "}
                <span className="text-lol-loss/70">{session.losses}L</span>
              </div>
              <div className="mt-1 text-[11px] text-lol-text">
                {winRatePercent(session.wins, session.wins + session.losses)} win rate
              </div>
            </div>
            <div>
              <div className="text-sm text-lol-text-bright">
                <Kda kills={session.kills} deaths={session.deaths} assists={session.assists} />
              </div>
              <div className="text-[11px] text-lol-text">
                {kdaRatio(session.kills, session.deaths, session.assists)} KDA
              </div>
            </div>
            {session.avgScore != null && (
              <div>
                <div className={`text-sm font-semibold ${scoreColor(session.avgScore)}`}>
                  {session.avgScore.toFixed(1)}
                </div>
                <div className="text-[11px] text-lol-text">avg score</div>
              </div>
            )}
            {streak && (
              <div className="ml-auto flex items-center gap-2">
                {streak.kind === "win" ? (
                  <TrendingUpIcon className="h-4 w-4 text-lol-win" />
                ) : (
                  <TrendingDownIcon className="h-4 w-4 text-lol-loss" />
                )}
                <div>
                  <div
                    className={`text-sm font-semibold ${
                      streak.kind === "win" ? "text-lol-win" : "text-lol-loss"
                    }`}
                  >
                    {streak.length}{" "}
                    {streak.kind === "win"
                      ? streak.length === 1
                        ? "win"
                        : "wins"
                      : streak.length === 1
                        ? "loss"
                        : "losses"}{" "}
                    in a row
                  </div>
                  <div className="text-[11px] text-lol-text">
                    {streak.isRecord
                      ? `Your longest ${streak.kind} streak ever`
                      : `${streak.kind === "win" ? "Best" : "Worst"}: ${streak.best}`}
                  </div>
                </div>
              </div>
            )}
          </div>

          <SessionStrip games={session.games} index={session.index} champData={champData} />
        </Panel>

        <Panel
          title={getChampionName(champData, champion.championId)}
          subtitle={`${champion.games} ${champion.games === 1 ? "game" : "games"} on record`}
          icon={<SwordsIcon className="h-3 w-3" />}
          accent="purple"
        >
          <div className="flex items-baseline gap-3">
            <div className="text-2xl font-bold leading-none">
              <span className="text-lol-win">{champion.wins}W</span>{" "}
              <span className="text-lol-loss/70">{champion.games - champion.wins}L</span>
            </div>
            {champion.avgScore != null && (
              <span className={`text-sm font-semibold ${scoreColor(champion.avgScore)}`}>
                {champion.avgScore.toFixed(1)}
                <span className="ml-1 font-normal text-lol-text">avg score</span>
              </span>
            )}
          </div>
          <div className="mt-2">
            <WinRateBar wins={champion.wins} total={champion.games} />
          </div>
          <div className="mt-2 text-[11px] text-lol-text">
            <Kda kills={champion.kills} deaths={champion.deaths} assists={champion.assists} />{" "}
            lifetime
            {champion.previousBest != null && recap.score != null && (
              <>
                {" · "}
                {recap.score > champion.previousBest
                  ? `beat your previous best of ${champion.previousBest.toFixed(1)}`
                  : `best on this champion: ${champion.previousBest.toFixed(1)}`}
              </>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Scoreboard" icon={<FlameIcon className="h-3 w-3" />} accent="gold">
        <MatchScoreboard detail={detail} champData={champData} puuids={puuids} />
      </Panel>
    </div>
  );
}

function sessionSubtitle(games: number, duration: number): string {
  const played = `${games} ${games === 1 ? "game" : "games"}`;
  return duration > 0 ? `${played} · ${formatPlaytime(duration)} played` : played;
}

function HeadlineStat({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-lol-text">{label}</div>
      <div className="text-sm font-semibold text-lol-text-bright">{value}</div>
      {delta && <div className="text-[10px]">{delta}</div>}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon,
  accent,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  accent: StatAccent;
  children: ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div className="relative overflow-hidden rounded-xl border border-lol-border/60 bg-lol-card p-4">
      <span
        className={`pointer-events-none absolute -top-14 -right-8 h-32 w-32 rounded-full blur-2xl ${a.glow}`}
      />
      <div className="relative mb-3 flex items-baseline gap-2">
        <span className={`flex h-5 w-5 items-center justify-center rounded-md ${a.chip}`}>
          {icon}
        </span>
        <span className="text-sm font-semibold text-lol-text-bright">{title}</span>
        {subtitle && <span className="text-[11px] text-lol-text">{subtitle}</span>}
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

// Only the top three get a colour: past that, "9th best game of 700" is a fact
// rather than an achievement, and dressing it up as one would cheapen the rest.
const RANK_STYLES = [
  "border-lol-gold/50 bg-lol-gold/10",
  "border-slate-300/40 bg-slate-300/10",
  "border-amber-700/50 bg-amber-700/10",
];

function placementValue(placement: RecapPlacement, recap: GameRecapData): string {
  switch (placement.format) {
    case "score":
      return placement.value.toFixed(1);
    case "compact":
      return formatCompact(placement.value);
    case "duration":
      return formatDuration(placement.value);
    case "kda":
      return kdaRatio(
        recap.detail.stats?.kills ?? 0,
        recap.detail.stats?.deaths ?? 0,
        recap.detail.stats?.assists ?? 0,
      );
    default:
      return Math.round(placement.value).toLocaleString(LOCALE);
  }
}

function PlacementCard({ placement, recap }: { placement: RecapPlacement; recap: GameRecapData }) {
  const style = placement.good ? RANK_STYLES[placement.rank - 1] : undefined;

  return (
    <div
      className={`rounded-lg border px-3 py-2 ${style ?? "border-lol-border/60 bg-white/[0.02]"}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] uppercase tracking-wider text-lol-text">
          {placement.label}
        </span>
        {placement.rank === 1 && (
          <StarIcon
            className={`h-3 w-3 shrink-0 ${placement.good ? "text-lol-gold" : "text-lol-loss/70"}`}
          />
        )}
      </div>
      <div className="text-lg font-bold text-lol-text-bright">
        {placementValue(placement, recap)}
      </div>
      <div
        className={`text-[11px] ${placement.good && placement.rank === 1 ? "text-lol-gold" : "text-lol-text"}`}
      >
        {placement.rank === 1
          ? placement.good
            ? "Best ever"
            : "Most ever"
          : `${ordinal(placement.rank)} of ${placement.total.toLocaleString(LOCALE)}`}
      </div>
    </div>
  );
}

// What this one game moved. The client hands over the before and after itself,
// so the gain is exact rather than inferred from a daily snapshot.
function ChallengeCard({ challenge }: { challenge: RecapChallenge }) {
  const gain = challenge.currentValue - challenge.previousValue;
  const tierUp = challenge.previousLevel !== challenge.currentLevel;

  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        tierUp ? "border-lol-gold/50 bg-lol-gold/10" : "border-lol-border/60 bg-white/[0.02]"
      }`}
      title={challenge.description}
    >
      <div className="flex items-center gap-2.5">
        <ChallengeToken iconPath={challenge.iconPath} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-xs font-medium text-lol-text-bright">
              {challenge.name}
            </span>
            <span className="ml-auto shrink-0 text-xs font-semibold text-lol-win">
              +{formatChallengeValue(gain)}
            </span>
          </div>
          <div className="truncate text-[11px] text-lol-text">
            {tierUp ? (
              <span
                className="font-semibold"
                style={{ color: CHALLENGE_LEVEL_COLORS[challenge.currentLevel] }}
              >
                {challengeLevelName(challenge.previousLevel)} to{" "}
                {challengeLevelName(challenge.currentLevel)}
              </span>
            ) : challenge.nextThreshold == null ? (
              `${formatChallengeValue(challenge.currentValue)} · complete`
            ) : (
              `${formatChallengeValue(challenge.currentValue)} / ${formatChallengeValue(
                challenge.nextThreshold,
              )} to ${challengeLevelName(challenge.nextLevel)}`
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// The day's games in order, with this one called out. Reads as a shape: a good
// run looks like a good run without having to read a single number.
function SessionStrip({
  games,
  index,
  champData,
}: {
  games: RecapSessionGame[];
  index: number;
  champData: ChampionData;
}) {
  if (games.length <= 1) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1">
      {games.map((game, i) => (
        <div
          key={game.game_id}
          title={`${getChampionName(champData, game.champion_id)} · ${formatKDA(
            game.kills,
            game.deaths,
            game.assists,
          )}${game.score != null ? ` · ${game.score.toFixed(1)} score` : ""}`}
          className={`h-6 w-6 rounded ${
            game.win ? "bg-lol-win/70" : "bg-lol-loss/60"
          } ${i === index ? "ring-2 ring-lol-gold ring-offset-1 ring-offset-lol-card" : ""}`}
        />
      ))}
    </div>
  );
}
