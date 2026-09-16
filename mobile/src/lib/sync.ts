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
 *
 * And one that follows from what a reviewer needs: nothing reaches the
 * dashboard unexplained if it can be helped. Before each upload the address
 * is looked up (captured underground, it had no signal) and the photo is read
 * by the on-device model if it never was. Both are bounded - a capture is
 * never held on the phone because a geocoder or a model was slow.
 */

import { api } from "./api";
import {
  clearAnnotationPending,
  markStatus,
  pending,
  pendingAnnotations,
  savePlace,
  type Capture,
} from "./db";
import { lookupPlace } from "./place";
import { readingState, readingWithin } from "./photoReader";

export interface SyncResult {
  uploaded: number;
  alreadyOnServer: number;
  failed: number;
  conflicts: number;
  /** Captures whose address or summary was sent after their upload. */
  annotated: number;
}

export type SyncStage = "address" | "reading" | "uploading" | "annotations";

/**
 * How long sync waits for the model to read one photo before uploading it
 * without a summary. A ceiling, not an estimate: the reading carries on after
 * it, and the summary follows at the next sync.
 */
const READ_LIMIT_MS = 120_000;

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

  // Annotations. None of them is hashed; the server fills gaps with them.
  if (c.gps_accuracy != null) form.append("gps_accuracy_m", String(c.gps_accuracy));
  if (c.place) form.append("place", c.place);
  if (c.ai_description) form.append("ai_description", c.ai_description);
  if (c.ai_problems) form.append("ai_problems", c.ai_problems);
  if (c.ai_model) form.append("ai_model", c.ai_model);

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

/** Fill in what the capture could not get underground. Mutates `c`. */
async function enrich(
  c: Capture,
  onStage: (stage: SyncStage) => void,
): Promise<void> {
  if (!c.place) {
    onStage("address");
    const place = await lookupPlace(c.lat, c.lon);
    if (place) {
      c.place = JSON.stringify(place);
      await savePlace(c.id, c.place);
    }
  }

  if (c.photo_uri && c.ai_status !== "done") {
    // A reading that already failed in this session is not retried here -
    // the same photo and the same model would fail the same way, and the
    // officer is waiting on the upload.
    if (readingState(c.photo_uri)?.kind !== "failed") {
      onStage("reading");
      const ann = await readingWithin(c.photo_uri, { title: c.title }, READ_LIMIT_MS);
      if (ann) {
        c.ai_description = ann.description;
        c.ai_problems = JSON.stringify(ann.problems);
        c.ai_model = ann.model;
        c.ai_status = "done";
      }
    }
  }
}

/** Send addresses and summaries that finished after their capture uploaded. */
async function sendLateAnnotations(): Promise<number> {
  let sent = 0;
  for (const c of await pendingAnnotations()) {
    try {
      await api.patch(`/evidence/${c.server_id}/annotations`, {
        place: c.place ? JSON.parse(c.place) : null,
        ai_description: c.ai_description,
        ai_problems: c.ai_problems ? JSON.parse(c.ai_problems) : null,
        ai_model: c.ai_model,
      });
      await clearAnnotationPending(c.id);
      sent++;
    } catch {
      // Left pending; the next sync tries again.
    }
  }
  return sent;
}

export async function syncQueue(
  onProgress?: (done: number, total: number, stage?: SyncStage) => void,
): Promise<SyncResult> {
  const items = await pending();
  const result: SyncResult = {
    uploaded: 0,
    alreadyOnServer: 0,
    failed: 0,
    conflicts: 0,
    annotated: 0,
  };

  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    try {
      await enrich(c, (stage) => onProgress?.(i, items.length, stage));
    } catch {
      // Enrichment is best effort. The capture uploads regardless.
    }

    onProgress?.(i, items.length, "uploading");
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

  onProgress?.(items.length, items.length, "annotations");
  result.annotated = await sendLateAnnotations();
  return result;
}
