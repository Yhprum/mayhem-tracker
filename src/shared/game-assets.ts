// League art reaches the renderer through the main process, under this scheme,
// rather than straight from CommunityDragon: the main process keeps a copy of
// everything it serves and falls back to the running client, so art that has
// loaded once keeps loading when CommunityDragon doesn't answer. Both processes
// build these URLs: the renderer for every icon it draws, the main process when
// it goes looking for art a retired augment left behind.
export const ASSET_SCHEME = "asset";

// A patch branch ("16.14") is an archive and never changes. "latest" and "pbe"
// move with Riot's releases under the same name.
export function isPatchBranch(branch: string): boolean {
  return /^\d+\.\d+$/.test(branch);
}

/**
 * A game-data path (as items.json and cherry-augments.json name an icon) reduced
 * to the part every source agrees on: what follows /lol-game-data/assets/ in the
 * client's own URLs. Lowercased, because CommunityDragon's exports are and the
 * client matches paths without regard to case.
 */
export function gameDataPath(iconPath: string): string {
  return iconPath.replace(/^\/lol-game-data\/assets\//i, "").toLowerCase();
}

// The file at a game-data path as of a branch: "latest", "pbe", or a patch
// like "16.14". Paths move between patches, so a path is only good on the
// branch it was read from.
export function gameAssetUrl(branch: string, iconPath: string): string {
  const encoded = gameDataPath(iconPath).split("/").map(encodeURIComponent).join("/");
  return `${ASSET_SCHEME}://game-data/${branch}/${encoded}`;
}

export const championIconUrl = (id: number): string =>
  gameAssetUrl("latest", `v1/champion-icons/${id}.png`);

export const profileIconUrl = (id: number): string =>
  gameAssetUrl("latest", `v1/profile-icons/${id}.jpg`);

// The base skin's splash art, cropped to the champion. Its own host, because
// where that art lives differs from champion to champion, and resolving it is
// the main process's job.
export const championSplashUrl = (id: number): string => `${ASSET_SCHEME}://splash/${id}`;
