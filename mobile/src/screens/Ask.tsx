import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { fetchDuties } from "../lib/api";
import { describeOrigin, locateModel } from "../lib/modelSource";
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
  const scroller = useRef<ScrollView>(null);

  const found = locateModel();

  const warm = useCallback(async () => {
    setState({ kind: "loading", pct: 0 });
    try {
      const llm = await getLlm();
      await llm.loadModel((pct) => setState({ kind: "loading", pct }));
      setState({ kind: "ready" });
    } catch (e) {
      setState({ kind: "error", message: String(e instanceof Error ? e.message : e) });
    }
  }, []);

  useEffect(() => {
    // Only reflects an already-warm model; never triggers the import itself.
    if (llmModule?.isLoaded()) setState({ kind: "ready" });
  }, []);

  function push(t: Turn) {
    setTurns((x) => [...x, t]);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
  }

  async function run(label: string, work: () => Promise<string>, note?: string) {
    if (state.kind !== "ready") {
      await warm();
      if (!llmModule?.isLoaded()) return;
    }
    push({ role: "you", text: label });
    setBusy(true);
    try {
      push({ role: "model", text: (await work()).trim(), note });
    } catch (e) {
      push({
        role: "model",
        text: `Could not answer: ${e instanceof Error ? e.message : e}`,
      });
    } finally {
      setBusy(false);
    }
  }

  /** Ledger Q&A. The duties are fetched and passed in, so the answer is
   *  grounded in this mine's actual data rather than the model's memory. */
  async function ask(question: string) {
    setInput("");
    await run(
      question,
      async () => {
        const { items } = await fetchDuties();
        const facts: LedgerFact[] = items.slice(0, 25).map((d) => ({
          title: d.title,
          clause_ref: d.clause_ref,
          owner_role: d.owner_role,
          status: d.status,
          due_date: d.due_date,
          evidence_count: d.evidence_count,
        }));
        return (await getLlm()).askLedger(question, facts);
      },
      "grounded in the live ledger",
    );
  }

  // ---------------------------------------------------------------- render

  if (state.kind !== "ready") {
    return (
      <ScrollView contentContainerStyle={s.gate}>
        <Text style={s.gateTitle}>On-device assistant</Text>
        <Text style={s.gateBody}>
          Gemma 4 E2B runs entirely on this device. No server, no cloud, no API —
          it answers in airplane mode.
        </Text>

        <View style={s.card}>
          <Row label="Model file">
            {found.path ? describeOrigin(found.origin) : "not found"}
          </Row>
          <Row label="Size">
            {found.bytes
              ? `${(found.bytes / 1e9).toFixed(2)} GB${found.complete ? "" : " (incomplete)"}`
              : "—"}
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
          onPress={warm}
          disabled={state.kind === "loading"}
        >
          {state.kind === "loading" ? (
            <View style={s.busyRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={s.primaryText}>Warming the model…</Text>
            </View>
          ) : (
            <Text style={s.primaryText}>
              {state.kind === "error" ? "Try again" : "Load the model"}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={s.gateNote}>
          Mapping 3.66 GB takes a few seconds on first open. Warm it before a
          demo, never during one.
        </Text>
      </ScrollView>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.banner}>
        <Text style={s.bannerText}>
          ON-DEVICE ·{" "}
          {llmModule?.modelLocation
            ? describeOrigin(llmModule.modelLocation.origin)
            : "loaded"}
          {llmModule?.loadedConfig
            ? ` · ${llmModule.loadedConfig.backend.toUpperCase()} / ${llmModule.loadedConfig.maxContextTokens}`
            : ""}{" "}
          · no network used
        </Text>
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

        {busy && (
          <View style={[s.bubble, s.model]}>
            <ActivityIndicator color={C.accent} size="small" />
          </View>
        )}
      </ScrollView>

      <View style={s.actions}>
        <Action
          label="Dictate observation"
          onPress={() =>
            run(
              "Draft an observation from what I said",
              async () =>
                (await getLlm()).draftObservation(
                  "gas reading is high in panel three, ventilation feels weak",
                  null,
                ),
              "voice → structured observation",
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
            onPress={() =>
              run(
                "What does the evidence photo show?",
                async () =>
                  (await getLlm()).describePhoto(lastPhotoUri, "What is wrong here?"),
                "native image input",
              )
            }
          />
        )}
      </View>

      <View style={s.composer}>
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
