# ANUPALAN — Build Progress

Updated 2026-09-03. Tracks the five demo moments and the 36-hour milestones.

---

## The five demo moments

| # | Moment | Backend | Dashboard | Mobile (emulator) | On-device model |
|---|--------|---------|-----------|--------|-----------|
| 1 | **Digital Rulebook** | ✅ **proven** | ⬜ paste-box UI | ⬜ | ❌ needs arm64 |
| 2 | **Offline capture** | ✅ **proven** | ✅ chain status | ✅ **proven** | n/a |
| 3 | **Hazard early-warning** | ✅ **proven** | ✅ **live chart + alerts** | ⬜ | ❌ needs arm64 |
| 4 | **Geo-compliance** | ✅ **proven** | ✅ **map renders breach** | ✅ inside-lease check | n/a |
| 5 | **Auto-drafted return** | ✅ **proven** | ✅ **draft + sign-off** | ⬜ | ❌ needs arm64 |

### The on-device model cannot run on this laptop

Emulator 37.x removed ARM translation on x86_64 hosts, and the LiteRT-LM
wrapper refuses x86_64 at runtime:

```
W LiteRTLMPackage: Skipping LiteRTLM native init on unsupported primary ABI: x86_64
```

Widening `abiFilters` does put `lib/x86_64/liblitertlm_jni.so` (24 MB) in the
APK, but the Kotlin layer still declines to initialise. **Gemma needs a
physical arm64 Android device.** Everything else runs on the emulator.

✅ verified working · 🟡 built, blocked · ⬜ not started

---

## Verified on the emulator, end to end

Ran on `anupalan_pixel7pro` (x86_64, Android 15, 6 GB RAM), not just typechecked:

- **Install → sign in → ledger.** App reaches the API on `10.0.2.2:8000`,
  shows "Online", renders overdue duties with red day-counts and clause refs.
- **Capture.** Camera live, GPS locks 22.3400 N 82.5700 E, the app calls
  `/geo/contains` and PostGIS answers **inside lease: Yes**, timestamp locks to
  the device clock. All four fields shown `locked` — none typeable.
- **Queue → sync → database.** Saved offline, uploaded on demand, landed as
  evidence row 1 with `inside_lease=t` and an intact hash chain. YOLOv8n
  screened the photo on upload; the file is on disk at `api/storage/1/1.jpg`.
- **Dashboard reacted.** Overdue dropped 8 → 7, evidence chain "Intact, 1
  record verified", the duty flipped to SUBMITTED.

**An emulator has no GPS.** Set a mock fix or capture waits forever:
`adb emu geo fix 82.57 22.34` (inside the Gevra polygon).

## Verified, not assumed

Each of these was run against the live API, not just written:

- **Hash chain breaks on tamper.** `UPDATE evidence SET lat=99.9999 WHERE id=2`
  → verify went `ok:true checked:4` → `ok:false`, naming evidence_id 2 with
  expected vs found hashes. This is the DBeaver demo.
- **Idempotent capture.** Re-posting the same `client_id` returns 200 with the
  existing row, not a duplicate. Makes the offline queue safe to retry.
- **PostGIS containment.** lon 82.57 → `inside_lease: true`, 2,768 m from
  boundary. lon 82.65 → `false`, 5,151 m out.
- **Boundary breach.** `ST_Difference` computes 4,106,328 m² (410 ha) outside
  the lease, with all three polygons returned for Leaflet.
- **Methane spike fires an alert** citing `CMR 2017 · Reg. 46`, z=4.3 sigma
  above the hour mean, threshold 1.25%.
- **Return signing locks.** Second signature → `409 already signed and locked`.
- **Role separation.** safety_officer signing → `403`. Regulator sees all 3 mines.
- **Grounding.** `/sensors/window` returns readings *plus* the governing clause
  text, so the on-device model never recalls statute from memory.

---

## Milestones (build plan §11)

| Hours | Milestone | State |
|---|---|---|
| 0–2 | Repo, compose up, DB with both extensions, API contract written | ✅ |
| 2–6 | Schema migrated, seed loaded, auth returns a token | ✅ |
| 6–12 | Ledger endpoints live and rendering in the dashboard | ✅ |
| 12–18 | Evidence capture end to end, sensor sim streaming | ✅ verified on the emulator |
| 18–24 | Rulebook returns cited JSON, risk scoring, alerts firing | ✅ |
| 24–30 | Map, vision, return drafting and sign-off | ✅ |
| 30–34 | **FEATURE FREEZE.** Polish, demo dataset, OBS recording | ⬜ |
| 34–36 | Three dry runs against the clock | ⬜ |

---

## Build the Android app from Android Studio, not the CLI

`gradlew.bat` cannot build on this machine from an agent shell. Any Gradle
daemon it spawns is unreachable over loopback:

```
FAILURE: java.io.IOException: Unable to establish loopback connection
  daemon side: TcpIncomingConnector — SocketException: Invalid argument: connect
```

Ruled out by testing, not assumption: java resolves `localhost` to both
127.0.0.1 and ::1 and cross-process connects fine; only Windows Defender is
installed; no firewall rule touches java; Gradle itself runs (`--version` is
fine); `preferIPv4Stack` does not help; it reproduces writing to a file, so it
is not a truncated pipe.

**Android Studio builds without any of this trouble** — its daemon connects
immediately. The agent shell has a non-stock environment
(`NoDefaultCurrentDirectoryInExePath=1`), which the daemon inherits.

**So: Claude writes and typechecks the code; a human presses Build → Make
Project.** Do not spend more time on the CLI.

---

## Running it

```bash
docker compose up -d                                   # database
cd api && ../.venv/Scripts/python -m uvicorn main:app --port 8000
cd web && npm run dev                                  # dashboard :5173
python tools/sensor_sim.py --mine 1                    # readings every 2s
```

Sign in as `manager.gevra` / `demo1234`.

## Running the emulator demo

```bash
# 1. the three services (see "Running it" above), then:
emulator -avd anupalan_pixel7pro          # x86_64, 6 GB, Android 15
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb emu geo fix 82.57 22.34               # an emulator has NO GPS
npx expo start --dev-client --port 8081   # debug build needs Metro
```

Grant permissions once: `adb shell pm grant in.neuraforge.anupalan android.permission.CAMERA`
(and `ACCESS_FINE_LOCATION`).

## Next

1. **Rulebook paste-box on the dashboard** — the backend is proven; moment 1
   has no UI yet. Highest-value remaining item, it is the headline claim.
2. **Evidence photo thumbnails** on the dashboard, now that capture works.
3. Demo dataset: seed a believable spread rather than everything at 92–98 risk.
4. OBS fallback recording of all five moments.
5. On-device Gemma — needs a physical arm64 phone; nothing more to do on this
   laptop.

---

## Decisions worth remembering

- **Dropped passlib for bcrypt directly.** passlib unmaintained since 2020, its
  backend probe crashes against bcrypt 5.x.
- **Alert stores `clause_ref` rather than deriving it.** An opencast mine has no
  ventilation obligation, but a methane reading still cites Reg. 46. Deriving
  it through a join lost the citation exactly where it mattered.
- **Evidence returns 200 (not 201) on idempotent replay**, so the mobile queue
  can tell the difference.
- **No endpoint files a return.** Draft and sign are separate; only
  `mine_manager` signs. The AI never files, so it never carries liability.
