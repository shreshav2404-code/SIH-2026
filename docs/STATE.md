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

## Next, in order

1. **Demo dataset.** Every duty scores 92-98, which is flat for a
   "which duty fails next" story. Give it spread.
2. **Evidence thumbnails** on the dashboard - capture works, the photo and
   chain hash should be visible where a regulator would look.
3. **OBS recording** of all five moments, per the build plan's insurance.
4. Ship an APK for other phones (`-PbundleModel=true` bundles the model).

## Read these before changing anything

- `docs/ANDROID_BUILD.md` - the four fixes that make the Android build work.
  `mobile/android/` is gitignored, so `expo prebuild --clean` wipes all of them.
- `docs/API_CONTRACT.md` - endpoint shapes, frozen unless all tracks agree.
- `docs/PROGRESS.md` - milestones and the decisions worth remembering.
