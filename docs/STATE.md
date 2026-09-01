# Where we left off — 2026-09-02, 01:20

Pick up here tomorrow.

---

## Demo device

**Galaxy S24+** — this is the target device. (A different S25+ appears in Windows
Explorer; ignore it. Build and demo against the S24+ as the plan specifies.)

---

## Done

**Machine (all verified working, on PATH)**

| Tool | Version |
|---|---|
| WSL2 | 2.7.12 — no distro installed, only the engine Docker needs |
| Docker Desktop | 4.88.1 / engine 29.7.2 |
| Node / npm | 24.19.0 / 11.17.0 |
| Python / pip | **3.11.9** / 24.0 (pinned — do NOT move to 3.13+) |
| Git | 2.55.0 |
| Android Studio | 2026.1 — SDK at `D:\Android\Sdk` |
| adb | 1.0.41 |
| scrcpy | 4.1 |
| DBeaver | 26.1.5 |
| Bruno | 4.1.0 |
| cloudflared | 2026.8.3 |
| OBS Studio | 32.2.1 |
| VS Code | 1.135.0 |

**Model** — `D:\anupalan\models\gemma-4-E4B-it.litertlm`
3,659,530,240 bytes, byte-exact. Source: `litert-community/gemma-4-E4B-it-litert-lm`, Apache 2.0.
Not yet pushed to the phone.

**Database** — built and verified, currently **stopped** (data preserved in volume `anupalan_pgdata`)
```
postgis  3.4.3   USE_GEOS=1 USE_PROJ=1 USE_STATS=1
vector   0.8.6   SELECT '[1,2,3]'::vector  ->  works
```

**Repo** — `D:\anupalan`, 2 commits
```
32e2793  Add statutory clause corpus (52 duties)
3307cd3  Scaffold ANUPALAN repo
```
Git identity is set **repo-local** (not global) so it vanishes at teardown.

**Clause corpus** — `api/seed/clauses.json`, 52 duties across 7 acts.
Every clause_ref traced to the domain-research brief; none invented.
Clause text is paraphrase, flagged in `_meta` — replace with gazette wording
before any production claim.

---

## Restart tomorrow

```bash
# 1. start Docker Desktop, then:
cd D:\anupalan
docker compose start

# 2. confirm the database is healthy
docker exec anupalan-db psql -U anupalan -d anupalan -c "SELECT postgis_version();"
```

---

## Next up — hours 2-6

1. **API contract** (`docs/API_CONTRACT.md`) — endpoint paths and JSON shapes for
   `/auth /obligations /evidence /sensors /risk /geo /returns`.
   The build plan calls this the single thing that decides whether integration at
   hour 30 takes twenty minutes or destroys the night. **Do this before any feature.**
2. SQLAlchemy models — 8 tables (mine, statute, obligation, evidence,
   sensor_reading, alert, risk_score, statutory_return)
3. Alembic migration
4. `seed.py` — embed the 52 clauses with MiniLM, 3 mines with lease polygons, 3 users
5. Auth returning a JWT

## Still outstanding

- Python venv + `pip install -r api/requirements.txt` (~4 GB, pulls PyTorch)
- `npm install` for `web/` and `mobile/`
- **Pre-cache MiniLM + YOLOv8n weights** — both fetch from the internet on first
  use; do this before travelling
- `adb push` the model to the S24+
- Expo Go on two team phones

---

## Teardown, when SIH is over

- `winget uninstall` the 13 packages
- delete `D:\anupalan`, `D:\Android`
- `wsl --unregister docker-desktop`
- delete `C:\Users\KESHAV JHA\.wslconfig` (caps Docker at 6 GB / 6 CPUs)
- remove env var `ANDROID_SDK_ROOT`
