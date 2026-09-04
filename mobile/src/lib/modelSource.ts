/**
 * Find the model files, wherever they happen to live.
 *
 * LiteRT-LM's loadModel() takes a real filesystem path or an HTTPS URL — it
 * cannot read an APK asset directly, because it memory-maps the file. So a
 * bundled model has to be extracted to app storage exactly once.
 *
 * Two sources are tried in order, so the same build works whether the model
 * was bundled or pushed over a cable:
 *
 *   1. app storage   — already extracted, or extracted by a previous launch
 *   2. bundled asset — built with -PbundleModel=true; extract once
 *
 * None of this touches the network. The models never leave the device.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";

export type ModelId = "e2b" | "qwen25" | "lfm25" | "smol360";

/**
 * How a model's chat template handles reasoning.
 *
 * Carried as DATA rather than branched on by id, because every model added so
 * far has needed a different answer and the code was starting to accumulate
 * `id === "qwen17"` checks. A new model should be describable, not coded for.
 *
 *   "none"      the template never opens a reasoning block. The toggle has
 *               nothing to switch and the model simply answers.
 *   "no-think"  the template honours a `/no_think` marker in the message, so
 *               the toggle works in both directions.
 *   "config"    the engine's ThinkingOptions reaches it (Gemma 4 family), so
 *               the toggle works in both directions.
 *   "forced"    the model reasons and CANNOT be stopped from here - Qwen3 is
 *               the example: its template defaults enable_thinking to true,
 *               that is a render-time variable we cannot set, ThinkingOptions
 *               does not reach it, and the bundle has no /no_think switch.
 *               The toggle cannot turn this off, so the UI says so instead of
 *               quietly doing nothing.
 */
export type ThinkingControl = "none" | "no-think" | "config" | "forced";

/**
 * What the reasoning toggle will ACTUALLY do for this model.
 *
 * Returned as text for the UI, because a switch that silently does nothing on
 * some models is worse than one that explains itself. `wanted` is the toggle
 * position the officer has chosen.
 */
export function describeThinking(spec: ModelSpec, wanted: boolean): string {
  switch (spec.thinking) {
    case "forced":
      return "always reasons — this model cannot be told not to";
    case "none":
      return wanted
        ? "no reasoning available — this model answers directly"
        : "answers directly";
    case "no-think":
    case "config":
      return wanted ? "will reason before answering" : "answers directly";
  }
}

/** Can the toggle change anything for this model? */
export function thinkingIsSwitchable(spec: ModelSpec): boolean {
  return spec.thinking === "no-think" || spec.thinking === "config";
}

export interface ModelSpec {
  id: ModelId;
  filename: string;
  /** Shown in the picker. */
  label: string;
  /**
   * Byte-exact size of the official file. Only a FALLBACK — `expectedBytes()`
   * prefers the bundled asset's own size, because a hand-maintained constant
   * desynchronises the moment a model changes, and one already did: it still
   * read 3,659,530,240 (E4B) after the switch to E2B, so every launch would
   * have judged a good file incomplete and re-extracted it forever.
   */
  approxBytes: number;
  /** Audio and image input. Only E2B has it; the rest are text-only. */
  multimodal: boolean;
  /** See ThinkingControl. Verified by reading each bundle's chat template. */
  thinking: ThinkingControl;
  /** One line under the label in the picker. */
  blurb: string;
}

/**
 * The models shipped inside the APK, largest first.
 *
 * Every one has had its chat template extracted from the .litertlm bundle and
 * read, because that is what caught the failure that wasted a build: Qwen3-1.7B
 * loaded perfectly on GPU/4096 and then answered a ledger question by saying
 * the question was unclear. Its template ended with
 *
 *     {%- if not enable_thinking|default(true) %}{{- '<think>...</think>' }}
 *
 * so reasoning was ON unless something turned it off, and nothing in this
 * runtime can: ThinkingOptions is documented for Gemma 4 only, `enable_thinking`
 * is a render-time variable we cannot set, and the bundle carried no /no_think
 * switch. It was dropped rather than shipped with a warning label.
 *
 * The three text models below were checked the same way and end cleanly at
 * `<|im_start|>assistant`. LFM2.5 does mention </think>, but in a clause that
 * STRIPS reasoning out of past messages - the opposite of enabling it.
 *
 * Only ever ONE is resident. Peak memory is whatever the largest one needs,
 * not the sum - and switching between them mid-session does not work, see
 * switchModel() in llm.ts.
 */
export const MODELS: ModelSpec[] = [
  {
    id: "e2b",
    filename: "gemma-4-E2B-it.litertlm",
    label: "Gemma 4 E2B",
    approxBytes: 2_588_147_712,
    multimodal: true,
    thinking: "config",
    blurb: "Recommended · understands speech and photos",
  },
  {
    id: "qwen25",
    filename: "Qwen2.5-1.5B-Instruct_q8.litertlm",
    label: "Qwen2.5 1.5B",
    approxBytes: 1_599_229_952,
    multimodal: false,
    thinking: "none",
    blurb: "Strong at instructions · int8 · text only",
  },
  {
    id: "lfm25",
    filename: "LFM2.5-1.2B-Instruct_int4.litertlm",
    label: "LFM2.5 1.2B",
    approxBytes: 736_015_744,
    multimodal: false,
    thinking: "none",
    blurb: "Built for phones · quick · text only",
  },
  {
    id: "smol360",
    filename: "SmolLM2_360M_instruct.litertlm",
    label: "SmolLM2 360M",
    approxBytes: 373_719_040,
    multimodal: false,
    thinking: "none",
    blurb: "Fastest · light chat only, not for clause work",
  },
];

export const DEFAULT_MODEL_ID: ModelId = "e2b";

const PREF_KEY = "anupalan.model";

/**
 * Remember the chosen model across launches.
 *
 * This matters more than a convenience. LiteRT-LM cannot reliably load a
 * second model after closing the first - switching mid-session leaves the
 * engine unable to invoke, so the fallback is to reopen the app. That is only
 * a workable answer if the choice survives the restart.
 */
export async function loadPreferredModel(): Promise<ModelSpec> {
  try {
    const id = await AsyncStorage.getItem(PREF_KEY);
    if (id) return modelById(id as ModelId);
  } catch {
    // Unreadable storage is not worth failing over; fall back to the default.
  }
  return modelById(DEFAULT_MODEL_ID);
}

export async function savePreferredModel(id: ModelId): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_KEY, id);
  } catch {
    /* best effort */
  }
}

export function modelById(id: ModelId): ModelSpec {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model id: ${id}`);
  return m;
}

/** The multimodal one, for voice and photo input. */
export function multimodalModel(): ModelSpec {
  const m = MODELS.find((x) => x.multimodal);
  if (!m) throw new Error("No multimodal model is bundled in this build.");
  return m;
}

export type ModelOrigin = "app-storage" | "bundled-asset" | "missing";

export interface ModelLocation {
  spec: ModelSpec;
  path: string | null;
  origin: ModelOrigin;
  bytes: number;
  complete: boolean;
}

/**
 * Where an extracted model lives.
 *
 * expo-file-system exposes only `cache`, `bundle` and `document` — there is no
 * external-files directory in its API, so `/sdcard/...` is unreachable from JS
 * (and since Android 11 an app cannot read shared storage anyway without
 * MANAGE_EXTERNAL_STORAGE). The models therefore sit in the app's own
 * document directory.
 */
function extractedFile(spec: ModelSpec): File {
  return new File(Paths.document, spec.filename);
}

/**
 * The copy inside the APK.
 *
 * Must be built the same way as extractedFile(): `Paths.bundle` is a Directory
 * OBJECT, not a string. Interpolating it into a template produced the literal
 * path "[object Object]/gemma-4-E2B-it.litertlm", which Android rejected with
 * "Illegal character in path at index 0" and surfaced as "model not found".
 */
function bundledAsset(spec: ModelSpec): File {
  return new File(Paths.bundle, spec.filename);
}

/** Prefer the bundled asset's real size over the constant. See approxBytes. */
function expectedBytes(spec: ModelSpec): number {
  try {
    const asset = bundledAsset(spec);
    if (asset.exists) {
      const n = asset.size ?? 0;
      if (n > 0) return n;
    }
  } catch {
    // No bundled copy on this build — fall through to the constant.
  }
  return spec.approxBytes;
}

/**
 * Locate a model without copying anything. Cheap enough to call on every
 * launch, so the UI can say what is already available before anything loads.
 */
export function locateModel(spec: ModelSpec): ModelLocation {
  const extracted = extractedFile(spec);
  if (extracted.exists && (extracted.size ?? 0) > 0) {
    const bytes = extracted.size ?? 0;
    return {
      spec,
      path: extracted.uri,
      origin: "app-storage",
      bytes,
      complete: bytes === expectedBytes(spec),
    };
  }
  return { spec, path: null, origin: "missing", bytes: 0, complete: false };
}

/** Which models are already extracted, so the picker can say so. */
export function locateAll(): ModelLocation[] {
  return MODELS.map(locateModel);
}

/**
 * Make a model available and return its path.
 *
 * If it was bundled into the APK, this copies it out on first use. E2B is
 * 2.59 GB, so that takes a while and should happen behind a progress
 * indicator, never in front of a judge. Later calls find it extracted and
 * return immediately.
 */
export async function ensureModel(
  spec: ModelSpec,
  onProgress?: (fraction: number) => void,
): Promise<ModelLocation> {
  const found = locateModel(spec);
  if (found.path && found.complete) {
    onProgress?.(1);
    return found;
  }

  // A partial file from an interrupted extraction would fail to load in a
  // confusing way. Delete it and start over.
  const target = extractedFile(spec);
  if (target.exists && (target.size ?? 0) !== expectedBytes(spec)) {
    try {
      target.delete();
    } catch {
      /* best effort */
    }
  }

  const asset = bundledAsset(spec);
  if (!asset.exists) {
    return { spec, path: null, origin: "missing", bytes: 0, complete: false };
  }

  onProgress?.(0);
  await asset.copy(target);
  onProgress?.(1);

  const bytes = target.size ?? 0;
  return {
    spec,
    path: target.uri,
    origin: "bundled-asset",
    bytes,
    complete: bytes === expectedBytes(spec),
  };
}

/** For the diagnostics panel. */
export function describeOrigin(origin: ModelOrigin): string {
  switch (origin) {
    case "app-storage":
      return "installed in app storage";
    case "bundled-asset":
      return "extracted from the app bundle";
    case "missing":
      return "not found on this device";
  }
}

/** "2.59 GB" / "932 MB" */
export function formatBytes(n: number): string {
  return n >= 2 ** 30
    ? `${(n / 2 ** 30).toFixed(2)} GB`
    : `${Math.round(n / 2 ** 20)} MB`;
}
