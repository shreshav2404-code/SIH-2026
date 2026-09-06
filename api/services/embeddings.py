"""MiniLM retrieval over the clause corpus, via pgvector.

Runs before every rulebook call. The point is grounding: the on-device model
only ever reasons over clause text we handed it, never from memory. An
ungrounded 4B model asked to recall statute invents regulation numbers, and a
reviewer who knows the Mines Act catches it in one question.
"""

from __future__ import annotations

import re
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from models import Statute


@lru_cache(maxsize=1)
def _model():
    """Loaded lazily — the API must start without the ML stack installed."""
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(settings.embedding_model)


def encode(texts: list[str]) -> list[list[float]]:
    return [v.tolist() for v in _model().encode(texts, batch_size=32)]


def chunk(text: str, max_chars: int = 480, min_chars: int = 25) -> list[str]:
    """Split a circular into one chunk per statutory sentence.

    ONE SENTENCE, ONE CHUNK — this used to greedily re-pack sentences up to
    max_chars, which meant a short circular came back as a single chunk and got
    a single averaged embedding. Measured: a three-sentence circular about
    methane in the general body of return air retrieved "CPCB - CAAQMS uptime"
    (ambient air stations) at 0.442 ahead of the correct CMR 2017 Reg. 46 at
    0.432, because averaging three sentences pulls the vector toward generic
    "air monitoring" language that both clauses share.

    A circular is written as discrete obligations, roughly one per sentence, so
    the sentence is the unit that actually corresponds to a duty. Embedding
    each one separately is both more accurate and a better match for what the
    caller does with the result - it drafts one duty per retrieved clause.

    min_chars is deliberately low (25). A circular's header line - "DGMS (Tech)
    Circular No. 05 of 2026." - is short but must NOT be merged into the
    substantive sentence that follows, because that reintroduces exactly the
    averaging this function exists to avoid. It becomes its own chunk, retrieves
    nothing useful, and loses on similarity to the chunk that matters. Only
    genuine fragments ("Provided that.") fall under the threshold.
    """
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []

    sentences = [s for s in re.split(r"(?<=[.;:])\s+", text) if s.strip()]
    chunks: list[str] = []
    buf = ""

    for s in sentences:
        buf = f"{buf} {s}".strip() if buf else s
        # Hold a fragment back until it is substantial enough to embed.
        if len(buf) >= min_chars:
            chunks.append(buf[:max_chars])
            buf = ""
    if buf:
        # Trailing fragment: attach to the previous chunk rather than embedding
        # it alone, unless it is all there is.
        if chunks:
            chunks[-1] = f"{chunks[-1]} {buf}"[:max_chars]
        else:
            chunks.append(buf[:max_chars])
    return chunks


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
