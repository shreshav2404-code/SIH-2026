# ANUPALAN — Build Context for Claude Code
**Team NeuraForge · SIH 2026 (SIH26024) · Presidency University Bengaluru**
AI-based compliance monitoring system for Coal India.

> Drop this file in your app repo root. Claude Code loads it automatically every session.
> This is the PROTOTYPE spec (36-hour hackathon build), not the production design on the pitch deck.

---

## Two hard constraints (read first)

1. **The LLM runs ON-DEVICE ONLY — inside the app.** No Ollama, no server LLM, no cloud, no API. Three small models ship inside the app and run via LiteRT-LM on the phone and the Android Studio emulator. The backend does NO LLM work.
2. **Total cost = ₹0.** Everything is free and open source, nothing runs in the cloud. No API keys, no server rental, no subscriptions. The whole thing runs on the phone, the emulator, and the developer's own laptop.

---

## What we are building

A thin prototype that demonstrates the full compliance story end to end. Five/six demo moments, each mapping to a claim on the deck. If a feature doesn't serve one, don't build it.

**Do NOT build (production target, not the prototype):** Kubernetes/Helm, NIC MeghRaj, real Kafka, MinIO (use local filesystem), real satellite pipeline, training any model from scratch, multi-tenant isolation, Parichay SSO, full statutory corpus (50 clauses is plenty), CI/CD, dark mode, i18n beyond one demo string.

When a judge asks why not Kubernetes: "That is the deployment target. In 36 hours we built the system it deploys."

---

## Architecture

```
  PHONE (S24+) / EMULATOR (arm64)      BROWSER (dashboard :5173)
  React Native app                     React dashboard
  3 small models on-device (LiteRT-LM) ledger · map · alerts · risk
  MiniLM retrieval · SQLite queue
  camera · GPS · voice
        |                                        |
        |  HTTP (same wifi / free tunnel)        |  HTTP
        +--------------------+-------------------+
                             |
                    FastAPI :8000   (laptop — NO LLM, NO cloud)
                    /auth /obligations /evidence /sensors /risk /geo /returns
                    | rulebook.py   stores duties the app extracted
                    | risk.py       XGBoost -> score
                    | hazard.py     rolling window -> alert
                    | geo.py        PostGIS ST_Contains
                    | vision.py     YOLOv8n -> pass/flag
                             |
                    PostgreSQL :5432 (postgis + pgvector)   +   ./storage (photos)
                    sensor_sim.py pushes readings every 2s
```

**Where intelligence runs:** all LLM/language work happens in the app on-device (a 350M-class model + MiniLM). The backend is a free local data layer — ledger, hash chain, geo, risk score, storage, dashboard data. It never calls an LLM. Clause extraction runs in the app; the result is POSTed to the backend to store.

---

## Stack (all free / open source)

| Layer | Choice | Notes |
|---|---|---|
| Dashboard | React 18 + TS, Vite, Tailwind, TanStack Query, Recharts, **React-Leaflet** | Maps use **OpenStreetMap tiles, NOT Google Maps** (Google bills per load; OSM is free). |
| Mobile | React Native + **Expo**, native build (prebuild) | expo-camera, expo-location, expo-sqlite, expo-crypto, expo-file-system. |
| Backend | Python 3.11, FastAPI, Uvicorn, SQLAlchemy 2, Pydantic v2, Alembic | Runs locally on the laptop under Docker. No LLM. |
| Database | PostgreSQL 16 + **PostGIS** + **pgvector**, one container | Relational + spatial + vector in one SQL store. |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` (90 MB) | RAG retrieval, on-device. |
| **On-device LLM** | **Granite 4.0 350M · SmolLM2 360M · LFM2.5 230M** via **LiteRT-LM** (`react-native-litert-lm`) | Text only. One resident at a time. No server. |
| Risk | XGBoost (scikit-learn), synthetic history | Deterministic, auditable. Runs on backend. |
| Vision | YOLOv8n, pretrained | Kept for the hackathon (AGPL is fine for a demo). |
| Infra | Docker + docker-compose, Git, scrcpy, DBeaver, OBS | All free. |

**Everything runs on hardware you own: phone, emulator, your laptop. No paid service anywhere.**

---

## The AI models (what does what)

| Model | Job | Runs |
|---|---|---|
| **Granite 4.0 350M** (459 MB) | Default. ALL grounded language work — clause→duty extraction, text→observation, sensor-window interpretation, ledger Q&A, report drafting. | On-device (app) |
| **SmolLM2 360M** (356 MB) | Same jobs, better conversational tone | On-device (app) |
| **LFM2.5 230M int4** (169 MB) | `chatOnly` — plain chat and general info. **Never given the ledger.** | On-device (app) |
| **MiniLM L6-v2** | RAG retrieval over the clause corpus | On-device (app) |
| **XGBoost** | Risk SCORING — deterministic, auditable | Backend (laptop) |
| **YOLOv8n** | Object detection on evidence photos | Backend (laptop) |

**No speech, no image input.** Only the Gemma 4 family manages either in
LiteRT-LM, and it is not bundled — so the microphone and camera buttons hide
themselves rather than fail when tapped. The spoken-Hindi demo moment goes with
it; that is the price of a phone that does not lag.

**The line that matters (put it on a slide):** the model does language work; deterministic code does safety-critical work. Threshold breaches, PostGIS `ST_Contains` boundary checks, hash-chain verification, and statutory filing NEVER touch the model. "A statutory alert cannot depend on a probabilistic system, so we drew the line deliberately." Colour-code the architecture diagram: amber = model, blue = deterministic.

---

## Why three small models (measured, not chosen)

Gemma 4 E4B was the locked pick and it **works** on the M31s — GPU/4096, 45 s
to load, 3.3 GB resident, correct answers with real clause references. It also
takes **144 seconds** to answer a ledger question. E2B: 115 s to load, 74 s to
answer. Qwen2.5 1.5B: 90 s. A demo where the officer waits two minutes is not a
demo, so the whole "one big multimodal model" premise was dropped.

**The thing that actually cost the phone its memory was the context window, not
the weights.** At `maxContextTokens: 4096`, measured cold on the M31s:

| model | on disk | resident |
|---|---|---|
| Qwen2.5 1.5B | 1.49 GB | 4,079 MB |
| Falcon-H1 0.6B R | 833 MB | 4,459 MB |
| Granite 4.0 350M | 459 MB | 3,984 MB |

A 459 MB model and a 1.49 GB model land in the same place. `GL mtrack` was 9 MB
throughout — the Mali GPU was barely used whatever the UI claimed. The KV cache
is allocated up front and dwarfs the weights. This starved a 7.7 GB phone to
1.4 GB and made Android kill background processes by the dozen. **The ladder now
starts at gpu/1024.** Nothing here needs more — a ledger prompt is ten duties
against a 150-token answer cap.

**Read every chat template before adding a model.** Qwen3-1.7B loaded perfectly
and then answered a ledger question by saying the question was unclear. Its
template ended `{%- if not enable_thinking|default(true) %}` — reasoning on
unless something turns it off, and nothing in LiteRT-LM can. Marker-counting is
not enough either: LFM2.5 mentions `</think>` inside a clause that STRIPS
reasoning from past messages.

**Ground the model, always** — unchanged and more important at this size. The
clause is retrieved and passed IN; the model never recalls statute from memory.
A model that gets a clause reference wrong does not fail loudly, it invents a
plausible regulation number — Qwen wrote "Mines Rules 1555" once, one digit off
a real statute. That is why the 230M model is `chatOnly` and its every answer is
captioned *NOT grounded in the ledger*.

---

## On-device model — install & load

```bash
npm install react-native-litert-lm react-native-nitro-modules
# add its config plugin to app.json, then:
npx expo prebuild            # generates android/ and ios/
npx expo run:android         # builds onto USB-connected S24+ (or the running emulator)

# The models are BUNDLED in the APK (-PbundleModel=true) and extracted to app
# storage on first use. No adb push is needed, and /sdcard is unreachable from
# expo-file-system anyway (no external-files dir in its API; Android 11+ blocks
# shared storage without MANAGE_EXTERNAL_STORAGE).
```

Load via LOAD_LADDER: `gpu/1024 → cpu/1024 → gpu/512 → cpu/512`, keeping the first rung that loads. **Do not raise the context window** — see "Why three small models". **Single code path — no LLM_MODE, no server branch.**

**Switching models mid-session does not work.** LiteRT-LM leaves the engine unable to invoke after a `close()`; the app detects it and asks the officer to reopen the app, and the choice is remembered so the restart is cheap.

**Pin the version:** replace `^` in package.json with an exact pin.
**Known crash:** `litertlm-android` 0.15/0.16 aborts the process (SIGABRT) if you pass a `suppressTokens` option. Never use it.

---

## Running it (emulator + phone — both free)

Same `.litertlm` file both places; the runtime picks the backend:

| Where | Backend | Speed | Role |
|---|---|---|---|
| Emulator (**arm64-v8a** image) | CPU | ~2–4 tok/s | Dev + UI on the laptop screen. Works for language demos with no phone. |
| S24+ (physical) | GPU | ~22 tok/s | The real demo device. Airplane mode. |

- **Default Pixel emulator image is x86_64 → model will NOT load** (binding is arm64 only). You MUST create the AVD with an **arm64-v8a** system image: AVD Manager → Create Virtual Device → Pixel (7/9) → System Image → **Other Images** tab → filter ABI = **arm64-v8a** → Android 14/15.
- GPU backend is unavailable in the emulator → CPU path (~3.3 GB) regardless.
- **Real Pixels are worst for GPU** — Tensor chips don't expose OpenCL (open LiteRT-LM issue: "Backend.GPU() silently fails on Pixel 8 Pro"). The **S24+** (Exynos 2400 / Snapdragon 8 Gen 3) exposes OpenCL → 710 MB GPU path works.
- **Split:** arm64 emulator for dev, physical S24+ for any model-speed-visible demo. Just a different run target in Android Studio — zero code changes.

Performance (Google's numbers, S26 Ultra): GPU 710 MB / 22.1 tok/s decode / 0.8s TTFT. CPU 3283 MB / 17.7 tok/s. Speculative decoding → 36.7–49.4 tok/s GPU.

---

## Key implementation details

- **Regulation-as-Code (runs in the app):** circular text → MiniLM embed → retrieve nearest clauses → the model returns strict JSON `{title, owner_role, frequency, evidence_type, clause_ref}` → POST to backend to store.
- **Charts:** model returns `{chart_type, x, y, title, caption}`; app/dashboard draws it. NEVER ask the model to draw — ask it to specify.
- **Hash chain:** store `prev_hash` = previous evidence row's `chain_hash` per mine. Verification endpoint walks the chain, returns OK or first broken link. Demo by editing a row in DBeaver and re-running.
- **Boundary/excavation:** hard-code a polygon crossing the boundary, `ST_Difference` for area outside, render both on Leaflet.
- **Malformed JSON:** retry twice, then fall back to a keyword-rule extractor.
- **Ground the model, always:** retrieve the clause first, pass it in, require the citation. A 4B model recalling statute from memory invents regulation numbers.
- **Cap output at 150 tokens.** Warm the model behind a splash screen (first-load mapping takes seconds — never in front of a judge).

---

## Demo-day rules

1. Validate on the demo handset with Google AI Edge Gallery (airplane mode, zero code, 15 min) before trusting any model in the app.
2. Do the native build before travel — Gradle resolving a native dep on venue wifi loses evenings.
3. **On-device is your ONLY LLM path — there is no server fallback.** So: validate early, build native early, and record an **OBS video** of everything working the night before.
4. **Feature freeze at hour 30.** Not a suggestion.
5. Tools: `scrcpy` mirrors phone to projector over USB; the free tunnel (`cloudflared tunnel --url http://localhost:8000`, no signup) only carries phone↔laptop DATA sync, never the LLM.

**Target offline demo:** phone in airplane mode, officer TYPES "gas reading is high in panel three" → the on-device model (no network) maps it to the retrieved clause, drafts an observation with the citation, and drops it in the sync queue.

*The spoken-Hindi version is gone.* Only the Gemma 4 family does native audio in LiteRT-LM and it was too slow on this handset to keep. Demo the airplane-mode + hash-chain + boundary-breach moments instead; they are deterministic and cannot stall.

---

## Cost note (for the team)
Nothing here costs money. The model runs on the phone/emulator; Postgres, FastAPI and the dashboard run on your own laptop under Docker; maps use OpenStreetMap. The only future-only costs (NOT needed for the demo): Google Play Store listing (~₹2,000 one-time) and cloud hosting (optional, only if you ever want public URLs). For SIH: ₹0.

## Attribution for commits
```
Co-Authored-By: Claude <noreply@anthropic.com>
```
