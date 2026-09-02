/**
 * Upload the queue when the phone reaches the surface.
 *
 * Two rules that are not negotiable:
 *
 *  1. SEQUENTIAL, IN CAPTURE ORDER. The server chains each evidence row to the
 *     previous one for that mine. Uploading in parallel would interleave the
 *     chain and produce a valid-looking but meaningless order.
 *
 *  2. IDEMPOTENT. Every capture carries a client_id. A retry returns 200 with
 *     the existing row instead of creating a duplicate, so a half-finished
 *     sync can simply be run again.
 */

import { api } from "./api";
import { markStatus, pending, type Capture } from "./db";

export interface SyncResult {
  uploaded: number;
  alreadyOnServer: number;
  failed: number;
  conflicts: number;
}

function filename(uri: string) {
  const base = uri.split("/").pop() || "evidence.jpg";
  return base.includes(".") ? base : `${base}.jpg`;
}

async function uploadOne(c: Capture): Promise<"created" | "existing"> {
  const form = new FormData();
  form.append("obligation_id", String(c.obligation_id));
  form.append("lat", String(c.lat));
  form.append("lon", String(c.lon));
  form.append("captured_at", c.captured_at);
  form.append("client_id", c.client_id);
  if (c.observation) form.append("observation", c.observation);

  if (c.photo_uri) {
    form.append("photo", {
      uri: c.photo_uri,
      name: filename(c.photo_uri),
      type: "image/jpeg",
    } as unknown as Blob);
  }

  const res = await api.post("/evidence", form, {
    headers: { "Content-Type": "multipart/form-data" },
    transformRequest: (d) => d, // let RN build the multipart body itself
    // A photo upload is not a JSON call. The client's 15s default is fine for
    // reading the ledger but far too tight for a multipart body on the
    // connection an officer actually has at the surface, and a timeout here
    // shows up as the misleading "no connection".
    timeout: 90_000,
  });

  await markStatus(c.id, "synced", {
    server_id: res.data?.id,
    chain_hash: res.data?.chain_hash,
  });

  // 200 means the server already had it — the queue retried safely.
  return res.status === 200 ? "existing" : "created";
}

export async function syncQueue(
  onProgress?: (done: number, total: number) => void,
): Promise<SyncResult> {
  const items = await pending();
  const result: SyncResult = {
    uploaded: 0,
    alreadyOnServer: 0,
    failed: 0,
    conflicts: 0,
  };

  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    await markStatus(c.id, "uploading");
    try {
      const outcome = await uploadOne(c);
      if (outcome === "existing") result.alreadyOnServer++;
      else result.uploaded++;
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err && "response" in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;

      if (status === 409) {
        await markStatus(c.id, "conflict", { error: "edited on two devices" });
        result.conflicts++;
      } else {
        const message =
          status === undefined ? "no connection" : `server said ${status}`;
        await markStatus(c.id, "error", { error: message });
        result.failed++;
      }
      // Keep going — one bad row must not strand the rest of the queue.
    }
    onProgress?.(i + 1, items.length);
  }

  return result;
}
