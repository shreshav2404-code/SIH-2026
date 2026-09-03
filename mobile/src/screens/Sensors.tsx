import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  available,
  isRunning,
  live,
  probeSensors,
  pushNoise,
  setNoiseAvailable,
  startSensors,
  stopSensors,
  type Availability,
} from "../lib/sensors";
import { C, mono } from "../theme";

/**
 * Live telemetry from the handset itself.
 *
 * Until now every reading on the dashboard came from tools/sensor_sim.py. These
 * are measured, on this phone, and they travel the same path as the simulated
 * ones - the hazard window does not care where a number came from, which is the
 * point: the detection logic was always arithmetic and stays arithmetic.
 */

/** Metering is dBFS (-160..0). Real SPL needs a calibrated mic; see NOISE_OFFSET. */
const NOISE_OFFSET = 90;
const POLL_MS = 250;

interface Reading {
  key: "vibration" | "noise" | "illumination";
  label: string;
  unit: string;
  threshold: number | null;
  /** Null where this corpus has no clause to cite. */
  clause: string | null;
  note: string;
}

const READINGS: Reading[] = [
  {
    key: "vibration",
    label: "Ground vibration",
    unit: "mm/s",
    threshold: 8.0,
    clause: "CMR 2017 · Reg. 106",
    note: "Accelerometer. Proxy, not a calibrated geophone — assumes a 10 Hz dominant component.",
  },
  {
    key: "noise",
    label: "Noise level",
    unit: "dB",
    threshold: 90,
    clause: null,
    note: "Microphone, uncalibrated. No noise clause exists in this corpus, so it is monitored, not cited.",
  },
  {
    key: "illumination",
    label: "Illumination",
    unit: "lux",
    threshold: 50,
    clause: null,
    note: "Ambient light sensor. No lighting clause in this corpus yet — monitoring only.",
  },
];

export default function Sensors({ mineId }: { mineId: number }) {
  const [on, setOn] = useState(isRunning());
  const [tick, setTick] = useState(0);
  const [micOk, setMicOk] = useState<boolean | null>(null);
  const [avail, setAvail] = useState<Availability>(available);
  const [error, setError] = useState<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  // Re-render on a timer rather than on every sample: the sensors fire at 5 Hz
  // and re-rendering the tree that often is wasted work on a mid-range phone.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  // Ask the hardware what it has before drawing anything, so a phone without a
  // light sensor says so instead of showing a convincing permanent zero.
  useEffect(() => {
    void probeSensors().then(setAvail);
  }, []);

  const stop = useCallback(async () => {
    stopSensors();
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
    try {
      await recorder.stop();
    } catch {
      /* was not recording */
    }
    setOn(false);
  }, [recorder]);

  const start = useCallback(async () => {
    setError(null);
    startSensors(mineId, (e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );

    // The microphone is optional. Vibration and light still work without it,
    // so a refused permission degrades one reading rather than the screen.
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      setMicOk(perm.granted);
      setNoiseAvailable(perm.granted);
      setAvail({ ...available });
      if (perm.granted) {
        await recorder.prepareToRecordAsync({
          ...RecordingPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        });
        recorder.record();
        poll.current = setInterval(() => {
          const m = recorder.getStatus().metering;
          // dBFS is negative and relative to full scale. Shifting it into a
          // positive range makes it readable and responsive; it is NOT a
          // calibrated sound-pressure level and the UI says so.
          if (typeof m === "number" && Number.isFinite(m)) {
            pushNoise(Math.max(0, m + NOISE_OFFSET));
          }
        }, POLL_MS);
      }
    } catch (e) {
      setMicOk(false);
      setNoiseAvailable(false);
      setAvail({ ...available });
      setError(e instanceof Error ? e.message : String(e));
    }

    setOn(true);
  }, [mineId, recorder]);

  useEffect(() => {
    return () => {
      // Leaving the tab must not leave the accelerometer and microphone running.
      stopSensors();
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16 }}>
      <Text style={s.title}>Handset telemetry</Text>
      <Text style={s.body}>
        Readings measured by this phone, posted to the ledger every two seconds
        on the same path as the fixed sensors. Breach detection is arithmetic —
        a rolling mean and a z-score against a threshold table. No model decides
        whether something is a hazard.
      </Text>

      <TouchableOpacity
        style={[s.primary, on && s.stopBtn]}
        onPress={() => (on ? stop() : start())}
      >
        <Text style={s.primaryText}>{on ? "Stop measuring" : "Start measuring"}</Text>
      </TouchableOpacity>

      {on && (
        <View style={s.liveRow}>
          <ActivityIndicator size="small" color={C.ok} />
          <Text style={s.liveText}>streaming to mine {mineId}</Text>
        </View>
      )}

      {micOk === false && (
        <Text style={s.warn}>
          Microphone unavailable — vibration and light are still being measured.
        </Text>
      )}
      {error && <Text style={s.warn}>{error}</Text>}

      {READINGS.map((r) => {
        const v = live[r.key];
        const has = avail[r.key];
        const missing = has === false;
        const over = !missing && r.threshold !== null && v > r.threshold;
        return (
          <View key={r.key} style={[s.card, over && s.cardHot, missing && s.cardOff]}>
            <View style={s.cardHead}>
              <Text style={[s.cardLabel, missing && s.labelOff]}>{r.label}</Text>
              {missing ? (
                <Text style={s.absent}>no sensor on this device</Text>
              ) : (
                <Text style={[s.value, over && s.valueHot]}>
                  {on ? v.toFixed(r.key === "illumination" ? 0 : 2) : "—"}
                  <Text style={s.unit}> {r.unit}</Text>
                </Text>
              )}
            </View>

            <Text style={s.limit}>
              {r.threshold !== null ? `limit ${r.threshold} ${r.unit}` : "no limit set"}
            </Text>

            {r.clause ? (
              <Text style={mono}>{r.clause}</Text>
            ) : (
              <Text style={s.monitorTag}>MONITORING ONLY · no clause to cite</Text>
            )}

            <Text style={s.note}>{r.note}</Text>
          </View>
        );
      })}

      <Text style={s.footer}>
        Two of these three carry no statutory citation, and the app does not
        pretend otherwise. A noise or lighting clause added to the corpus would
        turn them into compliance signals; until then they are measurements.
      </Text>
      <Text style={s.hidden}>{tick}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  title: { fontSize: 20, fontWeight: "700", color: C.ink },
  body: { marginTop: 6, fontSize: 13, lineHeight: 19, color: C.inkSoft },
  primary: {
    marginTop: 16, backgroundColor: C.accent, borderRadius: 8,
    paddingVertical: 14, alignItems: "center",
  },
  stopBtn: { backgroundColor: C.crit },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  liveText: { fontSize: 12, color: C.ok },
  warn: { marginTop: 10, fontSize: 12, color: C.warn },
  card: {
    marginTop: 12, backgroundColor: C.panel, borderRadius: 8,
    borderWidth: 1, borderColor: C.line, padding: 12,
  },
  cardHot: { borderColor: C.crit, backgroundColor: C.critBg },
  cardOff: { opacity: 0.55 },
  labelOff: { color: C.inkSoft },
  absent: { fontSize: 11, fontStyle: "italic", color: C.inkSoft },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  cardLabel: { fontSize: 14, fontWeight: "700", color: C.ink },
  value: { fontSize: 22, fontWeight: "700", color: C.ink, fontVariant: ["tabular-nums"] },
  valueHot: { color: C.crit },
  unit: { fontSize: 12, fontWeight: "400", color: C.inkSoft },
  limit: { marginTop: 2, fontSize: 11, color: C.inkSoft },
  monitorTag: {
    marginTop: 4, fontSize: 10, fontWeight: "700",
    letterSpacing: 0.6, color: C.warn,
  },
  note: { marginTop: 6, fontSize: 11, lineHeight: 16, color: C.inkSoft },
  footer: { marginTop: 18, fontSize: 11, lineHeight: 16, color: C.inkSoft, fontStyle: "italic" },
  hidden: { height: 0, opacity: 0 },
});
