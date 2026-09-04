import { CameraView, useCameraPermissions } from "expo-camera";
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import {
  DEFAULT_MODEL_ID,
  describeOrigin,
  loadPreferredModel,
  savePreferredModel,
  formatBytes,
  locateModel,
  modelById,
  MODELS,
  multimodalModel,
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
import { C, mono } from "../theme";

type Turn = { role: "you" | "model"; text: string; note?: string };

type ModelState =
  | { kind: "idle" }
  | { kind: "loading"; pct: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

/**
 * How many duties go into a ledger prompt.
 *
 * It used to send 25, which cost about 875 tokens of prefill on every single
 * question and was the bulk of a measured 62-second wait on the phone. Prefill
 * scales with prompt length, so this is the cheapest large speed-up available.
 *
 * It also tends to IMPROVE answers rather than harm them: 25 duties is mostly
 * noise for a targeted question, and the model has to find the relevant line
 * among them. The risk is the opposite one - an aggregate question ("how many
 * duties are there?") must not be answered from a truncated list - which is
 * why buildFacts() always states the true total in the prompt.
 */
const MAX_FACTS = 10;

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

  const scored = items.map((d) => {
    const hay = `${d.title} ${d.act} ${d.clause_ref} ${d.owner_role} ${d.status}`.toLowerCase();
    let score = terms.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
    if (d.status === "overdue") score += 2;
    return { d, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.d);
}

const SUGGESTIONS = [
  "What is overdue and who owns it?",
  "Which duties need a photo?",
  "What has the Ventilation Officer got outstanding?",
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
      // coexist in memory - which matters on a 7.5 GB phone where E2B alone
      // peaks at 2.5 GB.
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
   * Voice and photo input do not exist on the Qwen build, so rather than fail
   * with a confusing engine error, swap first and say so in the thread.
   */
  const ensureMultimodal = useCallback(async (): Promise<boolean> => {
    const mm = multimodalModel();
    if (llmModule?.activeSpec?.id === mm.id) return true;
    push({
      role: "model",
      text: `Switching to ${mm.label} - it is the only bundled model that can read speech and images.`,
      note: "model switch",
    });
    await warm(mm);
    return llmModule?.activeSpec?.id === mm.id;
  }, [warm]);

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
    ) => Promise<string | { text: string; note?: string }>,
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
      push({ role: "model", text: body.trim(), note: caption });
    } catch (e) {
      setStreaming(null);
      // A switch leaves LiteRT-LM unable to invoke. Say what to do about it
      // rather than printing a Kotlin stack trace at a mine inspector.
      const corrupted = llmModule?.isEngineCorrupted?.(e);
      push({
        role: "model",
        text: corrupted
          ? `The engine cannot run after switching models in the same session. ` +
            `Close and reopen the app — ${spec.label} is remembered and will ` +
            `load on its own.`
          : `Could not answer: ${e instanceof Error ? e.message : e}`,
        note: corrupted ? "known LiteRT-LM limitation, not a data problem" : undefined,
      });
    } finally {
      setBusy(false);
      setStreaming(null);
    }
  }

  /** Ledger Q&A. The duties are fetched and passed in, so the answer is
   *  grounded in this mine's actual data rather than the model's memory. */
  async function ask(question: string) {
    setInput("");
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
        const { answer, unverified } = await (await getLlm()).askLedger(
          question,
          facts,
          items.length,
          (tok: string) => onToken(tok),
        );

        // Never label an answer "grounded" without checking it. The model
        // wrote "Mines Rules 1555" once on this very question - one digit off
        // a real statute, under a caption claiming it came from the ledger.
        // Say what is actually true instead.
        if (unverified.length) {
          return {
            text:
              answer +
              "\n\nNOT IN THIS LEDGER: " +
              unverified.join(", ") +
              ". Treat that citation as unverified.",
            note: "citation could NOT be verified against the ledger",
          };
        }
        return { text: answer, note: "grounded - every citation verified" };
      },
    );
  }

  /**
   * Record the officer speaking, then hand the audio to the model.
   *
   * The recording never leaves the phone: expo-audio writes it to app storage
   * and the file path goes straight into E2B, which takes audio natively. That
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
      if (!(await ensureMultimodal())) return;
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
      if (!(await ensureMultimodal())) return;
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

  if (state.kind !== "ready") {
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
            <Text style={s.thinkNote}>
              Better on hard questions, and much slower — it thinks before it
              answers, inside the same short output budget.
            </Text>
          </View>
          <Text style={[s.thinkState, thinking && s.thinkLabelOn]}>
            {thinking ? "ON" : "OFF"}
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
              On an x86_64 emulator the LiteRT-LM runtime declines to start —
              logcat shows “Skipping LiteRTLM native init on unsupported primary
              ABI”. The engine needs a physical arm64 Android device. Every
              other part of the app works here.
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
          ON-DEVICE · {llmModule?.activeSpec?.label ?? spec.label}
          {llmModule?.loadedConfig
            ? ` · ${llmModule.loadedConfig.backend.toUpperCase()} / ${llmModule.loadedConfig.maxContextTokens}`
            : ""}{" "}
          · no network used
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
            {thinking ? "REASONING" : "FAST"}
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
                {m.multimodal ? " · voice/photo" : ""}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView ref={scroller} style={s.thread} contentContainerStyle={{ padding: 12 }}>
        {turns.length === 0 && (
          <View>
            <Text style={s.hint}>Ask about the ledger, or use a quick action.</Text>
            {SUGGESTIONS.map((q) => (
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

      <View style={s.actions}>
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
              if (!(await ensureMultimodal())) return;
              await run(
                "What does the evidence photo show?",
                async () =>
                  (await getLlm()).describePhoto(lastPhotoUri, "What is wrong here?"),
                "native image input",
              );
            }}
          />
        )}
      </View>

      <View style={s.composer}>
        {/* Speak, or show the model something. Both need the multimodal model
            and will offer to switch to it rather than fail. */}
        <TouchableOpacity
          style={[s.iconBtn, recording && s.iconBtnRec]}
          onPress={toggleVoice}
          disabled={busy}
        >
          <Text style={[s.iconText, recording && s.iconTextRec]}>
            {recording ? "STOP" : "MIC"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.iconBtn} onPress={openCamera} disabled={busy}>
          <Text style={s.iconText}>CAM</Text>
        </TouchableOpacity>
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
