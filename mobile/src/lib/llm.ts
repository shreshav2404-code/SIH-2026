/**
 * The on-device models, via LiteRT-LM.
 *
 * THIS IS THE ONLY LLM IN THE SYSTEM. There is no server model, no Ollama, no
 * cloud, no API. The backend does no LLM work at all, so nothing about the
 * intelligence depends on a network or a paid service. A phone in airplane
 * mode does everything below.
 *
 * Single code path: no LLM_MODE, no server branch, no fallback to manage.
 * The runtime picks GPU or CPU per device underneath us.
 */

import {
  createLLM,
  isMemoryError,
  type LiteRTLMInstance,
  type MultimodalPart,
} from "react-native-litert-lm";

/**
 * Per-token callback. Declared here rather than imported: the package defines
 * it in src/inferenceRouting.ts but does not re-export it from the root, and
 * reaching into a dependency's internals is how an npm update breaks a build.
 */
export type TokenCallback = (token: string, done: boolean) => void;

import {
  DEFAULT_MODEL_ID,
  ensureModel,
  modelById,
  type ModelLocation,
  type ModelSpec,
} from "./modelSource";

/** Where the active model was found, for the diagnostics panel to report. */
export let modelLocation: ModelLocation | null = null;

/** Which model is resident right now. Null until one is loaded. */
export let activeSpec: ModelSpec | null = null;

/** Tight prompts, short answers. Long generation is where on-device feels slow. */
const MAX_TOKENS = 150;

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
const LOAD_LADDER = [
  { backend: "gpu", maxContextTokens: 4096 },
  { backend: "gpu", maxContextTokens: 2048 },
  { backend: "cpu", maxContextTokens: 2048 },
  { backend: "cpu", maxContextTokens: 1024 },
] as const;

/** Which rung actually loaded, once one has. Null until then. */
export let loadedConfig: (typeof LOAD_LADDER)[number] | null = null;

let llm: LiteRTLMInstance | null = null;
let loading: Promise<LiteRTLMInstance> | null = null;
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
 * Warm the model behind a splash screen. Mapping 3.66 GB takes a few seconds
 * on first open â€” never do this in front of a judge.
 *
 * Walks LOAD_LADDER from GPU/4096 down to CPU/1024 and keeps the first rung
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
): Promise<LiteRTLMInstance> {
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
    let instance: LiteRTLMInstance | null = null;

    for (const rung of LOAD_LADDER) {
      const candidate = createLLM({ enableMemoryTracking: true });
      try {
        await candidate.loadModel(
          MODEL_PATH,
          {
            backend: rung.backend,
            maxContextTokens: rung.maxContextTokens,
            enableStructuredOutput: true,
            temperature: TEMPERATURE,
            // Session default. The engine's own default is true.
            thinking: { enabled: thinkingEnabled },
          },
          onProgress,
        );
        instance = candidate;
        won = rung;
        break;
      } catch (err) {
        lastErr = err;
        try {
          candidate.close();
        } catch {
          // Already dead. Nothing left to release.
        }
      }
    }

    if (!won) {
      // Report the last failure verbatim - the engine's own message names the
      // shortfall in MB, which is the number worth acting on.
      const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new Error(
        isMemoryError(lastErr)
          ? `Not enough free memory for ${spec.label}, even at the smallest ` +
            "context setting. Close other apps and try again." + "\n\n" + detail
          : detail,
      );
    }

    loadedConfig = won;
    activeSpec = spec;

    llm = instance!;
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
async function activeModel(): Promise<LiteRTLMInstance> {
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
export let switchedThisSession = false;

/** Does this error look like the post-switch corruption above? */
export function isEngineCorrupted(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /failed to invoke|status code:\s*13|compiled_model_executor/i.test(m);
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
    try {
      dying.close();
    } catch {
      // Already gone. Nothing left to release.
    }
  }
}

/**
 * Swap the resident model for another one.
 *
 * Unloads first and unconditionally, so the two never coexist in memory. On a
 * 7.5 GB phone that ordering is not a detail: E2B alone peaks at 2.5 GB.
 */
export async function switchModel(
  spec: ModelSpec,
  onProgress?: (pct: number) => void,
): Promise<LiteRTLMInstance> {
  if (llm && activeSpec?.id === spec.id) return llm;

  // unload() before close(): unload releases the native allocation while the
  // instance is still valid, close() then invalidates it. Doing only the
  // latter left memory mapped, which is part of why the second load lands in
  // a broken state.
  const dying = llm;
  if (dying) {
    try {
      await dying.unload();
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
  await llm?.unload();
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
    const raw = await model.execute(text(prompt), undefined, {
      ...messageOptions(),
      // Extraction is a copy-out task, not a reasoning one: the clauses are
      // in the prompt and the answer rearranges them. Reasoning spends time
      // here without improving the result.
      thinking: { enabled: false },
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
 * Spoken audio goes straight in â€” E2B takes audio natively, so there is no
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

  return model.execute(
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

  return model.execute(
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
  return model.execute(
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

  return model.execute(
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
const STATUTE_RE = /((?:[A-Z][A-Za-z.]*\s+){1,4}\d{4})/g;

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
export function unverifiedCitations(answer: string, facts: LedgerFact[]): string[] {
  // Check against what the model was actually shown. clause_ref carries the
  // act inside it, so a statute-shaped phrase is verified if it appears in ANY
  // supplied reference - matching on `act` alone missed references the model
  // had every right to use.
  const allowed = facts.map((f) => `${f.clause_ref} ${f.act}`.toLowerCase());
  const bad = new Set<string>();
  for (const m of answer.matchAll(STATUTE_RE)) {
    const cited = m[1].trim();
    const needle = cited.toLowerCase();
    if (!allowed.some((ref) => ref.includes(needle))) bad.add(cited);
  }
  return [...bad];
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

  // A trimmed list must never be presented as the whole ledger. Ask.tsx sends
  // the most relevant duties only, so the model is told what it is NOT seeing.
  const totalNote =
    totalDuties && totalDuties > facts.length
      ? `
(These are the ${facts.length} most relevant of ${totalDuties} duties.` +
        ` Do not claim this is the complete list.)`
      : "";

  const table = facts
    .map(
      (f) =>
        `- ${f.title} [${f.clause_ref}] owner=${f.owner_role} status=${f.status}` +
        ` due=${f.due_date ?? "n/a"} evidence=${f.evidence_count}`,
    )
    .join("\n");

  const answer = await model.execute(
    text(`You answer questions about a coal mine's statutory compliance ledger.

LEDGER (the only facts you may use):
${table}
${totalNote}

QUESTION: ${question}

Answer in under 60 words, plainly. Cite every duty you mention EXACTLY as it
appears in brackets above - copy it, do not rewrite it. If the ledger above
does not contain the answer, say so. Do not use outside knowledge, and never
state a statute or regulation number that is not listed above.`),
    onToken,
    messageOptions(),
  );

  const unverified = unverifiedCitations(answer, facts);
  const cited = [...answer.matchAll(STATUTE_RE)].length;
  return { answer, unverified, cited };
}
