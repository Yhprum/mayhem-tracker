import https from "https";
import type { BrowserWindow } from "electron";
import * as db from "./db";
import { getChampionData, loadSummonerSpellData } from "./dragon";
import { sendToRenderer } from "./ipc";
import { getLiveGameRef, lcuJson, onLcuStatusChange } from "./lcu";
import { mapNameForSkin } from "../shared/maps";
import type { LcuStatus, LiveEvent, LiveGameSnapshot, LivePlayer } from "../shared/api";

// --- The in-game API ------------------------------------------------------
//
// A running match serves its own read-only API on 127.0.0.1:2999. It is not the
// LCU: "League of Legends.exe" serves it, it needs no auth, and it exists only
// while a game is actually running. The certificate is Riot's own self-signed
// one, which is why this can't go through fetch without turning verification
// off.
//
// It carries champion, level, items, K/D/A and a kill feed for all ten players.
// It carries no damage, healing or augment numbers for anyone, including the
// local player, so those are missing from the live view by necessity and only
// arrive with the post-game capture.

const LIVE_PORT = 2999;
const LIVE_TIMEOUT_MS = 4_000;

function liveRequest<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port: LIVE_PORT,
        path,
        method: "GET",
        rejectUnauthorized: false,
        timeout: LIVE_TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`In-game API returned ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("In-game API request timed out")));
    req.on("error", reject);
    req.end();
  });
}

// --- Champion and spell resolution ----------------------------------------
//
// The in-game API names champions instead of numbering them. rawChampionName is
// the one to parse: it carries the internal name
// ("game_character_displayname_MonkeyKing"), which is exactly Data Dragon's
// key, where championName is localized and would stop matching under any other
// client language.

let championLookup: { source: unknown; byKey: Map<string, number> } | null = null;

function championIdLookup(): Map<string, number> {
  const champions = getChampionData();
  if (championLookup?.source === champions) return championLookup.byKey;

  const byKey = new Map<string, number>();
  for (const [id, champion] of Object.entries(champions)) {
    byKey.set(champion.key.toLowerCase(), Number(id));
    // Display names are the fallback for a player whose raw name is missing
    byKey.set(champion.name.toLowerCase(), Number(id));
  }
  championLookup = { source: champions, byKey };
  return byKey;
}

function resolveChampionId(rawName: unknown, displayName: unknown): number {
  const lookup = championIdLookup();
  const raw = String(rawName ?? "").replace(/^game_character_displayname_/, "");
  return lookup.get(raw.toLowerCase()) ?? lookup.get(String(displayName ?? "").toLowerCase()) ?? 0;
}

// Spells arrive as display names only, so they have to be matched back to ids
// before the renderer can draw the same icons it draws everywhere else.
let spellIdsByName: Map<string, number> | null = null;

function loadSpellIds(): void {
  loadSummonerSpellData()
    .then((spells) => {
      const byName = new Map<string, number>();
      for (const [id, spell] of Object.entries(spells)) {
        if (spell.name) byName.set(spell.name.toLowerCase(), Number(id));
      }
      spellIdsByName = byName;
    })
    .catch(() => {
      // Spell icons are cosmetic here, so a failed load just leaves them blank
    });
}

function resolveSpellId(displayName: unknown): number | null {
  const name = String(displayName ?? "").toLowerCase();
  if (!name || !spellIdsByName) return null;
  return spellIdsByName.get(name) ?? null;
}

// --- Roster ---------------------------------------------------------------

// What the LCU knows about one player in the current game. The in-game API
// never reports a puuid, so this is the only route to one, and a puuid is what
// keeps a player's record findable across a riot id change.
interface LcuRosterEntry {
  puuid: string | null;
  championId: number;
  spell1Id: number | null;
  spell2Id: number | null;
}

function rosterNameKeys(player: any): string[] {
  const keys: string[] = [];
  const push = (value: unknown) => {
    const text = String(value ?? "")
      .trim()
      .toLowerCase();
    if (text) keys.push(text);
  };
  push(player?.riotId);
  const name = player?.gameName ?? player?.riotIdGameName;
  if (name) {
    const tag = player?.tagLine ?? player?.riotIdTagLine;
    push(tag ? `${name}#${tag}` : name);
    push(name);
  }
  push(player?.summonerName);
  push(player?.summonerInternalName);
  return keys;
}

// Every identifier the LCU offers for a player, pointed at what it knows about
// them, so the in-game API's riot id finds them under whichever spelling the
// client happens to publish. The two sources share no id field, so the join is
// by name and has to tolerate either side dropping half of one.
function buildLcuRoster(session: any): Map<string, LcuRosterEntry> {
  const roster = new Map<string, LcuRosterEntry>();
  const add = (player: any, championId: number) => {
    const entry: LcuRosterEntry = {
      puuid: typeof player?.puuid === "string" && player.puuid ? player.puuid : null,
      championId,
      spell1Id: Number(player?.spell1Id) || null,
      spell2Id: Number(player?.spell2Id) || null,
    };
    for (const key of rosterNameKeys(player)) {
      // The team rows and the champion-select rows describe the same players
      // from different angles, so merge rather than letting whichever came
      // last overwrite a field with nothing.
      const existing = roster.get(key);
      roster.set(
        key,
        existing
          ? {
              puuid: existing.puuid ?? entry.puuid,
              championId: existing.championId || entry.championId,
              spell1Id: existing.spell1Id ?? entry.spell1Id,
              spell2Id: existing.spell2Id ?? entry.spell2Id,
            }
          : entry,
      );
    }
  };

  const gameData = session?.gameData ?? {};
  for (const player of [...(gameData.teamOne ?? []), ...(gameData.teamTwo ?? [])]) {
    add(player, Number(player?.championId) || 0);
  }
  for (const selection of gameData.playerChampionSelections ?? []) {
    add(selection, Number(selection?.championId) || 0);
  }
  return roster;
}

function lookupRoster(roster: Map<string, LcuRosterEntry>, player: any): LcuRosterEntry | null {
  for (const key of rosterNameKeys(player)) {
    const entry = roster.get(key);
    if (entry) return entry;
  }
  return null;
}

// --- Events ---------------------------------------------------------------

// The kill feed is the one thing here that reads better as champions than as
// riot ids, and the feed names players either way depending on the event.
const MULTIKILL_NAMES = ["", "", "Double Kill", "Triple Kill", "Quadra Kill", "PENTAKILL"];

function eventActor(name: unknown, byName: Map<string, LivePlayer>): string {
  const raw = String(name ?? "");
  const player = byName.get(raw.toLowerCase());
  if (player) return player.championName || player.name;
  // Structures arrive as their object ids, e.g. "Turret_T1_C_05_A"
  if (/^Turret_/i.test(raw)) return "a turret";
  if (/^Barracks_/i.test(raw)) return "an inhibitor";
  if (/^Minion_/i.test(raw)) return "a minion";
  return raw.split("#")[0] || "someone";
}

function describeEvent(event: any, byName: Map<string, LivePlayer>): LiveEvent | null {
  const rawId = Number(event?.EventID);
  const time = Number(event?.EventTime) || 0;
  const id = Number.isFinite(rawId) ? rawId : time;

  switch (String(event?.EventName)) {
    case "FirstBlood":
      return {
        id,
        time,
        tone: "special",
        text: `First blood: ${eventActor(event.Recorder, byName)}`,
      };
    case "ChampionKill": {
      const killer = eventActor(event.KillerName, byName);
      const victim = eventActor(event.VictimName, byName);
      const assists = Array.isArray(event.Assisters) ? event.Assisters.length : 0;
      return {
        id,
        time,
        tone: "kill",
        text: `${killer} killed ${victim}${assists > 0 ? ` (+${assists})` : ""}`,
      };
    }
    case "Multikill": {
      const streak = Number(event.KillStreak) || 0;
      const label = MULTIKILL_NAMES[streak] || `${streak} kills`;
      return {
        id,
        time,
        tone: "special",
        text: `${eventActor(event.KillerName, byName)}: ${label}`,
      };
    }
    case "Ace":
      return { id, time, tone: "special", text: `Ace by ${eventActor(event.Acer, byName)}` };
    case "FirstBrick":
      return {
        id,
        time,
        tone: "objective",
        text: `First tower: ${eventActor(event.KillerName, byName)}`,
      };
    case "TurretKilled":
      return {
        id,
        time,
        tone: "objective",
        text: `${eventActor(event.KillerName, byName)} destroyed a turret`,
      };
    case "InhibKilled":
      return {
        id,
        time,
        tone: "objective",
        text: `${eventActor(event.KillerName, byName)} destroyed an inhibitor`,
      };
    default:
      // GameStart, MinionsSpawning, InhibRespawned, and anything Riot adds
      return null;
  }
}

// How much of the feed to keep: long enough to catch up after looking away for
// a fight, short enough that it never becomes the page.
const MAX_EVENTS = 40;

// --- Snapshots ------------------------------------------------------------

function emptySnapshot(): LiveGameSnapshot {
  // The game id outlives the match it belongs to, which is what lets the page
  // switch itself over to that game's recap the moment the match ends.
  const ref = getLiveGameRef();
  return {
    inGame: false,
    starting: false,
    gameId: ref?.gameId ?? null,
    queueId: ref?.queueId ?? null,
    mapId: null,
    mapName: null,
    mapSkin: null,
    gameTime: 0,
    players: [],
    events: [],
  };
}

// Records don't change mid-game, so they're looked up once per roster rather
// than on every three-second poll.
let recordCache: { signature: string; histories: Record<string, db.PlayerHistory> } | null = null;

function playerHistories(gameId: number | null, players: LivePlayer[]) {
  const signature = `${gameId}:${players.map((p) => `${p.key}@${p.championId}`).join("|")}`;
  if (recordCache?.signature === signature) return recordCache.histories;

  const histories = db.getPlayerHistories(
    players.map((p) => ({
      key: p.key,
      puuid: p.puuid,
      gameName: p.name,
      tagLine: p.tagLine,
      championId: p.championId,
    })),
  );
  recordCache = { signature, histories };
  return histories;
}

// Which map was rolled is only knowable while the game is running, so it gets
// written down the first time we see it and read back by the recap afterwards.
let storedMapFor: number | null = null;

async function buildSnapshot(): Promise<LiveGameSnapshot> {
  const snapshot = emptySnapshot();

  const session = await lcuJson("/lol-gameflow/v1/session");
  const gameData = session?.gameData;
  if (gameData) {
    snapshot.gameId = Number(gameData.gameId) || snapshot.gameId;
    snapshot.queueId = Number(gameData.queue?.id) || snapshot.queueId;
    snapshot.mapId = Number(session.map?.id) || null;
  }

  let data: any = null;
  try {
    data = await liveRequest<any>("/liveclientdata/allgamedata");
  } catch {
    // The game's own API only exists while a match is running, and comes up a
    // few seconds after the client says the match has started
  }

  const allPlayers = Array.isArray(data?.allPlayers) ? data.allPlayers : [];
  if (allPlayers.length === 0) {
    // Champion select is over and the loading screen is up: the client knows
    // there is a game, the game itself is not answering yet.
    snapshot.starting = session?.phase === "InProgress" || session?.phase === "GameStart";
    return snapshot;
  }

  snapshot.inGame = true;
  snapshot.gameTime = Math.floor(Number(data?.gameData?.gameTime) || 0);
  snapshot.mapSkin = data?.gameData?.mapTerrain ?? null;
  snapshot.mapName = mapNameForSkin(snapshot.mapSkin);
  snapshot.mapId = Number(data?.gameData?.mapNumber) || snapshot.mapId;

  const roster = buildLcuRoster(session);
  const activeName = String(
    data?.activePlayer?.riotId ?? data?.activePlayer?.summonerName ?? "",
  ).toLowerCase();

  snapshot.players = allPlayers.map((player: any): LivePlayer => {
    const entry = lookupRoster(roster, player);
    const name = String(player.riotIdGameName || player.summonerName || "").trim();
    const tagLine = String(player.riotIdTagLine || "").trim() || null;
    const riotId = String(player.riotId || "").trim();
    const items: number[] = new Array(7).fill(0);
    for (const item of player.items ?? []) {
      const slot = Number(item?.slot);
      if (slot >= 0 && slot < items.length) items[slot] = Number(item?.itemID) || 0;
    }

    return {
      key: entry?.puuid || riotId || name,
      name: name || riotId || "Unknown",
      tagLine,
      puuid: entry?.puuid ?? null,
      championId:
        entry?.championId || resolveChampionId(player.rawChampionName, player.championName),
      championName: String(player.championName || ""),
      teamId: player.team === "CHAOS" ? 200 : 100,
      isSelf:
        activeName !== "" &&
        (riotId.toLowerCase() === activeName || name.toLowerCase() === activeName),
      isBot: player.isBot === true,
      level: Number(player.level) || 0,
      kills: Number(player.scores?.kills) || 0,
      deaths: Number(player.scores?.deaths) || 0,
      assists: Number(player.scores?.assists) || 0,
      creepScore: Number(player.scores?.creepScore) || 0,
      items,
      isDead: player.isDead === true,
      respawnTimer: Math.ceil(Number(player.respawnTimer) || 0),
      spell1Id:
        entry?.spell1Id ?? resolveSpellId(player.summonerSpells?.summonerSpellOne?.displayName),
      spell2Id:
        entry?.spell2Id ?? resolveSpellId(player.summonerSpells?.summonerSpellTwo?.displayName),
      championRecord: null,
      overallRecord: null,
      gamesWithUs: 0,
      friendKey: null,
    };
  });

  const histories = playerHistories(snapshot.gameId, snapshot.players);
  for (const player of snapshot.players) {
    const history = histories[player.key];
    if (!history) continue;
    player.championRecord = history.champion;
    player.overallRecord = history.overall;
    player.gamesWithUs = history.withUs;
    player.friendKey = history.friendKey;
  }

  const byName = new Map<string, LivePlayer>();
  for (const player of snapshot.players) {
    byName.set(player.name.toLowerCase(), player);
    if (player.tagLine) byName.set(`${player.name}#${player.tagLine}`.toLowerCase(), player);
  }
  const events: LiveEvent[] = [];
  for (const event of data?.events?.Events ?? []) {
    const described = describeEvent(event, byName);
    if (described) events.push(described);
  }
  snapshot.events = events.slice(-MAX_EVENTS);

  if (snapshot.gameId && snapshot.mapSkin && storedMapFor !== snapshot.gameId) {
    db.setGameMap(snapshot.gameId, snapshot.mapId, snapshot.mapSkin);
    storedMapFor = snapshot.gameId;
  }

  return snapshot;
}

// --- Polling --------------------------------------------------------------

// Fast enough that items and kills land while they still feel live, against a
// local server that answers in a millisecond.
const LIVE_POLL_INTERVAL_MS = 3_000;

let win: BrowserWindow | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let refreshing = false;
let latest: LiveGameSnapshot = emptySnapshot();

function publish(snapshot: LiveGameSnapshot) {
  latest = snapshot;
  sendToRenderer(win, "live:changed", snapshot);
}

// One refresh at a time: a poll tick overlapping the one before it would ask
// the same two services the same question twice and publish them out of order.
export async function refreshLiveGame(): Promise<LiveGameSnapshot> {
  if (refreshing) return latest;
  refreshing = true;
  try {
    const snapshot = await buildSnapshot();
    publish(snapshot);
    return snapshot;
  } catch (err) {
    console.log("Live game refresh failed:", err);
    // An empty snapshot rather than stale players: "not in a game" is what the
    // page reads to decide it is time to show the recap instead.
    publish(emptySnapshot());
    return latest;
  } finally {
    refreshing = false;
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void refreshLiveGame();
  }, LIVE_POLL_INTERVAL_MS);
  void refreshLiveGame();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  recordCache = null;
  // One last refresh, so the page learns the match is over instead of sitting
  // on the final in-game frame until something else touches it
  void refreshLiveGame();
}

export function getLiveGame(): LiveGameSnapshot {
  return latest;
}

// Tracking follows the client's own phase, so polling runs for exactly as long
// as a match does and the map is captured whether or not anyone has the tab
// open. Everything else here happens on demand.
export function startLiveTracking(window: BrowserWindow) {
  win = window;
  loadSpellIds();
  onLcuStatusChange((status: LcuStatus) => {
    if (status === "ingame") startPolling();
    else if (pollTimer) stopPolling();
  });
}

export function stopLiveTracking() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  win = null;
}
