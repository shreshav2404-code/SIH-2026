"""MiniLM retrieval over the clause corpus, via pgvector.

Runs before every rulebook call. The point is grounding: the on-device model
only ever reasons over clause text we handed it, never from memory. An
ungrounded 4B model asked to recall statute invents regulation numbers, and a
reviewer who knows the Mines Act catches it in one question.
"""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from models import Statute
from services.chunking import chunk  # noqa: F401  — re-exported for callers

__all__ = ["chunk", "encode", "nearest", "corpus_is_embedded"]


@lru_cache(maxsize=1)
def _model():
    """Loaded lazily — the API must start without the ML stack installed."""
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(settings.embedding_model)


def encode(texts: list[str]) -> list[list[float]]:
    return [v.tolist() for v in _model().encode(texts, batch_size=32)]


def nearest(db: Session, vector: list[float], k: int = 3) -> list[tuple[Statute, float]]:
    """pgvector cosine distance. Similarity = 1 - distance."""
    distance = Statute.embedding.cosine_distance(vector).label("distance")
    rows = db.execute(
        select(Statute, distance)
        .where(Statute.embedding.is_not(None))
        .order_by(distance)
        .limit(k)
    ).all()
    return [(st, 1.0 - float(d)) for st, d in rows]


def corpus_is_embedded(db: Session) -> bool:
    return db.scalar(
        select(Statute.id).where(Statute.embedding.is_not(None)).limit(1)
    ) is not None
