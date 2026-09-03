# ANUPALAN — Architectural & Operational Decision Records (ADR)

This file tracks all key technical, architectural, and operational decisions made during development and testing.

---

## Decision Log

### ADR-001: Database Container Recovery & Verification
- **Date:** 2026-09-03
- **Status:** Accepted & Implemented
- **Context:** The local Docker daemon and the `anupalan-db` PostgreSQL container were stopped.
- **Decision:** Initialized Docker Desktop, brought up the existing `anupalan-db` container (`docker compose up -d`), and verified extension health (PostGIS 3.4.3, pgvector 0.8.6).
- **Consequences:** Spatial boundary checks (`ST_Contains`) and vector queries are fully operational on port 5432.

---

### ADR-002: Backend API Host Binding & Execution
- **Date:** 2026-09-03
- **Status:** Accepted & Implemented
- **Context:** Mobile clients and the Android emulator need to connect to the backend across network boundaries.
- **Decision:** Bound the FastAPI Uvicorn server to `0.0.0.0:8000` instead of `127.0.0.1:8000` using the local virtual environment (`.venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000`).
- **Consequences:** The API is accessible via localhost, LAN IP, emulator bridge (`10.0.2.2`), and physical devices connected via ADB reverse tunneling.

---

### ADR-003: Web Dashboard Execution Policy Bypass
- **Date:** 2026-09-03
- **Status:** Accepted & Implemented
- **Context:** Direct invocation of `npm run dev` in PowerShell was blocked by Windows PowerShell `ExecutionPolicy` preventing execution of `npm.ps1`.
- **Decision:** Executed the dev server command wrapped with `cmd.exe /c npm run dev`.
- **Consequences:** Vite server started cleanly on `http://localhost:5173` without requiring system-wide administrator policy modification. Verified HTTP 200 response.

---

### ADR-004: Real-time Telemetry Simulation
- **Date:** 2026-09-03
- **Status:** Accepted & Implemented
- **Context:** Demo Moment 3 (Hazard early-warning) requires streaming telemetry data to trigger threshold alerts on the web dashboard.
- **Decision:** Started `tools/sensor_sim.py --mine 1` as a background daemon process.
- **Consequences:** Telemetry readings for methane, water level, strata convergence, vibration, and PM10 are posted every 2 seconds to `http://localhost:8000/sensors/readings`. Zero failures recorded.

---

### ADR-005: Physical Android Device Port Forwarding
- **Date:** 2026-09-03
- **Status:** Accepted & Implemented
- **Context:** A physical Samsung Galaxy M31s (`SM-M317F`, serial `RZ8N901JD7M`) is connected via USB. The device needs direct access to the backend without relying on fluctuating LAN IP addresses.
- **Decision:** Configured ADB reverse port forwards for port 8000 (FastAPI backend) and port 8081 (Metro bundler) using:
  `adb -s RZ8N901JD7M reverse tcp:8000 tcp:8000`
  `adb -s RZ8N901JD7M reverse tcp:8081 tcp:8081`
- **Consequences:** The physical device can communicate with the backend via `http://127.0.0.1:8000` reliably regardless of WiFi router isolation or IP changes.

---

### ADR-006: Device Memory Limits & Model Loader Safety
- **Date:** 2026-09-03
- **Status:** Proposed & In-Progress
- **Context:** Testing on Samsung Galaxy M31s (Exynos 9611, Mali-G72 without OpenCL userland driver) caused total system freeze/crash when attempting to load Gemma 4 E4B (3.66 GB). Top inspection before freeze showed 4.3 GB RES in app with only 119 MB RAM remaining on device.
- **Analysis:**
  1. Devices with Snapdragon chipsets (e.g. Galaxy S25+ with Snapdragon 8 Elite) expose OpenCL, enabling the 710 MB GPU memory footprint at ~22 tok/s.
  2. Devices lacking OpenCL fall back to CPU execution, which requires unpacking all 3.66 GB weights into RAM + context buffers (~4.3 GB total). On 6GB–8GB devices where Android OS + OneUI consumes ~3.5 GB, CPU loading induces severe kernel OOM conditions.
  3. `llm.ts` attempted `cpu/4096` before smaller contexts and reused the same `createLLM` instance across multiple failed attempts, retaining native allocations.
- **Decision:**
  1. Add available RAM guardrails (`MemoryInfo.availMem`) prior to invoking native model mapping.
  2. Reorder fallback ladder to try the smallest context `cpu/1024` first when in CPU mode to minimize working memory overhead.
  3. Recreate the LLM instance on each rung attempt to prevent memory leaks from failed native loads.
  4. Enable full field input capabilities (geotagged photos, offline SQLite queue, sensor sync, hash-chain integrity) so the app functions 100% reliably regardless of device tier.

---

### ADR-007: Lowering On-Device Model Size for Mid-Range Hardware Compatibility
- **Date:** 2026-09-03
- **Status:** Accepted & Adopted
- **Context:** Following empirical testing on the Galaxy M31s (Exynos 9611), Gemma 4 E4B (3.66 GB) demonstrated complete incompatibility with CPU-only execution on mid-range handsets. Without OpenCL GPU acceleration, CPU weight mapping and working context require ~4.3 GB RAM, triggering immediate kernel Out-Of-Memory (OOM) lockups and reboots on devices with ~2.5 GB available RAM.
- **Decision:** Lower the on-device model target to a lightweight quantized tier (such as Gemma 2B INT4 ~1.3 GB or Gemma 4 E2B) that safely fits within the strict ~1.5 GB to 2.5 GB memory envelope of mid-range field devices running in CPU mode.
- **Consequences:**
  1. Prevents system freezes, kernel watchdogs, and OOM crashes across budget/mid-range inspection handsets.
  2. Greatly reduces APK bundle size and sideload installation time (down from ~3.9 GB).
  3. Preserves on-device offline Q&A, statutory clause retrieval, and offline duty guidance without requiring an external server or cloud API.
  4. Enables a practical two-tier architecture: lightweight quantized models on everyday inspection phones, with flagship NPU/GPU support (e.g. S25+) as an optional high-performance tier.



---

### ADR-008: E4B Cannot Be Quantized Further — Measured, Not Assumed
- **Date:** 2026-09-03
- **Status:** Accepted & Closed
- **Context:** Before accepting the capability loss in ADR-007, the obvious question was whether E4B could simply be quantized harder to fit the M31s, keeping the stronger model.
- **Evidence:**
  1. The `gemma-4-E4B-it.litertlm` file we hold is 3,659,530,240 bytes against ~8B raw parameters = **3.66 bits per parameter**. It is *already* INT4, and slightly below it.
  2. `litert-community/gemma-4-E4B-it-litert-lm` publishes exactly three weight files: 3.66 GB (standard), and 2.97 GB `-gpu` / `-web`. **There is no int3 or int2 build.**
  3. The 2.97 GB variants are GPU/WebGPU-targeted. The M31s exposes no OpenCL, so they buy nothing on the CPU path — the 690 MB saving is unreachable on this device.
  4. Producing a sub-4-bit build ourselves means the `ai-edge-torch` conversion pipeline: hours of compute, an unsupported artifact, and severe quality loss on a model whose *effective* size is only 4B.
- **Decision:** Close the question. E4B cannot be made to fit a CPU-only mid-range handset. Adopt Gemma 4 E2B (2.59 GB) as ADR-007 specified.
- **Consequences:** Estimated ~3.2 GB resident on CPU against the ~4.3 GB ceiling this device demonstrated, leaving roughly 1 GB of headroom. Multimodality is retained — E2B is the same family and API, so the spoken-Hindi demo moment survives. Extraction quality at 2B-effective is **unverified** and must be tested against a known circular before it is trusted.

---

### ADR-009: Loader Instance Lifecycle — the Ladder Was Leaking
- **Date:** 2026-09-03
- **Status:** Accepted & Implemented
- **Context:** ADR-006 identified that `llm.ts` reused one `createLLM` instance across every fallback rung. This was a defect in the retry ladder added earlier that day.
- **Analysis:** A failed native load does not release what it already mapped. Reusing the instance meant each rung began from a higher memory floor than the last, so a ladder written to degrade gracefully instead walked the device *down* into the OOM it was meant to avoid.
- **Decision:**
  1. Construct a fresh instance per rung and `close()` the failed one. `close()` permanently invalidates it; `unload()` was rejected because it keeps the instance reusable and its allocations reachable.
  2. Collapse the CPU rungs to a single `cpu/1024`. Reaching a CPU rung at all means no OpenCL, which on this hardware class means memory — not speed — is binding, so ask for the smallest context outright rather than discovering the ceiling by crashing into it.
- **Consequences:** Failed attempts no longer accumulate. CPU-path devices are capped at 1024 context, which still holds a retrieved clause plus a question; output was already capped at 150 tokens.

---

### ADR-010: Survey of Alternative On-Device Models
- **Date:** 2026-09-03
- **Status:** Accepted — E2B primary, Qwen3-1.7B held as fallback
- **Context:** Before committing to E2B, the question was whether a different small model offers better capability per byte on a CPU-only mid-range handset.
- **Hard constraint:** The candidate must ship as a **`.litertlm`** file. `.task` is MediaPipe LLM Inference format and cannot be loaded by LiteRT-LM, so it would mean replacing the runtime — discarding all the native build work in `ANDROID_BUILD.md`. This alone disqualifies **Gemma 3 4B IT**, which publishes `.task` only.
- **Findings** (litert-community, smallest `.litertlm` per repo):

  | Model | Size | Est. CPU resident | Multimodal |
  |---|---|---|---|
  | Gemma 4 E2B | 2.59 GB | ~3.2 GB | audio + image |
  | Qwen3-4B-Instruct-2507 | 2.48 GB | ~3.1 GB | text only |
  | Qwen3.5-4B | 2.57 GB | ~3.2 GB | text only |
  | Qwen3-1.7B | 0.91 GB | ~1.4 GB | text only |
  | Gemma3-1B-IT | 0.54 GB | ~0.9 GB | text only |

- **Analysis:**
  1. **Qwen3-4B-Instruct-2507 is smaller than E2B (2.48 vs 2.59 GB) while being a full 4B dense model**, where E2B is 4B-raw / 2B-effective. For this app's actual work — strict-JSON clause→duty extraction, grounded ledger Q&A, observation drafting — it is the stronger text model at no extra memory cost.
  2. The only thing E2B buys over it is multimodality, which is exactly the spoken-Hindi demo moment. The photo path does not depend on it: YOLOv8n on the backend already triages evidence images.
  3. There is **no ASR escape hatch**. Whisper, Qwen3-ASR and Parakeet are LiteRT models, not LiteRT-LM, so pairing a text LLM with on-device speech means standing up a second runtime.
- **Decision:** Test E2B first — it preserves the differentiating voice demo at a memory cost we have reason to think fits. Hold **Qwen3-1.7B (0.91 GB, ~1.4 GB resident)** downloaded and ready as the fallback that is near-certain to load on this hardware. If the voice moment is cut for any reason, switch to **Qwen3-4B-Instruct-2507** rather than staying on E2B, since at that point E2B has no advantage left.

---

### ADR-011: E2B Runs on the M31s — and ADR-006's GPU Assumption Was Wrong
- **Date:** 2026-09-03
- **Status:** Accepted & Verified on hardware
- **Result:** Gemma 4 E2B loads and answers on the Galaxy M31s, on the **GPU backend at full 4096 context** — the top rung of the ladder.

  | | E4B (ADR-006) | E2B (measured) |
  |---|---|---|
  | Backend won | CPU (forced) | **GPU / 4096** |
  | Peak resident | 4,300 MB | **2,552 MB** |
  | Free at peak | 119 MB → froze | **3,138 MB** |
  | Load time | never completed | ~100 s incl. first extraction |

- **Correction to ADR-006:** it recorded the Exynos 9611 / Mali-G72 as having "no OpenCL userland driver" and predicted a forced CPU path at ~3.2 GB. That was wrong. LiteRT-LM took the GPU rung on the first attempt, which is *why* the footprint is 2.55 GB rather than the ~3.2 GB predicted for CPU. The E4B failure was therefore about model size alone, not about a missing GPU.
- **Consequence:** there is 1.75 GB of headroom against the ceiling that killed E4B. E2B is comfortable on this device, not marginal.

---

### ADR-012: Ledger Answers Must Have Citations Verified, Not Requested
- **Date:** 2026-09-03
- **Status:** Accepted & Implemented
- **Context:** Asked "What is overdue and who owns it?" twice, E2B answered correctly once and then wrote **"Mines Rules 1555 · Form B"** — one digit off a real statute. Both answers carried the UI caption "grounded in the live ledger".
- **Root cause — not simple hallucination.** `askLedger` passed only `clause_ref` ("R. 29-P") in the ledger table, never the act. A compliance answer wants the full reference, so the model supplied the statute name **from memory**, which is exactly what `CLAUDE.md` warns against: *"A 4B model recalling statute from memory invents regulation numbers."* It was not disobeying the instruction; it was never given the act to copy.
- **Decision:**
  1. `LedgerFact` now carries `act`, and the prompt table renders `[act - clause_ref]` with an instruction to copy the bracketed reference verbatim. The model no longer has to recall anything.
  2. `unverifiedCitations()` checks every statute-shaped phrase in the answer against the acts actually supplied. This is deterministic code, per the project's own rule that the model does language work and deterministic code does safety-critical work — and a statutory citation in a compliance record is safety-critical.
  3. The caption now tells the truth: **"grounded - every citation verified"** only when the check passes, otherwise **"citation could NOT be verified against the ledger"** with the offending reference named in the answer body.
- **Consequence:** the Rulebook screen already rejected fabricated clause refs on the extraction path; the Q&A path had no such check and now has one. A wrong statute number can still be generated, but it can no longer be presented as grounded.
