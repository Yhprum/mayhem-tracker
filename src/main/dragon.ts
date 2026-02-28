import https from "https";

let championCache: Record<number, { name: string; key: string }> = {};
let augmentCache: Record<number, { name: string; desc: string; iconPath: string; rarity: string }> =
  {};

let championReady: Promise<void> | null = null;
let augmentReady: Promise<void> | null = null;

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "MayhemTracker/1.0" } }, (res) => {
        // Follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          fetchJson(res.headers.location).then(resolve).catch(reject);
          return;
        }
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

export function loadChampionData() {
  championReady = (async () => {
    try {
      const versions = await fetchJson("https://ddragon.leagueoflegends.com/api/versions.json");
      const version = versions[0];

      const data = await fetchJson(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`,
      );
      championCache = {};
      for (const [key, champ] of Object.entries(data.data) as any[]) {
        championCache[parseInt(champ.key)] = { name: champ.name, key };
      }
      console.log(
        `Loaded ${Object.keys(championCache).length} champions from Data Dragon v${version}`,
      );
    } catch (err) {
      console.error("Failed to load champion data:", err);
    }
  })();
  return championReady;
}

export function loadAugmentData() {
  augmentReady = (async () => {
    try {
      const data = await fetchJson(
        "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json",
      );
      augmentCache = {};

      // cherry-augments.json is an array of augment objects
      if (Array.isArray(data)) {
        for (const aug of data) {
          augmentCache[aug.id] = {
            name: aug.name || aug.nameTRA || `Augment ${aug.id}`,
            desc: aug.desc || aug.descriptionTRA || "",
            iconPath: aug.augmentSmallIconPath || aug.iconSmall || aug.iconLarge || "",
            rarity: aug.rarity || "",
          };
        }
      } else if (typeof data === "object") {
        // Could be keyed by id
        for (const [id, aug] of Object.entries(data) as any[]) {
          const numId = parseInt(id);
          if (!isNaN(numId)) {
            augmentCache[numId] = {
              name: aug.name || aug.nameTRA || `Augment ${numId}`,
              desc: aug.desc || aug.descriptionTRA || "",
              iconPath: aug.augmentSmallIconPath || aug.iconSmall || aug.iconLarge || "",
              rarity: aug.rarity || "",
            };
          }
        }
      }

      console.log(`Loaded ${Object.keys(augmentCache).length} augments from CommunityDragon`);
    } catch (err) {
      console.error("Failed to load augment data:", err);
    }
  })();
  return augmentReady;
}

export async function waitForChampionData() {
  if (championReady) await championReady;
}

export async function waitForAugmentData() {
  if (augmentReady) await augmentReady;
}

export function getChampionData() {
  return championCache;
}

export function getAugmentDataCache() {
  return augmentCache;
}
