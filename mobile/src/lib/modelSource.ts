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

export type ModelId = "qwen25" | "falconR" | "lfm230";

/**
 * How a model's chat template handles reasoning.
 *
 * Carried as DATA rather than branched on by id, because every model added so
 * far has needed a different answer and the code was starting to accumulate
 * `id === "qwen17"` checks. A new model should be describable, not coded for.
 *
 *   "none"      the template never opens a reasoning block. The toggle has
 *               nothing to switch and the model simply answers.
 *   "no-think"  the template honours a `/no_think` marker in the message.
 *   "config"    the engine's ThinkingOptions reaches it (Gemma 4 family).
 *   "forced"    the model reasons and CANNOT be stopped from here - Qwen3 is
 *               the example. The toggle says so instead of doing nothing.
 */
export type ThinkingControl = "none" | "no-think" | "config" | "forced";

/**
 * What the reasoning toggle will ACTUALLY do for this model.
 *
 * Returned as text for the UI, because a switch that silently does nothing on
 * some models is worse than one that explains itself.
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
   * desynchronises the moment a model changes, and one already did.
   */
  approxBytes: number;
  /**
   * Audio and image input. None of the models in this build has it — the only
   * multimodal option in LiteRT-LM is the Gemma 4 family, and E4B took 45
   * seconds to load and 144 seconds to answer on this handset. See the note
   * on MODELS below.
   */
  multimodal: boolean;
  /** See ThinkingControl. Verified by reading each bundle's chat template. */
  thinking: ThinkingControl;
  /** One line under the label in the picker. */
  blurb: string;
}

/**
 * Three small models, and no large one. That is a deliberate retreat.
 *
 * Gemma 4 E4B works on this phone - GPU/4096, 45 s to load, 3.3 GB resident,
 * correct answers with real clause references. It is also 144 seconds to
 * answer a ledger question, and a demo where the officer waits two and a half
 * minutes is not a demo. E2B was no better: 115 s to load, 74 s to answer.
 *
 * The Gemma family is the ONLY multimodal option in LiteRT-LM, so dropping it
 * costs speech and photograph input outright - the spoken-Hindi moment goes
 * with it. That is the price of the trade and it is worth stating plainly
 * rather than discovering during a rehearsal. E4B is kept in models-archive/,
 * ready to return on hardware that can carry it.
 *
 * Every model here has had its chat template extracted from the .litertlm
 * bundle and READ. That is what caught Qwen3-1.7B, which loaded perfectly on
 * GPU/4096 and then answered a ledger question by saying the question was
 * unclear: its template ended with
 *
 *     {%- if not enable_thinking|default(true) %}{{- '<think>...</think>' }}
 *
 * so reasoning was on unless something turned it off, and nothing in this
 * runtime can. Marker-counting is not enough either - LFM2.5 mentions
 * </think> inside a clause that STRIPS reasoning from past messages, which a
 * naive check reports as a reasoning model.
 *
 * Only ever ONE is resident, and switching between them mid-session does not
 * work - see switchModel() in llm.ts.
 */
export const MODELS: ModelSpec[] = [
  {
    id: "qwen25",
    filename: "Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm",
    label: "Qwen2.5 1.5B",
    approxBytes: 1_597_931_520,
    multimodal: false,
    thinking: "none",
    blurb: "Most capable here · int8 · text only",
  },
  {
    id: "falconR",
    filename: "Falcon-H1-Tiny-R-0.6B_int8.litertlm",
    label: "Falcon-H1 0.6B R",
    approxBytes: 873_254_788,
    multimodal: false,
    // The R is Reasoning: this model is TRAINED to reason, so it may show its
    // working in the answer even though nothing forces it to. The template was
    // read and ends cleanly at <|im_start|>assistant with no <think> injection,
    // so it is not the Qwen3 trap - that one defaulted enable_thinking to true
    // and could not be switched off from here. Watch the output anyway: a
    // reasoning-tuned model can still ramble past a 150-token budget.
    thinking: "none",
    blurb: "Reasoning-tuned · int8 · may show its working",
  },
  {
    id: "lfm230",
    filename: "LFM2.5-230M_int4.litertlm",
    label: "LFM2.5 230M",
    approxBytes: 176_756_720,
    multimodal: false,
    thinking: "none",
    blurb: "Smallest · instant · light chat only",
  },
];


/**
 * The most capable of the three. Speed was the reason for dropping Gemma, but
 * the smallest model here is explicitly not for clause work, so the default
 * should still be the one that can do the job.
 */
export const DEFAULT_MODEL_ID: ModelId = "qwen25";

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
 * If it was bundled into the APK, this copies it out on first use. E4B is
 * 2.97 GB, so that takes a while and should happen behind a progress
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

/** "2.97 GB" / "706 MB" */
export function formatBytes(n: number): string {
  return n >= 2 ** 30
    ? `${(n / 2 ** 30).toFixed(2)} GB`
    : `${Math.round(n / 2 ** 20)} MB`;
}
