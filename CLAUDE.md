# ANUPALAN — Build Context for Claude Code
**Team NeuraForge · SIH 2026 (SIH26024) · Presidency University Bengaluru**
AI-based compliance monitoring system for Coal India.

> Drop this file in your app repo root. Claude Code loads it automatically every session.
> This is the PROTOTYPE spec (36-hour hackathon build), not the production design on the pitch deck.

---

## Two hard constraints (read first)

1. **The LLM runs ON-DEVICE ONLY — inside the app.** No Ollama, no server LLM, no cloud, no API. Three small models ship inside the app and run on **llama.cpp** (`llama.rn`) on the phone and the Android Studio emulator. The backend does NO LLM work.
   *One deliberate exception, added later:* the Ask screen has a **CLOUD** chip. It is off unless the officer saves a provider profile of their own, it is never automatic, it is **never given the ledger** (`askCloud()` takes a question string and nothing else), and every answer it returns is labelled as having left the device. The claim above holds for every graded demo moment; the chip exists so a judge asking "what if you had a big model?" gets a demonstration rather than a description.
2. **Total cost = ₹0.** Everything is free and open source. No server rental, no subscriptions, and no key is needed for anything that is demonstrated. (The optional CLOUD chip uses a free-tier key the officer supplies; nothing depends on it.) The whole thing runs on the phone, the emulator, and the developer's own laptop.

---

## What we are building

A thin prototype that demonstrates the full compliance story end to end. Five/six demo moments, each mapping to a claim on the deck. If a feature doesn't serve one, don't build it.

**Do NOT build (production target, not the prototype):** Kubernetes/Helm, NIC MeghRaj, real Kafka, MinIO (use local filesystem), real satellite pipeline, training any model from scratch, multi-tenant isolation, Parichay SSO, full statutory corpus (50 clauses is plenty), CI/CD, dark mode, i18n beyond one demo string.

When a judge asks why not Kubernetes: "That is the deployment target. In 36 hours we built the system it deploys."

---

## Architecture

```
  PHONE (Galaxy M31s) / EMULATOR       BROWSER (dashboard :5173)
  React Native app                     React dashboard
  3 small models on-device (llama.cpp) ledger · map · alerts · risk
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
| **On-device LLM** | **Qwen3 1.7B · ANUPALAN 270M · LFM2.5-VL 450M** as Q4_0 GGUF via **llama.cpp** (`llama.rn` 0.12.9) | Text and images. One resident at a time. No server. |
| Risk | XGBoost (scikit-learn), synthetic history | Deterministic, auditable. Runs on backend. |
| Vision | YOLOv8n, pretrained | Kept for the hackathon (AGPL is fine for a demo). |
| Infra | Docker + docker-compose, Git, scrcpy, DBeaver, OBS | All free. |

**Everything runs on hardware you own: phone, emulator, your laptop. No paid service anywhere.**

---

## The AI models (what does what)

| Model | Job | Runs |
|---|---|---|
| **Qwen3 1.7B** Q4_0 (1.15 GB) | Default. ALL grounded language work — clause→duty extraction, text→observation, sensor-window interpretation, ledger Q&A, report drafting. The only model measured on this handset to answer a ledger question with every owner and due date correct. | On-device (app) |
| **ANUPALAN 270M** Q4_0 (238 MB) | The same jobs, fastest. Gemma 3 270M **fine-tuned on this project** — 1,078 examples of ledger rows, sensor windows, clause text and the app's own facts, in the prompt shapes `llm.ts` actually sends. Not `chatOnly`: tuning it for the duty table is the entire point. | On-device (app) |
| **LFM2.5-VL 450M** Q4_0 (209 MB + 98 MB encoder) | `chatOnly`, and the only one that **reads photographs**. A vision GGUF is two files; the `mmproj` encoder is what turns pixels into embeddings, and without it the model is blind. **Never given the ledger.** | On-device (app) |
| **MiniLM L6-v2** | RAG retrieval over the clause corpus | On-device (app) |
| **XGBoost** | Risk SCORING — deterministic, auditable | Backend (laptop) |
| **YOLOv8n** | Object detection on evidence photos | Backend (laptop) |

**Images yes, speech no.** LFM2.5-VL plus its `mmproj` encoder reads a
photograph on-device, and `visionReady` gates it — that flag means the second
file was found, extracted and accepted by the engine, which is not the same as
the model merely being capable. Ask a text-only model for a photo and it
refuses by name rather than inventing a description of an image it never saw.

Audio has no bundled model at all, so it stays a hard refusal and the
spoken-Hindi demo moment is gone. That is the price of a phone that does not
lag.

**The line that matters (put it on a slide):** the model does language work; deterministic code does safety-critical work. Threshold breaches, PostGIS `ST_Contains` boundary checks, hash-chain verification, and statutory filing NEVER touch the model. "A statutory alert cannot depend on a probabilistic system, so we drew the line deliberately." Colour-code the architecture diagram: amber = model, blue = deterministic.

---

## Why three small models, and why llama.cpp (measured, not chosen)

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
starts at gpu/3072** and falls to cpu/1024. Nothing here needs more — a ledger
prompt is ten duties against a 150-token answer cap.

The table above was measured under LiteRT-LM. It is kept because the finding
survived the engine change: the KV cache is allocated up front and dwarfs the
weights, so the context window, not the parameter count, is what costs a phone
its memory.

**LiteRT-LM was the engine, and it is not any more.** Every small model
measured on the M31s came back broken on its Mali GPU path: Granite 4.0 350M
answered a ledger question with `_opt_opt_opt_opt...`, LFM2.5 230M with
`ERERERERER...`. Two unrelated model families degenerating into repeated tokens
is a backend fault, not a model fault — Mali-G72 is a 2019 mid-range part with
a shaky OpenCL story, and the same runtime charged 2.6 GB of GPU memory for a
459 MB model. llama.cpp runs this on the CPU instead, which is the part of this
phone that works. Slower per token in theory, correct in practice, and correct
is the only one of those a compliance tool can trade on.

**Read every chat template before adding a model.** Qwen3-1.7B loaded perfectly
under LiteRT and then answered a ledger question by saying the question was
unclear. Its template ended `{%- if not enable_thinking|default(true) %}` —
reasoning on unless something explicitly turns it off, and *undefined is not
the same as false*. llama.cpp can set it, which is why Qwen3 went from unusable
to the default model. Marker-counting is not enough either: LFM2.5 mentions
`</think>` inside a clause that STRIPS reasoning from past messages.

**Ground the model, always** — unchanged and more important at this size. The
clause is retrieved and passed IN; the model never recalls statute from memory.
A model that gets a clause reference wrong does not fail loudly, it invents a
plausible regulation number — Qwen wrote "Mines Rules 1555" once, one digit off
a real statute. That is why the 230M model is `chatOnly` and its every answer is
captioned *NOT grounded in the ledger*.

---

## On-device model — install & load

```bash
npm install llama.rn         # pinned to 0.12.9, no caret
npx expo prebuild            # generates android/ and ios/
npx expo run:android         # builds onto the USB-connected phone (or the emulator)

# The models are BUNDLED in the APK (-PbundleModel=true) and extracted to app
# storage on first use. No adb push is needed, and /sdcard is unreachable from
# expo-file-system anyway (no external-files dir in its API; Android 11+ blocks
# shared storage without MANAGE_EXTERNAL_STORAGE).
```

**Gradle will not run from an agent shell on this machine** — the daemon's
loopback self-connect fails (`Selector.open()` / `SocketException: Invalid
argument: connect`). Building from Android Studio works. For a code-only
change there is a faster path that skips Gradle entirely: `expo export:embed`
→ `hermesc` → swap `assets/index.android.bundle` into the already-signed APK
→ `zipalign -p -f 4` → `apksigner` → `adb install -r -d`. About three minutes.
See `docs/SHIP_APK.md`. It is why the app's images ship as base64 data URIs in
`src/lib/photos.ts` rather than as native assets — native assets need a real
build.

Load via LOAD_LADDER: `gpu/3072 → cpu/3072 → cpu/2048 → cpu/1024`, keeping the first rung that loads. On the M31s the GPU rung always loses (Exynos 9611 exposes no OpenCL) and CPU is the real path. **Do not raise the context window** — see the section above. **Single code path — no LLM_MODE, no server branch.**

**Switching models mid-session works now,** via `switchModel()`. Under LiteRT-LM it did not: the engine could not invoke after a `close()`, so the app had to ask the officer to reopen it. `isEngineCorrupted()` and `switchedThisSession` are still there to notice that failure if it ever returns.

**Pin the version:** replace `^` in package.json with an exact pin. `llama.rn` is pinned at 0.12.9.

---

## Running it (emulator + phone — both free)

Same `.gguf` file both places; the ladder picks the backend:

| Where | Backend | Role |
|---|---|---|
| Emulator (**arm64-v8a** image) | CPU | Dev + UI on the laptop screen. Works for language demos with no phone. |
| Galaxy M31s (physical) | CPU | The real demo device. Airplane mode. Its Exynos 9611 exposes no OpenCL, so the GPU rung never wins — and llama.cpp on CPU is what made the models correct here in the first place. |

- **Default Pixel emulator image is x86_64 → model will NOT load** (binding is arm64 only). You MUST create the AVD with an **arm64-v8a** system image: AVD Manager → Create Virtual Device → Pixel (7/9) → System Image → **Other Images** tab → filter ABI = **arm64-v8a** → Android 14/15.
- **Split:** arm64 emulator for dev, the physical phone for any model-speed-visible demo. Just a different run target in Android Studio — zero code changes.

The plan was written for an S24+/S25+ and the GPU throughput figures that come
with one. The phone this was actually built and measured on is a **Galaxy
M31s**, and every number in this file comes from it. Treat any S2x figure
elsewhere in the docs as the plan's assumption, not a measurement.

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
3. **On-device is the LLM path that gets graded.** The CLOUD chip is a deliberate side-demo, off unless a key is saved, and never given the ledger — do not let it become the answer to a question about the product. So: validate early, build native early, and record an **OBS video** of everything working the night before.
4. **Feature freeze at hour 30.** Not a suggestion.
5. Tools: `scrcpy` mirrors phone to projector over USB; the free tunnel (`cloudflared tunnel --url http://localhost:5173`, no signup) carries DATA only, never the LLM. A quick tunnel's hostname dies with the process — restart it and the old URL stops resolving, so re-share the new one.
6. **One command starts everything:** `start-demo.bat`. Docker Desktop, the database container and the hotspot are started BY HAND first, on purpose — see the comments at the top of `start-demo.ps1`.

**Target offline demo:** phone in airplane mode, officer TYPES "gas reading is high in panel three" → the on-device model (no network) maps it to the retrieved clause, drafts an observation with the citation, and drops it in the sync queue.

*The spoken-Hindi version is gone.* No bundled model does audio, so the app refuses rather than pretending. Photographs DO work — LFM2.5-VL reads them on-device. Demo the airplane-mode + hash-chain + boundary-breach moments instead; they are deterministic and cannot stall.

---

## Cost note (for the team)
Nothing here costs money. The model runs on the phone/emulator; Postgres, FastAPI and the dashboard run on your own laptop under Docker; maps use OpenStreetMap. The optional CLOUD chip uses a free-tier key the officer supplies, and nothing depends on it. The only future-only costs (NOT needed for the demo): Google Play Store listing (~₹2,000 one-time) and cloud hosting (optional, only if you ever want public URLs). For SIH: ₹0.

## Attribution for commits
Commits carry no co-author trailer. The work is the team's and the history
should read that way.
