import { useEffect, type ReactNode } from "react";
import { useParams, Link } from "react-router-dom";
import { useExpandedMatch } from "../hooks/useExpandedMatch";
import { useIpc } from "../hooks/useIpc";
import { useChampionData, getChampionName } from "../hooks/useChampions";
import type {
  ChampionData,
  TeammateGroupDetail,
  TeammateGroupMatch,
  TeammateLine,
} from "../lib/types";
import { GROUP_SIZES, groupSize } from "../lib/groups";
import BackToFriends from "../components/BackToFriends";
import ChampionIcon from "../components/ChampionIcon";
import SummonerIcon from "../components/SummonerIcon";
import ScoreCell from "../components/ScoreCell";
import SharedGameRow from "../components/SharedGameRow";
import StatBars from "../components/StatBars";
import WinRateBar from "../components/WinRateBar";
import {
  LOCALE,
  formatDecimal,
  formatTimeAgo,
  kdaRatio,
  kdaColor,
  scoreColor,
} from "../lib/format";
import Kda from "../components/Kda";
import RiotId from "../components/RiotId";

// The fields a line of ours and a teammate's have in common, so both add up the
// same way
type GameLine = Pick<TeammateLine, "kills" | "deaths" | "assists" | "score" | "score_badge">;

function summarize(lines: GameLine[]) {
  const kills = lines.reduce((sum, l) => sum + l.kills, 0);
  const deaths = lines.reduce((sum, l) => sum + l.deaths, 0);
  const assists = lines.reduce((sum, l) => sum + l.assists, 0);
  const scored = lines.filter((l) => l.score != null);

  return {
    kills,
    deaths,
    assists,
    ratio: deaths > 0 ? (kills + assists) / deaths : kills + assists,
    avgScore: scored.length
      ? scored.reduce((sum, l) => sum + (l.score ?? 0), 0) / scored.length
      : null,
    mvps: lines.filter((l) => l.score_badge === "MVP").length,
    aces: lines.filter((l) => l.score_badge === "ACE").length,
  };
}

// The game list's width at which a group's rows have room for stat bars, then
// for full-size ones. Decided on the list rather than each block, so every
// player in every row shows the same thing. Written out because Tailwind only
// sees whole class names.
const STAT_BAR_WIDTHS: Record<number, string> = {
  2: "@min-[48rem]:block @min-[60rem]:w-32",
  3: "@min-[62rem]:block @min-[68rem]:w-32",
  4: "@min-[79rem]:block @min-[87rem]:w-32",
  5: "@min-[96rem]:block",
};

// The game list's width at which a group's rows fit on one line. Dividers only
// read as columns there: on wrapped rows they'd hang off the end of each line.
const ROW_DIVIDERS: Record<number, string> = {
  2: "divide-x",
  3: "@min-[42rem]:divide-x",
  4: "@min-[52rem]:divide-x",
  5: "@min-[62rem]:divide-x",
};

// A Riot ID's name half, for where the tag won't fit
function gameName(id: string): string {
  return id.split("#")[0];
}

export default function GroupDetail() {
  const { key = "" } = useParams();
  const champData = useChampionData();
  const { data, loading, refetch } = useIpc<TeammateGroupDetail | null>(
    () => window.api.getTeammateGroupDetail(key),
    [key],
  );
  const { data: profile } = useIpc(() => window.api.getProfile(), []);
  const expansion = useExpandedMatch();

  useEffect(() => {
    const unsub = window.api.onGamesUpdated(() => refetch());
    return unsub;
  }, [refetch]);

  // Only before the first answer: a refetch after a new game keeps showing the
  // page it is about to update. null is an answer too ("no games together"), so
  // the check can't be on data alone.
  if (loading && !data) {
    return <div className="text-lol-text text-center mt-20">Loading...</div>;
  }

  if (!data) {
    return (
      <div className="max-w-[96rem] space-y-4">
        <BackToFriends link={{ view: "groups" }} />
        <div className="bg-lol-card rounded-xl border border-lol-border/60 p-8 text-center text-lol-text">
          No games found with this group.
        </div>
      </div>
    );
  }

  const { group, matches } = data;
  const losses = group.games - group.wins;
  const members = group.members.map((member, i) => ({
    ...member,
    summary: summarize(matches.map((m) => m.members[i])),
  }));
  const you = summarize(matches);
  // The page's totals are everyone's, us included
  const lines = matches.flatMap((m): GameLine[] => [m, ...m.members]);
  const overall = summarize(lines);
  const avg = (total: number) => formatDecimal(lines.length > 0 ? total / lines.length : 0);

  return (
    // Wider than a friend's page, so a bigger group has the room for stat bars
    <div className="max-w-[96rem] space-y-4">
      <BackToFriends link={{ view: "groups" }} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4 items-stretch">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex shrink-0 -space-x-4">
              {group.members.map((m) => (
                <SummonerIcon
                  key={m.key}
                  iconId={m.profileIcon}
                  size={56}
                  className="ring-2 ring-lol-dark"
                />
              ))}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-lol-text-bright truncate">
                {group.members.map((m, i) => (
                  <span key={m.key}>
                    {i > 0 && " + "}
                    <bdi>{gameName(m.name)}</bdi>
                  </span>
                ))}
              </h1>
              <span className="text-sm text-lol-text">
                {GROUP_SIZES[groupSize(group)]} · {group.games.toLocaleString(LOCALE)} games
                together · last played {formatTimeAgo(group.lastPlayed)}
              </span>
            </div>
          </div>

          {/* items-center keeps the columns at content height, so the dividers
              stop short of the card's top and bottom edges */}
          <div className="flex-1 flex items-center bg-lol-card rounded-xl border border-lol-border/60 divide-x divide-lol-border/60">
            <Stat label="Record">
              <div className="text-xl font-bold text-lol-text-bright">
                {group.wins.toLocaleString(LOCALE)}W{" "}
                <span className="text-lol-text/60">{losses.toLocaleString(LOCALE)}L</span>
              </div>
              <div className="mt-1">
                <WinRateBar wins={group.wins} total={group.games} />
              </div>
            </Stat>
            <Stat label="Group KDA">
              <div className={`text-xl font-bold ${kdaColor(overall.ratio)}`}>
                {kdaRatio(overall.kills, overall.deaths, overall.assists)}
              </div>
              <div className="text-xs text-lol-text mt-1">
                <Kda
                  kills={avg(overall.kills)}
                  deaths={avg(overall.deaths)}
                  assists={avg(overall.assists)}
                />{" "}
                per player
              </div>
            </Stat>
            <Stat label="Group Avg Score">
              <div
                className={`text-xl font-bold ${overall.avgScore != null ? scoreColor(overall.avgScore) : "text-lol-text"}`}
              >
                {overall.avgScore != null ? formatDecimal(overall.avgScore) : "—"}
              </div>
              <div className="text-xs text-lol-text mt-1">
                {overall.mvps} MVP · {overall.aces} ACE
              </div>
            </Stat>
          </div>
        </div>

        <div className="flex flex-col bg-lol-card rounded-xl border border-lol-border/60 overflow-hidden">
          <div className="px-3 py-2 border-b border-lol-border/60 flex items-center justify-between">
            <span className="text-[11px] text-lol-text uppercase tracking-wider">
              Group Members
            </span>
            <span className="text-[11px] text-lol-text">{groupSize(group)}</span>
          </div>
          <div className="divide-y divide-lol-border/40">
            <MemberRow name="You" profileIcon={profile?.profileIcon ?? null} summary={you} />
            {members.map((m) => (
              <Link
                key={m.key}
                to={`/friends/${encodeURIComponent(m.key)}`}
                className="block hover:bg-lol-card-hover transition-colors"
              >
                <MemberRow name={m.name} profileIcon={m.profileIcon} summary={m.summary} />
              </Link>
            ))}
          </div>
        </div>
      </div>

      <h2 className="text-sm font-semibold text-lol-text-bright uppercase tracking-wider pt-1">
        Games Played Together
      </h2>

      <div className="@container space-y-1">
        {matches.map((m) => (
          <SharedGameRow key={m.game_id} match={m} champData={champData} expansion={expansion}>
            <GameBlocks match={m} group={group} champData={champData} />
          </SharedGameRow>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex-1 px-4 py-2.5">
      <div className="text-[11px] text-lol-text uppercase tracking-wider">{label}</div>
      {children}
    </div>
  );
}

function MemberRow({
  name,
  profileIcon,
  summary,
}: {
  name: string;
  profileIcon: number | null;
  summary: ReturnType<typeof summarize>;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <SummonerIcon iconId={profileIcon} size={26} />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-lol-text-bright truncate">
          <RiotId id={name} />
        </div>
        <div className="text-[10px] text-lol-text">
          <span className={kdaColor(summary.ratio)}>
            {kdaRatio(summary.kills, summary.deaths, summary.assists)} KDA
          </span>{" "}
          · {summary.mvps} MVP · {summary.aces} ACE
        </div>
      </div>
      <ScoreCell score={summary.avgScore} badge={null} />
    </div>
  );
}

// Everyone's line in one game, ours first, in columns that hold from row to row
// and wrap onto a second line in a window too narrow for them
function GameBlocks({
  match,
  group,
  champData,
}: {
  match: TeammateGroupMatch;
  group: TeammateGroupDetail["group"];
  champData: ChampionData;
}) {
  const size = groupSize(group);
  const statBars = STAT_BAR_WIDTHS[size];
  // Every bar scales off the same game bests, so the players are comparable
  const max = {
    dmg: match.game_max_dmg,
    taken: match.game_max_taken,
    heal: match.game_max_heal,
  };

  return (
    <div
      className={`flex-1 min-w-0 grid grid-cols-[repeat(auto-fit,minmax(10.25rem,1fr))] gap-y-2 divide-lol-border/60 ${ROW_DIVIDERS[size]}`}
    >
      <MemberBlock label="You" line={match} max={max} statBars={statBars} champData={champData} />
      {group.members.map((member, i) => (
        <MemberBlock
          key={member.key}
          label={gameName(member.name)}
          line={match.members[i]}
          max={max}
          statBars={statBars}
          champData={champData}
        />
      ))}
    </div>
  );
}

function MemberBlock({
  label,
  line,
  max,
  statBars,
  champData,
}: {
  label: string;
  line: TeammateLine;
  max: { dmg: number; taken: number; heal: number };
  statBars: string;
  champData: ChampionData;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0 px-2">
      <ChampionIcon
        championId={line.champion_id}
        size={32}
        title={getChampionName(champData, line.champion_id)}
        className="shrink-0"
      />
      {/* Shrinks in a full team's columns, and keeps the score beside it in a duo's */}
      <div className="min-w-0 w-28">
        <div className="text-[10px] text-lol-text uppercase tracking-wider truncate" title={label}>
          <bdi>{label}</bdi>
        </div>
        <div className="text-xs text-lol-text-bright whitespace-nowrap">
          <Kda kills={line.kills} deaths={line.deaths} assists={line.assists} />
        </div>
      </div>
      <ScoreCell score={line.score} badge={line.score_badge} />
      <StatBars
        damage={line.total_damage_dealt}
        taken={line.total_damage_taken}
        heal={line.total_heal}
        max={max}
        className={`hidden w-24 ${statBars}`}
      />
    </div>
  );
}
