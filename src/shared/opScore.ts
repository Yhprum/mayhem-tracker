// Shared between the main process (insert-time scoring + migration backfill)
// and the renderer (full-scoreboard scoring). Bump SCORE_FORMULA_VERSION when
// the formula changes — stored scores are recomputed from raw_json on startup.
export const SCORE_FORMULA_VERSION = 1;

export type ScoreBadge = "MVP" | "ACE" | null;

export interface PlayerScore {
  score: number;
  badge: ScoreBadge;
}

export interface ScoreInput {
  participantId: number;
  teamId: number;
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

// Calibrated against real ARAM Mayhem lobbies (3.3k player-games): the 1.3
// exponent spreads the mid-range so the lobby median lands near 6, ~4% of
// player-games reach 9+, and perfect 10s are ~0.5%. Component weights sum to
// 11.0 and SCALE stretches the top end, so a 10 doesn't require maxing every
// single category — a dominant carry game gets there.
const CURVE = 1.3;
const SCALE = 1.05;

function rawScore(
  p: ScoreInput,
  teamKills: number,
  max: { dmg: number; taken: number; heal: number; gold: number },
): number {
  const kda = (p.kills + p.assists) / Math.max(p.deaths, 1);
  const kp = teamKills > 0 ? (p.kills + p.assists) / teamKills : 0;

  let score = 0;
  score += 2.2 * clamp01(kda / 8) ** CURVE;
  score += 2.2 * clamp01(kp / 0.9) ** CURVE;
  score += 2.6 * clamp01(p.totalDamageDealtToChampions / max.dmg) ** CURVE;
  score += 1.1 * clamp01(p.totalDamageTaken / max.taken) ** CURVE;
  score += 0.6 * clamp01(p.totalHeal / max.heal) ** CURVE;
  score += 1.1 * clamp01(p.goldEarned / max.gold) ** CURVE;

  if (p.pentaKills > 0) score += 0.6;
  else if (p.quadraKills > 0) score += 0.45;
  else if (p.tripleKills > 0) score += 0.3;
  else if (p.doubleKills > 0) score += 0.15;

  if (p.win) score += 0.6;

  return score * SCALE;
}

export function computeMatchScores(participants: ScoreInput[]): Map<number, PlayerScore> {
  const scores = new Map<number, PlayerScore>();
  if (participants.length === 0) return scores;

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
    const raw = rawScore(p, teamKills.get(p.teamId) ?? 0, max);
    const score = Math.min(10, Math.max(1, Math.round(raw * 10) / 10));
    scores.set(p.participantId, { score, badge: null });
  }

  // Best player on the winning team gets MVP, best on the losing team gets ACE
  const bestByTeam = new Map<number, ScoreInput>();
  for (const p of participants) {
    const best = bestByTeam.get(p.teamId);
    if (!best || scores.get(p.participantId)!.score > scores.get(best.participantId)!.score) {
      bestByTeam.set(p.teamId, p);
    }
  }
  for (const p of bestByTeam.values()) {
    scores.get(p.participantId)!.badge = p.win ? "MVP" : "ACE";
  }

  return scores;
}

// Build score inputs straight from a stored raw game JSON (LCU shape, both
// old nested-stats and new flat variants).
export function scoreInputsFromRaw(
  raw: any,
): (ScoreInput & { puuid: string | null; championId: number })[] {
  if (!raw?.participants) return [];
  const identities = raw.participantIdentities || [];
  return raw.participants.map((p: any, i: number) => {
    const s = p.stats || p;
    return {
      participantId: p.participantId ?? i + 1,
      teamId: p.teamId ?? 100,
      puuid: p.puuid || identities[i]?.player?.puuid || null,
      championId: p.championId ?? s.championId ?? 0,
      kills: s.kills ?? 0,
      deaths: s.deaths ?? 0,
      assists: s.assists ?? 0,
      doubleKills: s.doubleKills ?? 0,
      tripleKills: s.tripleKills ?? 0,
      quadraKills: s.quadraKills ?? 0,
      pentaKills: s.pentaKills ?? 0,
      totalDamageDealtToChampions: s.totalDamageDealtToChampions ?? s.totalDamageDealt ?? 0,
      totalDamageTaken: s.totalDamageTaken ?? 0,
      goldEarned: s.goldEarned ?? 0,
      totalHeal: s.totalHeal ?? 0,
      win: !!s.win,
    };
  });
}

export function scoreColor(score: number): string {
  if (score >= 9) return "text-amber-400";
  if (score >= 7) return "text-sky-400";
  if (score >= 5) return "text-emerald-400";
  return "text-slate-400";
}
