# ANUPALAN — API Contract

**Agreed in hour one. Frozen unless all four tracks agree to change it.**

Base URL: `http://localhost:8000`
Interactive docs: `http://localhost:8000/docs`
All bodies are JSON unless stated. All timestamps are ISO-8601 UTC (`2026-09-02T10:03:41Z`).

> **Why this document exists.** Backend, AI, dashboard and mobile build in parallel
> against these shapes and mock each other. Nobody waits. If you need a field that
> isn't here, add it to this file and tell the other tracks — do not invent it in code.

---

## Conventions

**Auth** — every endpoint except `/auth/login` and `/health` requires:
```
Authorization: Bearer <jwt>
```

**Roles** — three, seeded:

| Role | Sees |
|---|---|
| `mine_manager` | own mine: ledger, evidence, alerts, risk, returns |
| `safety_officer` | own mine: capture evidence, acknowledge alerts |
| `regulator` | all mines, read-only, plus chain verification |

**Errors** — consistent shape, always:
```json
{ "detail": "human readable reason", "code": "MACHINE_CODE" }
```

| Status | When |
|---|---|
| 400 | malformed request |
| 401 | missing or expired token |
| 403 | role not permitted |
| 404 | not found |
| 409 | conflict (e.g. signing an already-locked return) |
| 422 | validation failed (FastAPI default) |

**Pagination** — list endpoints accept `?limit=50&offset=0` and return:
```json
{ "items": [ ... ], "total": 128, "limit": 50, "offset": 0 }
```

**Enums** — single source of truth:

```
role            mine_manager | safety_officer | regulator
mine_type       underground | opencast | mixed
frequency       continuous | daily | weekly | 4x_weekly | fortnightly |
                monthly | quarterly | half_yearly | annual | event_driven | one_time
evidence_type   photo | reading | document | register | meeting_minutes |
                diary_entry | sample_result | return_filing | certificate | survey
status          pending | due | overdue | submitted | verified | waived
severity        info | warning | critical
sensor_type     methane | water_level | strata_convergence | vibration | pm10
source          sensor | rule | model | manual
```

---

## `/health`

### `GET /health`
No auth. For the demo, and for knowing the API is alive.
```json
{ "status": "ok", "db": "ok", "postgis": "3.4.3", "pgvector": "0.8.6" }
```

---

## `/auth` — owned by Backend core

### `POST /auth/login`
```json
{ "username": "manager.gevra", "password": "demo1234" }
```
→ `200`
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "expires_in": 43200,
  "user": {
    "id": 1,
    "username": "manager.gevra",
    "full_name": "P. Kujur",
    "role": "mine_manager",
    "mine_id": 1
  }
}
```
→ `401` on bad credentials.

### `GET /auth/me`
Returns the same `user` object. Used by the app to restore session.

---

## `/obligations` — the ledger. Owned by Backend core

### `GET /obligations`
Query params — all optional:

| Param | Example | Meaning |
|---|---|---|
| `mine_id` | `1` | defaults to the caller's mine; regulators may pass any |
| `status` | `overdue` | filter |
| `owner_role` | `Ventilation Officer` | filter |
| `due_before` | `2026-09-03` | date filter |
| `sort` | `risk` \| `due_date` | `risk` ranks by latest risk score, descending |

→ `200`
```json
{
  "items": [
    {
      "id": 41,
      "mine_id": 1,
      "title": "Support & strata observation, Panel 3B",
      "clause_ref": "CMR 2017 · Reg. 108",
      "act": "Coal Mines Regulations 2017",
      "owner_role": "Mine Manager",
      "frequency": "daily",
      "evidence_type": "photo",
      "due_date": "2026-09-02",
      "status": "due",
      "risk_score": 84,
      "evidence_count": 0,
      "last_evidence_at": null
    }
  ],
  "total": 52, "limit": 50, "offset": 0
}
```

> **Mobile note:** the duty list screen is exactly `GET /obligations?sort=risk`.
> The "RISK SCORE 84 — DO FIRST" badge is `risk_score` from this payload.

### `GET /obligations/{id}`
Same object plus:
```json
{
  "clause_text": "Support and strata conditions in the workings must be observed...",
  "evidence": [ { "id": 88, "captured_at": "...", "inside_lease": true } ],
  "risk": { "score": 84, "top_features": [ ... ] }
}
```

### `POST /obligations`
Created by the rulebook flow, or manually. Body:
```json
{
  "statute_id": 12,
  "mine_id": 1,
  "title": "Support & strata observation",
  "owner_role": "Mine Manager",
  "frequency": "daily",
  "evidence_type": "photo",
  "due_date": "2026-09-02"
}
```
→ `201` with the created object.

### `PATCH /obligations/{id}`
Only `status` and `due_date` are mutable.

---

## `/rulebook` — Regulation-as-Code. Owned by AI core

**The extraction itself runs on-device in the app.** The backend stores the result
and provides retrieval. There is no LLM on the server.

### `POST /rulebook/retrieve`
App sends circular text; backend embeds with MiniLM and returns the nearest existing
clauses for grounding. **The app passes these into the on-device prompt.**
```json
{ "text": "…pasted DGMS circular…", "k": 3 }
```
→ `200`
```json
{
  "chunks": [
    {
      "query_chunk": "…the manager shall inspect…",
      "matches": [
        {
          "statute_id": 12,
          "clause_ref": "CMR 2017 · Reg. 43",
          "act": "Coal Mines Regulations 2017",
          "text": "The manager must personally inspect the underground workings…",
          "similarity": 0.83
        }
      ]
    }
  ]
}
```

### `POST /rulebook/duties`
App posts what the on-device model extracted. **Rejected without `clause_ref`** —
that rule is the answer to the liability question, so it is enforced in code.
```json
{
  "mine_id": 1,
  "source_text": "…the circular that was pasted…",
  "duties": [
    {
      "title": "Quarterly fan efficiency determination",
      "owner_role": "Ventilation Officer",
      "frequency": "quarterly",
      "evidence_type": "reading",
      "clause_ref": "CMR 2017 · Reg. 46"
    }
  ]
}
```
→ `201`
```json
{ "created": [ { "id": 53, "title": "...", "clause_ref": "CMR 2017 · Reg. 46" } ], "rejected": [] }
```
→ `422` if any duty lacks `clause_ref`:
```json
{ "detail": "duty at index 0 has no clause_ref", "code": "CITATION_REQUIRED" }
```

---

## `/evidence` — hash-chained capture. Owned by Backend core

### `POST /evidence`
`multipart/form-data` — this is the only non-JSON endpoint.

| Field | Type | Notes |
|---|---|---|
| `photo` | file | JPEG/PNG |
| `obligation_id` | int | |
| `lat` | float | captured by device, not typed |
| `lon` | float | |
| `captured_at` | string | ISO-8601, device clock |
| `observation` | string | optional, free text or model-drafted |
| `client_id` | string | UUID from the app's SQLite queue, for idempotency |

→ `201`
```json
{
  "id": 88,
  "obligation_id": 41,
  "photo_path": "storage/1/88.jpg",
  "lat": 23.2591, "lon": 82.5847,
  "captured_at": "2026-09-02T10:03:41Z",
  "inside_lease": true,
  "vision_result": { "pass": true, "detections": [ { "label": "person", "conf": 0.91 } ] },
  "prev_hash": "a1b2…",
  "chain_hash": "a7f3…9c21"
}
```

**Idempotency.** Re-posting the same `client_id` returns `200` with the existing row,
not a duplicate. The offline queue retries; this is what makes that safe.

**Hash chain.**
```
chain_hash = sha256(prev_hash + photo_sha256 + lat + lon + captured_at + obligation_id)
```
`prev_hash` is the previous evidence row's `chain_hash` **for that mine**.

### `GET /evidence/verify?mine_id=1`
Walks the chain. **This endpoint is the demo** — edit a row in DBeaver, re-run it.
```json
{ "ok": false, "checked": 147, "first_broken": { "evidence_id": 63, "expected": "9f2a…", "found": "0000…" } }
```
Healthy: `{ "ok": true, "checked": 148, "first_broken": null }`

### `GET /evidence/{id}/photo`
Returns the image bytes.

---

## `/sensors` — Owned by AI core

### `POST /sensors/readings`
Posted by `tools/sensor_sim.py` every 2 seconds. Accepts a batch.
```json
{ "readings": [
  { "mine_id": 1, "sensor_type": "methane", "value": 1.42, "unit": "%", "recorded_at": "2026-09-02T10:03:41Z" }
] }
```
→ `202`
```json
{ "accepted": 4, "alerts_fired": [ { "id": 9, "severity": "critical", "clause_ref": "CMR 2017 · Reg. 46" } ] }
```

> **Detection is arithmetic, not a model.** Rolling mean + z-score against a static
> threshold table. A statutory safety alert cannot depend on a probabilistic system.

### `GET /sensors/readings`
`?mine_id=1&sensor_type=methane&since=2026-09-02T09:00:00Z&limit=200`
```json
{ "items": [ { "sensor_type": "methane", "value": 1.42, "unit": "%", "recorded_at": "..." } ] }
```

### `GET /sensors/window`
Feeds the on-device model for interpretation. Returns readings **plus the governing
clause**, so the app never asks the model to recall statute.
```json
{
  "mine_id": 1, "sensor_type": "methane", "window_minutes": 60,
  "readings": [ { "value": 1.42, "recorded_at": "..." } ],
  "stats": { "mean": 0.94, "max": 1.42, "z_max": 3.8, "threshold": 1.25, "breaching": true },
  "clause": { "clause_ref": "CMR 2017 · Reg. 46", "text": "The Ventilation Officer must…" }
}
```

---

## `/alerts` — Owned by AI core

### `GET /alerts`
`?mine_id=1&severity=critical&acknowledged=false`
```json
{ "items": [
  {
    "id": 9, "mine_id": 1, "obligation_id": 44,
    "severity": "critical",
    "message": "CH4 1.42% exceeds 1.25% trigger, rising since 03:00",
    "clause_ref": "CMR 2017 · Reg. 46",
    "source": "rule",
    "created_at": "2026-09-02T10:04:00Z",
    "acknowledged_by": null
  }
] }
```

> Every alert names the clause it threatens. That link is what makes it a
> **compliance** alert rather than a generic sensor dashboard.

### `POST /alerts/{id}/acknowledge`
→ `200` with `acknowledged_by` and `acknowledged_at` set.

---

## `/risk` — XGBoost, never an LLM. Owned by AI core

### `GET /risk/mine/{mine_id}`
```json
{
  "mine_id": 1, "score": 71, "band": "high",
  "computed_at": "2026-09-02T10:00:00Z",
  "obligations_at_risk": 6
}
```

### `GET /risk/obligation/{obligation_id}`
Score **plus its top three contributing features**, so it reads as reasoning rather
than a magic number.
```json
{
  "obligation_id": 41, "score": 84, "band": "high",
  "top_features": [
    { "feature": "days_overdue", "value": 2, "contribution": 0.34 },
    { "feature": "past_violations", "value": 3, "contribution": 0.21 },
    { "feature": "days_since_last_inspection", "value": 14, "contribution": 0.18 }
  ],
  "computed_at": "2026-09-02T10:00:00Z"
}
```

> The model **narrates** this score; it does not decide it. Trained on synthetic
> history — say that before a judge asks.

### `POST /risk/recompute`
`{ "mine_id": 1 }` → `202 { "recomputed": 52 }`

---

## `/geo` — PostGIS. No model. Owned by Backend core

### `GET /geo/mines`
GeoJSON `FeatureCollection` of lease polygons, straight into React-Leaflet.
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "mine_id": 1, "name": "Gevra OC", "subsidiary": "SECL", "type": "opencast" },
      "geometry": { "type": "Polygon", "coordinates": [ [ [82.58, 23.25], ... ] ] }
    }
  ]
}
```

### `POST /geo/contains`
One query: `ST_Contains(lease_geom, ST_SetSRID(ST_Point(:lon,:lat),4326))`.
The mobile app calls this on capture — it is how a photo gets `inside_lease`.
```json
{ "mine_id": 1, "lat": 23.2591, "lon": 82.5847 }
```
→ `200 { "inside_lease": true, "mine_id": 1, "distance_to_boundary_m": 412.6 }`

### `GET /geo/breach?mine_id=1`
The excavation demo. Returns the lease, the excavation polygon, and the difference.
```json
{
  "mine_id": 1,
  "lease": { "type": "Polygon", "coordinates": [ ... ] },
  "excavation": { "type": "Polygon", "coordinates": [ ... ] },
  "outside": { "type": "Polygon", "coordinates": [ ... ] },
  "area_outside_m2": 18432.7,
  "breach": true,
  "clause_ref": "MMDR 1957 · Lease boundary"
}
```

> **Geometry is a fact, not an opinion.** Reaching for a model here would be a
> mistake a judge would spot.

---

## `/returns` — human-in-the-loop. Owned by Backend core

### `POST /returns/draft`
```json
{ "mine_id": 1, "period": "2026-H1", "return_type": "EIA_HALF_YEARLY" }
```
→ `201`
```json
{
  "id": 3, "mine_id": 1, "period": "2026-H1",
  "locked": false, "signed_by": null,
  "draft_json": {
    "sections": [
      {
        "heading": "Ambient air quality",
        "body": "CAAQMS recorded 58 of 96 required stations operational…",
        "citations": [
          { "clause_ref": "CPCB · CAAQMS uptime", "evidence_ids": [88, 91], "figure": "58/96" }
        ]
      }
    ],
    "evidence_count": 148
  }
}
```

> **Every figure cites its clause and its source record.** A section with no
> citation is a bug, not a style choice.

### `GET /returns?mine_id=1`
List, with `locked` and `signed_by`.

### `POST /returns/{id}/sign`
```json
{ "signature_name": "P. Kujur", "certificate_no": "MGR/2019/4471" }
```
→ `200` with `locked: true`, `signed_at` set.
→ `409` if already locked — `{ "detail": "return already signed and locked", "code": "ALREADY_LOCKED" }`
→ `403` unless the caller is `mine_manager`.

**The AI never files.** There is no endpoint that submits a return to a regulator.
Drafting and signing are separate calls, and only a certificated officer signs.

---

## Sync — how the mobile queue behaves

1. Capture writes to local SQLite with a generated `client_id` (UUID) and `synced=0`.
2. On reconnect, the app POSTs each queued item **in capture order**.
3. `201` → mark `synced=1`. `200` → already on the server, mark `synced=1`.
4. `409` → conflict, surface it as **REVIEW** in the sync list (wireframe screen 3).
5. Chain order matters: post sequentially per mine, never in parallel.

---

## Ownership

| Track | Owns |
|---|---|
| **Backend core** (2) | `/auth` `/obligations` `/evidence` `/geo` `/returns`, the schema, all migrations |
| **AI core** (2) | `/rulebook` `/sensors` `/alerts` `/risk`, embeddings, risk model, hazard, vision |
| **Dashboard** (1) | consumes everything; owns no endpoint |
| **Mobile** (1) | consumes `/auth` `/obligations` `/evidence` `/geo/contains` `/rulebook`; owns the queue |

**Changing this file:** say so in the group chat before you edit. A silent change here
is how integration dies at hour 30.
