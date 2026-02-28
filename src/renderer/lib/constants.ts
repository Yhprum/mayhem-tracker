export const DDRAGON_VERSION = "14.24.1";

export const CHAMPION_ICON_URL = (id: number): string =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`;

export const AUGMENT_ICON_BASE = "https://raw.communitydragon.org/latest/game/";

// export const ITEM_ICON_URL = (itemId: number): string =>
//   `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/item/${itemId}.png`

export const ITEM_ICON_URL = (itemId: number): string =>
  `https://www.league-of-data-base.com/upload/16.4.1/item_img/${itemId}.png`;

export const QUEUE_ID_MAYHEM = 2400;
