import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { listQueue, type Capture } from "../lib/db";
import { syncQueue, type SyncResult } from "../lib/sync";
import {
  PROVIDERS,
  addProfile,
  askCloud,
  getActiveProfileId,
  loadProfiles,
  removeProfile,
  setActiveProfileId,
  type CloudProfile,
} from "../lib/cloudFallback";
import { C, mono } from "../theme";
import ScreenHero from "../components/ScreenHero";
import { SEAM_PHOTO } from "../lib/photos";

const TONE: Record<string, { bg: string; fg: string; label: string }> = {
  queued: { bg: "#eef2f6", fg: C.inkSoft, label: "QUEUED" },
  uploading: { bg: "#e7f0fb", fg: C.accent, label: "IN PROGRESS" },
  synced: { bg: C.okBg, fg: C.ok, label: "SYNCED" },
  conflict: { bg: C.warnBg, fg: C.warn, label: "REVIEW" },
  error: { bg: C.critBg, fg: C.crit, label: "FAILED" },
};

export default function Sync({ online }: { online: boolean }) {
  const [items, setItems] = useState<Capture[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  // Saved connections, and which one CLOUD is currently pointed at.
  const [profiles, setProfiles] = useState<CloudProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // The form for adding one more.
  const [draftLabel, setDraftLabel] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftModel, setDraftModel] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  /* Keep the provider form above the keyboard.
   *
   * Making the screen scroll was not enough on its own. Measured on the
   * M31s: tap the API key field and the keyboard rises over that field AND
   * the Save button beneath it, and the list does not move. The manifest's
   * adjustResize shrinks the window, but a FlatList does not scroll a focused
   * TextInput into view the way a web page would, so the officer is left
   * typing into a field they cannot see with a Save button they cannot reach.
   *
   * The form is the list footer, so "bring it into view" is simply "scroll to
   * the end". The whole form - four fields and both buttons - fits in the
   * space left above the keyboard, so scrolling to the end shows all of it
   * whichever field was tapped.
   *
   * keyboardDidShow, not the focus event alone: on focus the keyboard has not
   * risen yet, the window has not shrunk, and scrolling to the end of a
   * full-height list lands in the wrong place. The focus handler still
   * scrolls, for the case where the keyboard is already up and the officer
   * moves from one field to the next.
   */
  const listRef = useRef<FlatList<Capture>>(null);
  const formFocused = useRef(false);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (formFocused.current) listRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  const revealForm = () => {
    formFocused.current = true;
    listRef.current?.scrollToEnd({ animated: true });
  };
  const leaveForm = () => {
    formFocused.current = false;
  };

  useEffect(() => {
    void loadProfiles().then(setProfiles);
    void getActiveProfileId().then(setActiveId);
  }, []);

  /** Just the host, so a long endpoint does not wrap over three lines. */
  function host(url: string): string {
    const m = url.match(/^https?:\/\/([^/]+)/);
    return m ? m[1] : url;
  }

  function fillFrom(preset: (typeof PROVIDERS)[number]) {
    setDraftLabel(preset.name);
    setDraftUrl(preset.url);
    setDraftModel(preset.model ?? "");
    setTestMsg(null);
  }

  const refresh = useCallback(async () => setItems(await listQueue()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const r = await syncQueue((done, total) =>
        setProgress(`${done} of ${total}`),
      );
      setResult(r);
    } finally {
      setBusy(false);
      setProgress(null);
      refresh();
    }
  }

  const waiting = items.filter(
    (i) => i.status === "queued" || i.status === "error",
  ).length;
  const synced = items.filter((i) => i.status === "synced").length;

  /* One scroller, and the FlatList is it.
   *
   * This screen used to be a plain flex:1 View holding the hero, the banner,
   * the sync button, the queue and the cloud-provider form stacked in order.
   * Nothing scrolled vertically. On a real handset that put the API key field
   * and the Save button BELOW the fold with no way to reach them - the form
   * was there, it rendered, and it could not be used.
   *
   * A ScrollView wrapping the FlatList is the obvious fix and the wrong one:
   * React Native warns about nesting a VirtualizedList in a plain ScrollView
   * and the inner list stops virtualising. So the list becomes the scroll
   * container and everything else rides on it as a header or a footer.
   *
   * Both are passed as ELEMENTS, not as `() => <X/>` functions. An inline
   * function component is a new type on every render, which remounts the
   * footer on every keystroke and takes the keyboard focus out of whichever
   * field is being typed into. An element reconciles normally and the field
   * keeps focus.
   */
  const header = (
    <View>
      <ScreenHero
        photo={SEAM_PHOTO}
        title="Sync & sign-off"
        subtitle="captures held underground, uploaded at the surface"
        height={84}
      />
      <View style={[s.banner, online ? s.bannerOn : s.bannerOff]}>
        <Text style={[s.bannerText, { color: online ? C.ok : C.warn }]}>
          {online
            ? `ONLINE — ${synced} of ${items.length} uploaded`
            : `OFFLINE — ${waiting} capture${waiting === 1 ? "" : "s"} held, will sync at surface`}
        </Text>
      </View>

      <TouchableOpacity
        style={[s.primary, (!online || busy || waiting === 0) && s.disabled]}
        onPress={run}
        disabled={!online || busy || waiting === 0}
      >
        {busy ? (
          <View style={s.busyRow}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={s.primaryText}>Uploading {progress}</Text>
          </View>
        ) : (
          <Text style={s.primaryText}>
            {waiting === 0 ? "Nothing to sync" : `Sync ${waiting} capture${waiting === 1 ? "" : "s"}`}
          </Text>
        )}
      </TouchableOpacity>

      {result && (
        <View style={s.result}>
          <Text style={s.resultText}>
            {result.uploaded} uploaded
            {result.alreadyOnServer > 0 &&
              `, ${result.alreadyOnServer} already on server`}
            {result.conflicts > 0 && `, ${result.conflicts} need review`}
            {result.failed > 0 && `, ${result.failed} failed`}
          </Text>
        </View>
      )}

      <Text style={s.group}>UPLOAD QUEUE</Text>
    </View>
  );

  const footer = (
    <View>
      <View style={s.cloudBox}>
        <Text style={s.cloudTitle}>Cloud providers (optional)</Text>
        <Text style={s.cloudNote}>
          Off unless you save one. Save as many as you like and switch with a
          tap - a revoked key, an exhausted free tier or a retired model should
          not end a demo. Ledger answers never leave the phone: only the
          question you type is sent.
        </Text>

        {/* ---- saved connections ---- */}
        {profiles.map((p) => {
          const on = p.id === activeId;
          return (
            <TouchableOpacity
              key={p.id}
              style={[s.provRow, on && s.provRowOn]}
              onPress={async () => {
                await setActiveProfileId(p.id);
                setActiveId(p.id);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.provName, on && { color: C.accent }]}>
                  {on ? "● " : "○ "}
                  {p.label}
                </Text>
                <Text style={s.provMeta}>
                  {p.model || "no model set"} · {host(p.url)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={async () => {
                  const next = await removeProfile(p.id);
                  setProfiles(next);
                  setActiveId(await getActiveProfileId());
                }}
              >
                <Text style={s.provDel}>remove</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
        {profiles.length === 0 && (
          <Text style={s.cloudState}>
            none saved - everything stays on this device
          </Text>
        )}

        {/* ---- add another ---- */}
        <Text style={s.fieldLabel}>Add a provider</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.presetRow}
          contentContainerStyle={{ gap: 6 }}
        >
          {PROVIDERS.map((preset) => (
            <TouchableOpacity
              key={preset.name}
              style={s.preset}
              onPress={() => fillFrom(preset)}
            >
              <Text style={s.presetText}>{preset.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={s.presetHint}>
          {PROVIDERS.find((x) => x.name === draftLabel)?.hint ??
            "Tap one to fill the endpoint, or type any OpenAI-compatible URL."}
        </Text>

        <Text style={s.fieldLabel}>Name</Text>
        <TextInput
          style={s.cloudInput}
          value={draftLabel}
          onChangeText={setDraftLabel}
          placeholder="what to call this connection"
          onFocus={revealForm}
          onBlur={leaveForm}
          placeholderTextColor="#9aabbd"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={s.fieldLabel}>URL</Text>
        <TextInput
          style={s.cloudInput}
          value={draftUrl}
          onChangeText={setDraftUrl}
          placeholder="https://.../v1/chat/completions"
          onFocus={revealForm}
          onBlur={leaveForm}
          placeholderTextColor="#9aabbd"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={s.fieldLabel}>Model</Text>
        <TextInput
          style={s.cloudInput}
          value={draftModel}
          onChangeText={setDraftModel}
          placeholder="exact model id from that provider"
          onFocus={revealForm}
          onBlur={leaveForm}
          placeholderTextColor="#9aabbd"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={s.fieldLabel}>API key</Text>
        <TextInput
          style={s.cloudInput}
          value={draftKey}
          onChangeText={setDraftKey}
          placeholder="pasted from the provider"
          onFocus={revealForm}
          onBlur={leaveForm}
          placeholderTextColor="#9aabbd"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <View style={s.cloudRow}>
          <TouchableOpacity
            style={s.cloudBtn}
            disabled={!draftUrl || !draftKey || testing}
            onPress={async () => {
              const next = await addProfile({
                label: draftLabel || host(draftUrl),
                url: draftUrl,
                model: draftModel,
                key: draftKey,
              });
              setProfiles(next);
              setActiveId(await getActiveProfileId());
              setDraftLabel("");
              setDraftUrl("");
              setDraftModel("");
              setDraftKey("");
              setTestMsg(null);
            }}
          >
            <Text
              style={[
                s.cloudBtnText,
                (!draftUrl || !draftKey) && { color: C.inkSoft },
              ]}
            >
              Save
            </Text>
          </TouchableOpacity>

          {/* Proves the three fields agree BEFORE the officer relies on them.
              A wrong endpoint, a dead model and a revoked key all fail the
              same way at answer time, and none of them is worth diagnosing
              in front of a judge. */}
          <TouchableOpacity
            style={s.cloudBtn}
            disabled={!draftUrl || !draftKey || testing}
            onPress={async () => {
              setTesting(true);
              setTestMsg("testing...");
              try {
                const reply = await askCloud("Reply with the single word OK.", {
                  id: "test",
                  label: draftLabel || host(draftUrl),
                  url: draftUrl,
                  model: draftModel,
                  key: draftKey,
                });
                setTestMsg(`works - replied "${reply.slice(0, 40)}"`);
              } catch (e) {
                setTestMsg(e instanceof Error ? e.message : String(e));
              } finally {
                setTesting(false);
              }
            }}
          >
            <Text
              style={[
                s.cloudBtnText,
                (!draftUrl || !draftKey) && { color: C.inkSoft },
              ]}
            >
              Test
            </Text>
          </TouchableOpacity>
        </View>

        {testMsg && (
          <Text
            style={[
              s.cloudState,
              testMsg.startsWith("works") && { color: C.ok },
              !testMsg.startsWith("works") &&
                testMsg !== "testing..." && { color: C.crit },
            ]}
          >
            {testMsg}
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <FlatList
      ref={listRef}
      style={s.wrap}
      data={items}
      keyExtractor={(i) => String(i.id)}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        <Text style={s.empty}>
          Nothing captured yet. Pick a duty and photograph it.
        </Text>
      }
      renderItem={({ item }) => {
        const t = TONE[item.status] ?? TONE.queued;
        return (
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{item.title}</Text>
              <Text style={mono}>{item.clause_ref}</Text>
              <Text style={s.meta}>
                {new Date(item.captured_at).toLocaleTimeString()}
                {item.photo_uri ? " · photo" : ""}
                {item.chain_hash
                  ? ` · chain ${item.chain_hash.slice(0, 8)}…`
                  : ""}
                {item.error ? ` · ${item.error}` : ""}
              </Text>
            </View>
            <View style={[s.pill, { backgroundColor: t.bg }]}>
              <Text style={[s.pillText, { color: t.fg }]}>{t.label}</Text>
            </View>
          </View>
        );
      }}
      /* Without this, the first tap on Save while the keyboard is open only
         dismisses the keyboard - the officer taps, nothing happens, and it
         reads as a dead button. */
      keyboardShouldPersistTaps="handled"
      /* Room to scroll the last field and its buttons clear of the keyboard.
         The manifest already sets adjustResize, so the window shrinks; this
         is what gives the content somewhere to go. */
      contentContainerStyle={{ paddingBottom: 40 }}
    />
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  banner: { padding: 9 },
  bannerOn: { backgroundColor: C.okBg },
  bannerOff: { backgroundColor: C.warnBg },
  bannerText: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  primary: {
    backgroundColor: C.accent, margin: 12, borderRadius: 8,
    paddingVertical: 13, alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  disabled: { opacity: 0.45 },
  result: {
    marginHorizontal: 12, marginBottom: 4, padding: 9,
    backgroundColor: C.okBg, borderRadius: 6,
  },
  resultText: { color: C.ok, fontSize: 12, textAlign: "center" },
  group: {
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, fontSize: 11,
    fontWeight: "700", letterSpacing: 0.8, color: C.inkSoft,
  },
  empty: { padding: 24, textAlign: "center", color: C.inkSoft },
  cloudBox: {
    margin: 12, padding: 12, borderRadius: 8,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.panel,
  },
  cloudTitle: { fontSize: 13, fontWeight: "700", color: C.ink },
  cloudNote: { marginTop: 4, fontSize: 11, lineHeight: 16, color: C.inkSoft },
  cloudInput: {
    marginTop: 8, borderWidth: 1, borderColor: C.line, borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 12, color: C.ink,
    backgroundColor: "#fff",
  },
  cloudRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  cloudBtn: {
    flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 6,
    paddingVertical: 8, alignItems: "center",
  },
  cloudBtnOff: { borderColor: C.critBg },
  cloudBtnText: { fontSize: 12, fontWeight: "600", color: C.accent },
  cloudState: { marginTop: 8, fontSize: 11, color: C.inkSoft, fontStyle: "italic" },
  fieldLabel: {
    marginTop: 10, fontSize: 10, fontWeight: "700", color: C.inkSoft,
    letterSpacing: 0.4, textTransform: "uppercase",
  },
  provRow: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: C.line,
  },
  provRowOn: { borderColor: C.accent, backgroundColor: "#f2f7fd" },
  provName: { fontSize: 12, fontWeight: "700", color: C.ink },
  provMeta: { marginTop: 2, fontSize: 10, color: C.inkSoft },
  provDel: { fontSize: 10, fontWeight: "600", color: C.crit },
  presetRow: { marginTop: 8 },
  preset: {
    borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff",
  },
  presetText: { fontSize: 11, fontWeight: "600", color: C.accent },
  presetHint: { marginTop: 6, fontSize: 10, color: C.inkSoft, fontStyle: "italic" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.panel, paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  title: { fontSize: 14, fontWeight: "600", color: C.ink },
  meta: { fontSize: 11, color: C.inkSoft, marginTop: 3 },
  pill: { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3 },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
});
