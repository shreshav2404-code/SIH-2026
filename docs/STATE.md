# Where we left off — 2026-09-03, 03:40

Pick up here next time. Everything is committed; nothing is half-finished.

---

## Start it all again

```bash
# 1. database
docker compose -f D:/anupalan/docker-compose.yml start

# 2. API   (0.0.0.0 so the emulator can reach it)
cd D:/anupalan/api
../.venv/Scripts/python -m uvicorn main:app --host 0.0.0.0 --port 8000

# 3. dashboard          -> http://localhost:5173   manager.gevra / demo1234
cd D:/anupalan/web && npm run dev

# 4. sensor simulator
D:/anupalan/.venv/Scripts/python D:/anupalan/tools/sensor_sim.py --mine 1

# 5. emulator + app
D:/Android/Sdk/emulator/emulator -avd anupalan_pixel7pro
adb emu geo fix 82.57 22.34        # an emulator has NO GPS - capture hangs without this
cd D:/anupalan/mobile && npx expo start --dev-client --port 8081
```

The APK is already installed on the AVD and the 3.66 GB model is already in the
app's storage, so neither needs redoing. If you reinstall the app, the model
goes with it - see docs/ANDROID_BUILD.md for the run-as push.

---

## What works, verified on the emulator

| Demo moment | Backend | Dashboard | Mobile |
|---|---|---|---|
| 1 Digital Rulebook | ok | **ok** | on-device only |
| 2 Offline capture | ok | ok | **ok** |
| 3 Hazard early-warning | ok | ok | - |
| 4 Geo-compliance | ok | ok | **ok** (inside-lease) |
| 5 Auto-drafted return | ok | ok | - |

Driven on the device, not just typechecked: sign in, ledger with risk badges,
camera capture, GPS lock, PostGIS "inside lease: Yes", queue, sync, intact hash
chain, dashboard overdue count dropping. Rulebook rejects a fabricated
regulation number on screen.

## What cannot work here

The on-device model. `LiteRTLMPackage` refuses x86_64 at runtime and Emulator
37.x dropped ARM translation, so Gemma needs a physical arm64 Android phone.
The Ask tab detects the model (3.66 GB, "installed in app storage") and fails
with a clear explanation rather than crashing.

## The release APK on a physical phone (3 Sep)

A 3.82 GB release APK with the model inside it is built and installed on a
Galaxy M31s. Two defects that **only exist in a release build** were found and
fixed; both need a rebuild before they take effect.

1. **Cleartext HTTP was blocked.** `expo prebuild` writes
   `usesCleartextTraffic` into the *debug* manifest only, so the release APK
   was refused every request by the platform while `adb reverse` and the API
   were both healthy. It surfaced as "cannot reach the API" and looked like a
   network fault. Confirmed by dumping the built APK's manifest with `aapt2`.
   See `ANDROID_BUILD.md` §6.
2. **The model-load ladder dead-ended.** It branched once and stopped, so the
   M31s - whose Exynos 9611 exposes no OpenCL - failed GPU for a non-memory
   reason, fell to cpu/4096, and was refused for being ~62 MB short with no
   rung left. Now a real ladder, gpu/4096 down to cpu/1024.

The API host is no longer compiled in: the sign-in screen has a Server field.
The laptop's IP had already drifted from `.36` to `.101`, and each such change
otherwise cost a rebuild that repackages 3.66 GB.

Both changes are verified on the emulator against live Metro - Login renders
the Server line and signs in over the LAN IP - but **whether Gemma 4 E4B
actually loads on the M31s is still open**, and needs the rebuilt APK.

## Next, in order

1. **Rebuild the release APK** in Android Studio (`:app` Active ABI must be
   `arm64-v8a`, variant `release`), install it, and load the model on the
   phone. This is the one open question in the whole build.
2. **Evidence thumbnails** on the dashboard - capture works, the photo and
   chain hash should be visible where a regulator would look.
3. **OBS recording** of all five moments, per the build plan's insurance.

## Read these before changing anything

- `docs/ANDROID_BUILD.md` - the six fixes that make the Android build work.
  `mobile/android/` is gitignored, so `expo prebuild --clean` wipes all of them.
- `docs/API_CONTRACT.md` - endpoint shapes, frozen unless all tracks agree.
- `docs/PROGRESS.md` - milestones and the decisions worth remembering.
