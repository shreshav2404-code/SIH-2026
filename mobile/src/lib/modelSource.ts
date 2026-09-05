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

export type ModelId = "qwen3" | "tuned" | "lfmvl";

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
   * Can read an image. Separate from `audio` on purpose: LFM2.5-VL sees but
   * cannot hear, and a single `multimodal` flag would have offered a
   * microphone that no bundled model can listen through - failing at the
   * moment the officer taps it, which is the worst place to find out.
   */
  vision: boolean;
  /**
   * Can hear speech. Only the Gemma 4 family manages this in LiteRT-LM, and it
   * is archived for being too slow on this handset, so nothing in this build
   * sets it. The voice button hides itself rather than lying.
   */
  audio: boolean;
  /** See ThinkingControl. Verified by reading each bundle's chat template. */
  thinking: ThinkingControl;
  /**
   * Plain chat only - never given the ledger.
   *
   * The compliance prompt is a grouped duty table plus rules about copying
   * clause references exactly. That is a lot to ask of 230M parameters, and a
   * model that cannot follow it does not fail quietly: it invents regulation
   * numbers, which is the one failure this project cannot ship. So the
   * smallest model is not asked. It answers general questions, says so on
   * every reply, and the ledger work goes to a model that can carry it.
   */
  chatOnly: boolean;
  /**
   * Repetition penalty, or undefined for none.
   *
   * PER-MODEL, because a single global value was measured to help one model
   * and wreck another. LFM2.5-VL answered a photograph by repeating one
   * sentence fifteen times and needs 1.15. The fine-tuned 270M is the exact
   * opposite case: it answers by QUOTING the facts placed in its prompt, so a
   * repetition penalty is a penalty on quoting. Measured on four grounded
   * probes - 1.0 answered all four correctly, 1.05 already miscounted ("4
   * duties are overdue" from a two-row prompt), 1.15 produced multilingual
   * noise. Qwen3 is left alone because it was tested working without one.
   */
  repeatPenalty?: number;
  /**
   * The multimodal projector that gives this model sight, if it has one.
   *
   * A vision GGUF is always TWO files: the language model, and this - the
   * image encoder plus the projection that maps what it sees into the model's
   * embedding space. llama.cpp keeps them apart so text-only users need not
   * carry the encoder. The main file alone is blind.
   */
  mmproj?: string;
  /** One line under the label in the picker. */
  blurb: string;
}

/**
 * Three small models, and nothing above 460 MB. That is a deliberate retreat,
 * arrived at by measurement rather than preference.
 *
 * Gemma 4 E4B works on this phone and takes 144 seconds to answer a ledger
 * question. Qwen2.5 1.5B answers in ninety. Both were dropped, and so was the
 * assumption behind them - that a bigger model was the way to a better answer.
 * What actually cost the phone its memory was the CONTEXT WINDOW, not the
 * weights: at 4096 tokens every model measured settled near 4 GB resident
 * regardless of size, a 459 MB one no better than a 1.49 GB one. See
 * LOAD_LADDER in llm.ts.
 *
 * Dropping the Gemma family cost speech input outright, and dropping
 * LFM2.5-VL costs photographs - no model here reads an image, so the camera
 * and microphone buttons hide themselves rather than fail when tapped.
 *
 * Every model here has had its chat template extracted from the .litertlm
 * bundle and READ. That is what caught Qwen3-1.7B, which loaded perfectly on
 * GPU/4096 and then answered a ledger question by saying the question was
 * unclear: its template ended with
 *
 *     {%- if not enable_thinking|default(true) %}{{- '<think>...</think>' }}
 *
 * so reasoning was on unless something turned it off, and nothing in this
 * runtime can. All three below were checked the same way: LFM2.5 defaults
 * preserve_thinking to false, SmolLM2 is plain ChatML, and Granite opens no
 * reasoning block at all.
 *
 * Only ever ONE is resident, and switching between them mid-session does not
 * work - see switchModel() in llm.ts.
 */
export const MODELS: ModelSpec[] = [
  {
    id: "qwen3",
    filename: "Qwen_Qwen3-1.7B-Q4_0.gguf",
    label: "Qwen3 1.7B",
    approxBytes: 1_231_813_024,
    vision: false,
    audio: false,
    // The only model measured on this handset to answer a ledger question with
    // every owner and due date correct. Its template suppresses reasoning ONLY
    // when enable_thinking is explicitly false; undefined is not the same
    // thing, which is the trap that made it look broken under LiteRT-LM.
    thinking: "config",
    chatOnly: false,
    blurb: "Answers the ledger - q4_0 - reasoning can be switched off",
  },
  {
    id: "lfmvl",
    filename: "LFM2.5-VL-450M-Q4_0.gguf",
    mmproj: "mmproj-LFM2.5-VL-450m-Q8_0.gguf",
    label: "LFM2.5-VL 450M",
    approxBytes: 219_311_264,
    vision: true,
    audio: false,
    thinking: "none",
    chatOnly: true,
    // The one model measured to need this. See ModelSpec.repeatPenalty.
    repeatPenalty: 1.15,
    blurb: "Reads photographs - 209 MB + 98 MB encoder",
  },
  {
    id: "tuned",
    filename: "gemma-anupalan-Q4_0.gguf",
    label: "ANUPALAN 270M",
    approxBytes: 249_614_080,
    vision: false,
    audio: false,
    thinking: "none",
    // NOT chatOnly. This is the point of tuning it: a stock 270M could not be
    // trusted with a duty table, and this one is trained on 1,078 examples of
    // exactly that job - ledger rows, sensor windows, clause text and the
    // app's own facts, all in the prompt shapes llm.ts actually sends.
    chatOnly: false,
    blurb: "Trained on this project - 238 MB - fastest",
  },
];



/**
 * The most capable of the three, and still only 833 MB.
 *
 * Qwen2.5 1.5B held this slot and was removed. It was the best of the four on
 * paper and the worst on this handset: measured from a cold start it settled
 * at 4,079 MB resident and took ninety seconds to answer a ledger question.
 */
export const DEFAULT_MODEL_ID: ModelId = "qwen3";

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

/** A bundled model that can read images, or null if none can. */
export function visionModel(): ModelSpec | null {
  return MODELS.find((m) => m.vision) ?? null;
}

/** A bundled model that can hear speech, or null if none can. */
export function audioModel(): ModelSpec | null {
  return MODELS.find((m) => m.audio) ?? null;
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
/**
 * Make the multimodal projector available and return its path, or null.
 *
 * Separate from ensureModel() because it is a second file with its own size,
 * and because a text-only model must not pay for a check it can never need.
 * Vision is off unless BOTH files are present - a model that thinks it can see
 * and cannot would describe an image nobody looked at.
 */
export async function ensureProjector(spec: ModelSpec): Promise<string | null> {
  if (!spec.mmproj) return null;

  const target = new File(Paths.document, spec.mmproj);
  const asset = new File(Paths.bundle, spec.mmproj);

  const assetBytes = (() => {
    try {
      return asset.exists ? (asset.size ?? 0) : 0;
    } catch {
      return 0;
    }
  })();

  if (target.exists && (target.size ?? 0) > 0) {
    // Already extracted and the right size - reuse it.
    if (!assetBytes || (target.size ?? 0) === assetBytes) return target.uri;
    // A partial copy from an interrupted extraction. Start again.
    try {
      target.delete();
    } catch {
      /* best effort */
    }
  }

  if (!asset.exists) return null;
  await asset.copy(target);
  return target.uri;
}

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
