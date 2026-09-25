import type {
  RecapPlacement,
  RecapMilestone,
  RecapStreak,
  GameRecap,
  RecapSessionGame,
  RecapChallenge,
} from "../../shared/api";
import { ordinal } from "../../shared/text";
import { sessionDay } from "../../shared/session";
import { ARAM_S_GRADE_CHALLENGE_ID } from "../../shared/challenges";
import { getGameChallenges } from "./challenges";
import { getGameMapName } from "./live";
import { getMatchDetail } from "./matches";
import { type CareerRow, higher, lower, careerRows } from "./records";

// The biggest listed mark a running total passed on this game, or null for
// none. The largest wins so a game that crosses two at once reports the one
// worth reporting.
function crossedMark(before: number, after: number, marks: number[]): number | null {
  let best: number | null = null;
  for (const mark of marks) {
    if (before < mark && after >= mark && (best === null || mark > best)) best = mark;
  }
  return best;
}

// Repeating marks, for totals that keep climbing past any list worth writing.
function crossedStep(before: number, after: number, step: number): number | null {
  const mark = Math.floor(after / step) * step;
  return mark > 0 && before < mark ? mark : null;
}

interface PlacementDef {
  key: string;
  label: string;
  format: RecapPlacement["format"];
  good: boolean;
  value: (row: CareerRow) => number | null;
  // What the placement is ranked on, where that differs from the value shown
  rankedOn?: (row: CareerRow) => number | null;
  // True when a is the better of the two, which for deaths and duration is
  // not the larger one
  better: (a: number, b: number) => boolean;
}

const PLACEMENTS: PlacementDef[] = [
  {
    key: "kills",
    label: "Kills",
    format: "int",
    good: true,
    value: (r) => r.kills,
    better: higher,
  },
  {
    key: "kda",
    label: "KDA",
    format: "kda",
    good: true,
    // Deathless games rank by kills plus assists rather than dividing by zero,
    // the same way the Records page ranks them
    value: (r) => (r.kills + r.assists) / Math.max(r.deaths, 1),
    better: higher,
  },
  {
    key: "score",
    label: "Score",
    format: "score",
    good: true,
    value: (r) => r.score,
    // Shown clamped to 1-10 and ranked on the raw score, as the Records page
    // ranks it, so games that both show 10 still have an order
    rankedOn: (r) => r.score_raw ?? r.score,
    better: higher,
  },
  {
    key: "assists",
    label: "Assists",
    format: "int",
    good: true,
    value: (r) => r.assists,
    better: higher,
  },
  {
    key: "killingSpree",
    label: "Killing spree",
    format: "int",
    good: true,
    value: (r) => r.largest_killing_spree,
    better: higher,
  },
  {
    key: "damage",
    label: "Damage dealt",
    format: "compact",
    good: true,
    value: (r) => r.total_damage_dealt,
    better: higher,
  },
  {
    key: "damageTaken",
    label: "Damage taken",
    format: "compact",
    good: true,
    value: (r) => r.total_damage_taken,
    better: higher,
  },
  {
    key: "healing",
    label: "Healing",
    format: "compact",
    good: true,
    value: (r) => r.total_heal,
    better: higher,
  },
  {
    key: "gold",
    label: "Gold earned",
    format: "compact",
    good: true,
    value: (r) => r.gold_earned,
    better: higher,
  },
  {
    key: "deaths",
    label: "Deaths",
    format: "int",
    good: false,
    value: (r) => r.deaths,
    better: higher,
  },
  {
    key: "fastestWin",
    label: "Fastest win",
    format: "duration",
    good: true,
    value: (r) => (r.win ? r.game_duration : null),
    better: lower,
  },
  {
    key: "longestGame",
    label: "Longest game",
    format: "duration",
    good: true,
    value: (r) => r.game_duration,
    better: higher,
  },
];

// Deep enough to be worth saying, shallow enough that a stat which happens to
// be ordinary doesn't get listed as though it weren't.
const MAX_PLACEMENT_RANK = 10;

function buildPlacements(rows: CareerRow[], row: CareerRow): RecapPlacement[] {
  const placements: RecapPlacement[] = [];

  for (const def of PLACEMENTS) {
    const rankedOn = def.rankedOn ?? def.value;
    const value = def.value(row);
    const mark = rankedOn(row);
    if (value == null || mark == null) continue;

    let rank = 1;
    let total = 0;
    for (const other of rows) {
      const otherMark = rankedOn(other);
      if (otherMark == null) continue;
      total++;
      // Strictly better only, so a tie shares the rank rather than pushing the
      // game down behind a game it matched
      if (other.game_id !== row.game_id && def.better(otherMark, mark)) rank++;
    }
    if (rank <= MAX_PLACEMENT_RANK) {
      placements.push({
        key: def.key,
        label: def.label,
        value,
        rank,
        total,
        good: def.good,
        format: def.format,
      });
    }
  }

  return placements.sort((a, b) => a.rank - b.rank);
}

function buildMilestones(rows: CareerRow[], index: number): RecapMilestone[] {
  const row = rows[index];
  const milestones: RecapMilestone[] = [];
  const add = (key: string, label: string, detail: string) =>
    milestones.push({ key, label, detail });

  let wins = 0;
  let kills = 0;
  let mvps = 0;
  let pentas = 0;
  let quadras = 0;
  let champGames = 0;
  let champWins = 0;
  for (let i = 0; i <= index; i++) {
    const r = rows[i];
    wins += r.win;
    kills += r.kills;
    if (r.score_badge === "MVP") mvps++;
    pentas += r.penta_kills;
    quadras += r.quadra_kills;
    if (r.champion_id === row.champion_id) {
      champGames++;
      champWins += r.win;
    }
  }

  const games = index + 1;
  const gamesMark =
    crossedMark(games - 1, games, [10, 25, 50]) ?? crossedStep(games - 1, games, 100);
  if (gamesMark) add("games", `${ordinal(gamesMark)} game`, "Across every tracked account");

  const winsMark =
    crossedMark(wins - row.win, wins, [10, 25, 50]) ?? crossedStep(wins - row.win, wins, 100);
  if (winsMark) add("wins", `${ordinal(winsMark)} win`, "Career wins");

  const killsMark = crossedStep(kills - row.kills, kills, 1000);
  if (killsMark)
    add("kills", `${killsMark.toLocaleString()} career kills`, "Every game, every champion");

  if (champGames === 1) {
    add("champion-first", "First game on this champion", "A new name on the list");
  } else {
    const champMark = crossedMark(champGames - 1, champGames, [5, 10, 25, 50, 100, 200]);
    if (champMark)
      add(
        "champion-games",
        `${ordinal(champMark)} game on this champion`,
        "Career games on this pick",
      );
  }

  const champWinMark = crossedMark(champWins - row.win, champWins, [5, 10, 25, 50, 100]);
  if (champWinMark)
    add(
      "champion-wins",
      `${ordinal(champWinMark)} win on this champion`,
      "Career wins on this pick",
    );

  if (row.penta_kills > 0) {
    add(
      "penta",
      pentas === row.penta_kills ? "First pentakill" : `${ordinal(pentas)} pentakill`,
      "The rarest one",
    );
  } else if (row.quadra_kills > 0 && quadras === row.quadra_kills) {
    add("quadra", "First quadra kill", "So close");
  }

  if (row.score_badge === "MVP") {
    const mvpMark =
      crossedMark(mvps - 1, mvps, [1, 5, 10, 25, 50]) ?? crossedStep(mvps - 1, mvps, 50);
    if (mvpMark === 1) add("mvp", "First MVP", "Best player on the winning team");
    else if (mvpMark) add("mvp", `${ordinal(mvpMark)} MVP`, "Best player on the winning team");
  }

  return milestones;
}

// The streak this game leaves us on, and whether it is the longest of its kind
// on record. A single loss is a streak of one, which is honest: the page says
// "1 loss" rather than pretending nothing is happening.
function buildStreak(rows: CareerRow[], index: number): RecapStreak {
  let length = 0;
  const kind = rows[index].win ? "win" : "loss";
  for (let i = index; i >= 0 && rows[i].win === rows[index].win; i--) length++;

  let best = 0;
  let run = 0;
  for (let i = 0; i < rows.length; i++) {
    run = i > 0 && rows[i].win === rows[i - 1].win ? run + 1 : 1;
    if (rows[i].win === rows[index].win && run > best) best = run;
  }

  return { kind, length, best, isRecord: length >= best && length > 1 };
}

/**
 * Everything the post-game page says about one match: the match itself, where
 * its numbers land among every game on record, what the day looks like around
 * it, and which marks it moved past.
 *
 * Placements are all-time, since "where it lands among your records" is a
 * question about the library as it stands. Milestones are as of the game,
 * because crossing a mark only happens once and happened then.
 */
export function getGameRecap(gameId?: number): GameRecap | null {
  const rows = careerRows();
  const id = gameId ?? rows[rows.length - 1]?.game_id;
  if (id == null) return null;

  const detail = getMatchDetail(id);
  if (!detail) return null;

  // A remake is in no aggregate anywhere, so it has no placements, no
  // milestones and no streak. Everything else on the page still works.
  const index = rows.findIndex((r) => r.game_id === id);
  const row = index >= 0 ? rows[index] : null;

  const day = sessionDay(detail.game.game_creation);
  const sessionRows = rows.filter((r) => sessionDay(r.game_creation) === day);
  const session = {
    day,
    index: sessionRows.findIndex((r) => r.game_id === id),
    games: sessionRows.map((r): RecapSessionGame => ({
      game_id: r.game_id,
      game_creation: r.game_creation,
      game_duration: r.game_duration,
      champion_id: r.champion_id,
      win: r.win,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      score: r.score,
    })),
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    avgScore: null as number | null,
    duration: 0,
  };
  let sessionScore = 0;
  let sessionScored = 0;
  for (const r of sessionRows) {
    if (r.win) session.wins++;
    else session.losses++;
    session.kills += r.kills;
    session.deaths += r.deaths;
    session.assists += r.assists;
    session.duration += r.game_duration;
    if (r.score != null) {
      sessionScore += r.score;
      sessionScored++;
    }
  }
  if (sessionScored > 0) session.avgScore = sessionScore / sessionScored;

  const championId = detail.stats?.champion_id ?? 0;
  const championRows = rows.filter((r) => r.champion_id === championId);
  const champion = {
    championId,
    games: championRows.length,
    wins: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    avgScore: null as number | null,
    previousBest: null as number | null,
    firstTime:
      row != null && championRows.filter((r) => r.game_creation <= row.game_creation).length === 1,
  };
  let champScore = 0;
  let champScored = 0;
  for (const r of championRows) {
    champion.wins += r.win;
    champion.kills += r.kills;
    champion.deaths += r.deaths;
    champion.assists += r.assists;
    if (r.score != null) {
      champScore += r.score;
      champScored++;
      if (r.game_id !== id && (champion.previousBest == null || r.score > champion.previousBest)) {
        champion.previousBest = r.score;
      }
    }
  }
  if (champScored > 0) champion.avgScore = champScore / champScored;

  const career = {
    games: rows.length,
    wins: 0,
    avgScore: null as number | null,
    avgKills: 0,
    avgDeaths: 0,
    avgAssists: 0,
    avgDamage: 0,
    avgTaken: 0,
    avgHeal: 0,
    avgGold: 0,
  };
  let careerScore = 0;
  let careerScored = 0;
  for (const r of rows) {
    career.wins += r.win;
    career.avgKills += r.kills;
    career.avgDeaths += r.deaths;
    career.avgAssists += r.assists;
    career.avgDamage += r.total_damage_dealt;
    career.avgTaken += r.total_damage_taken;
    career.avgHeal += r.total_heal;
    career.avgGold += r.gold_earned;
    if (r.score != null) {
      careerScore += r.score;
      careerScored++;
    }
  }
  if (rows.length > 0) {
    for (const key of [
      "avgKills",
      "avgDeaths",
      "avgAssists",
      "avgDamage",
      "avgTaken",
      "avgHeal",
      "avgGold",
    ] as const) {
      career[key] /= rows.length;
    }
  }
  if (careerScored > 0) career.avgScore = careerScore / careerScored;

  const challenges = getGameChallenges(id).map((c): RecapChallenge => ({
    id: c.challenge_id,
    name: c.name,
    description: c.description,
    previousValue: c.previous_value,
    currentValue: c.current_value,
    previousLevel: c.previous_level,
    currentLevel: c.current_level,
    nextLevel: c.next_level,
    nextThreshold: c.next_threshold,
    iconPath: c.icon_path,
  }));

  const milestones = row ? buildMilestones(rows, index) : [];
  // The S- challenge counts champions, not grades, so it only moves on one a
  // champion has never earned before. A game that moved it is that game.
  const firstSGrade = challenges.find(
    (c) => c.id === ARAM_S_GRADE_CHALLENGE_ID && c.currentValue > c.previousValue,
  );
  if (firstSGrade) {
    milestones.push({
      key: "challenge-s-grade",
      label: "First S on this champion",
      detail: `${firstSGrade.name}: ${firstSGrade.currentValue} champions`,
    });
  }

  return {
    detail,
    mapName: getGameMapName(id),
    score: detail.stats?.score ?? null,
    scoreBadge: detail.stats?.score_badge ?? null,
    placements: row ? buildPlacements(rows, row) : [],
    milestones,
    session,
    streak: row ? buildStreak(rows, index) : null,
    champion,
    career,
    challenges,
  };
}
