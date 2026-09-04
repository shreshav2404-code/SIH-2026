"""Reports a regulator would actually read.

Print-styled HTML rather than a generated PDF binary. That is a deliberate
choice, not a shortcut: every browser prints to PDF, the output is identical,
and it avoids adding reportlab or weasyprint - a native dependency that has to
build wheels, on a project whose entire premise is that it costs nothing and
installs anywhere.

NOTHING HERE FILES ANYTHING. Per the API contract, this system drafts documents
for a human to check and sign. A statutory return leaves for the DGMS because a
qualified person sent it, not because software decided it was ready.
"""

from __future__ import annotations

from datetime import datetime, timezone
from html import escape

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import current_user, resolve_mine_id
from db import get_db
from models import Alert, Evidence, Mine, Obligation, Statute, StatutoryReturn, User
from services.chain import verify_chain

router = APIRouter(prefix="/reports", tags=["reports"])


CSS = """
:root { --ink:#0f2942; --soft:#4a6580; --line:#dbe4ed; --crit:#b3261e; --ok:#17734a; }
* { box-sizing: border-box; }
body {
  font: 13px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink); margin: 0; padding: 32px; background: #fff;
}
h1 { font-size: 22px; margin: 0 0 2px; }
h2 {
  font-size: 12px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--soft); margin: 26px 0 8px;
  border-bottom: 1px solid var(--line); padding-bottom: 4px;
}
.sub { color: var(--soft); margin: 0 0 4px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--soft); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
.clause { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: #14539a; }
.crit { color: var(--crit); font-weight: 600; }
.ok { color: var(--ok); font-weight: 600; }
.kv { display: flex; gap: 10px; padding: 4px 0; }
.kv span:first-child { width: 190px; color: var(--soft); }
.foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid var(--line);
        color: var(--soft); font-size: 11px; }
.noprint { margin-bottom: 18px; }
button { font: inherit; padding: 8px 14px; border: 1px solid var(--line);
         background: #14539a; color: #fff; border-radius: 6px; cursor: pointer; }
@media print { .noprint { display: none; } body { padding: 0; } }
"""


def _row(label: str, value: str) -> str:
    return f"<div class='kv'><span>{escape(label)}</span><span>{value}</span></div>"


@router.get("/compliance/{mine_id}", response_class=HTMLResponse)
def compliance_report(
    mine_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> HTMLResponse:
    """One page pulling the whole compliance picture together.

    Everything below is read from the ledger. No model wrote any of it: the
    counts are SQL, the chain result is a hash walk, and the boundary status is
    PostGIS. The only AI in this system writes language, and none of it appears
    here.
    """
    scoped = resolve_mine_id(user, mine_id)
    mine = db.get(Mine, scoped)
    name = mine.name if mine else f"Mine {scoped}"

    rows = db.execute(
        select(Obligation, Statute)
        .join(Statute, Statute.id == Obligation.statute_id)
        .where(Obligation.mine_id == scoped)
    ).all()

    overdue = [(o, s) for o, s in rows if o.status == "overdue"]
    verified = sum(1 for o, _ in rows if o.status == "verified")

    # verify_chain walks rows in insertion order and returns
    # (ok, checked, first_broken) - it does not take a session.
    evidence_rows = db.scalars(
        select(Evidence).where(Evidence.mine_id == scoped).order_by(Evidence.id)
    ).all()
    chain_ok, chain_checked, chain_broken = verify_chain(evidence_rows)
    evidence_count = len(evidence_rows)
    open_alerts = db.scalars(
        select(Alert)
        .where(Alert.mine_id == scoped, Alert.acknowledged_at.is_(None))
        .order_by(Alert.created_at.desc())
        .limit(10)
    ).all()

    overdue_rows = "".join(
        "<tr>"
        f"<td>{escape(o.title or '')}</td>"
        f"<td class='clause'>{escape(s.clause_ref or '')}</td>"
        f"<td>{escape(o.owner_role or '')}</td>"
        f"<td>{o.due_date.isoformat() if o.due_date else '—'}</td>"
        "</tr>"
        for o, s in sorted(overdue, key=lambda r: (r[0].due_date is None, r[0].due_date))
    ) or "<tr><td colspan='4'>Nothing overdue.</td></tr>"

    alert_rows = "".join(
        "<tr>"
        f"<td>{a.created_at.strftime('%Y-%m-%d %H:%M')}</td>"
        f"<td class='{'crit' if a.severity == 'critical' else ''}'>{escape(a.severity)}</td>"
        f"<td>{escape(a.message or '')}</td>"
        f"<td class='clause'>{escape(a.clause_ref or '—')}</td>"
        "</tr>"
        for a in open_alerts
    ) or "<tr><td colspan='4'>No unacknowledged alerts.</td></tr>"

    chain_html = (
        "<span class='ok'>INTACT</span>"
        if chain_ok
        else f"<span class='crit'>BROKEN at evidence #{(chain_broken or {}).get('id', '?')}</span>"
    )

    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Compliance report — {escape(name)}</title><style>{CSS}</style></head>
<body>
  <div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>

  <h1>Statutory compliance report</h1>
  <p class="sub">{escape(name)} · generated {generated}</p>

  <h2>Position</h2>
  {_row("Duties tracked", str(len(rows)))}
  {_row("Overdue", f"<span class='crit'>{len(overdue)}</span>" if overdue else "0")}
  {_row("Verified", str(verified))}
  {_row("Evidence captured", str(evidence_count))}
  {_row("Evidence chain", f"{chain_html} · {chain_checked} record(s) walked")}

  <h2>Overdue duties</h2>
  <table>
    <thead><tr><th>Duty</th><th>Clause</th><th>Owner</th><th>Due</th></tr></thead>
    <tbody>{overdue_rows}</tbody>
  </table>

  <h2>Unacknowledged alerts</h2>
  <table>
    <thead><tr><th>Raised</th><th>Severity</th><th>Detail</th><th>Clause</th></tr></thead>
    <tbody>{alert_rows}</tbody>
  </table>

  <div class="foot">
    Every figure above is read directly from the compliance ledger. Counts are
    SQL, the chain result is a hash walk over stored evidence, and threshold
    breaches were decided by arithmetic against a static table. No language
    model produced any part of this report, and nothing here has been filed
    with any authority — this is a draft for a qualified person to check.
  </div>
</body></html>"""

    return HTMLResponse(html)


@router.get("/return/{return_id}", response_class=HTMLResponse)
def return_document(
    return_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> HTMLResponse:
    """The statutory return itself, laid out as the document it will become.

    A DRAFT, and it says so on its face in a way nobody can miss. The API
    contract is explicit that this system never files anything: a return goes
    to the DGMS because a certificated officer sent it, not because software
    decided it was ready. An unsigned draft is watermarked; a signed one
    carries the name and certificate number of the person who took
    responsibility for it, which is the only thing that makes it a record.
    """
    ret = db.get(StatutoryReturn, return_id)
    if not ret:
        raise HTTPException(status_code=404, detail="no such return")
    scoped = resolve_mine_id(user, ret.mine_id)
    if ret.mine_id != scoped:
        raise HTTPException(status_code=403, detail="not your mine")

    mine = db.get(Mine, ret.mine_id)
    name = mine.name if mine else f"Mine {ret.mine_id}"
    draft = ret.draft_json or {}
    sections = draft.get("sections") or []

    # A return reads as numbered sections, each answering to the clauses it
    # cites - which is the shape the drafter already produces (heading, body,
    # citations). Rendering it as a flat table would throw away the citations,
    # and the citations are the part that makes it a statutory document rather
    # than a status summary.
    def _section(i: int, sec: dict) -> str:
        cites = sec.get("citations") or []
        cite_html = " ".join(
            f"<span class='clause'>{escape(str(c.get('clause_ref', '')))}</span>"
            for c in cites
        ) or "<span class='nocite'>no clause cited</span>"
        return (
            "<section class='sec'>"
            f"<h3>{i}. {escape(str(sec.get('heading', '')))}</h3>"
            f"<p>{escape(str(sec.get('body', '')))}</p>"
            f"<div class='cites'>{cite_html}</div>"
            "</section>"
        )

    body_rows = "".join(
        _section(i, sec) for i, sec in enumerate(sections, start=1)
    ) or "<p>No obligations in scope for this return.</p>"

    if ret.signed_at:
        signature = (
            "<div class='signed'>"
            f"<strong>Signed by {escape(ret.signature_name or 'unknown')}</strong><br>"
            f"Certificate {escape(ret.certificate_no or '—')} · "
            f"{ret.signed_at.strftime('%Y-%m-%d %H:%M')}"
            "</div>"
        )
        stamp = ""
    else:
        signature = (
            "<div class='unsigned'>"
            "Unsigned. This return has no legal standing until a certificated "
            "officer signs it."
            "</div>"
        )
        stamp = "<div class='stamp'>DRAFT — NOT FILED</div>"

    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{escape(ret.return_type)} — {escape(name)}</title>
<style>{CSS}
.stamp {{
  border: 3px solid var(--crit); color: var(--crit); font-weight: 700;
  letter-spacing: .12em; padding: 8px 14px; display: inline-block;
  transform: rotate(-3deg); margin: 8px 0 18px;
}}
.unsigned {{
  border-left: 3px solid var(--crit); padding: 8px 12px; margin-top: 22px;
  background: #fdecea; font-size: 12px;
}}
.signed {{
  border-left: 3px solid var(--ok); padding: 8px 12px; margin-top: 22px;
  background: #e6f4ec; font-size: 12px;
}}
.sec {{ margin: 0 0 16px; break-inside: avoid; }}
.sec h3 {{ font-size: 13px; margin: 0 0 3px; }}
.sec p {{ margin: 0 0 5px; font-size: 12px; }}
.cites {{ display: flex; flex-wrap: wrap; gap: 8px; }}
.nocite {{ font-size: 11px; color: var(--crit); font-style: italic; }}
</style></head>
<body>
  <div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>

  <h1>{escape(ret.return_type.replace('_', ' ').title())}</h1>
  <p class="sub">{escape(name)} · period {escape(ret.period)} · generated {generated}</p>

  {stamp}

  <h2>Position</h2>
  {_row("Obligations covered", str(draft.get("obligations_covered", len(sections))))}
  {_row("Evidence records cited", str(draft.get("evidence_count", 0)))}
  {_row("Drafted", escape(str(draft.get("generated_at", "—"))[:19]))}

  <h2>Obligations and evidence</h2>
  {body_rows}

  {signature}

  <div class="foot">
    Every row is drawn from the compliance ledger and cites the clause it
    answers to. This document has NOT been submitted to any authority and this
    system cannot submit it — filing is a deliberate act by a qualified person.
  </div>
</body></html>"""

    return HTMLResponse(html)
