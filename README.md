# ANUPALAN

**AI-based compliance monitoring for Coal India**
Team NeuraForge · SIH 2026 · PS SIH26024 · Presidency University, Bengaluru

*अनुपालन* — the Hindi word for compliance.

---

## What this is

A prototype that closes the loop between what the law requires and what the sensors
already measure. Coal India knows both; nothing connects them, so compliance is proved
on paper, months late, by the party being assessed.

Five demo moments, each mapping to a claim on the deck:

| # | Moment | Proves |
|---|--------|--------|
| 1 | **Digital Rulebook** — paste a DGMS circular, duties appear citing their clause | Regulation-as-Code |
| 2 | **Offline capture** — photograph a duty in airplane mode, sync at surface | Works underground; evidence is hash-chained |
| 3 | **Hazard early-warning** — methane spike fires an alert linked to its clause | Reads existing instruments |
| 4 | **Geo-compliance** — excavation polygon crosses the lease, turns red | PostGIS boundary detection |
| 5 | **Auto-drafted return** — system drafts, officer signs, it locks | Human-in-the-loop; the AI never files |

---

## Architecture

```
PHONE (S25+) / EMULATOR          BROWSER (:5173)
React Native + Expo              React dashboard
Gemma 4 E4B on-device            ledger · map · alerts · risk
MiniLM · SQLite queue
camera · GPS · voice
      |                                |
      +--------------+-----------------+
                     |
            FastAPI :8000  (laptop — NO LLM, NO cloud)
            /auth /obligations /evidence /sensors /risk /geo /returns
                     |
            PostgreSQL :5432 (postgis + pgvector)  +  api/storage/
            tools/sensor_sim.py — readings every 2s
```

**The line that matters:** the model does language work; deterministic code does
safety-critical work. Threshold breaches, `ST_Contains` boundary checks, hash-chain
verification and statutory filing never touch the model.

| Model | Job | Runs |
|---|---|---|
| Gemma 4 E4B | all language, image, voice | **on-device** |
| MiniLM L6-v2 | clause retrieval | on-device |
| XGBoost | risk scoring — deterministic | backend |
| YOLOv8n | evidence photo detection | backend |

---

## Running it

**Prerequisites:** Docker Desktop, Node 20+, Python 3.11, Android Studio.
See `../chodu sih/SETUP.md` for the machine setup.

```bash
# 1. database
docker compose up -d

# 2. backend
cd api
python -m venv ../.venv
../.venv/Scripts/activate     # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 3. dashboard
cd web && npm install && npm run dev

# 4. sensor simulator (separate terminal)
python tools/sensor_sim.py
```

API docs at http://localhost:8000/docs · dashboard at http://localhost:5173

---

## Cost

**₹0.** Everything is free and open source, nothing runs in the cloud. The model runs
on-device; Postgres, FastAPI and the dashboard run on the developer's laptop under
Docker; maps use OpenStreetMap, not Google. No API key, no server rental, no
subscription anywhere in the stack.
