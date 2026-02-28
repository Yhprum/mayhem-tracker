import type { ParsedParticipant } from "./types";

export function parseParticipants(raw: any, selfPuuid: string | null): ParsedParticipant[] {
  if (!raw?.participants) return [];

  const participants = raw.participants || [];
  const identities = raw.participantIdentities || [];

  return participants.map((p: any, i: number) => {
    const s = p.stats || p;
    const identity = identities[i];
    const puuid = p.puuid || identity?.player?.puuid || null;
    const name =
      identity?.player?.gameName ||
      identity?.player?.summonerName ||
      p.summonerName ||
      `Player ${i + 1}`;

    return {
      participantId: p.participantId ?? i + 1,
      championId: p.championId ?? s.championId ?? 0,
      teamId: p.teamId ?? 100,
      puuid,
      summonerName: name,
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
      largestKillingSpree: s.largestKillingSpree ?? 0,
      items: [
        s.item0 ?? 0,
        s.item1 ?? 0,
        s.item2 ?? 0,
        s.item3 ?? 0,
        s.item4 ?? 0,
        s.item5 ?? 0,
        s.item6 ?? 0,
      ],
      augments: [1, 2, 3, 4].map((n) => s[`playerAugment${n}`] ?? 0).filter((id: number) => id > 0),
      win: !!s.win,
      isSelf: selfPuuid != null && puuid === selfPuuid,
    };
  });
}

export function groupByTeam(participants: ParsedParticipant[]): Map<number, ParsedParticipant[]> {
  const teams = new Map<number, ParsedParticipant[]>();
  for (const p of participants) {
    if (!teams.has(p.teamId)) teams.set(p.teamId, []);
    teams.get(p.teamId)!.push(p);
  }
  return teams;
}
