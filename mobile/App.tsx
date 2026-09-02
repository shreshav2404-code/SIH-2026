import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { loadToken, login, me, ping, type Duty, type User } from "./src/lib/api";
import { counts } from "./src/lib/db";
import Capture from "./src/screens/Capture";
import Duties from "./src/screens/Duties";
import Sync from "./src/screens/Sync";
import { C } from "./src/theme";

type Tab = "duties" | "capture" | "sync";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<Tab>("duties");
  const [active, setActive] = useState<Duty | null>(null);
  const [online, setOnline] = useState(false);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    (async () => {
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

  if (booting)
    return (
      <View style={s.centre}>
        <ActivityIndicator color={C.accent} />
      </View>
    );

  if (!user) return <Login onSignedIn={setUser} />;

  return (
    <SafeAreaView style={s.app}>
      <StatusBar style="light" />

      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>
            {tab === "duties" ? "Today's Duties" : tab === "sync" ? "Sync & Sign-off" : "Capture Evidence"}
          </Text>
          <Text style={s.headerSub}>
            {user.full_name} · mine {user.mine_id}
          </Text>
        </View>
        <View style={[s.dot, { backgroundColor: online ? "#4ade80" : "#fbbf24" }]} />
        <Text style={s.headerNet}>{online ? "Online" : "No signal"}</Text>
      </View>

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
            <View style={s.centre}>
              <Text style={s.dim}>Pick a duty from the list to capture it.</Text>
            </View>
          ))}
        {tab === "sync" && <Sync online={online} />}
      </View>

      <View style={s.tabs}>
        {(["duties", "capture", "sync"] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={s.tab} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabActive]}>
              {t.toUpperCase()}
              {t === "sync" && queued > 0 ? ` (${queued})` : ""}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

function Login({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [username, setUsername] = useState("manager.gevra");
  const [password, setPassword] = useState("demo1234");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await login(username, password));
    } catch {
      setError("Could not sign in. Is the API reachable from this phone?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[s.app, s.centre]}>
      <StatusBar style="dark" />
      <Text style={s.brand}>ANUPALAN</Text>
      <Text style={s.dim}>Field inspection · Coal India</Text>

      <View style={s.form}>
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
        <TouchableOpacity
          style={[s.primary, busy && { opacity: 0.6 }]}
          onPress={submit}
          disabled={busy}
        >
          <Text style={s.primaryText}>{busy ? "Signing in…" : "Sign in"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 6,
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
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontSize: 12, fontWeight: "700", color: C.inkSoft, letterSpacing: 0.5 },
  tabActive: { color: C.accent },
  brand: { fontSize: 28, fontWeight: "700", color: C.ink, letterSpacing: 1 },
  dim: { color: C.inkSoft, fontSize: 13, marginTop: 4 },
  form: { alignSelf: "stretch", marginTop: 28 },
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
