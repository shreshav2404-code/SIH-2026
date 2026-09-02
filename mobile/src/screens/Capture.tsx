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
import { C, mono } from "../theme";

interface Fix {
  lat: number;
  lon: number;
  accuracy: number | null;
}

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
  const [insideLease, setInsideLease] = useState<boolean | null>(null);
  const [observation, setObservation] = useState("");
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Location is acquired up front, not at save time. Coordinates are captured
  // by the device, never typed by a person — that is what makes the evidence
  // impossible to back-date.
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setFix({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
    })();
  }, []);

  // Boundary check happens on capture, against PostGIS — not guessed on device.
  useEffect(() => {
    if (!fix || !online) return;
    checkInsideLease(duty.mine_id, fix.lat, fix.lon)
      .then((r) => setInsideLease(r.inside_lease))
      .catch(() => setInsideLease(null));
  }, [fix, online, duty.mine_id]);

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
    setPhoto(out.uri);
    setCapturedAt(new Date().toISOString());
  }

  async function save() {
    if (!fix) {
      Alert.alert("No GPS fix", "Wait for a location before capturing.");
      return;
    }
    setSaving(true);
    try {
      await enqueue({
        client_id: Crypto.randomUUID(),
        obligation_id: duty.id,
        title: duty.title,
        clause_ref: duty.clause_ref,
        photo_uri: photo,
        lat: fix.lat,
        lon: fix.lon,
        captured_at: capturedAt ?? new Date().toISOString(),
        observation: observation.trim() || null,
        reading_value: null,
      });
      onDone();
    } catch (e) {
      Alert.alert("Could not save", String(e));
    } finally {
      setSaving(false);
    }
  }

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
          <TouchableOpacity style={s.secondary} onPress={() => setPhoto(null)}>
            <Text style={s.secondaryText}>Retake</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.primary} onPress={shoot}>
            <Text style={s.primaryText}>Take photo</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Locked fields. The officer cannot edit any of these. */}
      <View style={s.card}>
        <Field label="Location" locked>
          {fix
            ? `${fix.lat.toFixed(4)}° N, ${fix.lon.toFixed(4)}° E`
            : "acquiring…"}
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
        <Field label="Accuracy" locked>
          {fix?.accuracy ? `±${Math.round(fix.accuracy)} m` : "—"}
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
        style={[s.primary, s.wide, (!fix || saving) && s.disabled]}
        onPress={save}
        disabled={!fix || saving}
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
        upload.
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
  card: {
    backgroundColor: C.panel, marginHorizontal: 12, borderRadius: 8,
    borderWidth: 1, borderColor: C.line,
  },
  field: {
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  fieldLabel: { color: C.inkSoft, fontSize: 13 },
  fieldValue: { flexDirection: "row", alignItems: "center", gap: 6 },
  fieldText: { color: C.ink, fontSize: 13, fontWeight: "600" },
  lock: { color: "#9aabbd", fontSize: 11 },
  dim: { color: C.inkSoft, fontSize: 13 },
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
