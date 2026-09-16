import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as ImageManipulator from "expo-image-manipulator";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { checkInsideLease, type Duty } from "../lib/api";
import { PHOTO_MAX_WIDTH, PHOTO_QUALITY } from "../lib/config";
import { enqueue } from "../lib/db";
import {
  lastPlaceFailure,
  lookupPlace,
  metresBetween,
  placeLine,
  type Place,
} from "../lib/place";
import {
  onReadingChange,
  readingState,
  startReading,
} from "../lib/photoReader";
import { C, mono } from "../theme";

interface Fix {
  lat: number;
  lon: number;
  accuracy: number | null;
}

/** Look the address up again once the fix has moved this far. */
const RELOOKUP_METRES = 30;
/** And no more often than this, whatever the GPS does. */
const RELOOKUP_MS = 10_000;

export default function Capture({
  duty,
  online,
  onDone,
  onCancel,
}: {
  duty: Duty;
  online: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [photo, setPhoto] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [placeState, setPlaceState] = useState<"idle" | "looking" | "none">("idle");
  const [insideLease, setInsideLease] = useState<boolean | null>(null);
  const [observation, setObservation] = useState("");
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, rerender] = useState(0);
  const [retryTick, setRetryTick] = useState(0);

  // Frozen at the shutter. The GPS keeps refining while the officer frames
  // the shot, but the evidence records where the photo was TAKEN, not where
  // the officer was standing when they pressed Save.
  const shotFix = useRef<Fix | null>(null);
  const shotPlace = useRef<Place | null>(null);
  const lastLookup = useRef<{ at: number; lat: number; lon: number } | null>(null);

  // Location follows the officer while this screen is open, instead of one
  // fix taken on arrival. A first fix is often +/-50 m and settles to single
  // metres within seconds; a single reading kept whichever one came first.
  // Coordinates are still captured by the device, never typed - that is what
  // makes the evidence impossible to back-date.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 2 },
        (pos) => {
          if (shotFix.current) return;
          setFix({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
        },
      );
      if (cancelled) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  // The address, live. Re-looked-up when the fix moves far enough to change
  // it, and throttled - the phone's geocoder is a network call and will
  // refuse a client that asks on every GPS tick.
  useEffect(() => {
    if (!fix || !online || shotFix.current || placeState === "looking") return;
    const last = lastLookup.current;
    const now = Date.now();
    // Standing still only suppresses a lookup that SUCCEEDED. A failed one is
    // retried on the timer whether or not the officer moves - otherwise a
    // lookup that failed once, at a desk, never ran again.
    if (
      last &&
      (now - last.at < RELOOKUP_MS ||
        (place && metresBetween(last, fix) < RELOOKUP_METRES))
    ) {
      return;
    }
    lastLookup.current = { at: now, lat: fix.lat, lon: fix.lon };
    setPlaceState("looking");
    lookupPlace(fix.lat, fix.lon).then((p) => {
      if (shotFix.current) return;
      setPlace(p);
      setPlaceState(p ? "idle" : "none");
    });
    // retryTick, not just fix: the GPS watch only reports a move of 2 m or
    // more, so a phone lying still produces no new fixes and nothing else
    // would ever run the retry.
  }, [fix, online, place, placeState, retryTick]);

  // Tick while there is no address, so a failed lookup gets retried.
  useEffect(() => {
    if (place || !online) return;
    const t = setInterval(() => setRetryTick((n) => n + 1), RELOOKUP_MS);
    return () => clearInterval(t);
  }, [place, online]);

  // Boundary check happens on capture, against PostGIS — not guessed on device.
  useEffect(() => {
    if (!fix || !online) return;
    checkInsideLease(duty.mine_id, fix.lat, fix.lon)
      .then((r) => setInsideLease(r.inside_lease))
      .catch(() => setInsideLease(null));
  }, [fix, online, duty.mine_id]);

  // Re-render when the model finishes reading this photo.
  useEffect(() => onReadingChange(() => rerender((n) => n + 1)), []);

  if (!permission) return <View style={s.centre}><ActivityIndicator /></View>;

  if (!permission.granted)
    return (
      <View style={s.centre}>
        <Text style={s.permText}>
          ANUPALAN needs the camera to capture statutory evidence.
        </Text>
        <TouchableOpacity style={s.primary} onPress={requestPermission}>
          <Text style={s.primaryText}>Grant camera access</Text>
        </TouchableOpacity>
      </View>
    );

  async function shoot() {
    const shot = await cameraRef.current?.takePictureAsync({ quality: 1 });
    if (!shot?.uri) return;

    // Compress — evidence has to upload over a bad connection.
    const out = await ImageManipulator.manipulateAsync(
      shot.uri,
      [{ resize: { width: PHOTO_MAX_WIDTH } }],
      { compress: PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
    shotFix.current = fix;
    shotPlace.current = place;
    setPhoto(out.uri);
    setCapturedAt(new Date().toISOString());

    // The model starts on the photo straight away, so its summary is on
    // screen while the officer is still standing in front of the thing.
    void startReading(out.uri, { title: duty.title });
  }

  function retake() {
    shotFix.current = null;
    shotPlace.current = null;
    setPhoto(null);
    setCapturedAt(null);
  }

  async function save() {
    const where = shotFix.current ?? fix;
    if (!where) {
      Alert.alert("No GPS fix", "Wait for a location before capturing.");
      return;
    }
    setSaving(true);
    try {
      // Whatever the model has finished by now goes in with the capture.
      // If it is still reading, it writes to this row when it is done.
      const read = readingState(photo);
      const ann = read?.kind === "done" ? read.annotation : null;
      const addr = shotPlace.current ?? place;

      await enqueue({
        client_id: Crypto.randomUUID(),
        obligation_id: duty.id,
        title: duty.title,
        clause_ref: duty.clause_ref,
        photo_uri: photo,
        lat: where.lat,
        lon: where.lon,
        gps_accuracy: where.accuracy,
        place: addr ? JSON.stringify(addr) : null,
        captured_at: capturedAt ?? new Date().toISOString(),
        observation: observation.trim() || null,
        reading_value: null,
        ai_description: ann?.description ?? null,
        ai_problems: ann ? JSON.stringify(ann.problems) : null,
        ai_model: ann?.model ?? null,
        ai_status: ann ? "done" : read?.kind === "reading" ? "reading" : null,
      });
      onDone();
    } catch (e) {
      Alert.alert("Could not save", String(e));
    } finally {
      setSaving(false);
    }
  }

  const shown = shotFix.current ?? fix;
  const shownPlace = shotPlace.current ?? place;
  const reading = readingState(photo);

  return (
    <ScrollView style={s.wrap} keyboardShouldPersistTaps="handled">
      <View style={s.head}>
        <Text style={s.headTitle}>{duty.title}</Text>
        <Text style={[mono, { color: "#9fc0e4" }]}>{duty.clause_ref}</Text>
      </View>

      {!online && (
        <View style={s.offline}>
          <Text style={s.offlineText}>OFFLINE — capture is stored locally</Text>
        </View>
      )}

      <View style={s.viewport}>
        {photo ? (
          <Image source={{ uri: photo }} style={s.preview} resizeMode="cover" />
        ) : (
          <CameraView ref={cameraRef} style={s.preview} facing="back" />
        )}
      </View>

      <View style={s.actions}>
        {photo ? (
          <TouchableOpacity style={s.secondary} onPress={retake}>
            <Text style={s.secondaryText}>Retake</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.primary} onPress={shoot}>
            <Text style={s.primaryText}>Take photo</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* What the model made of the photo, before the officer walks away. */}
      {photo && (
        <View style={s.readCard}>
          <Text style={s.readTitle}>WHAT THE MODEL SEES</Text>
          {!reading || reading.kind === "reading" ? (
            <View style={s.readRow}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={s.dim}>
                Reading the photo on this phone… you can keep typing and save;
                the summary is attached when it finishes.
              </Text>
            </View>
          ) : reading.kind === "failed" ? (
            <Text style={s.readFail}>
              Could not read this photo: {reading.message} It will be tried
              again at sync.
            </Text>
          ) : (
            <>
              <Text style={s.readText}>{reading.annotation.description}</Text>
              {reading.annotation.problems.map((p, i) => (
                <Text key={i} style={s.readProblem}>
                  ⚠ {p}
                </Text>
              ))}
              <Text style={s.readMeta}>
                {reading.via === "cloud"
                  ? `${reading.annotation.model} · sent from this phone because ${reading.because} · answered in ${reading.cloudSeconds}s`
                  : `${reading.annotation.model} · model loaded in ${reading.loadSeconds}s, photo read in ${reading.readSeconds}s`}
                {" · a description, not a compliance verdict"}
              </Text>
            </>
          )}
        </View>
      )}

      {/* Locked fields. The officer cannot edit any of these. */}
      <View style={s.card}>
        <Field label="Address" locked>
          {shownPlace ? (
            <Text style={s.addr}>{placeLine(shownPlace)}</Text>
          ) : (
            <Text style={s.dim}>
              {!online
                ? "looked up at sync"
                : placeState === "looking" || !shown
                  ? "finding address…"
                  : `no address - ${lastPlaceFailure ?? "not found"}`}
            </Text>
          )}
        </Field>
        <Field label="PIN code" locked>
          {shownPlace?.pincode ?? "—"}
        </Field>
        <Field label="Coordinates" locked>
          {shown
            ? `${shown.lat.toFixed(5)}° N, ${shown.lon.toFixed(5)}° E`
            : "acquiring…"}
        </Field>
        <Field label="Accuracy" locked>
          {shown?.accuracy ? `±${Math.round(shown.accuracy)} m` : "—"}
        </Field>
        <Field label="Inside lease">
          {insideLease === null ? (
            <Text style={s.dim}>{online ? "checking…" : "checks on sync"}</Text>
          ) : (
            <Text style={{ color: insideLease ? C.ok : C.crit, fontWeight: "700" }}>
              {insideLease ? "Yes" : "No — outside the boundary"}
            </Text>
          )}
        </Field>
        <Field label="Timestamp" locked>
          {capturedAt ? new Date(capturedAt).toLocaleString() : "on capture"}
        </Field>
      </View>

      <Text style={s.label}>OBSERVATION</Text>
      <TextInput
        style={s.input}
        multiline
        placeholder="Hairline cracking noted at junction, 2 m east of…"
        placeholderTextColor="#9aabbd"
        value={observation}
        onChangeText={setObservation}
      />

      <TouchableOpacity
        style={[s.primary, s.wide, (!shown || saving) && s.disabled]}
        onPress={save}
        disabled={!shown || saving}
      >
        <Text style={s.primaryText}>
          {saving ? "Saving…" : "Save to queue"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={[s.secondary, s.wide]} onPress={onCancel}>
        <Text style={s.secondaryText}>Cancel</Text>
      </TouchableOpacity>

      <Text style={s.note}>
        Coordinates, timestamp and hash are captured by the app, not typed by a
        person. The record is chained to the previous capture at this mine on
        upload. The address and the model's summary are worked out from the
        photo and the coordinates, so they are attached to the record but not
        part of its hash.
      </Text>
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

function Field({
  label,
  children,
  locked,
}: {
  label: string;
  children: React.ReactNode;
  locked?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.fieldValue}>
        {typeof children === "string" ? (
          <Text style={s.fieldText}>{children}</Text>
        ) : (
          children
        )}
        {locked && <Text style={s.lock}>locked</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  permText: { textAlign: "center", color: C.inkSoft, marginBottom: 16 },
  head: { backgroundColor: C.header, paddingHorizontal: 16, paddingVertical: 12 },
  headTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  offline: { backgroundColor: C.warnBg, padding: 8 },
  offlineText: {
    color: C.warn, fontSize: 12, fontWeight: "700", textAlign: "center",
  },
  viewport: { height: 260, backgroundColor: "#1d2b38" },
  preview: { flex: 1 },
  actions: { padding: 12 },
  readCard: {
    marginHorizontal: 12, marginBottom: 12, padding: 12, borderRadius: 8,
    borderWidth: 1, borderColor: "#d9ccf2", backgroundColor: "#f7f3fd",
  },
  readTitle: {
    fontSize: 10, fontWeight: "700", letterSpacing: 0.8, color: "#5b3e96",
    marginBottom: 6,
  },
  readRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 24 },
  readText: { fontSize: 13, lineHeight: 19, color: C.ink },
  readProblem: { marginTop: 6, fontSize: 12, lineHeight: 17, color: C.crit, fontWeight: "600" },
  readFail: { fontSize: 12, lineHeight: 17, color: C.warn },
  readMeta: { marginTop: 8, fontSize: 10, color: "#6f5a99" },
  card: {
    backgroundColor: C.panel, marginHorizontal: 12, borderRadius: 8,
    borderWidth: 1, borderColor: C.line,
  },
  field: {
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10, gap: 12,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  fieldLabel: { color: C.inkSoft, fontSize: 13 },
  fieldValue: {
    flexDirection: "row", alignItems: "center", gap: 6,
    flexShrink: 1, justifyContent: "flex-end",
  },
  fieldText: { color: C.ink, fontSize: 13, fontWeight: "600" },
  addr: { color: C.ink, fontSize: 12, fontWeight: "600", textAlign: "right", flexShrink: 1 },
  lock: { color: "#9aabbd", fontSize: 11 },
  dim: { color: C.inkSoft, fontSize: 13, flexShrink: 1 },
  label: {
    marginTop: 16, marginHorizontal: 12, fontSize: 11,
    fontWeight: "700", letterSpacing: 0.8, color: C.inkSoft,
  },
  input: {
    margin: 12, marginTop: 6, minHeight: 76, backgroundColor: C.panel,
    borderWidth: 1, borderColor: C.line, borderRadius: 8,
    padding: 10, color: C.ink, textAlignVertical: "top",
  },
  primary: {
    backgroundColor: C.accent, borderRadius: 8,
    paddingVertical: 13, alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondary: {
    backgroundColor: C.panel, borderRadius: 8, borderWidth: 1,
    borderColor: C.accent, paddingVertical: 13, alignItems: "center",
  },
  secondaryText: { color: C.accent, fontWeight: "700", fontSize: 15 },
  wide: { marginHorizontal: 12, marginTop: 8 },
  disabled: { opacity: 0.5 },
  note: {
    margin: 16, fontSize: 11, lineHeight: 16, color: C.inkSoft,
    textAlign: "center",
  },
});
