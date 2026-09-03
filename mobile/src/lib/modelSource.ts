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

export const MODEL_FILENAME = "gemma-4-E2B-it.litertlm";

/**
 * Byte-exact size of the official file — a short file means a truncated copy.
 *
 * This is only the FALLBACK. `expectedBytes()` prefers the bundled asset's own
 * size, because a hand-maintained constant desynchronises the moment the model
 * changes, and it already did: this still read 3,659,530,240 (E4B) after the
 * switch to E2B, so every launch would have judged a perfectly good file
 * incomplete, deleted it, and re-extracted 2.59 GB forever.
 */
export const MODEL_BYTES = 2_588_147_712;

/**
 * Where a pushed model must live.
 *
 * expo-file-system exposes only `cache`, `bundle` and `document` — there is no
 * external-files directory in its API, so `/sdcard/...` is not reachable from
 * JS at all. (And since Android 11 an app cannot read shared storage anyway
 * without MANAGE_EXTERNAL_STORAGE.) The model therefore has to sit in the
 * app's own document directory.
 *
 * adb cannot write there directly, but on a debuggable build run-as can:
 *
 *   adb push gemma-4-E2B-it.litertlm /data/local/tmp/
 *   adb shell run-as in.neuraforge.anupalan  *     cp /data/local/tmp/gemma-4-E2B-it.litertlm files/
 *   adb shell rm /data/local/tmp/gemma-4-E2B-it.litertlm
 *
 * For a release build, bundle it instead: -PbundleModel=true.
 */
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

/**
 * The copy inside the APK.
 *
 * Must be built the same way as extractedFile(): `Paths.bundle` is a Directory
 * OBJECT, not a string. Interpolating it into a template produced the literal
 * path "[object Object]/gemma-4-E2B-it.litertlm", which Android rejected with
 * "Illegal character in path at index 0" and surfaced as "model not found".
 */
function bundledAsset(): File {
  return new File(Paths.bundle, MODEL_FILENAME);
}

/** Prefer the bundled asset's real size over the constant. See MODEL_BYTES. */
function expectedBytes(): number {
  try {
    const asset = bundledAsset();
    if (asset.exists) {
      const n = asset.size ?? 0;
      if (n > 0) return n;
    }
  } catch {
    // No bundled copy on this build - fall through to the constant.
  }
  return MODEL_BYTES;
}

function describe(path: string, origin: ModelOrigin, bytes: number): ModelLocation {
  return { path, origin, bytes, complete: bytes === expectedBytes() };
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

  return { path: null, origin: "missing", bytes: 0, complete: false };
}

/**
 * Make the model available and return its path.
 *
 * If it was bundled into the APK, this copies it out on first launch — 2.59 GB,
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
  if (target.exists && (target.size ?? 0) !== expectedBytes()) {
    try {
      target.delete();
    } catch {
      /* best effort */
    }
  }

  const asset = bundledAsset();
  if (!asset.exists) {
    return { path: null, origin: "missing", bytes: 0, complete: false };
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
      return "pushed into app storage";
    case "missing":
      return "not found on this device";
  }
}
