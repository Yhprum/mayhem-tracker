import type { MatchParticipantRecord, ParsedParticipant } from "./types";

// The main process sends participants already unpicked from the match payload,
// so all that's left is marking which rows are ours.
export function parseParticipants(
  participants: MatchParticipantRecord[] | undefined,
  selfPuuids: string[] | null,
): ParsedParticipant[] {
  if (!participants) return [];

  return participants.map((p) => ({
    ...p,
    summonerName: p.gameName || `Player ${p.participantId}`,
    isSelf: selfPuuids != null && p.puuid != null && selfPuuids.includes(p.puuid),
  }));
}

export function groupByTeam(participants: ParsedParticipant[]): Map<number, ParsedParticipant[]> {
  const teams = new Map<number, ParsedParticipant[]>();
  for (const p of participants) {
    if (!teams.has(p.teamId)) teams.set(p.teamId, []);
    teams.get(p.teamId)!.push(p);
  }
  return teams;
}
