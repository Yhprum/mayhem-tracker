// Shared between the main process (insert-time scoring + migration backfill)
// and the renderer (full-scoreboard scoring). Bump SCORE_FORMULA_VERSION when
// the formula changes — stored scores are recomputed from match_participants on
// startup (the backfill key also includes the champion data version, so class
// changes trigger a recompute too).
export const SCORE_FORMULA_VERSION = 2;

// championId → Data Dragon class tag ("Assassin" | "Fighter" | "Mage" |
// "Marksman" | "Support" | "Tank"). Supplied by the caller from live champion
// data; champions missing from the map score with DEFAULT_WEIGHTS.
export type ChampionClassMap = Record<number, string | undefined>;

export type ScoreBadge = "MVP" | "ACE" | null;

export interface PlayerScore {
  score: number;
  badge: ScoreBadge;
}

export interface ScoreInput {
  participantId: number;
  teamId: number;
  championId: number;
  kills: number;
  deaths: number;
  assists: number;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentaKills: number;
  totalDamageDealtToChampions: number;
  totalDamageTaken: number;
  goldEarned: number;
  totalHeal: number;
  win: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Calibrated against real ARAM Mayhem lobbies (v3: rechecked on all stored
// raw-json games): the 1.3 exponent spreads the mid-range so the lobby median
// lands near 6, ~5% of player-games reach 9+, and perfect 10s are ~0.6%.
// Component weights sum to 11.0 (9.8 class components + multikill + win) and
// SCALE stretches the top end, so a 10 doesn't require maxing every single
// category — a dominant low-death carry game gets there.
const CURVE = 1.3;
const SCALE = 1.04;

// Per-class component weights so champions are graded on their job: tanks on
// soaking damage, supports on healing and participation, assassins/mages/
// marksmen on damage output. Every row sums to 9.8 (matching DEFAULT_WEIGHTS)
// so the score distribution stays comparable across classes — per-class
// medians land within 5.6-6.2 on the calibration sample.
interface ClassWeights {
  kda: number;
  kp: number;
  dmg: number;
  taken: number;
  heal: number;
  gold: number;
}

const DEFAULT_WEIGHTS: ClassWeights = {
  kda: 2.2,
  kp: 2.2,
  dmg: 2.6,
  taken: 1.1,
  heal: 0.6,
  gold: 1.1,
};

const CLASS_WEIGHTS: Record<string, ClassWeights> = {
  Assassin: { kda: 2.6, kp: 2.4, dmg: 2.8, taken: 0.5, heal: 0.2, gold: 1.3 },
  Marksman: { kda: 2.2, kp: 2.2, dmg: 2.8, taken: 0.7, heal: 0.5, gold: 1.4 },
  Mage: { kda: 2.2, kp: 2.3, dmg: 2.8, taken: 0.7, heal: 0.4, gold: 1.4 },
  Fighter: { kda: 2.2, kp: 2.2, dmg: 2.4, taken: 1.4, heal: 0.5, gold: 1.1 },
  Tank: { kda: 2.0, kp: 2.5, dmg: 2.1, taken: 2.2, heal: 0.3, gold: 0.7 },
  Support: { kda: 2.2, kp: 2.7, dmg: 1.7, taken: 0.8, heal: 1.8, gold: 0.6 },
};

export type ScoreComponentKey = "kda" | "kp" | "dmg" | "taken" | "heal" | "gold";

// One weighted term of the score. `points` and `weight` are post-SCALE, so
// across a breakdown they sum to `raw` (with the bonuses) and read as
// "earned X of a possible Y".
export interface ScoreComponent {
  key: ScoreComponentKey;
  // The player's stat: KDA ratio for "kda", kill-participation fraction for
  // "kp", raw totals for the rest.
  value: number;
  // The value that earns full credit: fixed caps for kda/kp, lobby max for
  // the rest.
  reference: number;
  ratio: number;
  weight: number;
  points: number;
}

export interface ScoreBreakdown {
  // Class whose weights were used; null means DEFAULT_WEIGHTS.
  cls: string | null;
  components: ScoreComponent[];
  multikill: { label: string; points: number } | null;
  // Win bonus points (0 on a loss).
  win: number;
  // Scaled sum before the 1-10 clamp and 0.1 rounding.
  raw: number;
  score: number;
  badge: ScoreBadge;
}

function buildBreakdown(
  p: ScoreInput,
  teamKills: number,
  max: { dmg: number; taken: number; heal: number; gold: number },
  classes: ChampionClassMap | undefined,
): ScoreBreakdown {
  const kda = (p.kills + p.assists) / Math.max(p.deaths, 1);
  const kp = teamKills > 0 ? (p.kills + p.assists) / teamKills : 0;

  const cls = classes?.[p.championId];
  const w = (cls && CLASS_WEIGHTS[cls]) || DEFAULT_WEIGHTS;

  // Sum unscaled and scale once at the end — same float ordering as when the
  // formula only produced a total, so stored scores don't shift by an ulp at
  // a rounding boundary.
  let sum = 0;
  const components: ScoreComponent[] = [];
  const component = (key: ScoreComponentKey, value: number, reference: number, weight: number) => {
    const ratio = clamp01(value / reference);
    const unscaled = weight * ratio ** CURVE;
    sum += unscaled;
    components.push({
      key,
      value,
      reference,
      ratio,
      weight: weight * SCALE,
      points: unscaled * SCALE,
    });
  };

  component("kda", kda, 8, w.kda);
  component("kp", kp, 0.9, w.kp);
  component("dmg", p.totalDamageDealtToChampions, max.dmg, w.dmg);
  component("taken", p.totalDamageTaken, max.taken, w.taken);
  component("heal", p.totalHeal, max.heal, w.heal);
  component("gold", p.goldEarned, max.gold, w.gold);

  let multikill: ScoreBreakdown["multikill"] = null;
  if (p.pentaKills > 0) multikill = { label: "Penta kill", points: 0.6 * SCALE };
  else if (p.quadraKills > 0) multikill = { label: "Quadra kill", points: 0.45 * SCALE };
  else if (p.tripleKills > 0) multikill = { label: "Triple kill", points: 0.3 * SCALE };
  else if (p.doubleKills > 0) multikill = { label: "Double kill", points: 0.15 * SCALE };

  if (p.pentaKills > 0) sum += 0.6;
  else if (p.quadraKills > 0) sum += 0.45;
  else if (p.tripleKills > 0) sum += 0.3;
  else if (p.doubleKills > 0) sum += 0.15;
  if (p.win) sum += 0.6;

  const raw = sum * SCALE;
  return {
    cls: cls && CLASS_WEIGHTS[cls] ? cls : null,
    components,
    multikill,
    win: p.win ? 0.6 * SCALE : 0,
    raw,
    score: Math.min(10, Math.max(1, Math.round(raw * 10) / 10)),
    badge: null,
  };
}

export function computeMatchScoreBreakdowns(
  participants: ScoreInput[],
  classes?: ChampionClassMap,
): Map<number, ScoreBreakdown> {
  const breakdowns = new Map<number, ScoreBreakdown>();
  if (participants.length === 0) return breakdowns;

  const max = { dmg: 1, taken: 1, heal: 1, gold: 1 };
  const teamKills = new Map<number, number>();
  for (const p of participants) {
    max.dmg = Math.max(max.dmg, p.totalDamageDealtToChampions);
    max.taken = Math.max(max.taken, p.totalDamageTaken);
    max.heal = Math.max(max.heal, p.totalHeal);
    max.gold = Math.max(max.gold, p.goldEarned);
    teamKills.set(p.teamId, (teamKills.get(p.teamId) ?? 0) + p.kills);
  }

  for (const p of participants) {
    breakdowns.set(p.participantId, buildBreakdown(p, teamKills.get(p.teamId) ?? 0, max, classes));
  }

  // Best player on the winning team gets MVP, best on the losing team gets ACE
  const bestByTeam = new Map<number, ScoreInput>();
  for (const p of participants) {
    const best = bestByTeam.get(p.teamId);
    if (
      !best ||
      breakdowns.get(p.participantId)!.score > breakdowns.get(best.participantId)!.score
    ) {
      bestByTeam.set(p.teamId, p);
    }
  }
  for (const p of bestByTeam.values()) {
    breakdowns.get(p.participantId)!.badge = p.win ? "MVP" : "ACE";
  }

  return breakdowns;
}

export function computeMatchScores(
  participants: ScoreInput[],
  classes?: ChampionClassMap,
): Map<number, PlayerScore> {
  const scores = new Map<number, PlayerScore>();
  for (const [id, b] of computeMatchScoreBreakdowns(participants, classes)) {
    scores.set(id, { score: b.score, badge: b.badge });
  }
  return scores;
}

// Build score inputs straight from a stored raw game JSON (LCU shape, both
// old nested-stats and new flat variants).

export function scoreColor(score: number): string {
  if (score >= 9) return "text-amber-400";
  if (score >= 7) return "text-sky-400";
  if (score >= 5) return "text-emerald-400";
  return "text-slate-400";
}
