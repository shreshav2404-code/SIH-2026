import { CameraView, useCameraPermissions } from "expo-camera";
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchDuties, type Duty } from "../lib/api";
import { EXCAVATOR_PHOTO } from "../lib/photos";
import {
  DEFAULT_MODEL_ID,
  describeOrigin,
  describeThinking,
  thinkingIsSwitchable,
  loadPreferredModel,
  savePreferredModel,
  formatBytes,
  locateModel,
  modelById,
  MODELS,
  audioModel,
  visionModel,
  type ModelId,
  type ModelSpec,
} from "../lib/modelSource";
import type { LedgerFact } from "../lib/llm";

/**
 * react-native-litert-lm creates a native HybridObject at MODULE LOAD time.
 * Where the runtime skipped native init - an x86_64 emulator, say - that throws
 * during import and kills the whole app before React renders, with a red
 * "HybridObject ModelStore not registered" screen.
 *
 * So llm.ts is never imported statically. It is pulled in on demand, inside a
 * try/catch, and a failure degrades this one tab instead of the app.
 */
type Llm = typeof import("../lib/llm");
let llmModule: Llm | null = null;

async function getLlm(): Promise<Llm> {
  if (llmModule) return llmModule;
  try {
    llmModule = await import("../lib/llm");
    // A partially-initialised module leaves the exports undefined rather than
    // throwing, which surfaces later as "undefined is not a function" from
    // somewhere unrelated. Fail here instead, where the cause is obvious.
    if (typeof llmModule.loadModel !== "function") {
      throw new Error("engine did not initialise");
    }
    return llmModule;
  } catch (e) {
    llmModule = null;
    throw new Error(
      "The LiteRT-LM engine is not available on this device. " +
        (e instanceof Error ? e.message : String(e)),
    );
  }
}
import {
  askCloud,
  cloudConfigured,
  getActiveProfile,
  loadCloudOn,
  saveCloudOn,
} from "../lib/cloudFallback";
import { C, mono } from "../theme";

type Turn = {
  role: "you" | "model";
  text: string;
  note?: string;
  /**
   * The question that produced this answer, kept so it can be re-asked of the
   * cloud. Only set on answers where that is ALLOWED - never on a grounded
   * ledger answer, because re-asking one would mean sending duty rows to a
   * third party.
   */
  retryQuestion?: string;
};

type ModelState =
  | { kind: "idle" }
  | { kind: "loading"; pct: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

/**
 * How many duties go into a ledger prompt.
 *
 * FOUR, down from ten, and the reason is not only speed.
 *
 * A big table in the prompt is the highest-probability thing for a small model
 * to continue, so it reproduces the table instead of answering it. Measured on
 * this handset, Granite 3.1 MoE returned the same row dump - title, clause,
 * owner=, due=, evidence=0 - to every question asked of it, which reads as the
 * model being broken when it is really the prompt inviting a copy.
 *
 * Four rows is short enough that copying them IS a reasonable answer, and the
 * prefill it costs is roughly a third of ten rows. Prefill is paid on every
 * question before a single token is written, so this is the cheapest speed-up
 * available and it improves the answer at the same time.
 *
 * The risk is the opposite one - an aggregate question ("how many duties are
 * there?") must not be answered from a truncated list - which is why
 * askLedger() is always told the true total.
 */
const MAX_FACTS = 4;

/** Words too common to signal anything about which duty is being asked about. */
const STOPWORDS = new Set([
  "what","which","who","whom","whose","when","where","why","how","is","are",
  "was","were","the","a","an","and","or","of","for","to","in","on","at","by",
  "it","its","my","me","i","do","does","did","has","have","had","this","that",
  "there","their","them","they","get","got","need","needs","show","tell","list",
]);

/**
 * Pick the duties most likely to answer this question.
 *
 * Overdue duties sort first regardless of wording: they are the compliance
 * story, and a question that mentions none of them explicitly ("what should I
 * do first?") still means them. After that it is plain keyword overlap, which
 * is crude but runs instantly and needs no second model - MiniLM would be
 * better and is the intended upgrade, but it is not wired up on this path yet.
 */
function rankDuties(items: Duty[], question: string): Duty[] {
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  // How many duties contain each term. A word in half the corpus says almost
  // nothing about which duty is meant; a word in one duty says everything.
  // This is the idea behind IDF, done cheaply - the corpus is ~40 rows, so
  // there is no call for a real index or an embedding model.
  const docFreq = new Map<string, number>();
  for (const t of terms) {
    let n = 0;
    for (const d of items) {
      if (`${d.title} ${d.act} ${d.clause_ref} ${d.owner_role}`.toLowerCase().includes(t)) n += 1;
    }
    docFreq.set(t, n);
  }

  const asked = question.toLowerCase();
  const wantsOverdue = /overdue|late|past due|behind|outstanding|pending/.test(asked);

  const scored = items.map((d) => {
    const hay = `${d.title} ${d.act} ${d.clause_ref} ${d.owner_role} ${d.status}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (!hay.includes(t)) continue;
      const df = docFreq.get(t) ?? items.length;
      // Rare term in this corpus -> strong signal. Common term -> weak.
      score += Math.log(1 + items.length / Math.max(df, 1));
    }
    // A role named in the question is a near-certain filter ("what has the
    // Ventilation Officer got outstanding?"), so weight it heavily.
    if (d.owner_role && asked.includes(d.owner_role.toLowerCase())) score += 4;
    // Overdue first, but only mildly unless the question is about lateness -
    // otherwise every question drags the same overdue rows in and the answers
    // start to look identical whatever was asked.
    if (d.status === "overdue") score += wantsOverdue ? 3 : 0.5;
    return { d, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.d);
}

const OPENER_WORDS = new Set([
  "hi", "hey", "helo", "hello", "yo", "hola", "namaste", "namaskar", "sup",
  "thanks", "thank", "thankyou", "thank you", "ok", "okay", "k", "test",
  "testing", "ping", "hlo", "hey there", "hi there", "hello there", "hi bro",
  "hey bro", "good morning", "good afternoon", "good evening",
]);

/**
 * Does this message carry no question?
 *
 * Plain string matching, NOT a regular expression. The regex version passed
 * every case under Node and then did not fire on the handset, so a greeting
 * went through the full ledger prompt and came back as a confident answer
 * about the Medical Officer. Hermes is a different regex engine from V8 and
 * this project has already been bitten by one of its differences. A Set lookup
 * cannot diverge between engines.
 *
 * Runs of the same letter are collapsed first, because people type "Hiii" and
 * "Helloo" and an exact-match Set misses every one of them - which is exactly
 * what happened on the device after the first fix.
 */
/**
 * Collapse runs of one letter: "hiii" -> "hi", "okkk" -> "ok".
 *
 * Written as a loop, NOT the regex /(.){1,}/g, because that needs a
 * backreference and Hermes has now broken two different regexes in this
 * project that behaved perfectly under Node. A five-line loop cannot diverge
 * between engines, and this has to be right on the handset rather than in a
 * test.
 */
function collapseRuns(w: string): string {
  let out = "";
  for (const ch of w) if (ch !== out[out.length - 1]) out += ch;
  return out;
}

function isOpener(q: string): boolean {
  const cleaned = q
    .toLowerCase()
    .split("")
    .map((c) => (c >= "a" && c <= "z" ? c : " "))
    .join("")
    .split(" ")
    .filter(Boolean)
    .map(collapseRuns)
    .join(" ");
  return cleaned.length > 0 && OPENER_WORDS.has(cleaned);
}


/** Words that mean the question is actually about this mine's compliance. */
const LEDGER_WORDS = [
  "overdue", "due", "duty", "duties", "owe", "owner", "owns", "outstanding",
  "pending", "clause", "cite", "citation", "statute", "regulation", "rule",
  "evidence", "photo", "photograph", "inspection", "officer", "manager",
  "register", "return", "compliance", "ledger", "deadline", "late", "risk",
  "mine", "safety", "ventilation", "medical", "environment", "reclamation",
  "water", "vibration", "methane", "boundary", "lease", "report", "filing",
];

/**
 * Is this a question about the ledger, or just conversation?
 *
 * Cheap and deliberately generous: any compliance word at all sends it down
 * the grounded path. The cost of a false positive is a slightly heavier
 * prompt; the cost of a false negative is an ungrounded answer about statute,
 * which is the one thing this app must not produce. So it errs toward the
 * ledger and only plain conversation escapes.
 */
function looksLikeLedgerQuestion(q: string): boolean {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((w) => LEDGER_WORDS.includes(w));
}

/**
 * The clause line shown under a ledger answer.
 *
 * Built from the duties the app RETRIEVED, never from the model's text. That
 * is the whole point of dropping citations from the prompt: a reference the
 * model never writes is a reference it cannot get wrong. Copying a bracket
 * character-for-character was the hardest thing being asked of a 0.6B model
 * and the source of most of the bad answers.
 */
function clauseNote(duties: Duty[]): string {
  const refs = Array.from(new Set(duties.map((d) => d.clause_ref).filter(Boolean)));
  if (!refs.length) return "from the compliance ledger";
  return "from " + refs.join(" · ");
}

const SUGGESTIONS = [
  "What is overdue and who owns it?",
  "Which duties need a photo?",
  "What has the Ventilation Officer got outstanding?",
];

/**
 * Openers for a chatOnly model, which has no ledger to be asked about.
 *
 * None of these invite a statutory answer. Offering "what is overdue?" to a
 * model that cannot see the ledger would be inviting it to make one up.
 */
const CHAT_SUGGESTIONS = [
  "What is methane and why is it dangerous underground?",
  "Explain what a mine ventilation officer does.",
  "What does a hash chain prove about a record?",
];

export default function Ask({ lastPhotoUri }: { lastPhotoUri?: string | null }) {
  const [state, setState] = useState<ModelState>({ kind: "idle" });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** Partial answer while tokens arrive. Null when nothing is generating. */
  const [streaming, setStreaming] = useState<string | null>(null);
  /** Which model the user has chosen. Only one is ever resident. */
  const [activeId, setActiveId] = useState<ModelId>(DEFAULT_MODEL_ID);
  const scroller = useRef<ScrollView>(null);
  /** Read inside warm(), which is memoised and must not capture a stale value. */
  const thinkingRef = useRef(false);
  const insets = useSafeAreaInsets();

  /** Voice capture. The audio goes straight into the model; it never uploads. */
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);

  /**
   * Keyboard height, applied as bottom padding.
   *
   * KeyboardAvoidingView was tried first and does not work here: the app is
   * edge-to-edge (gradle.properties edgeToEdgeEnabled=true), so the window
   * never resizes and `behavior="height"` has nothing to shrink. Measured on
   * the device, the composer sat completely underneath the keyboard. Listening
   * for the keyboard and padding by its real height works regardless.
   */
  const [kbHeight, setKbHeight] = useState(0);

  /** Seconds the current answer has been generating. */
  const [elapsed, setElapsed] = useState(0);

  /**
   * Let the model reason before answering. Off, deliberately.
   *
   * The engine's own default is ON, which is very probably why Qwen3-1.7B
   * looked broken - it opened a reasoning block, spent the 150-token output
   * budget in it, and never reached the answer. Exposed rather than hidden
   * because it is a real capability, but every task in this app is short and
   * grounded and reasoning only costs time the officer is standing there for.
   */
  const [thinking, setThinkingOn] = useState(false);
  thinkingRef.current = thinking;

  /**
   * Apply the toggle immediately, not just at load.
   *
   * Reasoning is set per message as well as per session, so changing your mind
   * costs nothing - which matters here, because reloading a model to change a
   * setting would mean restarting the app (see switchModel in llm.ts).
   */
  useEffect(() => {
    llmModule?.setThinking?.(thinking);
  }, [thinking]);

  /** Camera capture, for asking the model about something in front of you. */
  const [camOpen, setCamOpen] = useState(false);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const spec = modelById(activeId);
  const found = locateModel(spec);

  /** Load a specific model, swapping out whatever is resident. */
  const warm = useCallback(async (want: ModelSpec) => {
    setState({ kind: "loading", pct: 0 });
    try {
      const llm = await getLlm();
      // Session-level: the engine reads it when the model loads, so it has to
      // be set before switchModel, not after.
      llm.setThinking(thinkingRef.current);
      // switchModel unloads first and unconditionally, so the two never
      // coexist in memory - which matters on a 7.5 GB phone where the larger
      // model alone peaks around 3 GB.
      await llm.switchModel(want, (pct) => setState({ kind: "loading", pct }));
      // Persist BEFORE anything can fail downstream: if the engine is now
      // corrupted the fix is to reopen the app, and that only helps if the
      // choice survived.
      await savePreferredModel(want.id);
      setActiveId(want.id);
      setState({ kind: "ready" });
    } catch (e) {
      setState({ kind: "error", message: String(e instanceof Error ? e.message : e) });
    }
  }, []);

  /**
   * Make sure the multimodal model is the one loaded.
   *
   * Vision and hearing are separate capabilities and separate models. Asking
   * for one the build does not carry has to fail HERE, with a sentence, rather
   * than inside the engine with a stack trace.
   */
  const ensureCapable = useCallback(
    async (want: "vision" | "audio"): Promise<boolean> => {
      const spec = want === "vision" ? visionModel() : audioModel();
      if (!spec) {
        push({
          role: "model",
          text:
            want === "vision"
              ? "No model in this build can read an image."
              : "No model in this build can hear speech. Only the Gemma 4 " +
                "family can, and it is not bundled - it was too slow on this " +
                "handset to be worth the wait.",
        });
        return false;
      }
      if (llmModule?.activeSpec?.id === spec.id) return true;
      push({
        role: "model",
        text: `Switching to ${spec.label} - it is the bundled model that can ${
          want === "vision" ? "read images" : "hear speech"
        }.`,
        note: "model switch",
      });
      await warm(spec);
      return llmModule?.activeSpec?.id === spec.id;
    },
    [warm],
  );

  const [hasCloud, setHasCloud] = useState(false);
  /**
   * CLOUD selected in the switcher.
   *
   * When on, EVERY question goes straight to the API and the on-device path is
   * not involved at all - no ledger fetch, no fact injection, no opener
   * handling. It is a plain chat backed by the key in Sync, which is what
   * "answer directly on the API key" means.
   *
   * The mine's data still cannot leave this way: askCloud() takes the question
   * string and nothing else, so there is no parameter to put duty rows in. The
   * question text is sent; the ledger is never read.
   */
  const [cloudOn, setCloudOn] = useState(false);
  /** Which saved provider is answering - there can be several. */
  const [cloudLabel, setCloudLabel] = useState<string | null>(null);
  useEffect(() => {
    void cloudConfigured().then(setHasCloud);
    void loadCloudOn().then(setCloudOn);
    void getActiveProfile().then((p) => setCloudLabel(p?.label ?? null));
  }, []);

  /** Re-check on every focus, so a key added in Sync lights the chip up. */
  useEffect(() => {
    if (!cloudOn) void cloudConfigured().then(setHasCloud);
    void getActiveProfile().then((p) => setCloudLabel(p?.label ?? null));
  }, [cloudOn, turns.length]);

  /** CLOUD answers on its own; nothing local needs to be resident for it. */
  const cloudAnswering = cloudOn && hasCloud;

  /** Re-ask ONE general question of the cloud model, on explicit request. */
  const askCloudFor = useCallback(async (question: string) => {
    push({ role: "you", text: question });
    setBusy(true);
    try {
      const answer = await askCloud(question);
      push({
        role: "model",
        text: answer,
        note: "answered by the cloud model - this question LEFT the device",
      });
    } catch (e) {
      push({
        role: "model",
        text: e instanceof Error ? e.message : String(e),
        note: "cloud fallback failed",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) =>
      setKbHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // A visible counter while the model works. This engine build does not emit
  // tokens as it goes - the whole answer arrives at once after a minute or so
  // - so without a counter the screen is simply still, and still looks broken.
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    // Only reflects an already-warm model; never triggers the import itself.
    if (llmModule?.isLoaded()) {
      setState({ kind: "ready" });
      if (llmModule.activeSpec) setActiveId(llmModule.activeSpec.id);
      return;
    }
    // Nothing loaded: restore the model chosen last time, so reopening the app
    // after a failed switch lands on the model the officer actually wanted.
    void loadPreferredModel().then((m) => setActiveId(m.id));
  }, []);

  function push(t: Turn) {
    setTurns((x) => [...x, t]);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
  }

  /**
   * `work` may return a bare string, or a string plus its own note when the
   * caption depends on the result - a ledger answer only earns "grounded" if
   * its citations actually check out.
   */
  async function run(
    label: string,
    work: (
      onToken: (chunk: string) => void,
    ) => Promise<string | { text: string; note?: string; retryQuestion?: string }>,
    note?: string,
  ) {
    if (state.kind !== "ready") {
      await warm(spec);
      if (!llmModule?.isLoaded()) return;
    }
    push({ role: "you", text: label });
    setBusy(true);
    setStreaming("");
    try {
      // Tokens land in `streaming`, which renders as a live bubble. The
      // finished turn is pushed once, so the transcript holds one entry.
      const result = await work((chunk) =>
        setStreaming((prev) => (prev ?? "") + chunk),
      );
      const body = typeof result === "string" ? result : result.text;
      const caption = typeof result === "string" ? note : (result.note ?? note);
      setStreaming(null);
      push({
        role: "model",
        text: body.trim(),
        note: caption,
        retryQuestion: typeof result === "string" ? undefined : result.retryQuestion,
      });
    } catch (e) {
      setStreaming(null);
      // A switch leaves LiteRT-LM unable to invoke. Say what to do about it
      // rather than printing a Kotlin stack trace at a mine inspector.
      const corrupted = llmModule?.isEngineCorrupted?.(e);
      const notLoaded = llmModule?.isNotLoaded?.(e);
      let text: string;
      let note: string | undefined;
      if (corrupted) {
        text =
          `The engine cannot run after switching models in the same session. ` +
          `Close and reopen the app — ${spec.label} is remembered and will ` +
          `load on its own.`;
        note = "known LiteRT-LM limitation, not a data problem";
      } else if (notLoaded) {
        text = `${spec.label} has not finished loading yet. Give it a moment and ask again.`;
        note = "the model was still being allocated";
      } else {
        // briefError keeps the first line only. The raw exception carries a
        // Kotlin stack trace and it was being printed into the chat.
        text = `Could not answer: ${llmModule?.briefError?.(e) ?? String(e)}`;
      }
      push({ role: "model", text, note });
    } finally {
      setBusy(false);
      setStreaming(null);
    }
  }

  /** Ledger Q&A. The duties are fetched and passed in, so the answer is
   *  grounded in this mine's actual data rather than the model's memory. */
  async function ask(question: string) {
    setInput("");

    // CLOUD is selected, so it answers - all of it, directly. Deliberately
    // ahead of every local branch: no opener canned reply, no ledger lookup,
    // no chatOnly special case. The officer picked the API; give them the API.
    if (cloudAnswering) {
      await askCloudFor(question);
      return;
    }

    // Answered here, not by the model. See OPENERS.
    if (isOpener(question)) {
      push({ role: "you", text: question });
      push({
        role: "model",
        text:
          "Ask me about this mine's compliance ledger — what is overdue, who " +
          "owns a duty, which duties still need a photograph, or what a " +
          "particular officer has outstanding. Every answer cites the clause " +
          "it came from.",
        note: "answered without the model",
      });
      return;
    }

    // A question that is not about this mine does not get the ledger, whatever
    // model is loaded. Handing a compliance table to "how are you" produced a
    // duty dump on the device and made the whole app look broken. The ledger
    // is for ledger questions; everything else is a conversation.
    if (!looksLikeLedgerQuestion(question)) {
      await run(
        question,
        async (onToken) => ({
          text: await (await getLlm()).chat(question, (tok: string) => onToken(tok)),
          note: "plain chat - NOT grounded in the ledger, do not cite this",
          // Only general questions carry this. A ledger answer never does.
          retryQuestion: question,
        }),
      );
      return;
    }

    // The smallest model is never given the ledger. It cannot reliably copy a
    // clause reference, and a model that gets that wrong invents statute
    // numbers instead of failing visibly. See ModelSpec.chatOnly.
    if (spec.chatOnly) {
      await run(
        question,
        async (onToken) => ({
          text: await (await getLlm()).chat(question, (tok: string) => onToken(tok)),
          note: "plain chat - NOT grounded in the ledger, do not cite this",
        }),
      );
      return;
    }

    await run(
      question,
      async (onToken) => {
        const { items } = await fetchDuties();
        // Only the duties that could plausibly answer THIS question. Sending
        // all 25 cost ~875 tokens of prefill on every message and was most of
        // a measured 62-second wait.
        const chosen = rankDuties(items, question).slice(0, MAX_FACTS);
        const facts: LedgerFact[] = chosen.map((d) => ({
          title: d.title,
          act: d.act,
          clause_ref: d.clause_ref,
          owner_role: d.owner_role,
          status: d.status,
          due_date: d.due_date,
          evidence_count: d.evidence_count,
        }));
        const { answer, unverified, cited } = await (await getLlm()).askLedger(
          question,
          facts,
          items.length,
          (tok: string) => onToken(tok),
        );

        // Citations are no longer asked of the model, so there is nothing to
        // count and no "grounded" claim to make. What survives is the guard
        // that matters: if the answer names a statute that was NOT among the
        // facts, the model invented it, and an invented regulation number in a
        // compliance tool is the one failure that cannot be shipped. Nothing
        // else about the answer is labelled.
        if (unverified.length) {
          return {
            text:
              answer +
              "\n\nNOT IN THIS LEDGER: " +
              unverified.join(", ") +
              ". Treat that as unverified.",
            note: "this answer names a statute that is not in the ledger",
          };
        }
        // The clause references shown under the answer are attached by the app
        // from the rows it retrieved, not written by the model.
        return {
          text: answer,
          note: clauseNote(chosen),
        };
      },
    );
  }

  /**
   * Record the officer speaking, then hand the audio to the model.
   *
   * The recording never leaves the phone: expo-audio writes it to app storage
   * and the file path goes straight into E4B, which takes audio natively. That
   * is the whole reason this app needs no speech-to-text service and works in
   * airplane mode.
   */
  async function toggleVoice() {
    if (recording) {
      setRecording(false);
      try {
        await recorder.stop();
      } catch {
        /* nothing was recording */
      }
      const uri = recorder.uri;
      if (!uri) return;
      // Hearing, not seeing. A vision model cannot transcribe.
      if (!(await ensureCapable("audio"))) return;
      await run(
        "Draft an observation from what I just said",
        async () => (await getLlm()).observationFromAudio(uri, null),
        "spoken on this device - audio never left the phone",
      );
      return;
    }

    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      push({
        role: "model",
        text: "Microphone permission was refused, so I cannot record.",
      });
      return;
    }
    try {
      await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      recorder.record();
      setRecording(true);
    } catch (e) {
      push({
        role: "model",
        text: `Could not start recording: ${e instanceof Error ? e.message : e}`,
      });
    }
  }

  /** Take a photo and ask the model about it. */
  async function openCamera() {
    if (!camPerm?.granted) {
      const r = await requestCamPerm();
      if (!r.granted) {
        push({ role: "model", text: "Camera permission was refused." });
        return;
      }
    }
    setCamOpen(true);
  }

  async function shoot() {
    try {
      const shot = await camera.current?.takePictureAsync({ quality: 0.6 });
      setCamOpen(false);
      if (!shot?.uri) return;
      if (!(await ensureCapable("vision"))) return;
      await run(
        "What does this show?",
        async () => (await getLlm()).describePhoto(shot.uri, "What is wrong here?"),
        "image read on this device",
      );
    } catch (e) {
      setCamOpen(false);
      push({
        role: "model",
        text: `Could not take the photo: ${e instanceof Error ? e.message : e}`,
      });
    }
  }

  // ---------------------------------------------------------------- render

  // With CLOUD on there is nothing to warm - the answers come from the API, so
  // making someone sit through a 50-second model load first would be theatre.
  if (state.kind !== "ready" && !cloudAnswering) {
    return (
      <ScrollView contentContainerStyle={s.gate}>
        <Text style={s.gateTitle}>On-device assistant</Text>
        <Text style={s.gateBody}>
          The model runs entirely on this device. No server, no cloud, no API —
          it answers in airplane mode.
        </Text>

        <Text style={s.pickLabel}>Choose a model</Text>
        {MODELS.map((m) => {
          const loc = locateModel(m);
          const picked = m.id === activeId;
          return (
            <TouchableOpacity
              key={m.id}
              style={[s.modelCard, picked && s.modelCardOn]}
              onPress={() => setActiveId(m.id)}
              disabled={state.kind === "loading"}
            >
              <View style={s.modelHead}>
                <Text style={[s.modelName, picked && s.modelNameOn]}>{m.label}</Text>
                <Text style={s.modelSize}>{formatBytes(m.approxBytes)}</Text>
              </View>
              <Text style={s.modelBlurb}>{m.blurb}</Text>
              <Text style={s.modelState}>
                {loc.path ? describeOrigin(loc.origin) : "extracts from the app on first use"}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[s.thinkRow, thinking && s.thinkRowOn]}
          onPress={() => setThinkingOn((v) => !v)}
          disabled={state.kind === "loading"}
        >
          <View style={{ flex: 1 }}>
            <Text style={[s.thinkLabel, thinking && s.thinkLabelOn]}>
              Let the model reason first
            </Text>
            {/* Say what the switch will actually do for the SELECTED model.
                Not every model can be told to stop reasoning, and one that
                silently ignores the toggle is worse than one that explains. */}
            <Text style={s.thinkNote}>{describeThinking(spec, thinking)}</Text>
            {!thinkingIsSwitchable(spec) && (
              <Text style={s.thinkWarn}>
                this switch has no effect on {spec.label}
              </Text>
            )}
          </View>
          <Text style={[s.thinkState, thinking && s.thinkLabelOn]}>
            {spec.thinking === "forced"
              ? "ALWAYS"
              : spec.thinking === "none"
                ? "N/A"
                : thinking
                  ? "ON"
                  : "OFF"}
          </Text>
        </TouchableOpacity>

        <View style={s.card}>
          <Row label="Selected">{spec.label}</Row>
          <Row label="Reasoning">{thinking ? "enabled" : "off (recommended)"}</Row>
          <Row label="On device">
            {found.bytes
              ? `${formatBytes(found.bytes)}${found.complete ? "" : " (incomplete)"}`
              : "not yet extracted"}
          </Row>
          <Row label="Status" last>
            {state.kind === "loading"
              ? `loading… ${Math.round(state.pct * 100)}%`
              : state.kind === "error"
                ? "failed"
                : "not loaded"}
          </Row>
        </View>

        {state.kind === "error" && (
          <View style={s.err}>
            <Text style={s.errText}>{state.message}</Text>
            <Text style={s.errHint}>
              llama.cpp needs a physical arm64 device and a GGUF it still
              supports. “Failed to load model” with no further detail usually
              means the quantisation was dropped from llama.cpp — the
              pre-repacked Q4_0_4_4 / _4_8 / _8_8 variants were removed in
              favour of repacking plain Q4_0 at runtime, and loading one fails
              exactly like this. Every other part of the app works regardless.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[s.primary, state.kind === "loading" && s.disabled]}
          onPress={() => warm(spec)}
          disabled={state.kind === "loading"}
        >
          {state.kind === "loading" ? (
            <View style={s.busyRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={s.primaryText}>Warming the model…</Text>
            </View>
          ) : (
            <Text style={s.primaryText}>
              {state.kind === "error" ? "Try again" : `Load ${spec.label}`}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={s.gateNote}>
          First use extracts the model out of the app, which takes a minute for
          the larger one. Every load after that is about 17 seconds. Warm it
          before a demo, never during one.
        </Text>
      </ScrollView>
    );
  }

  return (
    // The window does not resize when the keyboard opens, because the app is
    // edge-to-edge (gradle.properties: edgeToEdgeEnabled=true) and draws behind
    // the system bars - so adjustResize in the manifest is not enough on its
    // own and the composer ended up underneath the keyboard.
    <View style={[s.wrap, { paddingBottom: kbHeight }]}>
      <View style={s.banner}>
        <Text style={s.bannerText}>
          {cloudAnswering ? (
            `CLOUD · ${cloudLabel ?? "API"} · this device is not answering`
          ) : (
            <>
              ON-DEVICE · {llmModule?.activeSpec?.label ?? spec.label}
              {llmModule?.loadedConfig
                ? ` · ${llmModule.loadedConfig.backend.toUpperCase()} / ${llmModule.loadedConfig.maxContextTokens}`
                : ""}{" "}
              · no network used
            </>
          )}
        </Text>
      </View>

      {/* Switch model mid-conversation. switchModel() closes the resident one
          first, so both are never in memory at once. */}
      <View style={s.switcher}>
        <TouchableOpacity
          style={[s.thinkPill, thinking && s.thinkPillOn]}
          onPress={() => setThinkingOn((v) => !v)}
          disabled={busy}
        >
          <Text style={[s.thinkPillText, thinking && s.switchTextOn]}>
            {llmModule?.activeSpec && !thinkingIsSwitchable(llmModule.activeSpec)
              ? llmModule.activeSpec.thinking === "forced"
                ? "REASONS"
                : "FAST"
              : thinking
                ? "REASONING"
                : "FAST"}
          </Text>
        </TouchableOpacity>
        {MODELS.map((m) => {
          const on = (llmModule?.activeSpec?.id ?? activeId) === m.id;
          return (
            <TouchableOpacity
              key={m.id}
              style={[s.switchBtn, on && s.switchBtnOn]}
              onPress={() => !on && !busy && warm(m)}
              disabled={busy || on}
            >
              <Text style={[s.switchText, on && s.switchTextOn]}>
                {m.label}
                {m.vision ? " · photos" : ""}
                {m.audio ? " · voice" : ""}
              </Text>
            </TouchableOpacity>
          );
        })}
        {/* The odd one out, and deliberately styled as such. Every other chip
            picks a model that runs here; this one sends the question away. */}
        <TouchableOpacity
          style={[s.cloudPill, cloudOn && s.cloudPillOn]}
          onPress={() => {
            if (!hasCloud) {
              push({
                role: "model",
                text:
                  "No API key is set. Open the Sync tab, paste a key, and the " +
                  "CLOUD option here becomes available. Without one this app " +
                  "makes no model calls off the device at all.",
                note: "cloud fallback is not configured",
              });
              return;
            }
            setCloudOn((v) => {
              void saveCloudOn(!v);
              return !v;
            });
          }}
          disabled={busy}
        >
          <Text style={[s.cloudPillText, cloudOn && s.switchTextOn]}>CLOUD</Text>
        </TouchableOpacity>
      </View>

      {cloudAnswering && (
        <Text style={s.cloudNote}>
          Every question goes to {cloudLabel ?? "the API"} and LEAVES this
          device. The ledger is not read and no duty rows are sent — this is a
          plain chat. Switch provider in Sync.
        </Text>
      )}

      <ScrollView ref={scroller} style={s.thread} contentContainerStyle={{ padding: 12 }}>
        {turns.length === 0 && (
          <View>
            {/* A photograph of the thing this app is about, above the first
                prompt. An empty chat is the screen an officer sees most often
                on opening the tab, and a bare sentence on grey made it look
                unfinished. Ships as a data URI - see lib/photos.ts. */}
            <View style={s.heroWrap}>
              <Image source={{ uri: EXCAVATOR_PHOTO }} style={s.hero} />
              <View style={s.heroScrim} />
              <Text style={s.heroText}>ANUPALAN runs on this phone</Text>
              <Text style={s.heroSub}>no server · no cloud · answers in airplane mode</Text>
            </View>

            <Text style={s.hint}>
              {cloudAnswering
                ? "Ask anything — the API is answering, not this phone."
                : spec.chatOnly
                  ? "General questions only — this model is not given the ledger."
                  : "Ask about the ledger, or use a quick action."}
            </Text>
            {(cloudAnswering || spec.chatOnly ? CHAT_SUGGESTIONS : SUGGESTIONS).map((q) => (
              <TouchableOpacity key={q} style={s.chip} onPress={() => ask(q)}>
                <Text style={s.chipText}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {turns.map((t, i) => (
          <View
            key={i}
            style={[s.bubble, t.role === "you" ? s.you : s.model]}
          >
            <Text style={t.role === "you" ? s.youText : s.modelText}>{t.text}</Text>
            {t.note && <Text style={mono}>{t.note}</Text>}
          </View>
        ))}

        {/* Tokens as they arrive. Without this the screen sits blank for the
            whole generation, which measured 62 seconds on this phone. */}
        {streaming !== null && streaming.length > 0 && (
          <View style={[s.bubble, s.model]}>
            <Text style={s.modelText}>{streaming}</Text>
          </View>
        )}

        {busy && (streaming === null || streaming.length === 0) && (
          <View style={[s.bubble, s.model, s.busyBubble]}>
            <ActivityIndicator color={C.accent} size="small" />
            <Text style={s.busyText}>
              thinking on this device · {elapsed}s
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Hidden under CLOUD: these run ledger and sensor prompts against the
          resident model, which is not the one answering. */}
      <View style={[s.actions, cloudAnswering && { display: "none" }]}>
        {/* Both quick actions produce compliance language, so neither is
            offered on a chatOnly model. */}
        {!spec.chatOnly && (
        <>
        {/* Text in, observation out. This does NOT record audio yet - the
            sample sentence below stands in for a transcript, and the label
            says so rather than implying a microphone that is not wired up.
            Real capture arrives with expo-audio; see PROGRESS.md. */}
        <Action
          label="Draft observation (sample)"
          onPress={() =>
            run(
              "Draft an observation from: gas reading is high in panel three",
              async () =>
                (await getLlm()).draftObservation(
                  "gas reading is high in panel three, ventilation feels weak",
                  null,
                ),
              "sample text → structured observation",
            )
          }
        />
        <Action
          label="Explain readings"
          onPress={() =>
            run(
              "What do the methane readings mean?",
              async () =>
                (await getLlm()).explainWindow(
                  "methane",
                  { mean: 0.74, max: 1.62, threshold: 1.25, z_max: 4.3 },
                  null,
                ),
              "interpretation — the breach itself was decided by arithmetic",
            )
          }
        />
        {lastPhotoUri && (
          <Action
            label="Describe photo"
            onPress={async () => {
              // Only the multimodal model can read an image; swap first rather
              // than fail with an engine error the officer cannot act on.
              if (!(await ensureCapable("vision"))) return;
              await run(
                "What does the evidence photo show?",
                async () =>
                  (await getLlm()).describePhoto(lastPhotoUri, "What is wrong here?"),
                "native image input",
              );
            }}
          />
        )}
        </>
        )}
      </View>

      <View style={s.composer}>
        {/* Shown only when a bundled model can actually do the job.
            ensureCapable() still explains a missing capability, but an officer
            should not be offered a microphone that no model in this build can
            listen through - finding out at the moment you tap it is the worst
            possible time. In this build NEITHER shows: no bundled model reads
            an image or hears speech, so both buttons stay hidden rather than
            failing under a judge's thumb. */}
        {audioModel() && (
          <TouchableOpacity
            style={[s.iconBtn, recording && s.iconBtnRec]}
            onPress={toggleVoice}
            disabled={busy}
          >
            <Text style={[s.iconText, recording && s.iconTextRec]}>
              {recording ? "STOP" : "MIC"}
            </Text>
          </TouchableOpacity>
        )}
        {visionModel() && (
          <TouchableOpacity style={s.iconBtn} onPress={openCamera} disabled={busy}>
            <Text style={s.iconText}>CAM</Text>
          </TouchableOpacity>
        )}
        <TextInput
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about the ledger…"
          placeholderTextColor="#9aabbd"
          editable={!busy}
          onSubmitEditing={() => input.trim() && ask(input.trim())}
        />
        <TouchableOpacity
          style={[s.send, (!input.trim() || busy) && s.disabled]}
          onPress={() => input.trim() && ask(input.trim())}
          disabled={!input.trim() || busy}
        >
          <Text style={s.sendText}>Ask</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={camOpen} animationType="slide" onRequestClose={() => setCamOpen(false)}>
        <View style={s.camWrap}>
          <CameraView ref={camera} style={s.cam} facing="back" />
          <View style={[s.camBar, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity style={s.camCancel} onPress={() => setCamOpen(false)}>
              <Text style={s.camCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.shutter} onPress={shoot}>
              <Text style={s.shutterText}>Ask about this</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{children}</Text>
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.action} onPress={onPress}>
      <Text style={s.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },

  // ---- model picker (gate screen) ----
  pickLabel: {
    marginTop: 18, marginBottom: 8, fontSize: 11, fontWeight: "700",
    letterSpacing: 0.8, color: C.inkSoft,
  },
  modelCard: {
    backgroundColor: C.panel, borderRadius: 8, borderWidth: 1,
    borderColor: C.line, padding: 12, marginBottom: 8,
  },
  modelCardOn: { borderColor: C.accent, borderWidth: 2 },
  modelHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modelName: { fontSize: 15, fontWeight: "700", color: C.ink },
  modelNameOn: { color: C.accent },
  modelSize: { fontSize: 12, color: C.inkSoft, fontVariant: ["tabular-nums"] },
  modelBlurb: { marginTop: 3, fontSize: 12, color: C.inkSoft },
  modelState: { marginTop: 6, fontSize: 11, color: C.inkSoft, fontStyle: "italic" },
  thinkRow: {
    flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4,
    padding: 12, borderRadius: 8, borderWidth: 1,
    borderColor: C.line, backgroundColor: C.panel,
  },
  thinkRowOn: { borderColor: C.accent },
  thinkLabel: { fontSize: 13, fontWeight: "700", color: C.ink },
  thinkLabelOn: { color: C.accent },
  thinkNote: { marginTop: 2, fontSize: 11, lineHeight: 15, color: C.inkSoft },
  thinkWarn: { marginTop: 3, fontSize: 10, color: C.warn, fontStyle: "italic" },
  thinkState: { fontSize: 12, fontWeight: "700", color: C.inkSoft },

  // ---- model switcher (chat view) ----
  switcher: {
    flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  switchBtn: {
    flex: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6,
    borderWidth: 1, borderColor: C.line, alignItems: "center",
  },
  switchBtnOn: { backgroundColor: C.accent, borderColor: C.accent },
  switchText: { fontSize: 11, color: C.inkSoft },
  switchTextOn: { color: "#fff", fontWeight: "700" },
  thinkPill: {
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6,
    borderWidth: 1, borderColor: C.line, justifyContent: "center",
  },
  thinkPillOn: { backgroundColor: C.warn, borderColor: C.warn },
  cloudPill: {
    paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6,
    borderWidth: 1, borderColor: C.line, justifyContent: "center",
  },
  // Red, not the accent blue the model chips use. Selecting this breaks the
  // property the rest of the app is built on, and it should look like it.
  cloudPillOn: { backgroundColor: C.crit, borderColor: C.crit },
  cloudPillText: { fontSize: 10, fontWeight: "700", color: C.inkSoft, letterSpacing: 0.4 },
  cloudNote: {
    fontSize: 10, color: C.crit, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  thinkPillText: { fontSize: 10, fontWeight: "700", color: C.inkSoft, letterSpacing: 0.4 },

  // ---- voice / camera ----
  iconBtn: {
    paddingHorizontal: 10, paddingVertical: 10, borderRadius: 6,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.panel,
    justifyContent: "center",
  },
  iconBtnRec: { backgroundColor: C.crit, borderColor: C.crit },
  busyBubble: { flexDirection: "row", alignItems: "center", gap: 8 },
  busyText: { fontSize: 12, color: C.inkSoft },
  iconText: { fontSize: 10, fontWeight: "700", color: C.inkSoft, letterSpacing: 0.5 },
  iconTextRec: { color: "#fff" },
  camWrap: { flex: 1, backgroundColor: "#000" },
  cam: { flex: 1 },
  camBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 12, backgroundColor: "#000",
  },
  camCancel: { paddingVertical: 12, paddingHorizontal: 16 },
  camCancelText: { color: "#fff", fontSize: 14 },
  shutter: {
    backgroundColor: C.accent, paddingVertical: 14, paddingHorizontal: 22,
    borderRadius: 8,
  },
  shutterText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  gate: { padding: 20, paddingBottom: 40 },
  gateTitle: { fontSize: 20, fontWeight: "700", color: C.ink },
  gateBody: { marginTop: 6, fontSize: 13, lineHeight: 19, color: C.inkSoft },
  gateNote: {
    marginTop: 12, fontSize: 11, lineHeight: 16,
    color: C.inkSoft, textAlign: "center",
  },
  card: {
    marginTop: 16, backgroundColor: C.panel, borderRadius: 8,
    borderWidth: 1, borderColor: C.line,
  },
  row: {
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  rowLabel: { color: C.inkSoft, fontSize: 13 },
  rowValue: { color: C.ink, fontSize: 13, fontWeight: "600" },
  err: {
    marginTop: 12, backgroundColor: C.critBg, borderRadius: 8,
    borderWidth: 1, borderColor: "#f3c2be", padding: 12,
  },
  errText: { color: C.crit, fontSize: 12, fontWeight: "700" },
  errHint: { marginTop: 6, color: C.crit, fontSize: 11, lineHeight: 16 },
  banner: { backgroundColor: C.okBg, padding: 8 },
  bannerText: {
    color: C.ok, fontSize: 11, fontWeight: "700", textAlign: "center",
  },
  thread: { flex: 1 },
  heroWrap: {
    borderRadius: 10, overflow: "hidden", marginBottom: 12,
    justifyContent: "flex-end",
  },
  hero: { width: "100%", height: 120 },
  heroScrim: {
    position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: "rgba(15,41,66,0.55)",
  },
  heroText: {
    position: "absolute", left: 12, bottom: 26,
    color: "#fff", fontSize: 15, fontWeight: "700",
  },
  heroSub: {
    position: "absolute", left: 12, bottom: 10,
    color: "#cfe3f7", fontSize: 11,
  },
  hint: { color: C.inkSoft, fontSize: 13, marginBottom: 10 },
  chip: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8,
  },
  chipText: { color: C.accent, fontSize: 13 },
  bubble: {
    borderRadius: 10, padding: 10, marginBottom: 8, maxWidth: "92%",
  },
  you: { alignSelf: "flex-end", backgroundColor: C.accent },
  youText: { color: "#fff", fontSize: 14 },
  model: {
    alignSelf: "flex-start", backgroundColor: C.panel,
    borderWidth: 1, borderColor: C.line,
  },
  modelText: { color: C.ink, fontSize: 14, lineHeight: 20 },
  actions: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    paddingHorizontal: 12, paddingBottom: 6,
  },
  action: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.accent,
    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6,
  },
  actionText: { color: C.accent, fontSize: 11, fontWeight: "600" },
  composer: {
    flexDirection: "row", gap: 8, padding: 12,
    borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.panel,
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 9, color: C.ink,
  },
  send: {
    backgroundColor: C.accent, borderRadius: 8,
    paddingHorizontal: 16, justifyContent: "center",
  },
  sendText: { color: "#fff", fontWeight: "700" },
  primary: {
    backgroundColor: C.accent, borderRadius: 8, paddingVertical: 13,
    alignItems: "center", marginTop: 16,
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  disabled: { opacity: 0.5 },
});
