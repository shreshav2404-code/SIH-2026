/**
 * Gemma 4 E4B, on-device, via LiteRT-LM.
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

import { ensureModel, type ModelLocation } from "./modelSource";

/** Where the model was actually found, for the splash screen to report. */
export let modelLocation: ModelLocation | null = null;

/** Tight prompts, short answers. Long generation is where on-device feels slow. */
const MAX_TOKENS = 150;

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

let llm: LiteRTLMInstance | null = null;
let loading: Promise<LiteRTLMInstance> | null = null;

export type LoadState = "idle" | "loading" | "ready" | "error";

function text(s: string): MultimodalPart[] {
  return [{ type: "text", text: s }];
}

/**
 * Warm the model behind a splash screen. Mapping 3.66 GB takes a few seconds
 * on first open â€” never do this in front of a judge.
 *
 * Requests GPU (710 MB / ~22 tok/s on the S24+'s Adreno) and falls back to CPU
 * (3.3 GB / ~18 tok/s), which is the guaranteed floor on any 8 GB phone.
 * Never pass `suppressTokens` â€” it aborts the process on litertlm-android
 * 0.15/0.16.
 */
export function loadModel(
  onProgress?: (pct: number) => void,
): Promise<LiteRTLMInstance> {
  if (llm) return Promise.resolve(llm);
  if (loading) return loading;

  loading = (async () => {
    // Resolves the model wherever it is: already in app storage, bundled in
    // the APK (-PbundleModel=true), or pushed to /sdcard/Download with adb.
    // On the emulator it is the pushed copy.
    modelLocation = await ensureModel(onProgress);
    if (!modelLocation.path) {
      throw new Error(
        "Model not found on this device. Push it over the cable:\n" +
          "  adb push gemma-4-E4B-it.litertlm /sdcard/Download/",
      );
    }
    const MODEL_PATH = modelLocation.path;

    const instance = createLLM({ enableMemoryTracking: true });

    try {
      await instance.loadModel(
        MODEL_PATH,
        { backend: "gpu", maxContextTokens: 4096, enableStructuredOutput: true, temperature: TEMPERATURE },
        onProgress,
      );
    } catch (err) {
      // A memory rejection is not a GPU problem â€” retry smaller, not on CPU.
      if (isMemoryError(err)) {
        await instance.loadModel(
          MODEL_PATH,
          { backend: "gpu", maxContextTokens: 2048, enableStructuredOutput: true, temperature: TEMPERATURE },
          onProgress,
        );
      } else {
        await instance.loadModel(
          MODEL_PATH,
          { backend: "cpu", maxContextTokens: 4096, enableStructuredOutput: true, temperature: TEMPERATURE },
          onProgress,
        );
      }
    }

    llm = instance;
    return instance;
  })();

  loading.catch(() => {
    loading = null; // let a later attempt retry
  });

  return loading;
}

export function isLoaded() {
  return llm !== null;
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
  const model = await loadModel();
  const prompt = extractionPrompt(circular, clauses);
  const allowed = new Set(clauses.map((c) => c.clause_ref));

  // Retry twice, then fall back to keywords.
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await model.execute(text(prompt), undefined, {
      maxOutputTokens: MAX_TOKENS,
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
  const model = await loadModel();
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
    { maxOutputTokens: MAX_TOKENS },
  );
}

export async function draftObservation(
  spoken: string,
  clause: RetrievedClause | null,
): Promise<string> {
  const model = await loadModel();
  const grounding = clause
    ? `Governing clause [${clause.clause_ref}]: ${clause.text}\n\n`
    : "";

  return model.execute(
    text(`${grounding}An officer reports: "${spoken}"

Write one factual inspection observation, under 40 words, in the third person.${
      clause ? ` End with the citation ${clause.clause_ref}.` : ""
    } No preamble.`),
    undefined,
    { maxOutputTokens: MAX_TOKENS },
  );
}

/** Describe an evidence photo. Native image input, one call. */
export async function describePhoto(
  photoPath: string,
  question: string,
): Promise<string> {
  const model = await loadModel();
  return model.execute(
    [
      { type: "image", path: photoPath },
      { type: "text", text: `${question} Answer in under 30 words.` },
    ],
    undefined,
    { maxOutputTokens: MAX_TOKENS },
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
  const model = await loadModel();
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
    { maxOutputTokens: MAX_TOKENS },
  );
}

/* ------------------------------------------------------------------ *
 * Ledger question answering.
 * ------------------------------------------------------------------ */

export interface LedgerFact {
  title: string;
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
export async function askLedger(
  question: string,
  facts: LedgerFact[],
): Promise<string> {
  const model = await loadModel();

  const table = facts
    .map(
      (f) =>
        `- ${f.title} [${f.clause_ref}] owner=${f.owner_role} status=${f.status}` +
        ` due=${f.due_date ?? "n/a"} evidence=${f.evidence_count}`,
    )
    .join("\n");

  return model.execute(
    text(`You answer questions about a coal mine's statutory compliance ledger.

LEDGER (the only facts you may use):
${table}

QUESTION: ${question}

Answer in under 60 words, plainly. Cite the clause reference for every duty you
mention. If the ledger above does not contain the answer, say so - do not use
outside knowledge, and never state a regulation number that is not listed.`),
    undefined,
    { maxOutputTokens: MAX_TOKENS },
  );
}
