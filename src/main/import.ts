import fs from "fs";
import type { BrowserWindow } from "electron";
import * as db from "./db";
import { backupQuietly } from "./backup";
import { sendToRenderer } from "./ipc";

// A backup file is one JSON object: a few small values ("version", "summoners")
// and a "games" array holding every stored match, which for a big library runs
// to hundreds of megabytes. It is read the way writeExportTo writes it, a chunk
// at a time, so an import never holds the whole file, never parses it in one
// go, and gives the event loop back between chunks.

// Games per transaction. One commit per game would be most of what an import
// spends its time on; one for the whole file would hold the database for as
// long as the import runs.
const IMPORT_BATCH = 50;

// How many new games to take in before telling the window, so a long import
// fills the app in as it goes, the same way a backfill does
const GAMES_UPDATED_BATCH = 100;

const READ_CHUNK_BYTES = 64 * 1024;

/**
 * Splits a JSON object read a chunk at a time into its top-level values, handing
 * each over as text once it is complete, except the members of the "games"
 * array, which are handed over one game at a time. Only strings, brackets and
 * separators are tracked; each piece it hands over is left to JSON.parse, which
 * is what actually validates it.
 */
class BackupScanner {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private finished = false;
  // What the text being collected is: a member's key or value, one game, or
  // the remainder of the games member after its array has closed
  private reading: "none" | "key" | "value" | "game" | "rest" = "none";
  // Text collected from earlier chunks, joined once the piece is complete
  private pieces: string[] = [];
  private key = "";
  private inGames = false;
  sawGames = false;

  constructor(
    private readonly onValue: (key: string, text: string) => void,
    private readonly onGame: (text: string) => void,
  ) {}

  push(chunk: string): void {
    let from = 0;
    const take = (to: number) => {
      const text = this.pieces.join("") + chunk.slice(from, to);
      this.pieces = [];
      return text;
    };

    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === "\\") this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }

      if (c === '"') {
        this.inString = true;
      } else if (c === "{" || c === "[") {
        if (this.depth === 0) {
          if (c !== "{" || this.finished) throw new SyntaxError("Expected one JSON object");
          this.reading = "key";
          from = i + 1;
        } else if (
          this.depth === 1 &&
          c === "[" &&
          this.reading === "value" &&
          this.key === "games" &&
          take(i).trim() === ""
        ) {
          this.inGames = true;
          this.sawGames = true;
          this.reading = "game";
          from = i + 1;
        }
        this.depth++;
      } else if (c === "}" || c === "]") {
        this.depth--;
        if (this.depth < 0) throw new SyntaxError("Unbalanced brackets");
        if (this.depth === 1 && this.inGames && c === "]") {
          this.emitGame(take(i));
          this.inGames = false;
          this.reading = "rest";
          from = i + 1;
        } else if (this.depth === 0) {
          if (c !== "}") throw new SyntaxError("Unbalanced brackets");
          this.endMember(take(i));
          this.reading = "none";
          this.finished = true;
        }
      } else if (c === "," && this.depth === 1) {
        this.endMember(take(i));
        this.reading = "key";
        from = i + 1;
      } else if (c === "," && this.depth === 2 && this.inGames) {
        this.emitGame(take(i));
        from = i + 1;
      } else if (c === ":" && this.depth === 1 && this.reading === "key") {
        this.key = JSON.parse(take(i).trim());
        this.reading = "value";
        from = i + 1;
      } else if (this.depth === 0 && !/\s/.test(c)) {
        throw new SyntaxError("Unexpected text outside the JSON object");
      }
    }

    if (this.reading !== "none") this.pieces.push(chunk.slice(from));
  }

  finish(): void {
    if (!this.finished || this.inString) throw new SyntaxError("The file ends part way through");
  }

  private endMember(text: string): void {
    const value = text.trim();
    if (this.reading === "value") this.onValue(this.key, value);
    // A key with no value, or anything after the games array but whitespace
    else if (value !== "") throw new SyntaxError(`Unexpected "${value.slice(0, 20)}"`);
  }

  private emitGame(text: string): void {
    const game = text.trim();
    if (game !== "") this.onGame(game);
  }
}

async function scan(
  file: string,
  onValue: (key: string, text: string) => void,
  onGame: (text: string) => void,
): Promise<BackupScanner> {
  const scanner = new BackupScanner(onValue, onGame);
  const stream = fs.createReadStream(file, { encoding: "utf8", highWaterMark: READ_CHUNK_BYTES });
  for await (const chunk of stream) scanner.push(chunk as string);
  scanner.finish();
  return scanner;
}

let importing = false;

/**
 * Imports every game in a backup file that isn't stored yet, and returns how
 * many that was. Throws a SyntaxError for a file that isn't JSON, and a plain
 * Error for JSON that isn't a backup.
 *
 * Two passes. The first reads only the small values and counts the games, so a
 * file that turns out not to be a backup has changed nothing, and progress has
 * a total to count toward. The second hands the games over a batch at a time.
 */
export async function importBackupFile(file: string, win: BrowserWindow | null): Promise<number> {
  if (importing) throw new Error("An import is already running");
  importing = true;
  try {
    const values = new Map<string, string>();
    let total = 0;
    const header = await scan(
      file,
      (key, text) => values.set(key, text),
      () => total++,
    );
    if (!header.sawGames) throw new Error("That file isn't a Mayhem Tracker backup");

    const read = (key: string) => {
      const text = values.get(key);
      return text === undefined ? undefined : JSON.parse(text);
    };

    // Version 3 names each game's owner and every account; version 2 has one
    // account, which owns every game
    const version = Number(read("version"));
    const summoners: any[] = version >= 3 ? (read("summoners") ?? []) : [read("summoner")];
    const accounts = summoners.filter((s) => typeof s?.puuid === "string" && s.puuid);
    const fallbackOwner: string | null = accounts[0]?.puuid ?? null;
    const ownerOf = (game: any): string | null =>
      version >= 3 ? game?._ownerPuuid || fallbackOwner : fallbackOwner;

    // Snapshot first: an import writes into every table, and this is the last
    // moment the database is known to be in the state the user chose it from.
    await backupQuietly("pre-import");
    db.importSummoners(accounts);

    let current = 0;
    let imported = 0;
    let announced = 0;
    let unreadable = 0;
    let batch: { game: any; owner: string }[] = [];

    const flush = () => {
      imported += db.importGames(batch);
      batch = [];
      sendToRenderer(win, "data:import-progress", { current, total, imported });
      if (imported - announced >= GAMES_UPDATED_BATCH) {
        announced = imported;
        sendToRenderer(win, "lcu:games-updated");
      }
    };

    sendToRenderer(win, "data:import-progress", { current: 0, total, imported: 0 });
    const stream = fs.createReadStream(file, { encoding: "utf8", highWaterMark: READ_CHUNK_BYTES });
    const scanner = new BackupScanner(
      () => {},
      (text) => {
        current++;
        let game: any;
        try {
          game = JSON.parse(text);
        } catch {
          unreadable++;
          return;
        }
        const owner = ownerOf(game);
        if (owner) batch.push({ game, owner });
      },
    );
    for await (const chunk of stream) {
      scanner.push(chunk as string);
      if (batch.length >= IMPORT_BATCH) flush();
    }
    scanner.finish();
    flush();

    if (imported > announced) sendToRenderer(win, "lcu:games-updated");
    if (unreadable > 0) console.warn(`Import skipped ${unreadable} games that would not parse`);
    console.log(`Imported ${imported} of ${total} games from ${file}`);
    return imported;
  } finally {
    importing = false;
  }
}
