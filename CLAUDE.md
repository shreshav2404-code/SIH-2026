# ANUPALAN — Build Context for Claude Code
**Team NeuraForge · SIH 2026 (SIH26024) · Presidency University Bengaluru**
AI-based compliance monitoring system for Coal India.

> Drop this file in your app repo root. Claude Code loads it automatically every session.
> This is the PROTOTYPE spec (36-hour hackathon build), not the production design on the pitch deck.

---

## Two hard constraints (read first)

1. **The LLM runs ON-DEVICE ONLY — inside the app.** No Ollama, no server LLM, no cloud, no API. Gemma 4 E4B ships inside the app and runs via LiteRT-LM on the phone and the Android Studio emulator. The backend does NO LLM work.
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
  Gemma 4 E4B on-device (LiteRT-LM)    ledger · map · alerts · risk
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

**Where intelligence runs:** all LLM/language/vision/voice work happens in the app on-device (E4B + MiniLM). The backend is a free local data layer — ledger, hash chain, geo, risk score, storage, dashboard data. It never calls an LLM. Clause extraction runs in the app; the result is POSTed to the backend to store.

---

## Stack (all free / open source)

| Layer | Choice | Notes |
|---|---|---|
| Dashboard | React 18 + TS, Vite, Tailwind, TanStack Query, Recharts, **React-Leaflet** | Maps use **OpenStreetMap tiles, NOT Google Maps** (Google bills per load; OSM is free). |
| Mobile | React Native + **Expo**, native build (prebuild) | expo-camera, expo-location, expo-sqlite, expo-crypto, expo-file-system. |
| Backend | Python 3.11, FastAPI, Uvicorn, SQLAlchemy 2, Pydantic v2, Alembic | Runs locally on the laptop under Docker. No LLM. |
| Database | PostgreSQL 16 + **PostGIS** + **pgvector**, one container | Relational + spatial + vector in one SQL store. |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` (90 MB) | RAG retrieval, on-device. |
| **On-device LLM** | **Gemma 4 E4B** via **LiteRT-LM** (`react-native-litert-lm`) | The one model. Language + vision + voice. No server. |
| Risk | XGBoost (scikit-learn), synthetic history | Deterministic, auditable. Runs on backend. |
| Vision | YOLOv8n, pretrained | Kept for the hackathon (AGPL is fine for a demo). |
| Infra | Docker + docker-compose, Git, scrcpy, DBeaver, OBS | All free. |

**Everything runs on hardware you own: phone, emulator, your laptop. No paid service anywhere.**

---

## The four AI models (what does what)

| Model | Job | Runs |
|---|---|---|
| **Gemma 4 E4B** | ALL language work — clause→duty extraction, voice/text→observation, sensor-window interpretation, ledger Q&A, report drafting, risk narration. Multimodal, so also image description + native audio (no Whisper needed). | On-device (app) |
| **MiniLM L6-v2** | RAG retrieval over the clause corpus | On-device (app) |
| **XGBoost** | Risk SCORING — deterministic, auditable | Backend (laptop) |
| **YOLOv8n** | Object detection on evidence photos | Backend (laptop) |

**The line that matters (put it on a slide):** the model does language work; deterministic code does safety-critical work. Threshold breaches, PostGIS `ST_Contains` boundary checks, hash-chain verification, and statutory filing NEVER touch the model. "A statutory alert cannot depend on a probabilistic system, so we drew the line deliberately." Colour-code the architecture diagram: amber = model, blue = deterministic.

---

## Why Gemma 4 E4B (locked)

8B total / 4.5B effective params. MMLU Pro 69.4% — beats Gemma 3 27B (67.6%). Text+image+audio, 128K context, 140+ languages (Hindi covered), native function calling, free for commercial use.

- **Multimodal = one model does everything:** language, image analysis, and native audio (spoken Hindi goes straight in — no separate speech-to-text model, one fewer dependency).
- **Not 12B:** better on paper (77.2%) but not a phone model — Google ships E4B with Android/iOS benchmarks + Play Store links; 12B is desktop/web only at 7.7–8.0 GB, ~3× slower per token. Don't spend time on it.
- **Sub-8GB fallback:** Gemma 4 E2B (2.59 GB, same family, same API). Read `ActivityManager.MemoryInfo` at first launch, fetch E2B instead. Safety net only.

---

## On-device model — install & load

```bash
npm install react-native-litert-lm react-native-nitro-modules
# add its config plugin to app.json, then:
npx expo prebuild            # generates android/ and ios/
npx expo run:android         # builds onto USB-connected S24+ (or the running emulator)

# push the model once over the cable — NEVER over venue wifi:
adb push gemma-4-E4B-it.litertlm /sdcard/Download/
```

Load: `loadModel(path, { backend: "gpu" })`, stream via `sendMessageAsync`. Request GPU, fall back to CPU automatically. **Single code path — no LLM_MODE, no server branch.**

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

- **Regulation-as-Code (runs in the app):** circular text → MiniLM embed → retrieve nearest clauses → E4B returns strict JSON `{title, owner_role, frequency, evidence_type, clause_ref}` → POST to backend to store.
- **Charts:** model returns `{chart_type, x, y, title, caption}`; app/dashboard draws it. NEVER ask the model to draw — ask it to specify.
- **Hash chain:** store `prev_hash` = previous evidence row's `chain_hash` per mine. Verification endpoint walks the chain, returns OK or first broken link. Demo by editing a row in DBeaver and re-running.
- **Boundary/excavation:** hard-code a polygon crossing the boundary, `ST_Difference` for area outside, render both on Leaflet.
- **Malformed JSON:** retry twice, then fall back to a keyword-rule extractor.
- **Ground the model, always:** retrieve the clause first, pass it in, require the citation. A 4B model recalling statute from memory invents regulation numbers.
- **Cap output at 150 tokens.** Warm the model behind a splash screen (first-load mapping takes seconds — never in front of a judge).

---

## Demo-day rules

1. Validate on the S24+ tonight with Google AI Edge Gallery (download E4B, airplane mode, use it — zero code, 15 min).
2. Do the native build before travel — Gradle resolving a native dep on venue wifi loses evenings.
3. **On-device is your ONLY LLM path — there is no server fallback.** So: validate early, build native early, and record an **OBS video** of everything working the night before.
4. **Feature freeze at hour 30.** Not a suggestion.
5. Tools: `scrcpy` mirrors phone to projector over USB; the free tunnel (`cloudflared tunnel --url http://localhost:8000`, no signup) only carries phone↔laptop DATA sync, never the LLM.

**Target offline demo:** phone in airplane mode, officer says in Hindi "gas reading is high in panel three" → E4B (on-device, no network) transcribes, maps to Regulation 46, drafts observation with clause cited, drops in sync queue. 30 seconds, no other team will have it.

---

## Cost note (for the team)
Nothing here costs money. The model runs on the phone/emulator; Postgres, FastAPI and the dashboard run on your own laptop under Docker; maps use OpenStreetMap. The only future-only costs (NOT needed for the demo): Google Play Store listing (~₹2,000 one-time) and cloud hosting (optional, only if you ever want public URLs). For SIH: ₹0.

## Attribution for commits
```
Co-Authored-By: Claude <noreply@anthropic.com>
```
