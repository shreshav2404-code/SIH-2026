# ANUPALAN — Build Progress

Updated 2026-09-02. Tracks the five demo moments and the 36-hour milestones.

---

## The five demo moments

| # | Moment | Backend | Dashboard | Mobile | On-device |
|---|--------|---------|-----------|--------|-----------|
| 1 | **Digital Rulebook** | 🟡 endpoints live, needs MiniLM | ⬜ | ⬜ | ⬜ |
| 2 | **Offline capture** | ✅ **proven** | ⬜ | ⬜ | n/a |
| 3 | **Hazard early-warning** | ✅ **proven** | ⬜ | ⬜ | ⬜ |
| 4 | **Geo-compliance** | ✅ **proven** | ⬜ | ⬜ | n/a |
| 5 | **Auto-drafted return** | ✅ **proven** | ⬜ | ⬜ | ⬜ |

✅ verified working · 🟡 built, blocked · ⬜ not started

---

## Verified, not assumed

Each of these was run against the live API, not just written:

- **Hash chain breaks on tamper.** `UPDATE evidence SET lat=99.9999 WHERE id=2`
  → verify went `ok:true checked:4` → `ok:false`, naming evidence_id 2 with
  expected vs found hashes. This is the DBeaver demo.
- **Idempotent capture.** Re-posting the same `client_id` returns 200 with the
  existing row, not a duplicate. Makes the offline queue safe to retry.
- **PostGIS containment.** lon 82.57 → `inside_lease: true`, 2,768 m from
  boundary. lon 82.65 → `false`, 5,151 m out.
- **Boundary breach.** `ST_Difference` computes 4,106,328 m² (410 ha) outside
  the lease, with all three polygons returned for Leaflet.
- **Methane spike fires an alert** citing `CMR 2017 · Reg. 46`, z=4.3 sigma
  above the hour mean, threshold 1.25%.
- **Return signing locks.** Second signature → `409 already signed and locked`.
- **Role separation.** safety_officer signing → `403`. Regulator sees all 3 mines.
- **Grounding.** `/sensors/window` returns readings *plus* the governing clause
  text, so the on-device model never recalls statute from memory.

---

## Milestones (build plan §11)

| Hours | Milestone | State |
|---|---|---|
| 0–2 | Repo, compose up, DB with both extensions, API contract written | ✅ |
| 2–6 | Schema migrated, seed loaded, auth returns a token | ✅ |
| 6–12 | Ledger endpoints live and rendering in the dashboard | 🟡 API done, dashboard not started |
| 12–18 | Evidence capture end to end, sensor sim streaming | 🟡 API done, mobile not started |
| 18–24 | Rulebook returns cited JSON, risk scoring, alerts firing | 🟡 alerts done; rulebook+risk blocked on ML |
| 24–30 | Map, vision, return drafting and sign-off | 🟡 API done, map not started |
| 30–34 | **FEATURE FREEZE.** Polish, demo dataset, OBS recording | ⬜ |
| 34–36 | Three dry runs against the clock | ⬜ |

---

## Blocked

**ML stack still installing.** PyPI is slow on this connection (~150 KB/s with
stalls; HuggingFace ran at 6.5 MB/s, so it is PyPI specifically). Split
requirements so nothing else waits:

- `requirements-core.txt` — ✅ installed, API runs
- `requirements-ml.txt` — 🔄 installing (xgboost 101 MB, then PyTorch)

Until it lands: `python api/seed/seed.py --reset --skip-embed --skip-model`

Blocks: `/rulebook/retrieve` (503), `/risk/*` (503), YOLOv8n vision screening.

---

## Next

1. **React dashboard** — ledger table, KPI row, alerts panel, risk bars,
   Leaflet map, return sign-off. Nothing visual exists yet.
2. **Expo mobile app** — duty list, camera capture, SQLite queue, sync.
3. Once ML lands: re-seed with embeddings, train risk model, verify rulebook
   extraction returns cited JSON.
4. On-device Gemma wiring (build plan says hours 24–30, after the plumbing holds).

---

## Decisions worth remembering

- **Dropped passlib for bcrypt directly.** passlib unmaintained since 2020, its
  backend probe crashes against bcrypt 5.x.
- **Alert stores `clause_ref` rather than deriving it.** An opencast mine has no
  ventilation obligation, but a methane reading still cites Reg. 46. Deriving
  it through a join lost the citation exactly where it mattered.
- **Evidence returns 200 (not 201) on idempotent replay**, so the mobile queue
  can tell the difference.
- **No endpoint files a return.** Draft and sign are separate; only
  `mine_manager` signs. The AI never files, so it never carries liability.
