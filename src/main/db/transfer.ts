import fs from "fs";
import { db } from "./connection";
import { insertGameFull } from "./ingest";
import { unpackRaw } from "./payloads";
import { upsertSummoner } from "./summoner";

// Games are read a page at a time and written straight to disk, rather than
// building the whole backup in memory. Two reasons: a library of a few thousand
// games is a hundred megabytes-plus of JSON to hold twice over, and every await
// here returns the main process to the event loop, so the window keeps painting
// while the export runs.
const EXPORT_PAGE_SIZE = 200;

export async function writeExportTo(filePath: string): Promise<number> {
  const out = fs.createWriteStream(filePath, { encoding: "utf8" });
  const write = (chunk: string) =>
    new Promise<void>((resolve, reject) => {
      out.write(chunk, (err) => (err ? reject(err) : resolve()));
    });

  let count = 0;
  try {
    const summoners = db.prepare("SELECT * FROM summoner").all();
    await write(`{"version":3,"summoners":${JSON.stringify(summoners)},"games":[`);

    // Keyset paging, not LIMIT/OFFSET: each query completes before the next
    // await, so no statement is left open across one — a statement still
    // running when a poll tries to insert a game would fail as busy. Paging by
    // last id also stays correct if rows arrive mid-export.
    const page = db.prepare(`
      SELECT game_id, raw_gz, puuid
      FROM games
      WHERE raw_gz IS NOT NULL AND game_id > ?
      ORDER BY game_id
      LIMIT ?
    `);

    let lastId = 0;
    for (;;) {
      const rows = page.all(lastId, EXPORT_PAGE_SIZE) as {
        game_id: number;
        raw_gz: Buffer;
        puuid: string;
      }[];
      if (rows.length === 0) break;

      let chunk = "";
      for (const row of rows) {
        // A backup stays the untouched payloads, so an import into any version
        // rebuilds whatever that version derives from them.
        const game = unpackRaw(row.raw_gz);
        if (!game) continue;
        game._ownerPuuid = row.puuid;
        chunk += (count === 0 ? "" : ",") + JSON.stringify(game);
        count++;
      }
      lastId = rows[rows.length - 1].game_id;
      await write(chunk);
    }

    await write("]}");
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.on("error", reject);
      out.end(() => resolve());
    });
  }
  return count;
}

// The accounts a backup file names, before any of its games go in
export function importSummoners(summoners: any[]): void {
  db.transaction(() => {
    for (const summoner of summoners) upsertSummoner(summoner);
  })();
}

// One batch of a backup file's games, in a single transaction, returning how
// many were new. Reading the file and deciding each game's owner is
// importBackupFile's business.
export function importGames(games: { game: any; owner: string }[]): number {
  let imported = 0;
  db.transaction(() => {
    for (const { game, owner } of games) {
      if (insertGameFull(game, owner)) imported++;
    }
  })();
  return imported;
}
