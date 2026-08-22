import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useIpc } from "../hooks/useIpc";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import type {
  ChampionData,
  MatchDetail,
  RecordMatchRef,
  RecordsData,
  StatRecord,
  StreakRecord,
} from "../lib/types";
import ChampionIcon from "../components/ChampionIcon";
import MatchScoreboard from "../components/MatchScoreboard";
import QueueSelect, { queueLabel } from "../components/QueueSelect";
import { ACCENTS, type StatAccent } from "../components/StatCard";
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
  XIcon,
  ZapIcon,
} from "../components/icons";
import { formatDuration, formatKDA, kdaRatio } from "../lib/format";
import { scoreColor } from "../../shared/opScore";

// Records are moments, not recency — "3 months ago" undersells a trophy, so
// they get a real date.
function recordDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---- Record cards ----

// The same tile treatment as StatCard, but a button: every record opens the
// game it was set in.
function RecordCard({
  label,
  icon,
  accent,
  value,
  sub,
  match,
  champData,
  onOpen,
}: {
  label: string;
  icon: ReactNode;
  accent: StatAccent;
  value: ReactNode;
  sub?: ReactNode;
  match: RecordMatchRef;
  champData: ChampionData;
  onOpen: (match: RecordMatchRef) => void;
}) {
  const a = ACCENTS[accent];
  return (
    <button
      onClick={() => onOpen(match)}
      title="View match"
      className="relative flex flex-col overflow-hidden bg-lol-card rounded-xl border border-lol-border/60 p-4 text-left transition-colors cursor-pointer hover:border-lol-gold/40 hover:bg-lol-card-hover"
    >
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
            {formatKDA(match.kills, match.deaths, match.assists)}
            {" · "}
            {recordDate(match.game_creation)}
          </div>
        </div>
      </div>
    </button>
  );
}

// ---- Match modal ----

// Records live outside the match list, so their games open here rather than
// deep-linking into an infinitely-scrolled page.
function MatchModal({
  match,
  champData,
  puuids,
  onClose,
}: {
  match: RecordMatchRef;
  champData: ChampionData;
  puuids: string[] | null;
  onClose: () => void;
}) {
  const { data: detail } = useIpc<MatchDetail>(
    () => window.api.getMatchDetail(match.game_id),
    [match.game_id],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-full overflow-y-auto rounded-xl border border-lol-border bg-lol-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <ChampionIcon championId={match.champion_id} size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-lol-text-bright truncate">
              <span className={match.win ? "text-lol-win" : "text-lol-loss"}>
                {match.win ? "Victory" : "Defeat"}
              </span>
              {" — "}
              {getChampionName(champData, match.champion_id)}{" "}
              {formatKDA(match.kills, match.deaths, match.assists)}
            </div>
            <div className="text-xs text-lol-text truncate">
              {queueLabel(match.queue_id)} · {formatDuration(match.game_duration)} ·{" "}
              {recordDate(match.game_creation)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-lol-text hover:bg-white/5 hover:text-lol-text-bright transition-colors"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-x-auto">
          {detail ? (
            <MatchScoreboard detail={detail} champData={champData} puuids={puuids} />
          ) : (
            <div className="text-sm text-lol-text text-center py-8">Loading...</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Page ----

interface CardDef {
  key: string;
  label: string;
  icon: ReactNode;
  accent: StatAccent;
  value: ReactNode;
  sub?: ReactNode;
  match: RecordMatchRef;
}

function statCards(bests: RecordsData["bests"]): CardDef[] {
  const cards: CardDef[] = [];
  const add = (
    record: StatRecord | null,
    def: Omit<CardDef, "match" | "value"> & { value: (r: StatRecord) => ReactNode },
  ) => {
    if (record) cards.push({ ...def, value: def.value(record), match: record.match });
  };
  const n = (v: number) => Math.round(v).toLocaleString();

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
    value: (r) => (
      <span className={scoreColor(r.value)}>
        {r.value.toFixed(1)}
        <span className="text-sm font-semibold text-lol-text/60"> / 10</span>
      </span>
    ),
  });
  add(bests.killingSpree, {
    key: "spree",
    label: "Longest Killing Spree",
    icon: <FlameIcon className="w-3 h-3" />,
    accent: "purple",
    value: (r) => r.value,
    sub: "kills without dying",
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

function streakCard(streak: StreakRecord, win: boolean): CardDef {
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

export default function Records() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queueParam = searchParams.get("queue");
  const queue = queueParam ? Number(queueParam) : undefined;
  const setQueue = (q: number | undefined) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (q == null) next.delete("queue");
        else next.set("queue", String(q));
        return next;
      },
      { replace: true },
    );
  };

  const { data, refetch } = useIpc<RecordsData>(() => window.api.getRecords(queue), [queue]);
  const champData = useChampionData();
  const [puuids, setPuuids] = useState<string[] | null>(null);
  const [openMatch, setOpenMatch] = useState<RecordMatchRef | null>(null);

  useEffect(() => {
    window.api.getAllSummonerPuuids().then(setPuuids);
  }, []);

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  if (!data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  if (data.totalGames === 0) {
    return (
      <div className="max-w-7xl space-y-4">
        <h1 className="text-xl font-bold text-lol-text-bright">Records</h1>
        <div className="bg-lol-card rounded-xl border border-lol-border/60 py-16 text-center text-sm text-lol-text">
          No games recorded yet — sync your match history to start setting records.
        </div>
      </div>
    );
  }

  const cards = statCards(data.bests);
  if (data.winStreak) cards.push(streakCard(data.winStreak, true));
  if (data.lossStreak && data.lossStreak.length > 1) {
    // A single loss is just a loss; it only becomes a "streak" worth
    // memorializing at two.
    cards.push(streakCard(data.lossStreak, false));
  }

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-lol-text-bright">Records</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-lol-text">
            personal bests across {data.totalGames} {data.totalGames === 1 ? "game" : "games"}
          </span>
          <QueueSelect value={queue} onChange={setQueue} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
        {cards.map(({ key, ...card }) => (
          <RecordCard key={key} {...card} champData={champData} onOpen={setOpenMatch} />
        ))}
      </div>

      {openMatch && (
        <MatchModal
          match={openMatch}
          champData={champData}
          puuids={puuids}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </div>
  );
}
