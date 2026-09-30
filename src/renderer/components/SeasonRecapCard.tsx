import type { ReactNode } from "react";
import type {
  ChampionData,
  ItemStats,
  SeasonChampion,
  SeasonRecap,
  TeammateStats,
} from "../lib/types";
import { getChampionName, useItemData } from "../hooks/useChampions";
import { CHAMPION_SPLASH_URL } from "../lib/constants";
import {
  LOCALE,
  formatDuration,
  formatPlaytime,
  formatTotal,
  kdaColor,
  kdaRatio,
  scoreColor,
  winRateColor,
  winRatePercent,
} from "../lib/format";
import { ALL_TIME_ID, findSeason, seasonBounds, seasonDate } from "../../shared/seasons";
import { sessionDay } from "../../shared/session";
import ActivityCalendar from "./ActivityCalendar";
import AugmentIcon from "./AugmentIcon";
import ChampionIcon from "./ChampionIcon";
import ItemIcon from "./ItemIcon";
import Panel from "./Panel";
import { RecordCard, recordCards } from "./RecordCard";
import StatCard from "./StatCard";
import SummonerIcon from "./SummonerIcon";
import WinRateBar from "./WinRateBar";
import {
  CalendarIcon,
  ClockIcon,
  CoinsIcon,
  CrosshairIcon,
  FlameIcon,
  MayhemIcon,
  MedalIcon,
  SparklesIcon,
  SwordsIcon,
  TrendingUpIcon,
  TrophyIcon,
  UsersIcon,
  ZapIcon,
} from "./icons";

// Matching the six champions and augments the main process sends, so the
// three lists line up
const TOP_ITEMS = 6;
// The record tiles worth sharing, in the order they're wanted: the first four a
// season has set make the row
const RECORD_KEYS = ["kills", "damage", "score", "spree", "kda", "healing", "taken", "assists"];
const RECORD_COUNT = 4;
// The widest a calendar week gets, which a season of a few months is drawn at;
// the all-time calendar narrows its weeks to fit
const CALENDAR_CELL = 20;
const DAY_MS = 86_400_000;

const DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" });
const WEEKDAY_DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

// What the card says it covers: the season's own dates where it has them, the
// span of games played for all time
function coverage(recap: SeasonRecap): string | null {
  const { season } = recap;
  if (season.start) {
    const start = seasonDate(season.start);
    if (!season.end) return `Since ${DATE_FORMAT.format(start)}`;
    return DATE_FORMAT.formatRange(start, seasonDate(season.end));
  }
  if (recap.firstGame == null || recap.lastGame == null) return null;
  return DATE_FORMAT.formatRange(recap.firstGame, recap.lastGame);
}

// The session days the calendar covers, on the same terms as coverage: a whole
// season, up to today for one with no end announced, or the span of games for
// all time. Days after `through` are still to come.
function calendarSpan(recap: SeasonRecap): { first: number; last: number; through: number } | null {
  const { season } = recap;
  const today = sessionDay(Date.now());
  if (season.start) {
    const last = season.end ? seasonDate(season.end) : today;
    return { first: seasonDate(season.start), last, through: Math.min(last, today) };
  }
  if (recap.firstGame == null || recap.lastGame == null) return null;
  const last = sessionDay(recap.lastGame);
  return { first: sessionDay(recap.firstGame), last, through: last };
}

function inProgress(seasonId: string): boolean {
  const season = findSeason(seasonId);
  if (!season) return false;
  const { from, to } = seasonBounds(season);
  const now = Date.now();
  return now >= from && (to == null || now < to);
}

// Riot ids come through as "Name#TAG", and the tag reads better set back
function splitRiotId(id: string): [string, string | null] {
  const hash = id.lastIndexOf("#");
  return hash > 0 ? [id.slice(0, hash), id.slice(hash + 1)] : [id, null];
}

function kdaValue(kills: number, deaths: number, assists: number): number {
  return deaths === 0 ? Infinity : (kills + assists) / deaths;
}

function hourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString(LOCALE, { hour: "numeric" });
}

function weekdayLabel(weekday: number): string {
  // January 2, 2000 was a Sunday, which getDay() calls 0
  return new Date(2000, 0, 2 + weekday).toLocaleDateString(LOCALE, { weekday: "long" });
}

function perGame(total: number, games: number): string {
  return (games > 0 ? total / games : 0).toFixed(1);
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

// MVP and ACE out of the games that could have produced them, as the match
// list's dashboard counts them
function share(count: number, of: number, games: string): string {
  return of > 0 ? `${percent(count / of)} of ${games}` : `no scored ${games}`;
}

/**
 * A season on one card, for sharing: who played, how much and how well, what
 * they played it on, their best games, who they played with and when. Drawn at the
 * export width (CARD_WIDTH) both in the capture window and in the page's
 * preview, which scales it down rather than reflowing it, so what the page
 * shows is exactly the image that gets saved.
 *
 * With hideFriends, the people played with have their names blanked out, for
 * sharing an image without putting anyone else's name in it.
 */
export default function SeasonRecapCard({
  recap,
  champData,
  hideFriends = false,
}: {
  recap: SeasonRecap;
  champData: ChampionData;
  hideFriends?: boolean;
}) {
  const losses = recap.games - recap.wins;
  const topChampion = recap.champions[0] ?? null;
  const records = recordCards(recap.records.bests);
  const highlights = RECORD_KEYS.flatMap((key) => records.filter((card) => card.key === key)).slice(
    0,
    RECORD_COUNT,
  );

  return (
    <div className="space-y-4">
      <Header recap={recap} champData={champData} topChampion={topChampion} />

      <div className="grid grid-cols-5 gap-4">
        <StatCard
          label="Games"
          icon={<SwordsIcon className="h-3 w-3" />}
          accent="gold"
          value={recap.games.toLocaleString(LOCALE)}
          subtext={`${recap.days.length} ${recap.days.length === 1 ? "day" : "days"} played`}
        />
        <StatCard
          label="Record"
          icon={<TrophyIcon className="h-3 w-3" />}
          accent="win"
          value={
            <span>
              <span className="text-lol-win">{recap.wins}W</span>{" "}
              <span className="text-lol-loss/80">{losses}L</span>
            </span>
          }
        >
          <WinRateBar wins={recap.wins} total={recap.games} />
        </StatCard>
        <StatCard
          label="Time played"
          icon={<ClockIcon className="h-3 w-3" />}
          accent="sky"
          value={formatPlaytime(recap.duration)}
          subtext={`${formatDuration(Math.round(recap.duration / recap.games))} average game length`}
        />
        <StatCard
          label="Best win streak"
          icon={<TrendingUpIcon className="h-3 w-3" />}
          accent="purple"
          value={
            recap.records.winStreak
              ? `${recap.records.winStreak.length} ${recap.records.winStreak.length === 1 ? "win" : "wins"}`
              : "None yet"
          }
          subtext={
            recap.records.lossStreak && recap.records.lossStreak.length > 1
              ? `Longest skid: ${recap.records.lossStreak.length} losses`
              : undefined
          }
        />
        <StatCard
          label="KDA"
          icon={<ZapIcon className="h-3 w-3" />}
          accent="sky"
          value={
            <span className={kdaColor(kdaValue(recap.kills, recap.deaths, recap.assists))}>
              {kdaRatio(recap.kills, recap.deaths, recap.assists)}
            </span>
          }
          subtext={`${perGame(recap.kills, recap.games)} / ${perGame(recap.deaths, recap.games)} / ${perGame(recap.assists, recap.games)} per game`}
        />
      </div>

      <Combat recap={recap} />

      <div className="grid grid-cols-3 gap-4">
        <Panel
          title="Top champions"
          subtitle={`${recap.uniqueChampions} played`}
          icon={<TrophyIcon className="h-3 w-3" />}
          accent="gold"
          className="h-full"
        >
          <Rows empty="No champions yet">
            {recap.champions.map((champ) => (
              <ChampionRow key={champ.champion_id} champ={champ} champData={champData} />
            ))}
          </Rows>
        </Panel>
        <Panel
          title="Top augments"
          icon={<CrosshairIcon className="h-3 w-3" />}
          accent="purple"
          className="h-full"
        >
          <Rows empty="No augments recorded">
            {recap.augments.map((augment) => (
              <PickRow key={augment.augment_id} picks={augment.picks} wins={augment.wins}>
                <AugmentIcon
                  augmentId={augment.augment_id}
                  size={32}
                  showName
                  nameClassName="text-sm font-medium"
                  patch={recap.patch}
                />
              </PickRow>
            ))}
          </Rows>
        </Panel>
        <ItemsPanel recap={recap} />
      </div>

      {highlights.length > 0 && (
        <div>
          <SectionHeading icon={<MedalIcon className="h-3.5 w-3.5" />}>
            {recap.season.id === ALL_TIME_ID ? "Personal bests" : "Season bests"}
          </SectionHeading>
          <div className="grid grid-cols-4 gap-4">
            {highlights.map(({ key, ...card }) => (
              <RecordCard key={key} {...card} champData={champData} />
            ))}
          </div>
        </div>
      )}

      <div className={`grid gap-4 ${recap.friends.length > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
        {recap.friends.length > 0 && (
          <Panel
            title="Played most with"
            subtitle="games on your team"
            icon={<UsersIcon className="h-3 w-3" />}
            accent="sky"
            className="h-full"
          >
            {/* Beside a calendar taller than the list, the rows share the
                spare height out between them rather than leave it all under
                the last one */}
            <div className="flex h-full flex-col gap-2.5">
              {recap.friends.map((friend) => (
                <FriendRow key={friend.key} friend={friend} hideName={hideFriends} />
              ))}
            </div>
          </Panel>
        )}
        <Activity recap={recap} />
      </div>
    </div>
  );
}

function Header({
  recap,
  champData,
  topChampion,
}: {
  recap: SeasonRecap;
  champData: ChampionData;
  topChampion: SeasonChampion | null;
}) {
  const { season, player } = recap;
  const title = season.id === ALL_TIME_ID ? "All-Time Recap" : `${season.name} Recap`;
  const dates = coverage(recap);
  const live = inProgress(season.id);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-lol-gold/30 bg-lol-card">
      {topChampion && (
        <img
          src={CHAMPION_SPLASH_URL(topChampion.champion_id)}
          alt=""
          className="absolute inset-y-0 right-0 h-full w-3/4 object-cover object-[center_25%] opacity-50"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      {/* The art fades out behind the name so the text never sits on a busy
          part of the splash */}
      <div className="absolute inset-0 bg-gradient-to-r from-lol-card from-35% via-lol-card/80 via-60% to-lol-card/10" />
      <span className="pointer-events-none absolute -top-24 -left-16 h-64 w-96 rounded-full bg-lol-gold/10 blur-3xl" />

      <div className="relative flex items-center gap-6 px-7 py-7">
        <SummonerIcon
          iconId={player.profileIcon}
          size={96}
          className="ring-2 ring-lol-gold/60 ring-offset-4 ring-offset-lol-card"
        />
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-lol-gold">
            ARAM Mayhem · {title}
          </div>
          <div className="mt-1.5 truncate text-4xl font-bold text-lol-text-bright">
            {player.gameName ?? "Summoner"}
            {player.tagLine && (
              <span className="ml-1 text-2xl font-semibold text-lol-text/60">
                #{player.tagLine}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-lol-text">
            {dates && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" />
                {dates}
              </span>
            )}
            {live && (
              <span className="rounded-md border border-lol-win/40 bg-lol-win/10 px-1.5 py-0.5 text-[11px] font-semibold text-lol-win">
                In progress · as of{" "}
                {new Date().toLocaleDateString(LOCALE, { month: "short", day: "numeric" })}
              </span>
            )}
            {recap.accounts > 1 && (
              <span className="text-lol-text/70">· {recap.accounts} accounts combined</span>
            )}
          </div>
        </div>

        <div className="ml-auto flex flex-col items-end gap-5 self-stretch">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md border border-lol-gold/40 bg-lol-gold/10">
              <MayhemIcon className="h-4 w-4 text-lol-gold" />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-lol-text-bright/80">
              Mayhem Tracker
            </span>
          </div>
          {topChampion && (
            <div className="mt-auto text-right">
              <div className="text-[10px] uppercase tracking-wider text-lol-text">Most played</div>
              <div className="text-lg font-bold text-lol-text-bright">
                {getChampionName(champData, topChampion.champion_id)}
              </div>
              <div className="text-xs text-lol-text">
                {topChampion.games} {topChampion.games === 1 ? "game" : "games"} ·{" "}
                {winRatePercent(topChampion.wins, topChampion.games)} win rate
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Combat({ recap }: { recap: SeasonRecap }) {
  const { games, multikills } = recap;

  return (
    <Panel
      title="Combat"
      subtitle={`across ${games.toLocaleString(LOCALE)} ${games === 1 ? "game" : "games"}`}
      icon={<FlameIcon className="h-3 w-3" />}
      accent="purple"
    >
      <div className="grid grid-cols-8 gap-4">
        <Figure
          label="Kills"
          value={recap.kills.toLocaleString(LOCALE)}
          sub={`${perGame(recap.kills, games)} per game`}
        />
        <Figure
          label="Deaths"
          value={recap.deaths.toLocaleString(LOCALE)}
          sub={`${perGame(recap.deaths, games)} per game`}
        />
        <Figure
          label="Assists"
          value={recap.assists.toLocaleString(LOCALE)}
          sub={`${perGame(recap.assists, games)} per game`}
        />
        <Figure
          label="Kill share"
          value={recap.killParticipation != null ? percent(recap.killParticipation) : "-"}
          sub="kill participation"
        />
        <Figure
          label="Damage dealt"
          value={formatTotal(recap.damage)}
          sub={recap.damageShare != null ? `${percent(recap.damageShare)} of team` : "to champions"}
        />
        <Figure
          label="Damage taken"
          value={formatTotal(recap.damageTaken)}
          sub={`${formatTotal(recap.damageTaken / games)} per game`}
        />
        <Figure
          label="Healing"
          value={formatTotal(recap.healing)}
          sub={`${formatTotal(recap.healing / games)} per game`}
        />
        <Figure
          label="Gold earned"
          value={formatTotal(recap.gold)}
          sub={`${formatTotal(recap.gold / games)} per game`}
        />
      </div>

      <div className="mt-4 grid grid-cols-8 gap-4 border-t border-lol-border/60 pt-4">
        <Figure label="Double kills" value={multikills.doubles} tone="text-sky-400" />
        <Figure label="Triple kills" value={multikills.triples} tone="text-amber-400" />
        <Figure label="Quadra kills" value={multikills.quadras} tone="text-purple-400" />
        <Figure label="Pentakills" value={multikills.pentas} tone="text-red-400" />
        <Figure label="MVP" value={recap.mvps} sub={share(recap.mvps, recap.scoredWins, "wins")} />
        <Figure
          label="ACE"
          value={recap.aces}
          sub={share(recap.aces, recap.scoredLosses, "losses")}
        />
        <Figure
          label="Avg score"
          value={recap.avgScore != null ? recap.avgScore.toFixed(1) : "-"}
          tone={recap.avgScore != null ? scoreColor(recap.avgScore) : undefined}
          sub="out of 10"
        />
        <Figure
          label="Damage / min"
          value={Math.round(recap.damage / (recap.duration / 60)).toLocaleString(LOCALE)}
          sub="to champions"
        />
      </div>
    </Panel>
  );
}

function Figure({
  label,
  value,
  sub,
  tone = "text-lol-text-bright",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wider text-lol-text">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tone}`}>
        {typeof value === "number" ? value.toLocaleString(LOCALE) : value}
      </div>
      {sub && <div className="truncate text-[11px] text-lol-text">{sub}</div>}
    </div>
  );
}

function Rows({ empty, children }: { empty: string; children: ReactNode[] }) {
  if (children.length === 0) return <div className="py-4 text-xs text-lol-text">{empty}</div>;
  return <div className="space-y-2.5">{children}</div>;
}

function WinRate({ wins, games, detail }: { wins: number; games: number; detail: string }) {
  return (
    <div className="shrink-0 text-right">
      <div className={`text-sm font-semibold tabular-nums ${winRateColor(wins, games)}`}>
        {winRatePercent(wins, games)}
      </div>
      <div className="text-[11px] tabular-nums text-lol-text">{detail}</div>
    </div>
  );
}

function ChampionRow({ champ, champData }: { champ: SeasonChampion; champData: ChampionData }) {
  return (
    <div className="flex items-center gap-3">
      <ChampionIcon championId={champ.champion_id} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-lol-text-bright">
          {getChampionName(champData, champ.champion_id)}
        </div>
        <div className="truncate text-[11px] text-lol-text">
          <span className={kdaColor(kdaValue(champ.kills, champ.deaths, champ.assists))}>
            {kdaRatio(champ.kills, champ.deaths, champ.assists)}
          </span>{" "}
          KDA
          {champ.avgScore != null && (
            <>
              {" · "}
              <span className={scoreColor(champ.avgScore)}>{champ.avgScore.toFixed(1)}</span> avg
              score
            </>
          )}
        </div>
      </div>
      <WinRate
        wins={champ.wins}
        games={champ.games}
        detail={`${champ.games} ${champ.games === 1 ? "game" : "games"}`}
      />
    </div>
  );
}

function PickRow({ picks, wins, children }: { picks: number; wins: number; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-3">
      <div className="min-w-0 flex-1">{children}</div>
      <WinRate wins={wins} games={picks} detail={`${picks} ${picks === 1 ? "pick" : "picks"}`} />
    </div>
  );
}

// Boots are bought nearly every game, so only the favourite pair makes the
// list, last and labelled, rather than letting three pairs crowd out the items.
// The label is what explains a pair with more picks sitting below the rest.
function ItemsPanel({ recap }: { recap: SeasonRecap }) {
  const itemData = useItemData(recap.patch);
  const isBoots = (item: ItemStats) => itemData[item.item_id]?.boots ?? false;
  const boots = recap.items.find(isBoots);
  const items = recap.items
    .filter((item) => !isBoots(item))
    .slice(0, boots ? TOP_ITEMS - 1 : TOP_ITEMS);
  if (boots) items.push(boots);

  return (
    <Panel
      title="Top items"
      icon={<CoinsIcon className="h-3 w-3" />}
      accent="win"
      className="h-full"
    >
      <Rows empty="No items recorded">
        {items.map((item) => (
          <PickRow key={item.item_id} picks={item.picks} wins={item.wins}>
            <div className="flex min-w-0 items-center gap-1.5">
              <ItemIcon itemId={item.item_id} size={32} patch={recap.patch} />
              <span className="truncate text-sm font-medium text-lol-text-bright">
                {itemData[item.item_id]?.name || `Item ${item.item_id}`}
              </span>
              {item === boots && (
                <span className="shrink-0 rounded border border-lol-border px-1 text-[9px] font-semibold uppercase tracking-wider text-lol-text">
                  Boots
                </span>
              )}
            </div>
          </PickRow>
        ))}
      </Rows>
    </Panel>
  );
}

// The champions and the win rate get fixed widths, so each row's champion
// icons sit in the same column whatever the numbers beside them come to. A row
// grows into spare height only so far, so a list of two doesn't drift apart.
function FriendRow({ friend, hideName }: { friend: TeammateStats; hideName: boolean }) {
  const [name, tag] = splitRiotId(friend.name);

  return (
    <div className="flex max-h-14 flex-1 items-center gap-3">
      <SummonerIcon iconId={friend.profileIcon} size={32} />
      <div className="min-w-0 flex-1">
        {hideName ? (
          // A blank where the name goes, the height of the line it stands in for
          <div className="flex h-5 items-center">
            <div className="h-0.5 w-24 rounded-full bg-lol-text/40" />
          </div>
        ) : (
          <div className="truncate text-sm text-lol-text-bright">
            {name}
            {tag && <span className="text-lol-text/60"> #{tag}</span>}
          </div>
        )}
        <div className="text-[11px] text-lol-text">{friend.games} games together</div>
      </div>
      <div className="flex w-14 shrink-0 -space-x-1.5">
        {friend.champions.slice(0, 3).map((champ) => (
          <ChampionIcon
            key={champ.champion_id}
            championId={champ.champion_id}
            size={22}
            className="ring-2 ring-lol-card"
          />
        ))}
      </div>
      <div className="w-20 shrink-0">
        <WinRate
          wins={friend.wins}
          games={friend.games}
          detail={`${friend.wins}W ${friend.games - friend.wins}L`}
        />
      </div>
    </div>
  );
}

// When the season was played: every day of it on a calendar, then what the
// days had in common
function Activity({ recap }: { recap: SeasonRecap }) {
  const span = calendarSpan(recap);
  const days = new Map(recap.days.map((played) => [played.day, played]));
  const facts: { key: string; icon: ReactNode; label: string; value: string; sub: string }[] = [];

  if (recap.busiestDay) {
    const { day, games, wins } = recap.busiestDay;
    facts.push({
      key: "day",
      icon: <ZapIcon className="h-3 w-3" />,
      label: "Busiest day",
      value: WEEKDAY_DATE_FORMAT.format(day),
      sub: `${games} ${games === 1 ? "game" : "games"} · ${wins}W ${games - wins}L`,
    });
  }
  if (recap.peakHour != null) {
    facts.push({
      key: "hour",
      icon: <ClockIcon className="h-3 w-3" />,
      label: "Prime time",
      value: hourLabel(recap.peakHour),
      sub: "most games started",
    });
  }
  if (recap.topWeekday != null) {
    facts.push({
      key: "weekday",
      icon: <SparklesIcon className="h-3 w-3" />,
      label: "Favorite day",
      value: weekdayLabel(recap.topWeekday),
      sub: "most games played",
    });
  }
  // A day on its own is no streak
  if (recap.dayStreak && recap.dayStreak.days > 1) {
    const { days: length, from, to } = recap.dayStreak;
    facts.push({
      key: "streak",
      icon: <FlameIcon className="h-3 w-3" />,
      label: "Longest streak",
      value: `${length} days`,
      sub: SHORT_DATE_FORMAT.formatRange(from, to),
    });
  }

  return (
    <Panel
      title="Activity"
      subtitle={
        span
          ? `${recap.days.length} of ${Math.round((span.through - span.first) / DAY_MS) + 1} days played`
          : undefined
      }
      icon={<CalendarIcon className="h-3 w-3" />}
      accent="gold"
      className="h-full"
    >
      {/* Centred, since a short season's weeks reach their widest well short
          of the panel's edge */}
      {span && (
        <div className="flex justify-center">
          <ActivityCalendar days={days} {...span} cell={CALENDAR_CELL} />
        </div>
      )}
      {facts.length > 0 && (
        <div className="mt-4 grid grid-cols-4 gap-4 border-t border-lol-border/60 pt-4">
          {facts.map((fact) => (
            <div key={fact.key} className="min-w-0">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-lol-text">
                <span className="text-lol-gold">{fact.icon}</span>
                {fact.label}
              </div>
              <div className="mt-0.5 truncate text-sm font-semibold text-lol-text-bright">
                {fact.value}
              </div>
              <div className="truncate text-[11px] text-lol-text">{fact.sub}</div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function SectionHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-lol-text">
      <span className="text-lol-gold">{icon}</span>
      {children}
    </div>
  );
}
