"""SQLAlchemy tables — eight, that is all.

Geometry is PostGIS. Embeddings are pgvector. Both live in the same database,
so there is no second datastore to wire up.
"""

from datetime import date, datetime

from geoalchemy2 import Geometry
from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from config import settings
from db import Base

# --- enums, as plain strings. See docs/API_CONTRACT.md for the canonical list. ---
ROLES = ("mine_manager", "safety_officer", "regulator")
MINE_TYPES = ("underground", "opencast", "mixed")
STATUSES = ("pending", "due", "overdue", "submitted", "verified", "waived")
SEVERITIES = ("info", "warning", "critical")


class User(Base):
    __tablename__ = "app_user"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(128))
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(32))
    certificate_no: Mapped[str | None] = mapped_column(String(64), nullable=True)

    mine_id: Mapped[int | None] = mapped_column(
        ForeignKey("mine.id"), nullable=True
    )  # regulators have none — they see every mine
    mine: Mapped["Mine | None"] = relationship(back_populates="users")


class Mine(Base):
    __tablename__ = "mine"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    subsidiary: Mapped[str] = mapped_column(String(64))
    type: Mapped[str] = mapped_column(String(16))
    lease_geom: Mapped[object] = mapped_column(
        Geometry(geometry_type="POLYGON", srid=4326)
    )

    users: Mapped[list[User]] = relationship(back_populates="mine")
    obligations: Mapped[list["Obligation"]] = relationship(back_populates="mine")


class Statute(Base):
    """One statutory clause. `embedding` is what MiniLM retrieval searches."""

    __tablename__ = "statute"

    id: Mapped[int] = mapped_column(primary_key=True)
    act: Mapped[str] = mapped_column(String(128))
    clause_ref: Mapped[str] = mapped_column(String(128), index=True)
    title: Mapped[str] = mapped_column(String(256))
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(settings.embedding_dim), nullable=True
    )
    version: Mapped[str] = mapped_column(String(32), default="2026.1")
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    obligations: Mapped[list["Obligation"]] = relationship(back_populates="statute")


class Obligation(Base):
    """A tracked duty: one clause, one mine, one named owner, one deadline."""

    __tablename__ = "obligation"

    id: Mapped[int] = mapped_column(primary_key=True)
    statute_id: Mapped[int] = mapped_column(ForeignKey("statute.id"))
    mine_id: Mapped[int] = mapped_column(ForeignKey("mine.id"), index=True)

    title: Mapped[str] = mapped_column(String(256))
    owner_role: Mapped[str] = mapped_column(String(64))
    frequency: Mapped[str] = mapped_column(String(32))
    evidence_type: Mapped[str] = mapped_column(String(32))
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)

    statute: Mapped[Statute] = relationship(back_populates="obligations")
    mine: Mapped[Mine] = relationship(back_populates="obligations")
    evidence: Mapped[list["Evidence"]] = relationship(back_populates="obligation")


class Evidence(Base):
    """Hash-chained capture. Evidence cannot be back-dated.

        chain_hash = sha256(prev_hash + photo_sha256 + lat + lon
                            + captured_at + obligation_id)

    `prev_hash` is the previous evidence row's chain_hash FOR THAT MINE.
    """

    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(primary_key=True)
    obligation_id: Mapped[int] = mapped_column(ForeignKey("obligation.id"), index=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mine.id"), index=True)

    # idempotency key from the app's offline SQLite queue — retries are safe
    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    photo_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    photo_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    observation: Mapped[str | None] = mapped_column(Text, nullable=True)

    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    inside_lease: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    vision_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    chain_hash: Mapped[str] = mapped_column(String(64), index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    obligation: Mapped[Obligation] = relationship(back_populates="evidence")

    __table_args__ = (
        UniqueConstraint("mine_id", "client_id", name="uq_evidence_mine_client"),
    )


class SensorReading(Base):
    __tablename__ = "sensor_reading"

    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mine.id"), index=True)
    sensor_type: Mapped[str] = mapped_column(String(32), index=True)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(16))
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True
    )


class Alert(Base):
    """Fired by arithmetic — rolling mean + z-score against a threshold table.

    Never by a model. A statutory safety alert cannot depend on a probabilistic
    system. `obligation_id` is what makes this a compliance alert rather than a
    generic sensor dashboard.
    """

    __tablename__ = "alert"

    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mine.id"), index=True)
    obligation_id: Mapped[int | None] = mapped_column(
        ForeignKey("obligation.id"), nullable=True
    )

    severity: Mapped[str] = mapped_column(String(16), index=True)
    message: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), default="rule")

    # Stored, not derived. The threshold table knows which clause a breach
    # threatens even when this mine has no matching obligation — an opencast
    # mine has no ventilation duty, but a methane reading still cites Reg. 46.
    clause_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    acknowledged_by: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id"), nullable=True
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class RiskScore(Base):
    """XGBoost output. `features` carries the top contributors so the number
    reads as reasoning rather than magic. The model narrates it; it does not
    decide it."""

    __tablename__ = "risk_score"

    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mine.id"), index=True)
    obligation_id: Mapped[int | None] = mapped_column(
        ForeignKey("obligation.id"), nullable=True, index=True
    )

    score: Mapped[float] = mapped_column(Float)
    features: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StatutoryReturn(Base):
    """Drafted by the system, signed by a certificated officer. There is no
    code path that files this to a regulator."""

    __tablename__ = "statutory_return"

    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int] = mapped_column(ForeignKey("mine.id"), index=True)
    period: Mapped[str] = mapped_column(String(32))
    return_type: Mapped[str] = mapped_column(String(64))

    draft_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    signed_by: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id"), nullable=True
    )
    signature_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    certificate_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    locked: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("mine_id", "period", "return_type", name="uq_return_period"),
    )


class FineTuneJob(Base):
    """A fine-tuning run, tracked here but NOT executed here.

    Be clear about the division, because it is the honest part of this feature:
    the dashboard prepares the dataset, records the configuration, and shows
    the outcome. The training itself happens on a GPU elsewhere - free Colab
    is the intended route - because a laptop running Postgres and a dev server
    cannot fine-tune a 1.7B model, and pretending otherwise would be a demo
    that falls over the moment anyone asks to watch it run.

    `metrics` holds whatever the training run reported back: loss curve, steps,
    eval numbers. Free-form because the shape depends on the trainer used.
    """

    __tablename__ = "finetune_job"

    id: Mapped[int] = mapped_column(primary_key=True)
    mine_id: Mapped[int | None] = mapped_column(
        ForeignKey("mine.id"), nullable=True, index=True
    )

    name: Mapped[str] = mapped_column(String(128))
    base_model: Mapped[str] = mapped_column(String(64))
    dataset_kind: Mapped[str] = mapped_column(String(32))
    examples: Mapped[int] = mapped_column(Integer, default=0)

    # prepared -> running -> finished | failed. Advanced by whoever runs the
    # training, via PATCH, since nothing here can observe a Colab notebook.
    status: Mapped[str] = mapped_column(String(16), default="prepared", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
