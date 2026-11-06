import type { ReactNode } from "react";
import type { useExpandedMatch } from "../hooks/useExpandedMatch";
import type { ChampionData, MatchListItem } from "../lib/types";
import { formatDuration, formatTimeAgo } from "../lib/format";
import MatchScoreboard from "./MatchScoreboard";

// One game on a friend's or a group's page: the result, the players' lines as
// `children`, and when it was played. A click opens the full scoreboard.
export default function SharedGameRow({
  match,
  champData,
  expansion,
  children,
}: {
  match: MatchListItem;
  champData: ChampionData;
  expansion: ReturnType<typeof useExpandedMatch>;
  children: ReactNode;
}) {
  const { puuids, expandedId, detail, detailLoading, toggleExpand } = expansion;
  const expanded = expandedId === match.game_id;
  const isWin = !!match.win;
  const accent = isWin ? "bg-lol-win" : "bg-lol-loss";
  const tint = isWin ? "from-lol-win/12 to-lol-win/[0.04]" : "from-lol-loss/12 to-lol-loss/[0.04]";

  return (
    <div>
      <button
        onClick={() => toggleExpand(match.game_id)}
        className={`relative overflow-hidden w-full flex items-center gap-4 pl-4 pr-3 py-2.5 border border-lol-border/60 bg-lol-card hover:bg-lol-card-hover transition-colors text-left ${
          expanded ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className={`absolute left-0 inset-y-0 w-[3px] ${accent}`} />
        <span className={`absolute inset-0 pointer-events-none bg-gradient-to-r ${tint}`} />
        <div
          className={`text-xs font-bold shrink-0 w-8 ${isWin ? "text-lol-win" : "text-lol-loss"}`}
        >
          {isWin ? "WIN" : "LOSS"}
        </div>

        {children}

        {/* A set width, so a long date can't shift this row's columns off the others' */}
        <div className="text-xs text-lol-text text-right shrink-0 w-[4.5rem]">
          <div className="tabular-nums">{formatDuration(match.game_duration)}</div>
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
