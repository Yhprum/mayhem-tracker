import { BrowserWindow } from "electron";
import * as db from "./db";
import { sendToRenderer } from "./ipc";
import { getLiveGameRef, isClientConnected, lcuJson, onLcuStatusChange } from "./lcu";
import {
  ARAM_CAPSTONE_ID,
  ARAM_GAME_MODES,
  ARAM_GROUP_IDS,
  CHALLENGE_DELTA_DAYS,
  CHALLENGE_LEVELS,
  challengeDay,
  challengeFraction,
  daysBefore,
} from "../shared/challenges";
import type {
  ChallengeGroup,
  ChallengeLevel,
  ChallengePlayerSummary,
  ChallengeProgress,
  ChallengeReward,
  ChallengesData,
  ChallengesResult,
  RecapChallenge,
} from "../shared/api";

// The window challenge updates are pushed to, so a tab that is already open
// takes new numbers without asking for them.
let win: BrowserWindow | null = null;

// Riot's challenge objects, as the client hands them over. Read defensively
// throughout: this is one of the few endpoints whose shape we don't control and
// can't pin to a patch.
type RawChallenge = Record<string, any>;

function finite(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toLevel(value: unknown): ChallengeLevel {
  const level = String(value ?? "");
  return (CHALLENGE_LEVELS as readonly string[]).includes(level)
    ? (level as ChallengeLevel)
    : "NONE";
}

function rewardsFor(raw: RawChallenge, level: ChallengeLevel): ChallengeReward[] {
  const list = raw.thresholds?.[level]?.rewards;
  if (!Array.isArray(list)) return [];
  return list.map((reward: any) => ({
    category: String(reward?.category ?? ""),
    name: String(reward?.name ?? ""),
    quantity: finite(reward?.quantity, 0),
  }));
}

// An unstarted challenge has no token of its own. Hand back the IRON one so
// every row has art, and let the view dim it.
function tokenPath(raw: RawChallenge, level: ChallengeLevel): string {
  const paths = raw.levelToIconPath ?? {};
  return String(paths[level === "NONE" ? "IRON" : level] ?? "");
}

function shape(raw: RawChallenge, baseline: Record<number, number> | null): ChallengeProgress {
  const id = Number(raw.id);
  const level = toLevel(raw.currentLevel);
  const nextLevel = toLevel(raw.nextLevel);
  // An empty nextLevel is the client saying the top tier is reached. The
  // thresholds still attached to such a challenge are leftovers: Pop Goes the
  // Poro sits maxed at BRONZE and still reports a nextThreshold of 1.
  const maxed = nextLevel === "NONE";
  const value = finite(raw.currentValue, 0);
  const previous = baseline?.[id];

  return {
    id,
    name: String(raw.name ?? `Challenge ${id}`),
    description: String(raw.description || raw.descriptionShort || ""),
    level,
    value,
    currentThreshold: finite(raw.currentThreshold, 0),
    nextLevel: maxed ? null : nextLevel,
    nextThreshold: maxed ? null : finite(raw.nextThreshold, 0),
    nextRewards: maxed ? [] : rewardsFor(raw, nextLevel),
    // 100 is the client's own answer for a challenge nobody has started, and
    // the honest fallback for one whose percentile didn't parse.
    percentile: finite(raw.percentile, 100),
    pointsAwarded: finite(raw.pointsAwarded, 0),
    iconPath: tokenPath(raw, level),
    retired: finite(raw.retireTimestamp, 0) > 0,
    // Only the champion-scored challenges name what's done; for the rest the
    // list is either absent or a list of something else entirely.
    completedChampionIds:
      raw.idListType === "CHAMPION"
        ? (Array.isArray(raw.completedIds) ? raw.completedIds : []).map(Number)
        : null,
    delta: previous == null ? null : value - previous,
  };
}

// The capstone and its groups carry no gameModes of their own (only the
// leaves are tagged), so the tree is matched by id and everything else by mode.
function isAramChallenge(raw: RawChallenge): boolean {
  const id = Number(raw.id);
  if (id === ARAM_CAPSTONE_ID || ARAM_GROUP_IDS.includes(id)) return true;
  const modes = Array.isArray(raw.gameModes) ? raw.gameModes : [];
  return modes.some((mode: unknown) => ARAM_GAME_MODES.includes(String(mode)));
}

// Closest to a new tier first, since that's the order the list is actually read
// in. Finished challenges have nothing left to be close to, so they sink.
function byProgress(a: ChallengeProgress, b: ChallengeProgress): number {
  const rank = (c: ChallengeProgress) =>
    c.nextThreshold == null ? -1 : challengeFraction(c.value, c.currentThreshold, c.nextThreshold);
  return rank(b) - rank(a);
}

function playerSummary(summary: any): ChallengePlayerSummary {
  const categories = Array.isArray(summary?.categoryProgress) ? summary.categoryProgress : [];
  return {
    level: toLevel(summary?.overallChallengeLevel),
    // The client reports points per category and never a total, so the total is
    // the sum of them.
    points: categories.reduce((total: number, c: any) => total + finite(c?.current, 0), 0),
    pointsUntilNextRank: finite(summary?.pointsUntilNextRank, 0),
    percentile: finite(summary?.positionPercentile, 100),
    title: String(summary?.title?.name ?? ""),
  };
}

/**
 * Pull the ARAM challenge tree from the running client, snapshot it, and return
 * it. Null when the client isn't answering or answered with nothing usable.
 *
 * The snapshot is the point as much as the return value is: the client only
 * ever reports where a challenge stands right now, so a day that goes
 * unrecorded is a day of progress that can never be attributed later.
 */
async function refreshChallenges(): Promise<ChallengesData | null> {
  const [raw, summary] = await Promise.all([
    lcuJson("/lol-challenges/v1/challenges/local-player"),
    lcuJson("/lol-challenges/v1/summary-player-data/local-player"),
  ]);
  if (!raw || typeof raw !== "object") return null;

  const byId = new Map<number, RawChallenge>();
  for (const entry of Object.values(raw) as RawChallenge[]) {
    const id = Number(entry?.id);
    if (Number.isFinite(id)) byId.set(id, entry);
  }
  // The client answers with every challenge in the game or with nothing at all.
  // An empty map means the former didn't happen, and writing it down would
  // overwrite a good snapshot with a blank one.
  if (byId.size === 0) return null;

  const today = challengeDay();
  const baseline = db.getChallengeBaseline(daysBefore(today, CHALLENGE_DELTA_DAYS), today);
  const shapeOne = (entry: RawChallenge) => shape(entry, baseline?.values ?? null);

  // Ids the tree accounts for, so what's left over can be recognised as
  // seasonal without hardcoding a list of seasons.
  const inTree = new Set<number>([ARAM_CAPSTONE_ID]);
  const groups: ChallengeGroup[] = [];
  for (const groupId of ARAM_GROUP_IDS) {
    const node = byId.get(groupId);
    if (!node) continue;
    inTree.add(groupId);
    const challenges: ChallengeProgress[] = [];
    for (const rawChildId of node.childrenIds ?? []) {
      const childId = Number(rawChildId);
      const child = byId.get(childId);
      if (!child) continue;
      inTree.add(childId);
      challenges.push(shapeOne(child));
    }
    challenges.sort(byProgress);
    groups.push({ summary: shapeOne(node), challenges });
  }

  const capstoneRaw = byId.get(ARAM_CAPSTONE_ID);
  const seasonal = [...byId.values()]
    .filter((entry) => !inTree.has(Number(entry.id)) && isAramChallenge(entry))
    .map(shapeOne)
    .sort((a, b) => b.id - a.id);

  const equipped = String(summary?.selectedChallengesString ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isFinite(id))
    .map((id) => byId.get(id))
    .filter((entry): entry is RawChallenge => entry != null)
    .map(shapeOne);

  const data: ChallengesData = {
    player: playerSummary(summary),
    capstone: capstoneRaw ? shapeOne(capstoneRaw) : null,
    groups,
    seasonal,
    equipped,
    fetchedAt: Date.now(),
    since: baseline?.day ?? null,
  };

  // Retired challenges are frozen by definition, and the equipped three are
  // whatever the player pinned to their profile, and neither has a trend worth a
  // row a day.
  const tracked = [
    ...(data.capstone ? [data.capstone] : []),
    ...groups.flatMap((group) => [group.summary, ...group.challenges]),
    ...seasonal,
  ].filter((challenge) => !challenge.retired);

  db.saveChallenges(
    today,
    JSON.stringify(data),
    tracked.map((challenge) => ({
      id: challenge.id,
      value: challenge.value,
      level: challenge.level,
    })),
  );

  return data;
}

function readStored(): ChallengesData | null {
  const row = db.getStoredChallenges();
  if (!row) return null;
  try {
    // fetchedAt comes off the row rather than out of the payload: the row is
    // what the write actually stamped.
    return { ...(JSON.parse(row.payload) as ChallengesData), fetchedAt: row.fetched_at };
  } catch (err) {
    console.log("Stored challenges unreadable:", err);
    return null;
  }
}

// One refresh at a time. The tab asking, the status listener firing and a
// manual refresh can all land together, and the client is slow enough that
// three overlapping fetches would be three waits rather than one.
let refreshing: Promise<ChallengesData | null> | null = null;

function refreshAndBroadcast(): Promise<ChallengesData | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const data = await refreshChallenges();
      if (data) sendToRenderer(win, "challenges:changed", { data, pending: false });
      return data;
    } catch (err) {
      console.log("Challenge fetch failed:", err);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * The last stored snapshot, straight away.
 *
 * Deliberately does not wait on the client: a round trip to it is slow enough
 * to be felt as the tab hanging on open, and the numbers that were true at the
 * last reading are a far better thing to draw in the meantime than a spinner.
 * A live refresh starts in the background and arrives over
 * "challenges:changed".
 */
export function getChallenges(): ChallengesResult {
  const pending = isClientConnected();
  if (pending) void refreshAndBroadcast();
  return { data: readStored(), pending };
}

// ---- Per-game progress -----------------------------------------------------
//
// The client will say which challenges a game moved, and by how much, but only
// for the most recent one: ask about the game before it and the answer is a
// 404. So a game's contribution is either written down while it is still the
// current game or lost for good, which is what makes this worth capturing
// eagerly rather than on demand from the recap.

// The phase can reach "connected" while the client is still writing the match
// up, so an empty first answer isn't final. The window stays open until the
// next game ends, which leaves room to be patient.
const GAME_CAPTURE_DELAYS_MS = [0, 5_000, 20_000, 60_000];

// Games a capture chain is already running for, so a second status change
// doesn't start a competing one.
const capturePending = new Set<number>();

function shapeGameChallenge(raw: RawChallenge): RecapChallenge {
  const level = toLevel(raw.currentLevel);
  const nextLevel = toLevel(raw.nextLevel);
  const maxed = nextLevel === "NONE";
  return {
    id: Number(raw.id),
    name: String(raw.name ?? `Challenge ${raw.id}`),
    description: String(raw.description || raw.descriptionShort || ""),
    previousValue: finite(raw.previousValue, 0),
    currentValue: finite(raw.currentValue, 0),
    previousLevel: toLevel(raw.previousLevel),
    currentLevel: level,
    nextLevel: maxed ? null : nextLevel,
    nextThreshold: maxed ? null : finite(raw.nextThreshold, 0),
    iconPath: tokenPath(raw, level),
  };
}

/**
 * Record what one game moved, if the client still remembers.
 *
 * Returns how many challenges were written, or 0 when the client has nothing
 * for this game: either it moved none, or a later game has already taken its
 * place as the current one.
 */
async function captureGameChallenges(gameId: number): Promise<number> {
  const raw = await lcuJson(`/lol-challenges/v1/my-updated-challenges/${gameId}`);
  // A game with no challenge movement answers 404, which lcuJson reports as
  // null, so an absent answer is not an error worth surfacing.
  if (!raw || typeof raw !== "object") return 0;

  const rows = (Object.values(raw) as RawChallenge[])
    .filter((entry) => Number.isFinite(Number(entry?.id)))
    .map(shapeGameChallenge);
  if (rows.length === 0) return 0;

  db.saveGameChallenges(gameId, rows);
  console.log(`Captured ${rows.length} challenge updates for game ${gameId}`);
  return rows.length;
}

function startGameCapture(gameId: number) {
  if (capturePending.has(gameId) || db.hasGameChallenges(gameId)) return;
  capturePending.add(gameId);

  void (async () => {
    try {
      for (const delay of GAME_CAPTURE_DELAYS_MS) {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          if ((await captureGameChallenges(gameId)) > 0) return;
        } catch (err) {
          console.log(`Challenge capture for game ${gameId} failed:`, err);
        }
      }
    } finally {
      capturePending.delete(gameId);
    }
  })();
}

/**
 * The game whose challenge updates the client would still answer for.
 *
 * The live ref covers a match this process watched end. It is null when the app
 * was started after the game rather than before it, which is the ordinary case
 * for anyone who finishes a game and only then opens the tracker, so the
 * gameflow session stands in: it goes on naming the finished game while the
 * end-of-game screen is up, and for a while after.
 */
async function capturableGameId(): Promise<number | null> {
  const live = getLiveGameRef();
  if (live) return live.gameId;
  const session = await lcuJson("/lol-gameflow/v1/session");
  const gameId = Number(session?.gameData?.gameId);
  return Number.isFinite(gameId) && gameId > 0 ? gameId : null;
}

// Snapshots have to accrue whether or not anyone opens the tab: the client is
// the only source for these numbers and it's only there while it's running.
// Leaving a match is also exactly when they move, and that's the transition
// back to "connected", which is the same moment the finished game is still the
// one the client will answer about.
export function startChallengeTracking(window: BrowserWindow) {
  win = window;
  onLcuStatusChange((status) => {
    if (status !== "connected") return;
    void (async () => {
      // Through the broadcast path, so an open tab takes the post-game numbers
      // without being asked to refresh
      await refreshAndBroadcast();
      // A game already captured, or one the client has moved past, costs a
      // single request that answers nothing.
      const gameId = await capturableGameId();
      if (gameId != null) startGameCapture(gameId);
    })();
  });
}
