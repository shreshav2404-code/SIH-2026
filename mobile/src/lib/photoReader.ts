/**
 * Read evidence photographs with the on-device vision model, one at a time.
 *
 * A reading starts the moment the shutter fires, so the officer can see what
 * the model made of the photo while still standing in front of the thing it
 * shows - and retake it if the summary says it shows the wrong thing. Sync
 * reads any capture that was never read (the app was closed, the model
 * failed to load) before uploading it, so no capture reaches the dashboard
 * unread just because nobody waited.
 *
 * ONE AT A TIME. There is one model and one context on the phone. Two
 * readings started together would race for it; they are queued instead.
 *
 * KEYED BY PHOTO. Each shot is a new file, so its URI names it uniquely - a
 * retake gets its own reading, and the old one simply goes unused. The key is
 * not the queue row, because the row does not exist until Save.
 *
 * llm.ts is imported lazily, as Ask.tsx does, so a device where the engine
 * cannot initialise loses photo reading and keeps capture.
 *
 * THE CLOUD, ONLY WHEN THE PHONE CANNOT DECIDE. If the on-device reading
 * fails, or answers "unclear" on whether the photo shows the duty, and the
 * officer has chosen a profile for photos, the same 448 px copy goes to that
 * cloud vision model. Measured: NVIDIA's Llama 3.2 11B Vision read two real
 * evidence photos in under two seconds each and got both verdicts right. A
 * model twenty-five times the size is worth asking exactly when the small one
 * is unsure - and not otherwise, because every photo it reads leaves the
 * device. Which model read a photo is recorded with it and shown everywhere.
 */

import * as ImageManipulator from "expo-image-manipulator";

import { getPhotoProfile, readPhotoInCloud, type CloudProfile } from "./cloudFallback";
import { saveReading, setReadingStatus } from "./db";
import {
  parseReading,
  readingFromAnswers,
  toAnnotation,
  type Annotation,
  type Match,
} from "./reading";

export type ReadState =
  | { kind: "reading" }
  | {
      kind: "done";
      annotation: Annotation;
      /** Swapping the vision model in. Zero when it was already loaded. */
      loadSeconds: number;
      /** Encoding the photo and writing the answer, on the phone. */
      readSeconds: number;
      /** Which model's reading this is. */
      via: "device" | "cloud";
      /** Why the cloud was asked, when it was. */
      because?: string;
      cloudSeconds?: number;
    }
  | { kind: "failed"; message: string };

const states = new Map<string, ReadState>();
const inflight = new Map<string, Promise<Annotation | null>>();
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();

function notify() {
  listeners.forEach((l) => l());
}

/** Re-render when any reading changes. Returns the unsubscribe. */
export function onReadingChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function readingState(photoUri: string | null | undefined): ReadState | undefined {
  return photoUri ? states.get(photoUri) : undefined;
}

export function startReading(
  photoUri: string,
  duty: { title: string },
): Promise<Annotation | null> {
  const known = states.get(photoUri);
  if (known?.kind === "done") return Promise.resolve(known.annotation);
  const running = inflight.get(photoUri);
  if (running) return running;

  states.set(photoUri, { kind: "reading" });
  notify();

  const job = queue.then(() => read(photoUri, duty));
  // The queue must survive a failed reading, or one bad photo stops all the
  // readings after it.
  queue = job.catch(() => null);
  inflight.set(photoUri, job);
  return job;
}

/**
 * Longest edge of the copy the model reads. The evidence photo itself - the
 * one that is hashed and uploaded - is not touched.
 *
 * The first reading on the M31s took 158 seconds with the 1280 px capture.
 * LFM2.5-VL tiles an image larger than its native 512 px into several crops
 * plus a thumbnail, and every tile is a few hundred image tokens of prefill
 * on a CPU. At 448 px the photo is a single tile. A description of what is in
 * a frame does not need the resolution a reviewer needs to read a register.
 */
const MODEL_EDGE = 448;

function cloudLabel(profile: CloudProfile): string {
  const model = profile.model.split("/").pop() || profile.model;
  return `${model} via ${profile.label} (cloud)`.slice(0, 64);
}

async function read(photoUri: string, duty: { title: string }): Promise<Annotation | null> {
  let deviceFailure: string | null = null;
  let cloudFailure: string | null = null;
  try {
    await setReadingStatus(photoUri, "reading");
    const small = await ImageManipulator.manipulateAsync(
      photoUri,
      [{ resize: { width: MODEL_EDGE } }],
      // base64 as well as a file: the phone model reads the file, a cloud
      // model needs the bytes inline.
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );

    // ---- 1. On the phone, offline.
    let device: { annotation: Annotation; match: Match } | null = null;
    let loadSeconds = 0;
    let readSeconds = 0;
    try {
      const llm = await import("./llm");
      const r = await llm.describeEvidence(small.uri, duty);
      loadSeconds = Math.round(r.loadMs / 1000);
      readSeconds = Math.round(r.readMs / 1000);
      const reading = readingFromAnswers(r.describe, r.verdict, r.problem);
      try {
        device = {
          annotation: toAnnotation(reading, duty.title, r.model),
          match: reading.match,
        };
      } catch (e) {
        // Say what the model actually produced. "Returned nothing" with the
        // output hidden cannot be told apart from an empty reply, a truncated
        // one, or one the parser mishandled - and each has a different fix.
        const shown = r.describe.trim()
          ? `"${r.describe.trim().slice(0, 160)}"`
          : "an empty reply";
        throw new Error(
          `${e instanceof Error ? e.message : String(e)} It produced ${shown} ` +
            `in ${readSeconds}s.`,
        );
      }
    } catch (e) {
      deviceFailure = e instanceof Error ? e.message : String(e);
    }

    // ---- 2. The cloud, only if the phone could not decide.
    if (!device || device.match === "unclear") {
      const profile = await getPhotoProfile();
      if (profile && small.base64) {
        const started = Date.now();
        try {
          const raw = await readPhotoInCloud(profile, small.base64, duty.title);
          let annotation: Annotation;
          try {
            annotation = toAnnotation(parseReading(raw), duty.title, cloudLabel(profile));
          } catch {
            throw new Error(`it replied "${raw.slice(0, 120)}", which has no reading in it`);
          }
          states.set(photoUri, {
            kind: "done",
            annotation,
            loadSeconds,
            readSeconds,
            via: "cloud",
            because: device
              ? "the phone model could not tell whether the photo shows the duty"
              : "the phone model could not read the photo",
            cloudSeconds: Math.round((Date.now() - started) / 1000),
          });
          await saveReading(photoUri, annotation);
          return annotation;
        } catch (e) {
          cloudFailure = e instanceof Error ? e.message : String(e);
        }
      }
    }

    // ---- 3. The phone's reading stands, unsure or not, if there is one.
    if (device) {
      states.set(photoUri, {
        kind: "done",
        annotation: device.annotation,
        loadSeconds,
        readSeconds,
        via: "device",
        because: cloudFailure ? `cloud not used: ${cloudFailure}` : undefined,
      });
      await saveReading(photoUri, device.annotation);
      return device.annotation;
    }

    throw new Error(
      [deviceFailure, cloudFailure && `Cloud: ${cloudFailure}`].filter(Boolean).join(" "),
    );
  } catch (e) {
    states.set(photoUri, {
      kind: "failed",
      message: e instanceof Error ? e.message : String(e),
    });
    await saveReading(photoUri, null).catch(() => {});
    return null;
  } finally {
    inflight.delete(photoUri);
    notify();
  }
}

/**
 * Wait for a reading, but not forever.
 *
 * Sync calls this. Past the limit the capture uploads without its summary and
 * the reading carries on; when it lands, the row is marked and the next sync
 * sends it. A slow model must not hold evidence on the phone.
 */
export async function readingWithin(
  photoUri: string,
  duty: { title: string },
  ms: number,
): Promise<Annotation | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([startReading(photoUri, duty), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
