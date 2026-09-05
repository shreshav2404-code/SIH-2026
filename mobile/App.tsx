import axios from "axios";
import { StatusBar } from "expo-status-bar";
// react-native-safe-area-context, not react-native. RN's SafeAreaView is
// deprecated and a no-op for the Android status bar, so the header painted
// straight over the system clock and the duty list was clipped at the top.
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  ImageBackground,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  currentServerUrl,
  loadServerUrl,
  loadToken,
  login,
  me,
  ping,
  saveServerUrl,
  transport,
  type Duty,
  type User,
} from "./src/lib/api";
import { LAN_HOST } from "./src/lib/config";
import { describeTransport } from "./src/lib/discovery";
import { counts } from "./src/lib/db";
import Ask from "./src/screens/Ask";
import Capture from "./src/screens/Capture";
import Duties from "./src/screens/Duties";
import DirectiveBanner from "./src/components/DirectiveBanner";
import Headframe from "./src/components/Headframe";
import ScreenHero from "./src/components/ScreenHero";
import { UNDERGROUND_PHOTO } from "./src/lib/photos";
import { TabBoundary } from "./src/components/TabBoundary";
import Sensors from "./src/screens/Sensors";
import Sync from "./src/screens/Sync";
import { C } from "./src/theme";

type Tab = "duties" | "capture" | "ask" | "sensors" | "sync";

function AppInner() {
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<Tab>("duties");
  const [active, setActive] = useState<Duty | null>(null);
  const [online, setOnline] = useState(false);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    (async () => {
      // Must come first: every request below uses this base URL.
      await loadServerUrl();
      await loadToken();
      try {
        setUser(await me());
      } catch {
        setUser(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Connectivity is polled, not assumed. The banner must be honest — an
  // officer underground needs to know the capture is being held, not lost.
  const refreshStatus = useCallback(async () => {
    setOnline(await ping());
    const c = await counts();
    setQueued(c.queued + c.error);
  }, []);

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 6000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  // Android's back button exits the app by default. Mid-capture that means a
  // judge pressing back lands on the launcher and the evidence is gone, so
  // back walks the app's own history first and only leaves from the duty list.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tab === "capture") {
        setActive(null);
        setTab("duties");
        return true;
      }
      if (tab === "sync" || tab === "ask") {
        setTab("duties");
        return true;
      }
      return false; // already on duties — let Android close the app
    });
    return () => sub.remove();
  }, [tab]);

  if (booting)
    return (
      <View style={s.centre}>
        <ActivityIndicator color={C.accent} />
      </View>
    );

  if (!user) return <Login onSignedIn={setUser} />;

  return (
    <View style={s.app}>
      <StatusBar style="light" />

      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Headframe size={30} />
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>
            {tab === "duties"
              ? "Today's Duties"
              : tab === "sync"
                ? "Sync & Sign-off"
                : tab === "ask"
                  ? "Ask ANUPALAN"
                : tab === "sensors"
                    ? "Handset Telemetry"
                    : "Capture Evidence"}
          </Text>
          <Text style={s.headerSub}>
            {user.full_name} · mine {user.mine_id}
          </Text>
        </View>
        <View style={[s.dot, { backgroundColor: online ? "#4ade80" : "#fbbf24" }]} />
        <Text style={s.headerNet}>{online ? "Online" : "No signal"}</Text>
      </View>

      {/* Above everything, on every tab. A withdrawal order that only shows on
          the right screen is not a withdrawal order. */}
      <DirectiveBanner online={online} />

      {!online && queued > 0 && tab === "duties" && (
        <View style={s.offline}>
          <Text style={s.offlineText}>
            OFFLINE — {queued} capture{queued === 1 ? "" : "s"} held, will sync at surface
          </Text>
        </View>
      )}

      <View style={{ flex: 1 }}>
        {tab === "duties" && (
          <Duties
            onCapture={(d) => {
              setActive(d);
              setTab("capture");
            }}
          />
        )}
        {tab === "capture" &&
          (active ? (
            <Capture
              duty={active}
              online={online}
              onDone={() => {
                refreshStatus();
                setActive(null);
                setTab("sync");
              }}
              onCancel={() => {
                setActive(null);
                setTab("duties");
              }}
            />
          ) : (
            // The capture tab with nothing selected was a line of grey text on
            // an empty screen. It is the second tab an officer lands on, so it
            // now says what the tab is FOR rather than only what is missing.
            <View style={{ flex: 1 }}>
              <ScreenHero
                photo={UNDERGROUND_PHOTO}
                title="Capture evidence"
                subtitle="geo-tagged, hashed on capture, queued if there is no signal"
              />
              <View style={s.centre}>
                <Text style={s.dim}>Pick a duty from the list to capture it.</Text>
              </View>
            </View>
          ))}
        {/* These two depend on native modules (LiteRT-LM, expo-sensors,
            expo-audio). If the installed binary predates one, the boundary
            explains it in that tab instead of the app refusing to open. */}
        {tab === "ask" && (
          <TabBoundary name="The assistant">
            <Ask />
          </TabBoundary>
        )}
        {tab === "sensors" && (
          <TabBoundary name="Handset telemetry">
            <Sensors mineId={user.mine_id ?? 1} />
          </TabBoundary>
        )}
        {tab === "sync" && <Sync online={online} />}
      </View>

      <View style={[s.tabs, { paddingBottom: insets.bottom }]}>
        {(["duties", "capture", "ask", "sensors", "sync"] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={s.tab} onPress={() => setTab(t)}>
            {/* A bar above the label rather than colour alone - colour is the
                first thing a projector washes out, and the demo runs on one. */}
            <View style={[s.tabMark, tab === t && s.tabMarkOn]} />
            <Text style={[s.tabText, tab === t && s.tabActive]}>
              {t.toUpperCase()}
              {t === "sync" && queued > 0 ? ` (${queued})` : ""}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  // SafeAreaProvider must wrap everything that reads insets.
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

function Login({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [username, setUsername] = useState("keshav");
  const [password, setPassword] = useState("demo1234");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState(currentServerUrl());
  const [editingServer, setEditingServer] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await saveServerUrl(server);
      onSignedIn(await login(username, password));
    } catch (err) {
      // Underground, "wrong password" versus "no signal" are completely
      // different problems. Never conflate them.
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;

      if (status === 401) setError("Incorrect username or password.");
      else if (status === undefined)
        setError(
          "Cannot reach the API. Tried the cable, the phone's hotspot and " +
            "wifi. Start the backend, or set the address below by hand.",
        );
      else if (status >= 500)
        setError(`API error ${status} — the server is up but failing.`);
      else setError(`Sign-in failed (HTTP ${status}).`);
    } finally {
      setBusy(false);
    }
  }

  return (
    // Generated artwork, not a stock photograph - see tools/make_art.py.
    // A government-facing tool should be able to account for the
    // provenance of every asset it ships.
    <ImageBackground
      source={require("./assets/mine-bg.png")}
      style={[s.app, s.centre]}
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <Text style={s.brandOnArt}>ANUPALAN</Text>
      <Text style={s.dimOnArt}>Field inspection · Coal India</Text>

      <View style={s.formCard}>
        <TextInput
          style={s.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          placeholder="Username"
        />
        <TextInput
          style={s.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
        />
        {error && <Text style={s.error}>{error}</Text>}

        {editingServer ? (
          <TextInput
            style={s.input}
            value={server}
            onChangeText={setServer}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={LAN_HOST}
          />
        ) : (
          <TouchableOpacity onPress={() => setEditingServer(true)}>
            <Text style={s.serverLine}>
              Server: {server}
              {transport ? ` · ${describeTransport(transport)}` : ""} · change
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[s.primary, busy && { opacity: 0.6 }]}
          onPress={submit}
          disabled={busy}
        >
          <Text style={s.primaryText}>{busy ? "Signing in…" : "Sign in"}</Text>
        </TouchableOpacity>
      </View>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg },
  // Deliberately quiet. It matters when the API moves, and never otherwise.
  serverLine: { color: C.inkSoft, fontSize: 12, textAlign: "center", paddingVertical: 6 },
  // Top inset paints in the header colour so the status bar blends
  // into the header instead of showing a pale band above it.
  appDark: { flex: 1, backgroundColor: C.header },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.header, paddingHorizontal: 16, paddingVertical: 12,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  headerSub: { color: "#9fc0e4", fontSize: 12, marginTop: 2 },
  headerNet: { color: "#c9dcf0", fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  offline: { backgroundColor: C.warnBg, padding: 8 },
  offlineText: { color: C.warn, fontSize: 12, fontWeight: "700", textAlign: "center" },
  tabs: {
    flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line,
    backgroundColor: C.panel,
  },
  tab: { flex: 1, paddingTop: 8, paddingBottom: 12, alignItems: "center", gap: 6 },
  tabMark: { height: 3, width: 22, borderRadius: 2, backgroundColor: "transparent" },
  tabMarkOn: { backgroundColor: C.accent },
  tabText: { fontSize: 12, fontWeight: "700", color: C.inkSoft, letterSpacing: 0.5 },
  tabActive: { color: C.accent },
  brand: { fontSize: 28, fontWeight: "700", color: C.ink, letterSpacing: 1 },
  dim: { color: C.inkSoft, fontSize: 13, marginTop: 4 },
  form: { alignSelf: "stretch", marginTop: 28 },

  // Sign-in over the artwork. The form sits on an opaque card so the inputs
  // keep full contrast whatever is behind them.
  brandOnArt: { fontSize: 28, fontWeight: "700", color: "#fff", letterSpacing: 1 },
  dimOnArt: { color: "#c8d6e4", fontSize: 13, marginTop: 4 },
  formCard: {
    alignSelf: "stretch", marginTop: 28, backgroundColor: C.panel,
    borderRadius: 12, padding: 16,
  },
  input: {
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    borderRadius: 8, padding: 12, marginBottom: 10, color: C.ink,
  },
  error: { color: C.crit, fontSize: 12, marginBottom: 8 },
  primary: {
    backgroundColor: C.accent, borderRadius: 8, paddingVertical: 13,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
