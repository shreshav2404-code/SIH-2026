/**
 * An instruction from the control room, shown until somebody acknowledges it.
 *
 * This is the half of the loop that usually goes missing. Plenty of systems
 * raise an alert on a dashboard; far fewer can tell you whether the person
 * standing next to the hazard ever saw it. Acknowledgement here writes a name
 * and a time to the server, so "we told them" stops being a claim.
 *
 * Sits above the tab content on every screen on purpose. A withdrawal order
 * that only appears if the officer happens to be on the right tab is not a
 * withdrawal order.
 *
 * Polled every 12 seconds rather than pushed: push needs FCM, a Google project
 * and a network the demo does not have. The app already polls for duties, so
 * this costs one more request on the same connection - and it keeps working in
 * exactly the places the rest of the app works.
 */

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { ackDirective, fetchOpenDirectives, type Directive } from "../lib/api";
import { C } from "../theme";

const POLL_MS = 12_000;

/** The verb, rendered as the banner's headline. */
const ACTION_LABEL: Record<string, string> = {
  STOP_WORK: "STOP WORK",
  EVACUATE: "EVACUATE",
  VENTILATE: "RESTORE VENTILATION",
  INSPECT: "INSPECT NOW",
  WITHDRAW_MEN: "WITHDRAW ALL PERSONS",
};

export default function DirectiveBanner({ online }: { online: boolean }) {
  const [items, setItems] = useState<Directive[]>([]);
  const [busy, setBusy] = useState(false);

  const poll = useCallback(async () => {
    if (!online) return;
    try {
      setItems(await fetchOpenDirectives());
    } catch {
      // Offline or the server moved. The banner simply does not update; it
      // must never throw into the app shell over a failed poll.
    }
  }, [online]);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  if (items.length === 0) return null;

  // Oldest first: if two are waiting, the one that has been unanswered longest
  // is the one somebody should be looking at.
  const d = items[items.length - 1];
  const critical = d.severity === "critical";

  return (
    <View style={[s.wrap, critical ? s.crit : s.warn]}>
      <View style={s.row}>
        <Text style={s.action}>
          {d.action ? (ACTION_LABEL[d.action] ?? d.action) : "CONTROL ROOM"}
        </Text>
        {items.length > 1 && (
          <Text style={s.more}>+{items.length - 1} more</Text>
        )}
      </View>

      {d.location_label && <Text style={s.where}>{d.location_label}</Text>}
      <Text style={s.msg}>{d.message}</Text>
      <Text style={s.from}>
        issued by {d.issued_by_name ?? "control room"} ·{" "}
        {new Date(d.created_at).toLocaleTimeString()}
      </Text>

      <TouchableOpacity
        style={s.ack}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await ackDirective(d.id);
            await poll();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={s.ackText}>ACKNOWLEDGE</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, gap: 3 },
  crit: { backgroundColor: C.crit },
  warn: { backgroundColor: C.warn },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  action: { color: "#fff", fontSize: 14, fontWeight: "800", letterSpacing: 0.8 },
  more: { color: "#ffffffcc", fontSize: 11, fontWeight: "700" },
  where: { color: "#ffffffdd", fontSize: 12, fontWeight: "700" },
  msg: { color: "#fff", fontSize: 13, lineHeight: 18, marginTop: 2 },
  from: { color: "#ffffffaa", fontSize: 10, marginTop: 3 },
  ack: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#ffffff2e",
    borderWidth: 1,
    borderColor: "#ffffff66",
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  ackText: { color: "#fff", fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
});
