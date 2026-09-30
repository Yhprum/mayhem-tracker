import type { ReactNode } from "react";
import type {
  ChampionData,
  RecordMatchRef,
  RecordsData,
  StatRecord,
  StreakRecord,
} from "../lib/types";
import { getChampionName } from "../hooks/useChampions";
import { LOCALE, formatDuration, kdaRatio, scoreColor } from "../lib/format";
import ChampionIcon from "./ChampionIcon";
import Kda from "./Kda";
import { ACCENTS, type StatAccent } from "./StatCard";
import {
  CoinsIcon,
  FlameIcon,
  HeartIcon,
  HourglassIcon,
  ShieldIcon,
  SkullIcon,
  StarIcon,
  SwordsIcon,
  TimerIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UsersIcon,
  ZapIcon,
} from "./icons";

// Records are moments, not recency — "3 months ago" undersells a trophy, so
// they get a real date.
export function recordDate(ts: number): string {
  return new Date(ts).toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// The same tile treatment as StatCard, with the game the record was set in
// along the bottom. A button when there is somewhere to open that game, as on
// the Records page; a plain tile on a card that is only ever looked at.
export function RecordCard({
  label,
  icon,
  accent,
  value,
  sub,
  match,
  champData,
  onOpen,
}: Omit<RecordCardDef, "key"> & {
  champData: ChampionData;
  onOpen?: (match: RecordMatchRef) => void;
}) {
  const a = ACCENTS[accent];
  const body = (
    <>
      <span
        className={`pointer-events-none absolute -top-14 -right-8 h-32 w-32 rounded-full blur-2xl ${a.glow}`}
      />
      <div className="relative flex items-center gap-1.5 mb-1">
        <span className={`flex h-5 w-5 items-center justify-center rounded-md ${a.chip}`}>
          {icon}
        </span>
        <span className="text-[11px] text-lol-text uppercase tracking-wider">{label}</span>
      </div>
      <div className="relative text-2xl font-bold text-lol-text-bright">{value}</div>
      {sub && <div className="relative text-xs text-lol-text mt-0.5">{sub}</div>}
      <div className="relative mt-auto pt-3 flex items-center gap-2">
        <ChampionIcon championId={match.champion_id} size={24} />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-lol-text-bright truncate">
            {getChampionName(champData, match.champion_id)}
          </div>
          <div className="text-[11px] text-lol-text truncate">
            <span className={match.win ? "text-lol-win" : "text-lol-loss"}>
              {match.win ? "W" : "L"}
            </span>
            {" · "}
            <Kda kills={match.kills} deaths={match.deaths} assists={match.assists} />
            {" · "}
            {recordDate(match.game_creation)}
          </div>
        </div>
      </div>
    </>
  );
  const tile =
    "relative flex flex-col overflow-hidden bg-lol-card rounded-xl border border-lol-border/60 p-4 text-left";

  if (!onOpen) return <div className={tile}>{body}</div>;
  return (
    <button
      onClick={() => onOpen(match)}
      title="View match"
      className={`${tile} transition-colors cursor-pointer hover:border-lol-gold/40 hover:bg-lol-card-hover`}
    >
      {body}
    </button>
  );
}

export interface RecordCardDef {
  key: string;
  label: string;
  icon: ReactNode;
  accent: StatAccent;
  value: ReactNode;
  sub?: ReactNode;
  match: RecordMatchRef;
}

// One card per single-game best that has been set, in the Records page's order
export function recordCards(bests: RecordsData["bests"]): RecordCardDef[] {
  const cards: RecordCardDef[] = [];
  const add = (
    record: StatRecord | null,
    def: Omit<RecordCardDef, "match" | "value"> & { value: (r: StatRecord) => ReactNode },
  ) => {
    if (record) cards.push({ ...def, value: def.value(record), match: record.match });
  };
  const n = (v: number) => Math.round(v).toLocaleString(LOCALE);

  add(bests.kills, {
    key: "kills",
    label: "Most Kills",
    icon: <SwordsIcon className="w-3 h-3" />,
    accent: "gold",
    value: (r) => r.value,
  });
  add(bests.kda, {
    key: "kda",
    label: "Best KDA",
    icon: <ZapIcon className="w-3 h-3" />,
    accent: "sky",
    // kdaRatio turns a deathless game into "Perfect" — better than the raw
    // rank value, which pretends one death happened
    value: (r) => kdaRatio(r.match.kills, r.match.deaths, r.match.assists),
  });
  add(bests.score, {
    key: "score",
    label: "Highest Score",
    icon: <StarIcon className="w-3 h-3" />,
    accent: "gold",
    // The raw score, which runs past the 10 every other score stops at: a best
    // is the one place telling the 10s apart matters
    value: (r) => <span className={scoreColor(r.value)}>{r.value.toFixed(1)}</span>,
  });
  add(bests.killingSpree, {
    key: "spree",
    label: "Longest Killing Spree",
    icon: <FlameIcon className="w-3 h-3" />,
    accent: "purple",
    value: (r) => r.value,
  });
  add(bests.damage, {
    key: "damage",
    label: "Most Damage Dealt",
    icon: <SwordsIcon className="w-3 h-3" />,
    accent: "sky",
    value: (r) => n(r.value),
  });
  add(bests.damageTaken, {
    key: "taken",
    label: "Most Damage Taken",
    icon: <ShieldIcon className="w-3 h-3" />,
    accent: "win",
    value: (r) => n(r.value),
  });
  add(bests.healing, {
    key: "healing",
    label: "Most Healing",
    icon: <HeartIcon className="w-3 h-3" />,
    accent: "win",
    value: (r) => n(r.value),
  });
  add(bests.gold, {
    key: "gold",
    label: "Most Gold Earned",
    icon: <CoinsIcon className="w-3 h-3" />,
    accent: "gold",
    value: (r) => n(r.value),
  });
  add(bests.assists, {
    key: "assists",
    label: "Most Assists",
    icon: <UsersIcon className="w-3 h-3" />,
    accent: "sky",
    value: (r) => r.value,
  });
  add(bests.deaths, {
    key: "deaths",
    label: "Most Deaths",
    icon: <SkullIcon className="w-3 h-3" />,
    accent: "purple",
    value: (r) => r.value,
    sub: "we don't talk about this one",
  });
  add(bests.fastestWin, {
    key: "fastestWin",
    label: "Fastest Win",
    icon: <TimerIcon className="w-3 h-3" />,
    accent: "win",
    value: (r) => formatDuration(r.value),
  });
  add(bests.longestGame, {
    key: "longestGame",
    label: "Longest Game",
    icon: <HourglassIcon className="w-3 h-3" />,
    accent: "purple",
    value: (r) => formatDuration(r.value),
  });
  return cards;
}

export function streakCard(streak: StreakRecord, win: boolean): RecordCardDef {
  const range =
    recordDate(streak.start) === recordDate(streak.end)
      ? recordDate(streak.start)
      : `${recordDate(streak.start)} – ${recordDate(streak.end)}`;
  return {
    key: win ? "winStreak" : "lossStreak",
    label: win ? "Longest Win Streak" : "Longest Loss Streak",
    icon: win ? <TrendingUpIcon className="w-3 h-3" /> : <TrendingDownIcon className="w-3 h-3" />,
    accent: win ? "win" : "purple",
    value: `${streak.length} ${win ? "wins" : "losses"}`,
    sub: range,
    match: streak.match,
  };
}
