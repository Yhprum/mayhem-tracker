export const CHAMPION_ICON_URL = (id: number): string =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`;

export const PROFILE_ICON_URL = (id: number): string =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${id}.jpg`;

// The base skin's splash art, cropped to the champion
export const CHAMPION_SPLASH_URL = (id: number): string =>
  `https://cdn.communitydragon.org/latest/champion/${id}/splash-art/centered`;

export { cdragonAssetUrl as CDRAGON_ASSET_URL } from "../../shared/cdragon";
export { QUEUE_ID_MAYHEM, QUEUE_ID_MAYHEM_CLASSIC, QUEUE_LABELS } from "../../shared/queues";
