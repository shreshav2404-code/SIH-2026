import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { listQueue, type Capture } from "../lib/db";
import { syncQueue, type SyncResult } from "../lib/sync";
import { C, mono } from "../theme";

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

  return (
    <View style={s.wrap}>
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

      {items.length === 0 ? (
        <Text style={s.empty}>
          Nothing captured yet. Pick a duty and photograph it.
        </Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.id)}
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
        />
      )}
    </View>
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
