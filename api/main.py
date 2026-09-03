"""ANUPALAN API.

No LLM runs here. All language work — clause extraction, voice to observation,
report drafting, ledger Q&A — happens on-device in the app via Gemma 4 E4B.
This service is the ledger, the hash chain, the geometry and the risk score.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from config import settings
from db import engine

TAGS = [
    {"name": "auth", "description": "JWT login. Three roles."},
    {"name": "obligations", "description": "The ledger — every clause a tracked duty."},
    {"name": "rulebook", "description": "Regulation-as-Code. Retrieval here, extraction on-device."},
    {"name": "evidence", "description": "Hash-chained capture. Evidence cannot be back-dated."},
    {"name": "sensors", "description": "Readings in, threshold breaches out. Arithmetic, not a model."},
    {"name": "alerts", "description": "Every alert names the clause it threatens."},
    {"name": "risk", "description": "XGBoost. Reproducible and inspectable — never an LLM."},
    {"name": "geo", "description": "PostGIS. Geometry is a fact, not an opinion."},
    {"name": "returns", "description": "System drafts, a certificated officer signs. The AI never files."},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="ANUPALAN API",
    description=(
        "AI-based compliance monitoring for Coal India. "
        "Team NeuraForge · SIH26024.\n\n"
        "**The model does language work; deterministic code does safety-critical "
        "work.** Threshold breaches, boundary checks, hash-chain verification and "
        "statutory filing never touch a model."
    ),
    version="0.1.0",
    openapi_tags=TAGS,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/storage", StaticFiles(directory=settings.storage_dir), name="storage"
)


@app.get("/health", tags=["health"])
def health() -> JSONResponse:
    db_ok, postgis, pgvector = "error", None, None
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            db_ok = "ok"
            row = conn.execute(
                text(
                    "SELECT extversion FROM pg_extension WHERE extname = 'postgis'"
                )
            ).first()
            postgis = row[0] if row else None
            row = conn.execute(
                text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            ).first()
            pgvector = row[0] if row else None
    except Exception as exc:  # noqa: BLE001 — health must never raise
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "db": db_ok, "detail": str(exc)},
        )

    return JSONResponse(
        {
            "status": "ok",
            "db": db_ok,
            "postgis": postgis,
            "pgvector": pgvector,
        }
    )


from routers import alerts as alerts_router  # noqa: E402
from routers import auth as auth_router  # noqa: E402
from routers import evidence as evidence_router  # noqa: E402
from routers import geo as geo_router  # noqa: E402
from routers import obligations as obligations_router  # noqa: E402
from routers import reports as reports_router  # noqa: E402
from routers import returns as returns_router  # noqa: E402
from routers import risk as risk_router  # noqa: E402
from routers import rulebook as rulebook_router  # noqa: E402
from routers import sensors as sensors_router  # noqa: E402

for r in (
    auth_router,
    obligations_router,
    rulebook_router,
    evidence_router,
    sensors_router,
    alerts_router,
    risk_router,
    geo_router,
    returns_router,
    reports_router,
):
    app.include_router(r.router)
