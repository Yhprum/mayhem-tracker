export const CHAMPION_ICON_URL = (id: number): string =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`;

export const PROFILE_ICON_URL = (id: number): string =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${id}.jpg`;

// Converts a CommunityDragon game-data icon path (e.g. from items.json) to a
// raw asset URL on the given branch ("latest", "pbe", or a patch like "16.14")
export const CDRAGON_ASSET_URL = (branch: string, iconPath: string): string =>
  `https://raw.communitydragon.org/${branch}/game/${iconPath
    .replace("/lol-game-data/assets/", "")
    .toLowerCase()}`;

// Rune/perk icon paths (from Data Dragon's runesReforged.json, e.g.
// "perk-images/Styles/Domination/Electrocute/Electrocute.png", or from
// CommunityDragon's perks.json, e.g.
// "/lol-game-data/assets/v1/perk-images/Styles/Domination/Electrocute/Electrocute.png")
// don't map onto CDRAGON_ASSET_URL's "game/<path>" scheme — perk assets live
// under "game/assets/perks/<rest, lowercased>" instead.
export const PERK_ICON_URL = (iconPath: string, branch = "latest"): string => {
  const relative = iconPath
    .replace(/^\/+/, "")
    .replace(/^lol-game-data\/assets\/v1\/perk-images\//i, "")
    .replace(/^perk-images\/+/i, "");
  return `https://raw.communitydragon.org/${branch}/game/assets/perks/${relative.toLowerCase()}`;
};

// Data Dragon's own CDN for rune/perk art. Unlike champion/item images there is
// NO version segment here and it is NOT addressable by perk id
// (".../cdn/{version}/img/perk/{perkId}.png" 403s — that path doesn't exist).
// The only valid path is the un-versioned "icon" field straight from
// runesReforged.json / CommunityDragon's perks.json, e.g.
// "https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Domination/Electrocute/Electrocute.png".
export const DDRAGON_PERK_ICON_URL = (iconPath: string): string => {
  const relative = iconPath
    .replace(/^\/+/, "")
    .replace(/^lol-game-data\/assets\/v1\//i, "");
  return `https://ddragon.leagueoflegends.com/cdn/img/${relative}`;
};

// Community-run mirror of the same un-versioned Data Dragon perk path, used
// when ddragon.leagueoflegends.com itself is unreachable.
export const CANISBACK_PERK_ICON_URL = (iconPath: string): string => {
  const relative = iconPath
    .replace(/^\/+/, "")
    .replace(/^lol-game-data\/assets\/v1\//i, "");
  return `https://ddragon.canisback.com/img/${relative}`;
};

export { QUEUE_ID_MAYHEM, QUEUE_ID_MAYHEM_CLASSIC, QUEUE_LABELS } from "../../shared/queues";
