export const CHAMPION_ICON_URL = (id: number): string =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`;

export const PROFILE_ICON_URL = (id: number): string =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${id}.jpg`;

// The base skin's splash art, cropped to the champion
export const CHAMPION_SPLASH_URL = (id: number): string =>
  `https://cdn.communitydragon.org/latest/champion/${id}/splash-art/centered`;

// The party sizes the Friends page can narrow to, counting us: 2 is a duo, 5
// is a full team. `friends` is how many of the other players are friends.
export const PARTY_SIZES = [
  { size: 2, label: "Duo", friends: 1 },
  { size: 3, label: "Trio", friends: 2 },
  { size: 4, label: "Quad", friends: 3 },
  { size: 5, label: "Team", friends: 4 },
] as const;

export function partyLabel(size: number | undefined): string | null {
  return PARTY_SIZES.find((party) => party.size === size)?.label ?? null;
}

export { cdragonAssetUrl as CDRAGON_ASSET_URL } from "../../shared/cdragon";
export { QUEUE_ID_MAYHEM, QUEUE_ID_MAYHEM_CLASSIC, QUEUE_LABELS } from "../../shared/queues";
