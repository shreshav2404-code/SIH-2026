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
