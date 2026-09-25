import type { RecapChallenge } from "../../shared/api";
import { db } from "./connection";

// The whole payload plus one history row per challenge, in a single
// transaction: a snapshot that recorded half its challenges would show up later
// as a week of progress that never happened.
export function saveChallenges(
  day: string,
  payload: string,
  values: { id: number; value: number; level: string }[],
): void {
  const writeState = db.prepare(
    "INSERT OR REPLACE INTO challenge_state (id, payload, fetched_at) VALUES (1, ?, ?)",
  );
  // Last read of the day wins, so today's row keeps pace with the live numbers
  // while older days stay as they were.
  const writeHistory = db.prepare(
    "INSERT OR REPLACE INTO challenge_history (day, challenge_id, value, level) VALUES (?, ?, ?, ?)",
  );
  db.transaction(() => {
    writeState.run(payload, Date.now());
    for (const entry of values) writeHistory.run(day, entry.id, entry.value, entry.level);
  })();
}

export function getStoredChallenges(): { payload: string; fetched_at: number } | null {
  const row = db.prepare("SELECT payload, fetched_at FROM challenge_state WHERE id = 1").get() as
    | { payload: string; fetched_at: number }
    | undefined;
  return row ?? null;
}

/**
 * The newest snapshot taken on or before `cutoff`, as a value per challenge.
 *
 * Deltas all measure from one day rather than from each challenge's own last
 * reading, so "+312 since Tuesday" means the same thing on every row. Until the
 * history reaches back as far as `cutoff` this falls back to the oldest day
 * recorded, so the first week of tracking still says something; only `today`
 * itself is refused, since measuring progress from now is measuring nothing.
 */
export function getChallengeBaseline(
  cutoff: string,
  today: string,
): { day: string; values: Record<number, number> } | null {
  const dayRow = (db
    .prepare("SELECT day FROM challenge_history WHERE day <= ? ORDER BY day DESC LIMIT 1")
    .get(cutoff) ??
    db.prepare("SELECT MIN(day) as day FROM challenge_history WHERE day < ?").get(today)) as
    | { day: string | null }
    | undefined;
  if (!dayRow?.day) return null;

  const rows = db
    .prepare("SELECT challenge_id, value FROM challenge_history WHERE day = ?")
    .all(dayRow.day) as { challenge_id: number; value: number }[];
  const values: Record<number, number> = {};
  for (const row of rows) values[row.challenge_id] = row.value;
  return { day: dayRow.day, values };
}

export function saveGameChallenges(gameId: number, rows: RecapChallenge[]): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO challenge_game_progress
      (game_id, challenge_id, name, description, previous_value, current_value,
       previous_level, current_level, next_level, next_threshold, icon_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const row of rows) {
      insert.run(
        gameId,
        row.id,
        row.name,
        row.description,
        row.previousValue,
        row.currentValue,
        row.previousLevel,
        row.currentLevel,
        row.nextLevel,
        row.nextThreshold,
        row.iconPath,
      );
    }
  })();
}

export function hasGameChallenges(gameId: number): boolean {
  return (
    db.prepare("SELECT 1 FROM challenge_game_progress WHERE game_id = ? LIMIT 1").get(gameId) !=
    null
  );
}

// A tier earned is the headline, so those come first; the rest keep the order
// the client listed them in.
export function getGameChallenges(gameId: number): any[] {
  return db
    .prepare(`
      SELECT challenge_id, name, description, previous_value, current_value,
             previous_level, current_level, next_level, next_threshold, icon_path
      FROM challenge_game_progress
      WHERE game_id = ?
      ORDER BY (previous_level = current_level), challenge_id
    `)
    .all(gameId);
}
