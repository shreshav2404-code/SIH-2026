# Where we left off — 2026-09-04, 17:40

Pick up here next time.

**Blocked, and not on the project:** the release build cannot run. Gradle's
daemon binds `127.0.0.1` and then Java cannot complete the loopback
self-connect it needs (`java.net.SocketException: Invalid argument: connect`).
Ruled out: stale daemons, java firewall rules, VPNs, forcing IPv4 and IPv6.
PowerShell binds loopback fine, so it is Java specifically, and it built
successfully at 16:28 the same day. Fix is `netsh winsock reset` in an admin
terminal followed by a reboot, then:

    cd mobile/android && ./gradlew assembleRelease -PbundleModel=true

All source changes below are written and typecheck clean; none has run on the
phone.

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

The APK is already installed on the AVD and the models are already in the app's
storage, so neither needs redoing. If you reinstall the app, the model
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
37.x dropped ARM translation, so the models need a physical arm64 Android phone.
The Ask tab detects the models ("installed in app storage") and fails
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
the Server line and signs in over the LAN IP. Gemma 4 E4B was later confirmed
to load on the M31s (GPU/4096, 45 s, 3.3 GB) and then dropped anyway: it took
144 seconds to answer. See Phase 7.

## Phase 8 - the model was trained here (5 Sep)

**There is now a model fine-tuned on this project**, built on the laptop's own
RTX 4050. Nothing was uploaded: the corpus, the training and the weights all
stayed on the machine, which is the same premise as the rest of the system.

    tools/build_dataset.py   1,078 examples from the clause corpus, the ledger
                             and these docs. Nothing invented - every answer
                             traces to a file or a database row.
    tools/train.py           full fine-tune of Gemma 3 270M, --epochs/--lr
    tools/eval.py            grounded / recall / unrelated batteries
    models/gemma-anupalan-Q4_0.gguf   238 MB, 117 tok/s on the laptop

**Seven rounds, and the failures were all in the data, not the training.**

1. Clause examples were 47% of the corpus, so the model answered EVERYTHING in
   clause style - asked "does this need internet" it cited a lease boundary.
2. The answers were 40-word paragraphs. It learned the opening phrase and then
   drifted into invention: "A tamper-evident ledger" followed by nonsense about
   prime numbers.
3. Facts were taught as `fact + question -> the fact`, which teaches ECHO, not
   answering. Rewriting the target as a direct answer derived from the fact
   repaired three failures at once.

**Ten epochs was worse than six.** The longer run produced self-contradicting
answers ("No. It runs entirely on this device and only needs internet"). Six is
the setting; more training made it worse, which is only visible by reading the
output.

**Recall does not work at 270M, so facts moved into the prompt.** See
mobile/src/lib/facts.ts - twelve system facts with rarity-weighted keyword
retrieval, injected before the question. Recall becomes reading, which the
model does well. An early version of that router listed "what" and "how" as
keys, so "what is the capital of France" had a paragraph about compliance
monitoring pushed in front of it.

**Three facts bypass the model entirely.** "Can this file a statutory return"
came back "Yes" in six consecutive rounds even with the correct fact in the
prompt - the base model's yes/no prior is immovable at this size. Filing,
offline operation and hazard detection are now returned verbatim from the
table by code. A compliance tool claiming it can file returns is not a rough
edge; it is a false statement about the software, and the project's own rule
says a statement like that cannot depend on a probabilistic system.

## Phase 7 — measured, then cut (4 Sep, evening)

**The lag was never the model. It was the context window.** Measured on the
M31s from a cold start, at `maxContextTokens: 4096` every model landed in the
same place regardless of its size:

| model | on disk | resident |
|---|---|---|
| Qwen2.5 1.5B | 1.49 GB | 4,079 MB |
| Falcon-H1 0.6B R | 833 MB | 4,459 MB |
| Granite 4.0 350M | 459 MB | 3,984 MB |

`GL mtrack` was 9 MB throughout — the Mali GPU was barely used, whatever the
green header claimed. The KV cache is allocated up front and scales with the
window, so it dwarfed the weights. This took a 7.7 GB phone down to 1.4 GB
available and made Android kill background processes by the dozen;
force-stopping the app returned 4 GB instantly. **LOAD_LADDER now starts at
gpu/1024** and falls to cpu/512. Nothing here needs more: a ledger prompt is
ten duties against a 150-token answer cap.

**Three models, 984 MB of weights** (was 3.43 GB across four):

| model | size | role |
|---|---|---|
| Granite 4.0 350M | 459 MB | default; template is trained for document-grounded answers |
| SmolLM2 360M Instruct | 356 MB | best chat quality per megabyte |
| LFM2.5 230M int4 | 169 MB | `chatOnly` — plain chat, never given the ledger |

**`chatOnly` is a hard branch, not a lighter prompt.** A 230M model cannot
reliably copy a clause reference, and that failure is not quiet — it invents a
plausible regulation number. Qwen wrote "Mines Rules 1555" once, one digit off
a real statute. So the smallest model skips `askLedger()` entirely, gets no
duty table, no citation audit and no compliance quick-actions, and every reply
it produces is captioned *plain chat — NOT grounded in the ledger*.

**Template leakage is stripped at a single choke point.** Typing "Hi bro" at
Qwen2.5 produced `<|im_start|>assistant` followed by mangled fragments of the
prompt: a greeting has no answer in a ledger prompt, so the model degenerated
into emitting its own turn markers. All six call sites now route through
`generate()`, which truncates at the first template marker and sanitises
streamed tokens as well. Greetings are additionally short-circuited in
`Ask.tsx` and answered without the model at all — instant, and it cannot
hallucinate.

**Two bugs found by looking rather than reasoning.** A Kotlin stack trace
(`HybridLiteRTLM.ensureLoaded`) was being rendered into the chat as an answer —
now `briefError()` keeps the first line. And `mergeReleaseAssets/` still held a
complete Qwen2.5 and Falcon-H1 after they left the registry: 2.3 GB that would
have shipped silently and pushed the APK back at the 4 GiB ZIP32 ceiling. The
build guard only inspected `models/`, so it saw nothing. It now sweeps the
merged directory too.

**Not yet measured:** none of the three has been run at 1024 context. Every
number above is from 4096. The rebuild is blocked on a Windows fault, not the
project — Gradle cannot bind loopback (`SocketException: Invalid argument:
connect`); needs `netsh winsock reset` as admin and a reboot.

## Phases 1-6 (4 Sep)

**Two models, one resident.** *(Superseded by Phase 7 — the set is now three
small models and neither of these ships.)* Qwen3-1.7B (0.91 GB) was the
default; Gemma 4 E2B (2.59 GB) loaded on demand for speech and photographs. `switchModel()` closes the
current model before loading the next, so they never coexist — E2B alone peaks
at 2.5 GB on a 7.5 GB phone. A picker on the gate screen and a switcher in the
chat header change it mid-conversation.

**Speed.** The ledger answer took a measured 62 seconds on the M31s, and almost
none of that was the model: `execute()` always accepted an `onToken` callback
and we passed `undefined`, so the screen sat blank throughout, and every
question shipped 25 duties (~875 tokens of prefill). Tokens now stream, and
`rankDuties()` sends the 10 most relevant — overdue first, then keyword
overlap. `askLedger` is told the true total so a trimmed list is never
presented as complete.

**The cable is optional.** `discovery.ts` probes the saved address, the USB
tunnel, both Android hotspot subnets and plain wifi in parallel, and keeps the
first that answers `/health`. A request that fails for want of a connection
retries once through a fresh pass, so unplugging mid-demo fails over rather
than stranding the app.

**Handset telemetry.** The accelerometer and ambient light sensor feed the same
ingest path as `sensor_sim.py`. Each sensor is probed individually — a phone
without one says so rather than showing a convincing permanent zero. Vibration
maps to a real clause (CMR 2017 Reg. 106); noise and illumination have **no
clause in this corpus**, so they carry `clause_ref: null` and the backend
downgrades them to `info` with "monitoring only" appended.

**Voice and photographs** go straight into E2B from the chat. Nothing uploads.

**Dashboard.** New Evidence page shows every capture with its photograph, GPS
and lease verdict, the YOLO detections, and both hashes. `/reports/compliance`
renders a print-ready report. A Fine-tune page builds JSONL training data from
the ledger (41 examples today) and registers runs — it does **not** train, and
says so.

**Artwork** is generated by `tools/make_art.py`, not sourced. Provenance is
accountable.

## Verified on 4 Sep

Dashboard: every page renders, all requests 200. Risk recomputed (41
obligations, mine at 91.3 high). Boundary breach 410.6 ha via PostGIS.
`sensor_sim` streaming, 0 failures. Fine-tune dataset and job register working
end to end. Mobile and web both typecheck clean.

**Not yet verified on hardware** — everything mobile since the last APK. The
installed build predates the model registry, streaming, the sensors tab, voice
and camera input, and both new native modules.

## Next, in order

1. **Rebuild the release APK** — everything mobile above is unverified on
   hardware, and `expo-sensors` / `expo-audio` are native so Metro cannot test
   them. Variant `release`, `:app` Active ABI `arm64-v8a`.
2. **Verify on the phone**: keyboard, model switching mid-chat, streaming,
   whether the trimmed prompt actually cut the 62 seconds, sensors, voice,
   camera, and hotspot discovery with the cable out.
3. **OBS recording** of every demo moment, per the build plan's insurance.

## Read these before changing anything

- `docs/ANDROID_BUILD.md` - the six fixes that make the Android build work.
  `mobile/android/` is gitignored, so `expo prebuild --clean` wipes all of them.
- `docs/API_CONTRACT.md` - endpoint shapes, frozen unless all tracks agree.
- `docs/PROGRESS.md` - milestones and the decisions worth remembering.
