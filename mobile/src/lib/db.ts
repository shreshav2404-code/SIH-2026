/**
 * Offline-first capture queue.
 *
 * Offline-first BY DESIGN, not offline-tolerant. Capture writes to this local
 * store first and always succeeds. The queue holds it. Upload happens when the
 * phone reaches the surface. Nothing is ever lost because the network was down,
 * because the network was never on the critical path.
 */

import * as SQLite from "expo-sqlite";

export type QueueStatus = "queued" | "uploading" | "synced" | "conflict" | "error";

export interface Capture {
  id: number;
  client_id: string;
  obligation_id: number;
  title: string;
  clause_ref: string;
  photo_uri: string | null;
  lat: number;
  lon: number;
  captured_at: string;
  observation: string | null;
  reading_value: number | null;
  /** How far off lat/lon may be, as the GPS reported it. */
  gps_accuracy: number | null;
  /** JSON of Place - the address, looked up once there is signal. */
  place: string | null;
  /** The on-device model's verification summary of the photo. */
  ai_description: string | null;
  /** JSON array of problems the model reported. */
  ai_problems: string | null;
  ai_model: string | null;
  /** null = not attempted, then reading / done / failed. */
  ai_status: "reading" | "done" | "failed" | null;
  /** 1 when an annotation landed after upload and still has to be sent. */
  annotation_pending: number;
  status: QueueStatus;
  server_id: number | null;
  chain_hash: string | null;
  error: string | null;
  attempts: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("anupalan.db").then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS capture (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id     TEXT NOT NULL UNIQUE,
          obligation_id INTEGER NOT NULL,
          title         TEXT NOT NULL,
          clause_ref    TEXT NOT NULL,
          photo_uri     TEXT,
          lat           REAL NOT NULL,
          lon           REAL NOT NULL,
          captured_at   TEXT NOT NULL,
          observation   TEXT,
          reading_value REAL,
          status        TEXT NOT NULL DEFAULT 'queued',
          server_id     INTEGER,
          chain_hash    TEXT,
          error         TEXT,
          attempts      INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_capture_status ON capture(status);

        -- Duties are cached so the list still opens with no signal.
        CREATE TABLE IF NOT EXISTS duty_cache (
          id         INTEGER PRIMARY KEY,
          payload    TEXT NOT NULL,
          cached_at  TEXT NOT NULL
        );
      `);
      await addMissingColumns(db);
      return db;
    });
  }
  return dbPromise;
}

/**
 * Columns added after the first release, applied to a queue that already exists.
 *
 * CREATE TABLE IF NOT EXISTS does nothing to a table that is already there, so
 * a phone that installed an earlier build keeps the old shape and the first
 * INSERT naming a new column fails - taking every capture with it. SQLite has
 * no ADD COLUMN IF NOT EXISTS, so ask the table what it has.
 *
 * Dropping and recreating would be simpler and would delete captures that
 * have not synced yet, which are the one thing this queue exists to keep.
 */
const LATER_COLUMNS: [string, string][] = [
  ["gps_accuracy", "REAL"],
  ["place", "TEXT"],
  ["ai_description", "TEXT"],
  ["ai_problems", "TEXT"],
  ["ai_model", "TEXT"],
  ["ai_status", "TEXT"],
  ["annotation_pending", "INTEGER NOT NULL DEFAULT 0"],
];

async function addMissingColumns(db: SQLite.SQLiteDatabase) {
  const have = new Set(
    (await db.getAllAsync<{ name: string }>("PRAGMA table_info(capture)")).map(
      (c) => c.name,
    ),
  );
  for (const [name, type] of LATER_COLUMNS) {
    if (!have.has(name)) {
      await db.execAsync(`ALTER TABLE capture ADD COLUMN ${name} ${type}`);
    }
  }
}

export type NewCapture = Omit<
  Capture,
  | "id" | "status" | "server_id" | "chain_hash" | "error" | "attempts"
  | "annotation_pending"
>;

export async function enqueue(c: NewCapture): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    `INSERT INTO capture
       (client_id, obligation_id, title, clause_ref, photo_uri, lat, lon,
        captured_at, observation, reading_value, gps_accuracy, place,
        ai_description, ai_problems, ai_model, ai_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    c.client_id,
    c.obligation_id,
    c.title,
    c.clause_ref,
    c.photo_uri,
    c.lat,
    c.lon,
    c.captured_at,
    c.observation,
    c.reading_value,
    c.gps_accuracy,
    c.place,
    c.ai_description,
    c.ai_problems,
    c.ai_model,
    c.ai_status,
  );
  return r.lastInsertRowId;
}

/**
 * Store the model's reading against the capture that owns this photo.
 *
 * Keyed by photo_uri, not by row id: reading starts the moment the shutter
 * fires, before the officer has pressed Save and before any row exists. If it
 * finishes first, Capture puts it in the INSERT; if it finishes after, this
 * finds the row. A capture that is already on the server is marked so the
 * next sync sends the reading on.
 */
export async function saveReading(
  photoUri: string,
  reading: { description: string; problems: string[]; model: string } | null,
) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE capture
        SET ai_description = ?, ai_problems = ?, ai_model = ?, ai_status = ?,
            annotation_pending = CASE WHEN status = 'synced' THEN 1
                                      ELSE annotation_pending END
      WHERE photo_uri = ?`,
    reading?.description ?? null,
    reading ? JSON.stringify(reading.problems) : null,
    reading?.model ?? null,
    reading ? "done" : "failed",
    photoUri,
  );
}

export async function setReadingStatus(photoUri: string, status: "reading") {
  const db = await getDb();
  await db.runAsync(
    "UPDATE capture SET ai_status = ? WHERE photo_uri = ? AND ai_status IS NULL",
    status,
    photoUri,
  );
}

export async function savePlace(id: number, place: string) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE capture
        SET place = ?,
            annotation_pending = CASE WHEN status = 'synced' THEN 1
                                      ELSE annotation_pending END
      WHERE id = ? AND place IS NULL`,
    place,
    id,
  );
}

/** Synced captures whose address or reading arrived after they were uploaded. */
export async function pendingAnnotations(): Promise<Capture[]> {
  const db = await getDb();
  return db.getAllAsync<Capture>(
    `SELECT * FROM capture
      WHERE status = 'synced' AND annotation_pending = 1 AND server_id IS NOT NULL
      ORDER BY id ASC`,
  );
}

export async function clearAnnotationPending(id: number) {
  const db = await getDb();
  await db.runAsync("UPDATE capture SET annotation_pending = 0 WHERE id = ?", id);
}

export async function listQueue(): Promise<Capture[]> {
  const db = await getDb();
  return db.getAllAsync<Capture>("SELECT * FROM capture ORDER BY id DESC");
}

/** Pending items in CAPTURE ORDER — the hash chain depends on this. */
export async function pending(): Promise<Capture[]> {
  const db = await getDb();
  return db.getAllAsync<Capture>(
    "SELECT * FROM capture WHERE status IN ('queued','error') ORDER BY id ASC",
  );
}

export async function counts() {
  const db = await getDb();
  const rows = await db.getAllAsync<{ status: QueueStatus; n: number }>(
    "SELECT status, COUNT(*) AS n FROM capture GROUP BY status",
  );
  const out: Record<QueueStatus, number> = {
    queued: 0, uploading: 0, synced: 0, conflict: 0, error: 0,
  };
  rows.forEach((r) => (out[r.status] = r.n));
  return out;
}

export async function markStatus(
  id: number,
  status: QueueStatus,
  extra: { server_id?: number; chain_hash?: string; error?: string } = {},
) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE capture
        SET status = ?, server_id = COALESCE(?, server_id),
            chain_hash = COALESCE(?, chain_hash), error = ?,
            attempts = attempts + 1
      WHERE id = ?`,
    status,
    extra.server_id ?? null,
    extra.chain_hash ?? null,
    extra.error ?? null,
    id,
  );
}

export async function cacheDuties(payload: unknown) {
  const db = await getDb();
  await db.runAsync("DELETE FROM duty_cache");
  await db.runAsync(
    "INSERT INTO duty_cache (id, payload, cached_at) VALUES (1, ?, ?)",
    JSON.stringify(payload),
    new Date().toISOString(),
  );
}

export async function readCachedDuties<T>(): Promise<{ data: T; at: string } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ payload: string; cached_at: string }>(
    "SELECT payload, cached_at FROM duty_cache WHERE id = 1",
  );
  if (!row) return null;
  try {
    return { data: JSON.parse(row.payload) as T, at: row.cached_at };
  } catch {
    return null;
  }
}
