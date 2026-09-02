import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { fetchDuties, type Duty } from "../lib/api";
import { cacheDuties, readCachedDuties } from "../lib/db";
import { C, mono } from "../theme";

const GROUPS = [
  { key: "overdue", label: "OVERDUE" },
  { key: "due", label: "DUE TODAY" },
  { key: "pending", label: "UPCOMING" },
  { key: "submitted", label: "COMPLETED" },
] as const;

export default function Duties({
  onCapture,
}: {
  onCapture: (d: Duty) => void;
}) {
  const [duties, setDuties] = useState<Duty[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchDuties();
      setDuties(data.items);
      setFromCache(null);
      await cacheDuties(data.items);
    } catch {
      // No signal. The list must still open — that is the whole point.
      const cached = await readCachedDuties<Duty[]>();
      if (cached) {
        setDuties(cached.data);
        setFromCache(cached.at);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <View style={s.centre}>
        <ActivityIndicator color={C.accent} />
      </View>
    );

  const sections = GROUPS.flatMap((g) => {
    const items = duties.filter((d) => d.status === g.key);
    return items.length ? [{ header: g.label }, ...items] : [];
  });

  return (
    <FlatList
      data={sections as (Duty | { header: string })[]}
      keyExtractor={(item, i) =>
        "header" in item ? `h-${item.header}` : `d-${item.id}-${i}`
      }
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={load} tintColor={C.accent} />
      }
      ListHeaderComponent={
        fromCache ? (
          <View style={s.cacheNote}>
            <Text style={s.cacheText}>
              Showing duties cached at{" "}
              {new Date(fromCache).toLocaleTimeString()} — no signal
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        if ("header" in item)
          return <Text style={s.group}>{item.header}</Text>;

        const d = item;
        const risky = (d.risk_score ?? 0) >= 70;
        return (
          <TouchableOpacity style={s.row} onPress={() => onCapture(d)}>
            <Text style={s.title}>{d.title}</Text>
            <Text style={mono}>{d.clause_ref}</Text>
            <Text style={s.meta}>
              {d.owner_role} · {d.frequency.replace(/_/g, " ")} ·{" "}
              {d.evidence_type}
            </Text>

            <View style={s.badges}>
              {d.status === "overdue" && d.due_date && (
                <Badge tone="crit">
                  OVERDUE {daysAgo(d.due_date)} DAY
                  {daysAgo(d.due_date) === 1 ? "" : "S"}
                </Badge>
              )}
              {risky && <Badge tone="warn">RISK {Math.round(d.risk_score!)} — DO FIRST</Badge>}
              {d.status === "due" && d.due_date && <Badge tone="warn">DUE TODAY</Badge>}
              {d.evidence_count > 0 && (
                <Badge tone="ok">{d.evidence_count} CAPTURED</Badge>
              )}
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

function daysAgo(iso: string) {
  const ms = Date.now() - new Date(iso + "T00:00:00").getTime();
  return Math.max(1, Math.floor(ms / 86400000));
}

function Badge({
  tone,
  children,
}: {
  tone: "crit" | "warn" | "ok";
  children: React.ReactNode;
}) {
  const map = {
    crit: { bg: C.critBg, fg: C.crit },
    warn: { bg: C.warnBg, fg: C.warn },
    ok: { bg: C.okBg, fg: C.ok },
  }[tone];
  return (
    <View style={[s.badge, { backgroundColor: map.bg, borderColor: map.fg }]}>
      <Text style={[s.badgeText, { color: map.fg }]}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  group: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: C.inkSoft,
  },
  row: {
    backgroundColor: C.panel,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  title: { fontSize: 15, fontWeight: "600", color: C.ink, marginBottom: 2 },
  meta: { fontSize: 12, color: C.inkSoft, marginTop: 3 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  cacheNote: { backgroundColor: C.warnBg, padding: 10 },
  cacheText: { fontSize: 12, color: C.warn, textAlign: "center" },
});
