"""Pydantic in/out. Shapes match docs/API_CONTRACT.md — change both together."""

from datetime import date, datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------- auth


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    role: str
    mine_id: int | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


# ---------------------------------------------------------- obligations


class ObligationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    mine_id: int
    title: str
    clause_ref: str
    act: str
    owner_role: str
    frequency: str
    evidence_type: str
    due_date: date | None = None
    status: str
    risk_score: float | None = None
    evidence_count: int = 0
    last_evidence_at: datetime | None = None


class ObligationDetail(ObligationOut):
    clause_text: str
    evidence: list["EvidenceOut"] = Field(default_factory=list)
    risk: dict[str, Any] | None = None


class ObligationCreate(BaseModel):
    statute_id: int
    mine_id: int
    title: str
    owner_role: str
    frequency: str
    evidence_type: str
    due_date: date | None = None


class ObligationPatch(BaseModel):
    """Every field a supervisor may change from the dashboard.

    Widened from status/due_date alone so a duty can actually be REASSIGNED -
    owner_role is the field that makes "assign this to the Ventilation Officer"
    possible, and it was the one missing. statute_id and mine_id are
    deliberately absent: re-pointing a duty at a different clause or a
    different mine is not an edit, it is a different duty.
    """

    title: str | None = None
    owner_role: str | None = None
    frequency: str | None = None
    evidence_type: str | None = None
    status: str | None = None
    due_date: date | None = None


# ------------------------------------------------------------- rulebook


class RetrieveIn(BaseModel):
    text: str
    k: int = 3


class ClauseMatch(BaseModel):
    statute_id: int
    clause_ref: str
    act: str
    text: str
    similarity: float


class RetrieveChunk(BaseModel):
    query_chunk: str
    matches: list[ClauseMatch]


class RetrieveOut(BaseModel):
    chunks: list[RetrieveChunk]


class ExtractedDuty(BaseModel):
    title: str
    owner_role: str
    frequency: str
    evidence_type: str
    # No default. A duty with no citation is rejected — that rule is the answer
    # to the liability question, so it lives in the type, not in a comment.
    clause_ref: str


class DutiesIn(BaseModel):
    mine_id: int
    source_text: str | None = None
    duties: list[ExtractedDuty]


class DutiesOut(BaseModel):
    created: list[ObligationOut]
    rejected: list[dict[str, Any]] = Field(default_factory=list)


# ------------------------------------------------------------- evidence


class EvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    obligation_id: int
    photo_path: str | None = None
    lat: float
    lon: float
    captured_at: datetime
    inside_lease: bool | None = None
    vision_result: dict[str, Any] | None = None
    prev_hash: str | None = None
    chain_hash: str


class ChainBreak(BaseModel):
    evidence_id: int
    expected: str
    found: str


class VerifyOut(BaseModel):
    ok: bool
    checked: int
    first_broken: ChainBreak | None = None


# -------------------------------------------------------------- sensors


class ReadingIn(BaseModel):
    mine_id: int
    sensor_type: str
    value: float
    unit: str
    recorded_at: datetime
    # Optional so the existing simulator and any plant gateway keep working
    # unchanged, but everything new should send it. See services/locations.py.
    location: str | None = None


class ReadingsIn(BaseModel):
    readings: list[ReadingIn]


class ReadingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sensor_type: str
    value: float
    unit: str
    recorded_at: datetime
    location: str | None = None


class WindowStats(BaseModel):
    mean: float
    max: float
    z_max: float
    threshold: float
    breaching: bool


class WindowOut(BaseModel):
    mine_id: int
    sensor_type: str
    window_minutes: int
    readings: list[ReadingOut]
    stats: WindowStats
    # The governing clause travels with the readings, so the on-device model is
    # never asked to recall statute from memory.
    clause: dict[str, str] | None = None


# --------------------------------------------------------------- alerts


class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    mine_id: int
    obligation_id: int | None = None
    severity: str
    message: str
    clause_ref: str | None = None
    location: str | None = None
    source: str
    created_at: datetime
    acknowledged_by: int | None = None


# ----------------------------------------------------------------- risk


class FeatureContribution(BaseModel):
    feature: str
    value: float
    contribution: float


class RiskOut(BaseModel):
    obligation_id: int | None = None
    mine_id: int | None = None
    score: float
    band: str
    top_features: list[FeatureContribution] = Field(default_factory=list)
    computed_at: datetime


# ------------------------------------------------------------------ geo


class ContainsIn(BaseModel):
    mine_id: int
    lat: float
    lon: float


class ContainsOut(BaseModel):
    inside_lease: bool
    mine_id: int
    distance_to_boundary_m: float | None = None


class BreachOut(BaseModel):
    mine_id: int
    lease: dict[str, Any]
    excavation: dict[str, Any] | None = None
    outside: dict[str, Any] | None = None
    area_outside_m2: float = 0.0
    breach: bool = False
    clause_ref: str | None = None


# -------------------------------------------------------------- returns


class DraftIn(BaseModel):
    mine_id: int
    period: str
    return_type: str


class SignIn(BaseModel):
    signature_name: str
    certificate_no: str


class ReturnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    mine_id: int
    period: str
    return_type: str
    draft_json: dict[str, Any] | None = None
    signed_by: int | None = None
    signature_name: str | None = None
    signed_at: datetime | None = None
    locked: bool


ObligationDetail.model_rebuild()


# ------------------------------------------------------------- directives


class DirectiveCreate(BaseModel):
    """What the control room sends underground.

    `alert_id` is optional: most directives answer an alert, but a manager may
    also raise one from a phone call or a shift report, and refusing that would
    just push it outside the system where nothing records it.
    """

    message: str
    severity: str = "critical"
    action: str | None = None
    alert_id: int | None = None
    location: str | None = None


class DirectiveOut(BaseModel):
    id: int
    mine_id: int
    alert_id: int | None
    severity: str
    location: str | None
    location_label: str | None
    message: str
    action: str | None
    created_at: datetime
    issued_by_name: str | None
    acknowledged_at: datetime | None
    acknowledged_by_name: str | None
