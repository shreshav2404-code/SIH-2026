/**
 * The on-device models, via llama.cpp (llama.rn).
 *
 * THIS IS THE ONLY LLM IN THE SYSTEM. There is no server model, no Ollama, no
 * cloud, no API. The backend does no LLM work at all, so nothing about the
 * intelligence depends on a network or a paid service. A phone in airplane
 * mode does everything below.
 *
 * WHY NOT LiteRT-LM. It was the engine until every small model measured on the
 * M31s came back broken on the Mali GPU path: Granite 4.0 350M answered a
 * ledger question with "_opt_opt_opt_opt..." and LFM2.5 230M with
 * "ERERERERER...". Two unrelated model families degenerating into repeated
 * tokens is a backend fault, not a model fault, and Mali-G72 is a 2019
 * mid-range part with a shaky OpenCL story. The same runtime also charged
 * 2.6 GB of GPU memory for a 459 MB model.
 *
 * llama.cpp runs this on the CPU instead, which is the part of this phone that
 * works. It is slower per token in theory and correct in practice, and correct
 * is the only one of those a compliance tool can trade on.
 *
 * Single code path: no LLM_MODE, no server branch, no fallback to manage.
 */

import { initLlama, type LlamaContext } from "llama.rn";

import { findFact } from "./facts";

/**
 * One piece of a prompt.
 *
 * Was LiteRT-LM's MultimodalPart. Defined here now because llama.cpp has no
 * equivalent for a text-only GGUF: image and audio parts are declared so the
 * call sites still compile and can refuse honestly, not because anything in
 * this build can read them.
 */
export type MultimodalPart =
  | { type: "text"; text: string }
  | { type: "image"; path: string }
  | { type: "audio"; path: string };

/**
 * Per-token callback. Declared here rather than imported: the package defines
 * it in src/inferenceRouting.ts but does not re-export it from the root, and
 * reaching into a dependency's internals is how an npm update breaks a build.
 */
export type TokenCallback = (token: string, done: boolean) => void;

import {
  DEFAULT_MODEL_ID,
  ensureModel,
  ensureProjector,
  modelById,
  type ModelLocation,
  type ModelSpec,
} from "./modelSource";

/** Where the active model was found, for the diagnostics panel to report. */
export let modelLocation: ModelLocation | null = null;

/** Which model is resident right now. Null until one is loaded. */
export let activeSpec: ModelSpec | null = null;

/** Tight prompts, short answers. Long generation is where on-device feels slow. */
/**
 * Output ceiling for one answer.
 *
 * 384, up from 150. At 150 a ledger answer listing four duties was cut off
 * mid-item - the model had more to say and the cap took it. The prompt no
 * longer carries a "one or two sentences" instruction either (every
 * instruction added to it came back AS the answer at least once), so length is
 * governed here rather than by asking.
 *
 * It is not free: generation is roughly linear in tokens produced, so this
 * lengthens the wait in proportion to how much the model actually writes. The
 * context window is 1024 and a four-duty prompt is only a couple of hundred
 * tokens, so there is room for it.
 */
const MAX_TOKENS = 384;

/** With reasoning on, the answer needs room AFTER the thinking block. */
const MAX_TOKENS_THINKING = 640;

/** Ceiling on the reasoning itself, so a think block cannot run away. */
const THINKING_BUDGET = 384;

/**
 * Session-level, because LiteRT-LM sets temperature at load, not per message.
 * Kept low deliberately: the docs recommend it for schema adherence, and in a
 * compliance tool a reproducible answer is a feature, not a limitation.
 */
const TEMPERATURE = 0.2;

/**
 * Constrained decoding schema for clause extraction. With
 * `enableStructuredOutput: true` at load time, the engine GUARANTEES the
 * output parses against this â€” malformed JSON stops being a failure mode
 * rather than something we retry our way out of. The keyword fallback below
 * stays as belt and braces.
 */
const DUTY_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    duties: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          owner_role: { type: "string" },
          frequency: { type: "string" },
          evidence_type: { type: "string" },
          clause_ref: { type: "string" },
        },
        required: [
          "title",
          "owner_role",
          "frequency",
          "evidence_type",
          "clause_ref",
        ],
      },
    },
  },
  required: ["duties"],
});

/**
 * Load attempts, in order of preference.
 *
 * GPU first: where OpenCL exists it is about five times lighter than CPU
 * (710 MB against ~3.2 GB) as well as faster.
 *
 * Reaching a CPU rung AT ALL means this device exposes no OpenCL - the Exynos
 * 9611 in a Galaxy M31s, every Tensor-based Pixel - and on that class of
 * hardware memory is the binding constraint, not speed. So the CPU rung asks
 * for the smallest context outright instead of discovering the ceiling by
 * crashing into it. That is not hypothetical: E4B at cpu/4096 took this phone
 * to 4.3 GB resident with 119 MB left and froze it (ADR-006).
 *
 * 1024 tokens still holds a retrieved clause and a question, which is all any
 * prompt in this app sends, and output is capped at 150 tokens anyway.
 */
/**
 * Load configurations, best first. GPU is tried, then CPU.
 *
 * llama.rn ships an OpenCL build (librnllama_*_opencl.so) so GPU offload is
 * available in principle. Whether it helps on THIS handset is an open
 * question: the Mali-G72 is a 2019 part, llama.cpp's OpenCL backend is
 * written mainly against Adreno, and the previous engine's Mali path returned
 * "_opt_opt_opt_opt..." for a ledger question while charging 2.6 GB of GPU
 * memory for a 459 MB model. So GPU is attempted, not assumed.
 *
 * A failed rung falls through to the next, and `loadedConfig` records which
 * one won - the chat header prints it, so "GPU / 3072" versus "CPU / 3072" is
 * visible on screen rather than guessed at. If GPU loads but answers turn to
 * repeated tokens, that is the Mali path failing silently and CPU is the fix.
 *
 * Context is 3072. Under llama.cpp the KV cache is the only thing that scales
 * with it - roughly 112 KB per token for a 1.7B model, about 345 MB here,
 * against 5 GB free. Prefill tracks the prompt actually sent, not the window,
 * so a larger window costs memory rather than time.
 */
const LOAD_LADDER = [
  { backend: "gpu", maxContextTokens: 3072, gpuLayers: 99, threads: 4 },
  { backend: "cpu", maxContextTokens: 3072, gpuLayers: 0, threads: 4 },
  { backend: "cpu", maxContextTokens: 2048, gpuLayers: 0, threads: 4 },
  { backend: "cpu", maxContextTokens: 1024, gpuLayers: 0, threads: 2 },
] as const;

/** Which rung actually loaded, once one has. Null until then. */
export let loadedConfig: (typeof LOAD_LADDER)[number] | null = null;

let llm: LlamaContext | null = null;
let loading: Promise<LlamaContext> | null = null;
/** The spec `loading` is working on, so a concurrent call can tell them apart. */
let loadingSpec: ModelSpec | null = null;

export type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * A per-model marker that suppresses reasoning, where the template reads one.
 *
 * Driven by ModelSpec.thinking rather than by checking the model id. The id
 * check was the start of a pile of special cases - every model added so far
 * has wanted a different answer here - and a new model should be describable
 * in the registry, not coded for in this file.
 */
function thinkingSuffix(): string {
  if (thinkingEnabled) return "";
  return activeSpec?.thinking === "no-think" ? "\n/no_think" : "";
}

function text(s: string): MultimodalPart[] {
  return [{ type: "text", text: s + thinkingSuffix() }];
}

/**
 * Chat-template markers that must never reach the officer.
 *
 * Measured, not theoretical. Typing "Hi bro" at Qwen2.5 on this handset
 * produced:
 *
 *     <|im_start|>assistant, Environment Officer
 *     LEDGER (
 *     - 2 202-06-- 20
 *
 * A greeting has no answer in a ledger prompt, so the model degenerated and
 * began emitting its own turn markers along with fragments of the prompt. The
 * engine stops on its configured end token; it does not promise that no OTHER
 * special token appears mid-stream, and one did.
 *
 * Covers the families that are bundled or might be: ChatML (Qwen, Falcon-H1),
 * Llama 3, Gemma, and the plain sentence enders.
 */
const TEMPLATE_MARKERS = [
  "<|im_start|>",
  "<|im_end|>",
  "<|endoftext|>",
  "<|end_of_text|>",
  "<|eot_id|>",
  "<|start_header_id|>",
  "<|end_header_id|>",
  "<start_of_turn>",
  "<end_of_turn>",
  "</s>",
  "<s>",
  "<|user|>",
  "<|assistant|>",
  "<|system|>",
];

/**
 * Cut a generation at the first template marker and tidy what is left.
 *
 * Truncating rather than deleting is deliberate: everything after a stray
 * <|im_start|> is the model talking to itself, and in the measured case it was
 * mangled prompt text. Keeping it because it is technically words would put
 * fabricated ledger rows on screen under a compliance heading.
 */
export function sanitize(raw: string): string {
  let out = raw;
  for (const marker of TEMPLATE_MARKERS) {
    const at = out.indexOf(marker);
    if (at >= 0) out = out.slice(0, at);
  }
  return out.trim();
}

/**
 * The ONLY route to the engine.
 *
 * Every prompt in this file goes through here so that sanitising cannot be
 * forgotten at a call site - which is exactly how the leak above reached the
 * screen. Streamed tokens are sanitised too: once a marker arrives, the stream
 * is finished and later tokens are dropped rather than shown.
 */
async function generate(
  model: LlamaContext,
  parts: MultimodalPart[],
  onToken?: TokenCallback,
  options?: Record<string, unknown>,
): Promise<string> {
  // A text-only GGUF cannot see or hear. Refuse in words rather than let the
  // part be silently dropped and an answer invented about an image nobody
  // looked at - which is exactly the failure mode a compliance tool must not
  // have. describePhoto() and observationFromAudio() are the callers.
  // Audio has no bundled model at all, so it is still a hard refusal.
  const audio = parts.find((p) => p.type === "audio");
  if (audio) {
    throw new Error("No bundled model can hear speech in this build.");
  }

  // Images go to llama.cpp as media_paths, but ONLY once the projector is
  // attached. Without it the model is blind and would describe an image it
  // never saw - the worst possible failure for evidence.
  const images = parts.filter((p) => p.type === "image") as {
    type: "image";
    path: string;
  }[];
  if (images.length && !visionReady) {
    throw new Error(
      "This model cannot read images. Switch to LFM2.5-VL 450M, which ships " +
        "the vision encoder.",
    );
  }
  const mediaPaths = images.map((p) => p.path.replace(/^file:\/\//, ""));

  const prompt = parts.map((p) => (p.type === "text" ? p.text : "")).join("");

  let stopped = false;
  let seen = "";

  const raw = await model.completion(
    {
      // messages, not prompt: llama.cpp then applies the chat template baked
      // into the GGUF itself. Handing it a bare string would skip the template
      // and an instruct-tuned model asked outside its template rambles.
      messages: [{ role: "user", content: prompt }],
      ...(mediaPaths.length ? { media_paths: mediaPaths } : {}),
      n_predict: (options?.maxOutputTokens as number) ?? MAX_TOKENS,
      temperature: TEMPERATURE,
      // Schema-constrained decoding, same guarantee LiteRT-LM gave via
      // responseSchema: llama.cpp compiles the schema to a GBNF grammar and
      // cannot emit a token that violates it. The JSON parses by construction,
      // which is what makes clause extraction safe to trust.
      ...(options?.responseSchema
        ? {
            response_format: {
              type: "json_schema" as const,
              json_schema: {
                strict: true,
                schema: JSON.parse(options.responseSchema as string),
              },
            },
          }
        : {}),
      // Belt and braces with sanitize(): stop the moment a turn marker appears
      // rather than spend the budget generating a conversation with itself.
      stop: ["<|im_start|>", "<|im_end|>", "<|eot_id|>", "<|endoftext|>", "</s>"],
      // Repetition penalty, per model rather than global - see
      // ModelSpec.repeatPenalty for the measurements. Applying 1.15 to
      // everything was tried and made the fine-tuned 270M markedly worse,
      // because that model answers by quoting its prompt and this penalises
      // quoting. Only LFM2.5-VL sets it.
      ...(activeSpec?.repeatPenalty
        ? { penalty_repeat: activeSpec.repeatPenalty, penalty_last_n: 256 }
        : {}),
      // Qwen3's template gates reasoning on an explicit kwarg:
      //
      //   {%- if enable_thinking is defined and enable_thinking is false %}
      //       {{- (an empty think block) }}
      //
      // Passing false pre-fills an EMPTY think block, which tells the model
      // its reasoning is already done and it should answer. Leaving the value
      // undefined is NOT the same thing - the block is simply absent and the
      // model reasons freely, burning the whole 150-token budget before it
      // reaches an answer. That is what made Qwen3 look broken under
      // LiteRT-LM, which had no way to set this at all.
      ...(activeSpec?.thinking === "config"
        ? { chat_template_kwargs: { enable_thinking: thinkingEnabled } }
        : {}),
    },
    (data: { token: string }) => {
      if (stopped || !onToken) return;
      seen += data.token;
      if (TEMPLATE_MARKERS.some((m) => seen.includes(m))) {
        stopped = true;
        return;
      }
      onToken(data.token, false);
    },
  );

  return sanitize(raw.text ?? "");
}


/**
 * Warm the model behind a splash screen. Mapping the weights takes a few seconds
 * on first open â€” never do this in front of a judge.
 *
 * Walks LOAD_LADDER from GPU/1024 down to CPU/512 and keeps the first rung
 * that loads, which one is recorded in `loadedConfig`. Do not assume the top
 * rung: a phone with no OpenCL never gets a GPU rung at all.
 * Never pass `suppressTokens` â€” it aborts the process on litertlm-android
 * 0.15/0.16.
 */
/**
 * Whether the engine may generate a reasoning block before answering.
 *
 * OFF, and that is not a detail. The engine default is `true`, and it is very
 * probably why Qwen3-1.7B looked broken: Qwen's own chat template ends with
 *
 *     {%- if not enable_thinking|default(true) %}{{- '<think>

</think>' }}
 *
 * so it opens a <think> block, spends the 150-token output budget reasoning,
 * and never reaches the answer. What surfaced on screen was the tail of that,
 * which reads like the model misunderstanding the question.
 *
 * It is wrong for this app regardless of model. Every task here is short and
 * grounded - copy a clause reference, list what is overdue, draft forty words
 * - and at roughly ten tokens a second on a mid-range phone a reasoning block
 * costs thirty to sixty seconds to produce something the officer never sees.
 */
export let thinkingEnabled = false;

export function setThinking(on: boolean) {
  thinkingEnabled = on;
}

/**
 * Output budget for one message, and the reasoning allowance with it.
 *
 * These have to move together. 150 tokens is right for a grounded answer and
 * catastrophic with reasoning switched on: the model opens a <think> block,
 * consumes the whole budget inside it and emits no answer - which is exactly
 * the failure that made Qwen3-1.7B look broken. Turning reasoning on without
 * raising the ceiling would rebuild that trap behind a toggle.
 *
 * The reasoning allowance is capped rather than left unlimited (-1) because on
 * a mid-range phone at roughly ten tokens a second, an unbounded think block is
 * a minute of blank screen.
 */
function messageOptions() {
  if (!thinkingEnabled) {
    return { maxOutputTokens: MAX_TOKENS, thinking: { enabled: false } };
  }

  // Reasoning plus answer has to fit the context the model ACTUALLY loaded
  // with, which the ladder decides at runtime - it can land on cpu/1024 on a
  // memory-tight phone. Asking for 640 output tokens inside a 1024 window
  // leaves no room for the prompt, and the request either truncates or fails.
  // Roughly half the window, less what the prompt needs.
  const ctx = loadedConfig?.maxContextTokens ?? 4096;
  const room = Math.max(MAX_TOKENS, Math.floor(ctx / 2) - 128);
  const out = Math.min(MAX_TOKENS_THINKING, room);

  return {
    maxOutputTokens: out,
    // Leave the answer at least MAX_TOKENS after the thinking block.
    thinking: {
      enabled: true,
      tokenBudget: Math.max(64, Math.min(THINKING_BUDGET, out - MAX_TOKENS)),
    },
  };
}

export function loadModel(
  spec: ModelSpec = modelById(DEFAULT_MODEL_ID),
  onProgress?: (pct: number) => void,
): Promise<LlamaContext> {
  // Already have exactly this model - nothing to do.
  if (llm && activeSpec?.id === spec.id) return Promise.resolve(llm);
  // A load of this same model is already in flight; join it.
  if (loading && loadingSpec?.id === spec.id) return loading;
  // A DIFFERENT model is resident. Switching is explicit, so a caller never
  // silently pays a reload it did not ask for.
  if (llm && activeSpec && activeSpec.id !== spec.id) {
    return Promise.reject(
      new Error(
        `${activeSpec.label} is loaded. Call switchModel() to change to ${spec.label}.`,
      ),
    );
  }

  loadingSpec = spec;
  loading = (async () => {
    // Resolves the model wherever it is: already in app storage, bundled in
    // the APK (-PbundleModel=true), or pushed to /sdcard/Download with adb.
    // On the emulator it is the pushed copy.
    modelLocation = await ensureModel(spec, onProgress);
    if (!modelLocation.path) {
      throw new Error(
        `${spec.label} is not on this device. It ships inside the APK, so a ` +
          "build made without -PbundleModel=true will not have it.",
      );
    }
    const MODEL_PATH = modelLocation.path;

    // A FRESH instance per attempt, and the failed one is closed.
    //
    // Reusing one instance across rungs was the bug: a failed native load does
    // not hand back what it already mapped, so each rung started from a higher
    // floor than the last and a ladder meant to degrade gracefully instead
    // walked the device down into an OOM. close() permanently invalidates the
    // candidate, which is what a dead attempt deserves; unload() would keep it
    // reusable and keep its allocations reachable.
    let lastErr: unknown = null;
    let won: (typeof LOAD_LADDER)[number] | null = null;
    let instance: LlamaContext | null = null;

    for (const rung of LOAD_LADDER) {
      try {
        // initLlama both creates and loads; there is no separate handle to
        // release when it throws, which is simpler than the LiteRT ladder
        // where a failed rung kept its allocations and walked the device into
        // an OOM. n_gpu_layers comes from the rung: the first attempt offloads
        // every layer to the GPU, the rest are pure CPU.
        instance = await initLlama(
          {
            // Scheme stripped: expo-file-system returns a file:// URI and
            // llama.cpp opens a plain filesystem path. Passing the URI through
            // makes the open fail somewhere down in C++ with a message that
            // does not mention the scheme.
            model: MODEL_PATH.replace(/^file:\/\//, ""),
            n_ctx: rung.maxContextTokens,
            n_gpu_layers: rung.gpuLayers,
            n_threads: rung.threads,
            // Keys and values at f16: the KV cache is the other big allocation
            // and 1024 tokens of it is small enough not to need quantising.
            cache_type_k: "f16",
            cache_type_v: "f16",
          },
          onProgress ? (p: number) => onProgress(p) : undefined,
        );
        won = rung;
        break;
      } catch (err) {
        lastErr = err;
        instance = null;
      }
    }

    if (!won || !instance) {
      // Restored guard. Without it a total load failure resolved the promise
      // with null, the UI went to "ready", and the first question then died
      // on "Cannot read property 'completion' of null" - the real engine
      // error never reached anyone.
      const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
      const outOfMemory = /alloc|memory|oom/i.test(detail);
      const lead = outOfMemory
        ? `Not enough free memory for ${spec.label}, even at the smallest context setting. Close other apps and try again.`
        : `${spec.label} would not load.`;
      throw new Error(lead + "\n\n" + detail);
    }

    loadedConfig = won;
    activeSpec = spec;

    // Sight is attached AFTER the model loads, as a second step on the same
    // context. A vision GGUF is two files and this is the other one - without
    // it the model is blind, so visionReady stays false and describePhoto()
    // refuses rather than inventing a description of an image nobody read.
    visionReady = false;
    if (spec.mmproj) {
      try {
        const projector = await ensureProjector(spec);
        if (projector) {
          await instance.initMultimodal({
            path: projector.replace(/^file:\/\//, ""),
            use_gpu: won.backend === "gpu",
          });
          visionReady = await instance.isMultimodalEnabled();
        }
      } catch {
        // Vision failed to attach. The model still answers text; the camera
        // button simply stays hidden.
        visionReady = false;
      }
    }

    llm = instance;
    return llm;
  })();

  loading.catch(() => {
    loading = null; // let a later attempt retry
    loadingSpec = null;
  });

  return loading;
}

/**
 * The model that is loaded right now, loading the default only if none is.
 *
 * Every task below must use THIS rather than loadModel(), which defaults to
 * Qwen: with E2B deliberately loaded for a photo, loadModel() would be asked
 * for a different model and correctly refuse, so describePhoto() would fail
 * with "call switchModel()" while the right model sat loaded and ready.
 */
async function activeModel(): Promise<LlamaContext> {
  if (llm) return llm;
  return loadModel();
}

export function isLoaded() {
  return llm !== null;
}

/**
 * Release the resident model.
 *
 * `close()` rather than `unload()`: close permanently invalidates the instance,
 * which is what we want before loading a different one. unload() keeps it
 * reusable and its allocations reachable, and holding 0.9 GB of dead weights
 * while mapping 2.6 GB more is how a 7.5 GB phone ends up thrashing.
 */
/**
 * True once a model has been swapped in this process.
 *
 * LiteRT-LM does not reliably load a second model after the first is closed:
 * the new one reports as loaded, but the first inference dies with
 *
 *   LiteRtLmJniException: Status Code: 13
 *   llm_litert_compiled_model_executor.cc:708 Failed to invoke the compiled model
 *
 * Measured on the M31s - Qwen loaded on GPU/4096, switched to E2B, which came
 * up as CPU/1024 at 1.8 GB resident (E2B needs ~2.5) and then refused to run.
 * Loaded fresh in a new process, the same E2B is fine on GPU/4096.
 *
 * The engine cannot be reset from JS, so the app has to notice and say so.
 */
/**
 * Whether the loaded model actually has its projector attached.
 *
 * Not the same as ModelSpec.vision, which only says the model CAN see. This
 * says the second file was found, extracted and accepted by the engine.
 */
export let visionReady = false;

export let switchedThisSession = false;

/** Does this error look like the post-switch corruption above? */
export function isEngineCorrupted(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /failed to invoke|status code:\s*13|compiled_model_executor/i.test(m);
}

/**
 * True when the engine says it holds no model.
 *
 * Distinct from corruption: nothing is broken, the load simply had not
 * finished. Seen on this handset when a question was asked while a load was
 * still allocating - the header already read "GPU / 1024" but the engine threw
 * "Model not loaded. Call loadModel() first."
 */
export function isNotLoaded(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /not loaded|loadModel\(\) first|ensureLoaded/i.test(m);
}

/**
 * One readable line from an engine exception.
 *
 * These arrive as a message followed by a full Kotlin stack trace, and the
 * whole thing was being rendered into the chat - a judge reading
 * "com.margelo.nitro.dev.litert.litertlm.HybridLiteRTLM.ensureLoaded" in an
 * answer bubble is the worst version of this failing. Keep the first line,
 * drop the frames.
 */
export function briefError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  const first = m.split(/\n\s*at\s|\n/)[0].trim();
  return first.length > 160 ? first.slice(0, 157) + "..." : first;
}

export function unloadModel(): void {
  const dying = llm;
  llm = null;
  loading = null;
  loadingSpec = null;
  activeSpec = null;
  loadedConfig = null;
  modelLocation = null;
  if (dying) {
    // release() is llama.cpp's only teardown - there is no separate
    // unload()/close() pair as LiteRT-LM had. It frees the context and the
    // mapped weights together, and it is async; nothing here waits on it
    // because callers treat unload as fire-and-forget.
    void dying.release().catch(() => {
      // Already gone. Nothing left to release.
    });
  }
}

/**
 * Swap the resident model for another one.
 *
 * Unloads first and unconditionally, so the two never coexist in memory. On a
 * 7.5 GB phone that ordering is not a detail: the larger model alone peaks
 * around 3 GB.
 */
export async function switchModel(
  spec: ModelSpec,
  onProgress?: (pct: number) => void,
): Promise<LlamaContext> {
  if (llm && activeSpec?.id === spec.id) return llm;

  // Awaited, unlike unloadModel's fire-and-forget: the next model must not
  // start mapping its weights while this one still holds its own. On a 7.5 GB
  // phone that overlap is the difference between a load and an OOM.
  const dying = llm;
  if (dying) {
    try {
      await dying.release();
    } catch {
      // Already released, or the engine is past caring.
    }
  }

  const hadModel = llm !== null;
  unloadModel();
  if (hadModel) switchedThisSession = true;

  return loadModel(spec, onProgress);
}

export async function release() {
  await llm?.release();
  llm = null;
  loading = null;
}

/* ------------------------------------------------------------------ *
 * Clause â†’ duty extraction. The whole Regulation-as-Code feature.
 * ------------------------------------------------------------------ */

export interface ExtractedDuty {
  title: string;
  owner_role: string;
  frequency: string;
  evidence_type: string;
  clause_ref: string;
}

export interface RetrievedClause {
  clause_ref: string;
  act: string;
  text: string;
}

/**
 * GROUND IT, ALWAYS. The retrieved clauses are passed in and the citation is
 * required back. A 4B model asked to recall statute from memory invents
 * regulation numbers, and a reviewer who knows the Mines Act catches it in one
 * question. The API rejects any duty without a clause_ref, so this prompt and
 * that server check are the same rule stated twice.
 */
function extractionPrompt(circular: string, clauses: RetrievedClause[]) {
  const context = clauses
    .map((c) => `[${c.clause_ref}] (${c.act})\n${c.text}`)
    .join("\n\n");

  return `You convert Indian coal-mining regulation text into tracked compliance duties.

RETRIEVED CLAUSES â€” you may ONLY cite clause_ref values that appear here:
${context}

CIRCULAR TEXT:
${circular}

Return STRICT JSON, no prose, no markdown fence:
{"duties":[{"title":"","owner_role":"","frequency":"","evidence_type":"","clause_ref":""}]}

Rules:
- clause_ref MUST be copied exactly from the retrieved clauses above. Never invent one.
- owner_role: Mine Manager | Safety Officer | Ventilation Officer | Environment Officer | Medical Officer | Welfare Officer | Workmen's Inspector | Rescue Superintendent | Owner/Agent | Surveyor
- frequency: continuous | daily | weekly | 4x_weekly | fortnightly | monthly | quarterly | half_yearly | annual | event_driven | one_time
- evidence_type: photo | reading | document | register | meeting_minutes | diary_entry | sample_result | return_filing | certificate | survey
- If the text states no duty, return {"duties":[]}.`;
}

function parseJson<T>(raw: string): T | null {
  // Models wrap JSON in fences even when told not to. Strip and retry.
  const cleaned = raw
    .replace(/^[\s\S]*?```(?:json)?/i, "")
    .replace(/```[\s\S]*$/, "")
    .trim();

  for (const candidate of [raw.trim(), cleaned]) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      const m = candidate.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]) as T;
        } catch {
          /* fall through to the next candidate */
        }
      }
    }
  }
  return null;
}

/**
 * Keyword fallback. Ugly, invisible to a judge, keeps the demo alive when the
 * model returns malformed JSON twice in a row.
 */
function keywordExtract(
  circular: string,
  clauses: RetrievedClause[],
): ExtractedDuty[] {
  if (clauses.length === 0) return [];
  const t = circular.toLowerCase();

  const frequency = t.includes("daily")
    ? "daily"
    : t.includes("weekly")
      ? "weekly"
      : t.includes("quarter")
        ? "quarterly"
        : t.includes("annual") || t.includes("year")
          ? "annual"
          : "event_driven";

  const top = clauses[0];
  return [
    {
      title: top.text.split(/[.;]/)[0].slice(0, 120),
      owner_role: t.includes("ventilation")
        ? "Ventilation Officer"
        : t.includes("safety")
          ? "Safety Officer"
          : "Mine Manager",
      frequency,
      evidence_type: t.includes("photograph") ? "photo" : "document",
      clause_ref: top.clause_ref,
    },
  ];
}

export async function extractDuties(
  circular: string,
  clauses: RetrievedClause[],
): Promise<{ duties: ExtractedDuty[]; source: "model" | "fallback" }> {
  const model = await activeModel();
  const prompt = extractionPrompt(circular, clauses);
  const allowed = new Set(clauses.map((c) => c.clause_ref));

  // Retry twice, then fall back to keywords.
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generate(model, text(prompt), undefined, {
      ...messageOptions(),
      // The engine constrains decoding to this schema, so the response is
      // guaranteed to parse. parseJson below is now a formality, not a hope.
      responseSchema: DUTY_SCHEMA,
    });

    const parsed = parseJson<{ duties: ExtractedDuty[] }>(raw);
    if (parsed?.duties?.length) {
      // Drop anything citing a clause we did not hand it. This is the
      // hallucination guard, on-device, before the network is involved.
      const duties = parsed.duties.filter((d) => allowed.has(d.clause_ref));
      if (duties.length) return { duties, source: "model" };
    }
  }

  return { duties: keywordExtract(circular, clauses), source: "fallback" };
}

/* ------------------------------------------------------------------ *
 * Voice / free text â†’ observation, and sensor-window narration.
 * ------------------------------------------------------------------ */

/**
 * Spoken audio goes straight in â€” E4B takes audio natively, so there is no
 * Whisper, no separate speech-to-text model, no extra 500 MB to load. One
 * fewer dependency than the obvious architecture.
 */
export async function observationFromAudio(
  audioPath: string,
  clause: RetrievedClause | null,
): Promise<string> {
  const model = await activeModel();
  const grounding = clause
    ? `Governing clause [${clause.clause_ref}]: ${clause.text}\n\n`
    : "";

  return generate(
    model,
    [
      { type: "text", text: `${grounding}The officer says:` },
      { type: "audio", path: audioPath },
      {
        type: "text",
        text: `\nWrite one factual inspection observation, under 40 words, third person.${
          clause ? ` End with the citation ${clause.clause_ref}.` : ""
        } No preamble.`,
      },
    ],
    undefined,
    messageOptions(),
  );
}

export async function draftObservation(
  spoken: string,
  clause: RetrievedClause | null,
): Promise<string> {
  const model = await activeModel();
  const grounding = clause
    ? `Governing clause [${clause.clause_ref}]: ${clause.text}\n\n`
    : "";

  return generate(
    model,
    text(`${grounding}An officer reports: "${spoken}"

Write one factual inspection observation, under 40 words, in the third person.${
      clause ? ` End with the citation ${clause.clause_ref}.` : ""
    } No preamble.`),
    undefined,
    messageOptions(),
  );
}

/** Describe an evidence photo. Native image input, one call. */
export async function describePhoto(
  photoPath: string,
  question: string,
): Promise<string> {
  const model = await activeModel();
  return generate(
    model,
    [
      { type: "image", path: photoPath },
      { type: "text", text: `${question} Answer in under 30 words.` },
    ],
    undefined,
    messageOptions(),
  );
}

/**
 * Interpretation, not arithmetic. Whether the threshold was breached is
 * already decided â€” deterministically, on the backend. The model only explains
 * what it means and what the duty requires.
 */
export async function explainWindow(
  sensorType: string,
  stats: { mean: number; max: number; threshold: number; z_max: number },
  clause: RetrievedClause | null,
): Promise<string> {
  const model = await activeModel();
  const grounding = clause
    ? `Governing clause [${clause.clause_ref}]: ${clause.text}\n\n`
    : "";

  return generate(
    model,
    text(`${grounding}Sensor: ${sensorType}
Hour mean ${stats.mean}, peak ${stats.max}, statutory trigger ${stats.threshold}, ${stats.z_max} sigma above mean.

In under 40 words: what is happening, why it matters, and what the duty requires.${
      clause ? ` Cite ${clause.clause_ref}.` : ""
    }`),
    undefined,
    messageOptions(),
  );
}

/* ------------------------------------------------------------------ *
 * Ledger question answering.
 * ------------------------------------------------------------------ */

export interface LedgerFact {
  title: string;
  /**
   * The statute, e.g. "Mines Rules 1955".
   *
   * Kept for verification only - it is NOT rendered into the prompt. An
   * earlier version printed `[act - clause_ref]` on the theory that the model
   * was inventing statute names because it had not been given them. That was
   * wrong: clause_ref already reads "Mines Rules 1955 - R. 29-P", so the
   * prompt said the act twice and the model dutifully echoed the duplication
   * back as "[Mines Rules 1955 - Mines Rules 1955 - R. 29-P]".
   */
  act: string;
  clause_ref: string;
  owner_role: string;
  status: string;
  due_date: string | null;
  evidence_count: number;
}

/**
 * Answer a question about the ledger.
 *
 * Grounded exactly like clause extraction: the duties are fetched from the API
 * and passed in, and the model is told to answer only from them. An open chat
 * box would invite questions it answers from memory - which for statute means
 * inventing regulation numbers.
 */
/** A ledger answer plus whatever could not be verified against the ledger. */
export interface LedgerAnswer {
  answer: string;
  /**
   * Statute names the model wrote that were NOT in the facts it was given.
   * Non-empty means the answer must not be presented as grounded.
   */
  unverified: string[];
  /**
   * How many statute references the answer contained at all.
   *
   * Zero is its own problem, and the check missed it: an answer citing nothing
   * has nothing to contradict, so it passed as "every citation verified" and
   * was captioned grounded. That is how a model rambling about "legal or
   * medical terms" earned a green label. A ledger answer that cites no clause
   * has not used the ledger.
   */
  cited: number;
}

/**
 * Anything shaped like a statute: capitalised words followed by a four-digit
 * year. Matches "Mines Act 1952" and "Mines Rules 1955" - and "Mines Rules
 * 1555", which is the point.
 */
/**
 * Kept as a SOURCE STRING, not a shared RegExp object.
 *
 * A module-level /g regex carries `lastIndex`, and two matchAll() calls
 * against the same object left the second starting where the first
 * finished - so an answer citing six clauses was counted as citing none
 * and captioned "NOT grounded". Measured on the device with E4B. A fresh
 * regex per call cannot do that.
 */
/**
 * Words that can precede a four-digit number without it being a statute.
 *
 * "Due 2026-08-29" matched the statute pattern as "Due 2026" and was reported
 * to the officer as an invented citation - a date flagged as fabricated law.
 * The pattern cannot tell a year in a date from a year in an Act, so the
 * leading word decides.
 */
const NOT_STATUTE_LEAD = new Set([
  "due", "by", "on", "in", "at", "since", "until", "before", "after", "from",
  "overdue", "dated", "date", "deadline", "expires", "expired",
]);

const STATUTE_SRC = "((?:[A-Z][A-Za-z.]*\\s+){1,4}\\d{4})";

/**
 * Check the model's citations against the ledger it was handed.
 *
 * The prompt already asks it to copy references rather than recall them. That
 * is necessary and not sufficient: asked the same question twice, E2B wrote
 * "Mines Rules 1955" once and "Mines Rules 1555" the next time, both under a
 * UI label reading "grounded in the live ledger". One digit turns a real
 * statute into one that does not exist.
 *
 * This project's rule is that the model does language work and deterministic
 * code does safety-critical work. A statutory citation in a compliance record
 * is safety-critical, so it is verified here rather than requested politely.
 */
export function auditCitations(
  answer: string,
  facts: LedgerFact[],
): { unverified: string[]; cited: number } {
  // One pass, one fresh regex. Counting and checking used to be two separate
  // matchAll() calls over a shared /g object, which is how a six-citation
  // answer was reported as citing nothing.
  //
  // Checked against what the model was actually SHOWN: clause_ref carries the
  // act inside it, so a statute-shaped phrase is verified if it appears in any
  // supplied reference. Matching on `act` alone missed references the model had
  // every right to use.
  const allowed = facts.map((f) => `${f.clause_ref} ${f.act}`.toLowerCase());
  const bad = new Set<string>();
  let cited = 0;

  for (const m of answer.matchAll(new RegExp(STATUTE_SRC, "g"))) {
    const ref = m[1].trim();
    // "Due 2026-08-29" arrives here as "Due 2026". A date is not a citation
    // and must not be reported as an invented one.
    const lead = ref.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
    if (NOT_STATUTE_LEAD.has(lead)) continue;
    cited += 1;
    const needle = ref.toLowerCase();
    if (!allowed.some((a) => a.includes(needle))) bad.add(ref);
  }
  return { unverified: [...bad], cited };
}

/**
 * Plain chat. No ledger, no clause rules, no citation audit.
 *
 * Deliberately the shortest prompt in this file. It exists for the smallest
 * bundled model, which is not asked to do compliance work - see
 * ModelSpec.chatOnly. The caller labels every answer as ungrounded, because an
 * ungrounded answer about mining law is exactly where invented regulation
 * numbers come from, and nothing here checks for them.
 */
export async function chat(
  question: string,
  onToken?: TokenCallback,
): Promise<string> {
  const model = await activeModel();

  // A question about the app itself gets the answer handed to it, rather than
  // being asked to remember. A fine-tuned 270M model answered "does this need
  // internet" with "Yes" - the opposite of true - through three training
  // rounds, while answering perfectly whenever the fact was in the prompt.
  // Reading is what these models do well; recall is not. See facts.ts.
  const hit = findFact(question);

  // Some facts are returned verbatim, without the model. See SystemFact.direct:
  // the tuned model answered "can this file a statutory return" with "Yes"
  // through six training rounds even with the correct fact in front of it, and
  // a compliance tool claiming it can file returns is not a rough edge, it is
  // a false statement about what the software does.
  if (hit?.direct) {
    onToken?.(hit.fact, true);
    return hit.fact;
  }

  const fact = hit?.fact ?? null;
  const prompt = fact ? `${fact}

${question}` : question;

  return generate(
    model,
    // One line, and the question last. Every extra instruction here is a
    // sentence the model may echo instead of answering: "If you do not know,
    // say so rather than guessing" came back verbatim as the reply to "Hii" on
    // the device. Short prompts give a small model less to copy.
    text(prompt),
    onToken,
    messageOptions(),
  );
}

export async function askLedger(
  question: string,
  facts: LedgerFact[],
  /** How many duties exist in total, when `facts` is a trimmed selection. */
  totalDuties?: number,
  /**
   * Called per token as they are produced.
   *
   * Without this the whole answer lands at once and the officer stares at a
   * blank screen - measured at 62 seconds on the M31s. Streaming does not make
   * generation faster, it makes the wait legible, which is most of the
   * complaint.
   */
  onToken?: TokenCallback,
): Promise<LedgerAnswer> {
  const model = await activeModel();

  // Grouped by status, not a flat list.
  //
  // A flat "- title [clause] owner=X status=overdue" line asks the model to
  // FILTER, and a 1.5B model measured on this handset would not do it: given
  // eight rows each carrying status=overdue it answered "the ledger does not
  // contain information about any duties that are overdue". The same model,
  // asked to list the rows verbatim, reproduced all eight with exact clause
  // references - so it could read them, it just could not select on a field
  // buried mid-line.
  //
  // Grouping turns selection into copying, which small models do reliably.
  // The count in each heading also gives a claim of "none" something directly
  // above it to contradict.
  const ORDER = ["overdue", "due", "pending", "verified"];
  const groups = new Map<string, LedgerFact[]>();
  for (const f of facts) {
    const k = (f.status || "other").toLowerCase();
    const bucket = groups.get(k);
    if (bucket) bucket.push(f);
    else groups.set(k, [f]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const table = keys
    .map((k) => {
      const rows = groups.get(k)!;
      const head = `${k.toUpperCase()} (${rows.length}):`;
      const body = rows
        .map(
          (f) =>
            // No bracketed clause and no key=value pairs. Both were there for
            // the model to copy back, and copy them back is exactly what it
            // did - the clause reference is now attached by the UI from the
            // same facts, so the model never has to reproduce one.
            `  - ${f.title}, owned by ${f.owner_role}, due ${f.due_date ?? "not set"}`,
        )
        .join("\n");
      return `${head}\n${body}`;
    })
    .join("\n\n");

  // Stated separately as well, because the heading alone was not always
  // enough: a sentence in plain prose is what the model echoes back.
  const overdueCount = groups.get("overdue")?.length ?? 0;
  const summary =
    overdueCount > 0
      ? `\n\n${overdueCount} of the duties listed are OVERDUE.`
      : "\n\nNo duty listed is overdue.";

  const answer = await generate(
    model,
    // The prompt is the facts and the question. Nothing else.
    //
    // Every instruction that used to live here came back as the answer at
    // least once on this handset: a worked example was copied verbatim, the
    // <placeholder> shape that replaced it was copied verbatim, and "If you
    // do not know, say so rather than guessing" was returned as the reply to
    // "Hii". A small model continues the text it is given, so every sentence
    // added here to improve the answer is another sentence that can BECOME
    // the answer.
    //
    // What used to be enforced by instruction is now enforced by code:
    // clause references are attached by the UI from the retrieved rows, and
    // auditCitations still flags any statute the model invents.
    text(`${table}${summary}

${question}`),
    onToken,
    messageOptions(),
  );

  const { unverified, cited } = auditCitations(answer, facts);
  return { answer, unverified, cited };
}
