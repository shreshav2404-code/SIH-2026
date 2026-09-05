/**
 * Manual sensor injection, for a mine that has no instrumentation yet.
 *
 * HONESTY FIRST. This is not a sensor and the screen says so in as many words.
 * It posts to exactly the endpoint a real plant gateway would post to, with
 * exactly the same body, so the path under test - ingest, threshold
 * arithmetic, alert with a clause and a place, dashboard, directive back to
 * this handset - is the production path. Wiring a real transmitter later
 * replaces this screen and nothing else.
 *
 * That is a stronger claim than a canned demo, and it is only true because
 * nothing here is special-cased server-side. Do not add a "demo mode" flag to
 * the backend to make this work; the moment the server can tell the difference,
 * the demo stops proving anything.
 *
 * Levels rather than a free number, because the interesting values are
 * relative to the statutory threshold and nobody should have to remember that
 * methane trips at 1.25%. Custom entry is there for the officer who does.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  fetchSensorPoints,
  pushReading,
  type FiredAlert,
  type SensorPoint,
} from "../lib/api";
import { C, mono } from "../theme";

/**
 * The streams this console can emit, with their units and the statutory
 * trigger the backend's threshold table holds. The trigger is repeated here
 * ONLY to place the three levels sensibly - the server remains the authority
 * on whether a reading breaches, and this screen never decides that.
 */
const STREAMS: {
  type: string;
  label: string;
  unit: string;
  trigger: number;
  normal: number;
}[] = [
  { type: "methane", label: "Methane", unit: "%", trigger: 1.25, normal: 0.6 },
  { type: "carbon_monoxide", label: "Carbon monoxide", unit: "ppm", trigger: 50, normal: 8 },
  { type: "strata_convergence", label: "Strata convergence", unit: "mm/24h", trigger: 3, normal: 1.1 },
  { type: "vibration", label: "Ground vibration", unit: "mm/s", trigger: 8, normal: 3 },
  { type: "pm10", label: "Respirable dust", unit: "ug/m3", trigger: 100, normal: 55 },
  { type: "water_level", label: "Water level", unit: "m", trigger: 3.5, normal: 1.9 },
  { type: "air_quantity", label: "Air quantity", unit: "m3/s", trigger: 20, normal: 34 },
  { type: "illumination", label: "Illumination", unit: "lux", trigger: 50, normal: 120 },
];

type Level = "normal" | "elevated" | "breach" | "custom";

export default function SensorConsole({ mineId }: { mineId: number }) {
  const [points, setPoints] = useState<SensorPoint[]>([]);
  const [streamIdx, setStreamIdx] = useState(0);
  const [location, setLocation] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("breach");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [fired, setFired] = useState<FiredAlert[]>([]);

  const stream = STREAMS[streamIdx];

  useEffect(() => {
    void fetchSensorPoints()
      .then(setPoints)
      .catch(() => setPoints([]));
  }, []);

  // Only points where this sensor is actually installed. Offering "methane at
  // the mine water discharge point" would be inventing instrumentation.
  const valid = useMemo(
    () => points.filter((p) => p.sensor_types.includes(stream.type)),
    [points, stream.type],
  );

  useEffect(() => {
    // Reset the place whenever the stream changes, rather than keeping a
    // selection that is no longer valid for it.
    setLocation(valid.length ? valid[0].key : null);
  }, [valid]);

  function valueFor(): number {
    if (level === "custom") return Number(custom) || 0;
    if (level === "normal") return stream.normal;
    // Just under the line, and comfortably over it. A z-score needs the run of
    // readings to move, so "elevated" sits close enough to be interesting.
    if (level === "elevated") return Number((stream.trigger * 0.92).toFixed(2));
    return Number((stream.trigger * 1.55).toFixed(2));
  }

  async function send() {
    if (!location) return;
    setBusy(true);
    setResult(null);
    setFired([]);
    try {
      // A single reading rarely moves a rolling mean, so a breach is sent as a
      // short burst - the same shape a real transmitter reporting every couple
      // of seconds would produce.
      const n = level === "breach" ? 12 : 4;
      let alerts: FiredAlert[] = [];
      for (let i = 0; i < n; i++) {
        alerts = await pushReading({
          mine_id: mineId,
          sensor_type: stream.type,
          value: valueFor(),
          unit: stream.unit,
          location,
        });
      }
      setFired(alerts);
      setResult(
        alerts.length
          ? `${n} readings sent — the server fired ${alerts.length} alert${alerts.length === 1 ? "" : "s"}.`
          : `${n} readings sent. No threshold crossed.`,
      );
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const point = valid.find((p) => p.key === location);

  return (
    <View style={s.box}>
      <Text style={s.title}>Send a reading</Text>
      <Text style={s.note}>
        This mine has no transmitters yet, so readings are entered by hand. They
        go to the same endpoint a plant gateway would use — the threshold
        arithmetic, the alert and the clause behind it are the real ones.
      </Text>

      <Text style={s.label}>Sensor</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {STREAMS.map((st, i) => (
          <TouchableOpacity
            key={st.type}
            style={[s.chip, i === streamIdx && s.chipOn]}
            onPress={() => setStreamIdx(i)}
          >
            <Text style={[s.chipText, i === streamIdx && s.chipTextOn]}>{st.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={s.label}>Where</Text>
      {valid.length === 0 ? (
        <Text style={s.note}>No monitoring point in the catalogue takes this sensor.</Text>
      ) : (
        <View style={s.places}>
          {valid.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[s.place, p.key === location && s.placeOn]}
              onPress={() => setLocation(p.key)}
            >
              <Text style={[s.placeText, p.key === location && s.placeTextOn]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {point && <Text style={s.why}>{point.why}</Text>}

      <Text style={s.label}>Level</Text>
      <View style={s.levels}>
        {(["normal", "elevated", "breach", "custom"] as Level[]).map((l) => (
          <TouchableOpacity
            key={l}
            style={[s.lvl, l === level && (l === "breach" ? s.lvlCrit : s.lvlOn)]}
            onPress={() => setLevel(l)}
          >
            <Text style={[s.lvlText, l === level && s.lvlTextOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {level === "custom" ? (
        <TextInput
          style={s.input}
          value={custom}
          onChangeText={setCustom}
          keyboardType="numeric"
          placeholder={`value in ${stream.unit}`}
          placeholderTextColor="#9aabbd"
        />
      ) : (
        <Text style={s.preview}>
          will send <Text style={mono}>{valueFor()} {stream.unit}</Text> · statutory
          trigger <Text style={mono}>{stream.trigger} {stream.unit}</Text>
        </Text>
      )}

      <TouchableOpacity
        style={[s.send, (busy || !location) && s.sendOff]}
        onPress={send}
        disabled={busy || !location}
      >
        {busy ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={s.sendText}>Send to the server</Text>
        )}
      </TouchableOpacity>

      {result && (
        <Text style={[s.result, fired.length > 0 && { color: C.crit }]}>{result}</Text>
      )}
      {fired.map((f) => (
        <Text key={f.id} style={s.firedRow}>
          alert #{f.id} · {f.severity}
          {f.clause_ref ? ` · ${f.clause_ref}` : ""}
        </Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    margin: 16,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel,
    gap: 6,
  },
  title: { fontSize: 14, fontWeight: "700", color: C.ink },
  note: { fontSize: 11, lineHeight: 16, color: C.inkSoft },
  label: {
    marginTop: 8,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: C.inkSoft,
    textTransform: "uppercase",
  },
  chips: { gap: 6, paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 11, color: C.inkSoft, fontWeight: "600" },
  chipTextOn: { color: "#fff" },
  places: { gap: 5 },
  place: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  placeOn: { borderColor: C.accent, backgroundColor: "#f2f7fd" },
  placeText: { fontSize: 12, color: C.ink },
  placeTextOn: { color: C.accent, fontWeight: "700" },
  why: { fontSize: 10, lineHeight: 15, color: C.inkSoft, fontStyle: "italic", marginTop: 4 },
  levels: { flexDirection: "row", gap: 6 },
  lvl: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 7,
    paddingVertical: 7,
    alignItems: "center",
  },
  lvlOn: { backgroundColor: C.accent, borderColor: C.accent },
  lvlCrit: { backgroundColor: C.crit, borderColor: C.crit },
  lvlText: { fontSize: 11, color: C.inkSoft, fontWeight: "600", textTransform: "capitalize" },
  lvlTextOn: { color: "#fff" },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: C.ink,
    backgroundColor: "#fff",
  },
  preview: { fontSize: 11, color: C.inkSoft, marginTop: 2 },
  send: {
    marginTop: 10,
    backgroundColor: C.accent,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
  },
  sendOff: { opacity: 0.45 },
  sendText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  result: { marginTop: 8, fontSize: 12, color: C.ok, fontWeight: "600" },
  firedRow: { fontSize: 10, color: C.crit, fontFamily: "monospace" },
});
