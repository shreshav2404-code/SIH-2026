"""Bring an existing database up to the current models, without losing data.

There is no Alembic here, and for a prototype there does not need to be. New
TABLES already appear on their own: seed.py and create_all() make any that are
missing. New COLUMNS on a table that already exists do not - create_all()
skips a table it finds, so the model and the database silently disagree and
the first INSERT that names a new column fails.

The alternative was reseeding, which drops the evidence table and with it the
hash chain. That is the one table in this system whose history is the point.

Every statement is idempotent (ADD COLUMN IF NOT EXISTS), so this runs on
every API start and does nothing once applied. Only ever ADD here. Renaming or
dropping a column needs a real migration and a person deciding to do it.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine

STATEMENTS = [
    # Precise location and photo explanation - see the annotations block on
    # models.Evidence for why none of these are hashed.
    "ALTER TABLE evidence ADD COLUMN IF NOT EXISTS gps_accuracy_m DOUBLE PRECISION",
    "ALTER TABLE evidence ADD COLUMN IF NOT EXISTS place JSON",
    "ALTER TABLE evidence ADD COLUMN IF NOT EXISTS ai_description TEXT",
    "ALTER TABLE evidence ADD COLUMN IF NOT EXISTS ai_problems JSON",
    "ALTER TABLE evidence ADD COLUMN IF NOT EXISTS ai_model VARCHAR(64)",
]


def upgrade(engine: Engine) -> None:
    """Apply every statement. A missing table is left for seed.py to create."""
    with engine.begin() as conn:
        exists = conn.execute(
            text("SELECT to_regclass('public.evidence') IS NOT NULL")
        ).scalar()
        if not exists:
            return
        for sql in STATEMENTS:
            conn.execute(text(sql))
