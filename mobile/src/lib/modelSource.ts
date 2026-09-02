/**
 * Find the model file, wherever it happens to live.
 *
 * LiteRT-LM's loadModel() takes a real filesystem path or an HTTPS URL — it
 * cannot read an APK asset directly, because it memory-maps the file. So a
 * bundled model has to be extracted to app storage exactly once.
 *
 * Three sources are tried in order, so the same build works whether the model
 * was bundled, pushed over a cable, or neither:
 *
 *   1. app storage      — already extracted, or extracted by a previous launch
 *   2. bundled asset    — built with -PbundleModel=true; extract once
 *   3. /sdcard/Download — pushed with `adb push`, the dev workflow
 *
 * None of this touches the network. The model never leaves the device.
 */

import { File, Paths } from "expo-file-system";

export const MODEL_FILENAME = "gemma-4-E4B-it.litertlm";

/** Byte-exact size of the official file. A short file means a truncated copy. */
export const MODEL_BYTES = 3_659_530_240;

/** Where `adb push` puts it during development. */
export const PUSHED_PATH = `/sdcard/Download/${MODEL_FILENAME}`;

export type ModelOrigin = "app-storage" | "bundled-asset" | "pushed" | "missing";

export interface ModelLocation {
  path: string | null;
  origin: ModelOrigin;
  bytes: number;
  complete: boolean;
}

function extractedFile(): File {
  return new File(Paths.document, MODEL_FILENAME);
}

function describe(path: string, origin: ModelOrigin, bytes: number): ModelLocation {
  return { path, origin, bytes, complete: bytes === MODEL_BYTES };
}

/**
 * Locate the model without copying anything. Cheap enough to call on every
 * launch, so the splash screen can decide whether it needs to show progress.
 */
export function locateModel(): ModelLocation {
  const extracted = extractedFile();
  if (extracted.exists && (extracted.size ?? 0) > 0) {
    return describe(extracted.uri, "app-storage", extracted.size ?? 0);
  }

  const pushed = new File(PUSHED_PATH);
  try {
    if (pushed.exists && (pushed.size ?? 0) > 0) {
      return describe(PUSHED_PATH, "pushed", pushed.size ?? 0);
    }
  } catch {
    // No permission to read shared storage on this device — fine, it just
    // means the pushed copy is not an option here.
  }

  return { path: null, origin: "missing", bytes: 0, complete: false };
}

/**
 * Make the model available and return its path.
 *
 * If it was bundled into the APK, this copies it out on first launch — 3.66 GB,
 * so it takes a while and MUST happen behind the splash screen, never in front
 * of a judge. Subsequent launches find it already extracted and return
 * immediately.
 */
export async function ensureModel(
  onProgress?: (fraction: number) => void,
): Promise<ModelLocation> {
  const found = locateModel();
  if (found.path && found.complete) {
    onProgress?.(1);
    return found;
  }

  // A partial file from an interrupted extraction would fail to load in a
  // confusing way. Delete it and start over.
  const target = extractedFile();
  if (target.exists && (target.size ?? 0) !== MODEL_BYTES) {
    try {
      target.delete();
    } catch {
      /* best effort */
    }
  }

  const asset = new File(`${Paths.bundle}/${MODEL_FILENAME}`);
  if (!asset.exists) {
    // Not bundled. If a pushed copy exists, use it as-is — no need to
    // duplicate 3.66 GB just to move it.
    return found.path ? found : { path: null, origin: "missing", bytes: 0, complete: false };
  }

  onProgress?.(0);
  await asset.copy(target);
  onProgress?.(1);

  const size = target.size ?? 0;
  return describe(target.uri, "bundled-asset", size);
}

/** For the splash screen and the diagnostics panel. */
export function describeOrigin(origin: ModelOrigin): string {
  switch (origin) {
    case "app-storage":
      return "installed in app storage";
    case "bundled-asset":
      return "extracted from the app bundle";
    case "pushed":
      return "loaded from Download (adb push)";
    case "missing":
      return "not found on this device";
  }
}
