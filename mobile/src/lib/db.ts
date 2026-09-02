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
      return db;
    });
  }
  return dbPromise;
}

export async function enqueue(
  c: Omit<Capture, "id" | "status" | "server_id" | "chain_hash" | "error" | "attempts">,
): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    `INSERT INTO capture
       (client_id, obligation_id, title, clause_ref, photo_uri, lat, lon,
        captured_at, observation, reading_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  );
  return r.lastInsertRowId;
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
