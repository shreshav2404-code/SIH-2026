"""Move the rulebook off repealed law, and add duties it was missing.

    .venv/Scripts/python tools/migrate_citations.py --dry-run   # show, change nothing
    .venv/Scripts/python tools/migrate_citations.py             # apply

Updates both copies of the rulebook - api/seed/clauses.json and the live
`statute` table - re-embeds every changed clause so Rulebook retrieval finds
the new wording, carries changed frequency and owner through to the duties
built from each clause, and adds duties for the new clauses at every mine
they apply to. The evidence hash chain covers obligation ids, never clause
text; it is verified before and after anyway.

WHY. Checked against the Gazette texts on 2026-09-16 (data/SOURCES.md):

  - Mines Act, 1952: repealed by OSH Code 2020 s.143(1)(c).
  - Mines Rules, 1955 and Mines Rescue Rules, 1985: superseded by the OSH
    (Central) Rules, 2026 (G.S.R. 345(E), 8 May 2026).
  - Coal Mines Regulations, 2017: still in force under OSH Code s.143(3).

28 of the 52 clauses cited the repealed or superseded texts. Moving them was
not only renaming: several duties changed in SUBSTANCE, and the app was
stating the old requirement as current -

  Safety Committee      100+ workers        -> 500+ workers        (R. 14(1))
  Welfare Officer       500+ workers        -> 250+ workers        (R. 57)
  Medical records       kept ten years      -> employment + 5 yrs  (R. 114(1))
  Periodic medical exam "prescribed"        -> annually, FORM-IX   (R. 109(1)(ii))
  Registers             Forms A, B, D, E    -> FORMS XIII-XV, XX   (R. 72, 76)

- and one citation was wrong even under the old law: "Medical records retained
for ten years" cited Mines Rules R. 29-K, which is the rule constituting the
Appellate Medical Board.

NOTHING GUESSED. Every new text below was read in the provision it cites.
Where the current law holds no equivalent - Workmen's Inspectors and identity
tokens - the duty is kept and marked for legal review rather than given a
citation that does not say what the duty says. Claims the current text does
not make were removed: the notice of opening no longer says "one month
before", and inspector entry no longer says "at any hour".
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "api"
SEED = API / "seed" / "clauses.json"
VERSION = "2026-09-16"

OSH = "OSH Code 2020"
CR = "OSH (Central) Rules 2026"
CMR = "Coal Mines Regulations 2017"
REVIEW = (" NOTE: the rule this duty came from was superseded on 8 May 2026, and no "
          "equivalent provision was found in the OSH Code 2020 or the OSH (Central) "
          "Rules 2026. Needs legal review before it is relied on.")

# (old clause_ref, old title) -> the replacement. Only keys given change.
MAPPING: dict[tuple[str, str], dict] = {
    ("Mines Act 1952 · S.16", "Notice of opening a mine"): dict(
        act=CMR, clause_ref="CMR 2017 · Reg. 3", title="Notice of opening a mine",
        text="The notice for commencement of any mining operation shall be submitted in the Form "
             "and method specified by the Chief Inspector, accompanied by a plan showing the "
             "boundaries of the mine and the shafts or openings of the mine.",
        change="Moved to CMR 2017 Reg. 3. \"At least one month before\" removed: not in the current text."),
    ("Mines Act 1952 · S.17", "Sole manager with prescribed qualifications"): dict(
        act=OSH, clause_ref="OSH Code 2020 · S.67(1)",
        text="Every mine shall be under a sole manager who shall have such qualifications as may be "
             "prescribed by the Central Government, and the owner or agent of every mine shall "
             "appoint a person having such qualifications to be the manager.",
        change="Same duty, now OSH Code s.67(1)."),
    ("Mines Act 1952 · S.18", "Due diligence record — owner, agent and manager"): dict(
        act=OSH, clause_ref="OSH Code 2020 · S.7(1)", title="Owner and agent responsible for compliance",
        owner_role="Owner/Agent",
        text="The owner and agent of every mine shall jointly and severally be responsible for making "
             "financial and other provisions and for taking such other steps as may be necessary for "
             "compliance with the Code and the rules, regulations, bye-laws and orders made under it "
             "relating to mines.",
        change="Now OSH Code s.7(1), which places the duty on the owner and agent jointly and severally."),
    ("Mines Act 1952 · S.22", "Compliance with improvement and stop-work notices"): dict(
        act=OSH, clause_ref="OSH Code 2020 · S.38",
        title="Compliance with an Inspector-cum-Facilitator's notice or order",
        text="An Inspector-cum-Facilitator has special powers in respect of mines to issue notices and "
             "orders where conditions are dangerous. The employer of the mine may appeal within ten "
             "days of receiving the notice or order.",
        change="Now the special powers in OSH Code s.38; inspectors are Inspectors-cum-Facilitators."),
    ("Mines Act 1952 · S.23", "Accident notice and 14-day posting at the mine"): dict(
        act=CMR, clause_ref="CMR 2017 · Reg. 8",
        text="When an accident causing loss of life or serious bodily injury, or a dangerous occurrence, "
             "happens in or about a mine, notice must be given as the regulation requires, and the "
             "owner, agent or manager shall simultaneously exhibit a copy of the notice on a special "
             "notice board at the office of the mine for not less than fourteen days.",
        change="Moved to CMR 2017 Reg. 8, where the 14-day posting still stands (Reg. 8(2)). "
               "The FORM-XI notice itself is OSH (Central) Rules 2026 R. 7."),
    ("Mines Act 1952 · S.48", "Statutory registers maintained"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 72(1)",
        text="Every employer shall maintain an employee register in FORM XIII, an attendance "
             "register-cum-muster roll in FORM XIV and a register for wages, overtime and deduction "
             "in FORM XV, electronically or otherwise, and preserve them in original for five "
             "calendar years from the last entry.",
        change="Now OSH (Central) Rules 2026 R. 72(1): new forms, electronic registers allowed, kept five years."),
    ("Mines Act 1952 · S.7", "Facilitate inspector entry at any hour"): dict(
        act=OSH, clause_ref="OSH Code 2020 · S.35(1)",
        title="Facilitate inspection by the Inspector-cum-Facilitator",
        text="An Inspector-cum-Facilitator may enter any place used as a work place, inspect and examine "
             "the establishment, premises, plant and machinery, and inquire into any accident or "
             "dangerous occurrence.",
        change="Now OSH Code s.35(1). \"At any hour, day or night\" removed: not in the current text."),
    ("Mines Rules 1955 · R. 29-P", "Annual medical examination return by 20 February"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 74",
        title="Annual return in FORM-XVII by end of February", owner_role="Mine Manager",
        text="Every employer shall send an annual return in FORM-XVII, covering the category of "
             "employees, health and welfare facilities and related matters, electronically to the "
             "Inspector-cum-Facilitator so as to reach on or before the last day of February following "
             "each calendar year.",
        change="The separate medical return (old Form T, 20 February) is replaced by the FORM-XVII annual "
               "return (R. 74), due the last day of February. The mine's own annual returns are CMR 2017 "
               "Reg. 4, due 1 February, added as a separate duty."),
    ("Mines Rules 1955 · R. 29-B", "Initial medical examination on employment"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 109(1)(i)",
        title="Initial medical examination before employment",
        text="The employer of every mine shall make arrangements for initial medical examination of "
             "every person seeking employment in a mine, conducted as per FORM-IX.",
        change="Now OSH (Central) Rules 2026 R. 109(1)(i); examination as per FORM-IX."),
    ("Mines Rules 1955 · R. 29-C", "Periodic medical examination"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 109(1)(ii)",
        title="Periodical medical examination every year",
        text="The employer of every mine shall make arrangements for periodical medical examination of "
             "every person employed in a mine annually, conducted as per FORM-IX.",
        change="The interval is now stated: annually (R. 109(1)(ii))."),
    ("Mines Rules 1955 · R. 29-K", "Medical records retained for ten years"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 114(1)",
        title="Medical records kept during employment and five years after", owner_role="Mine Manager",
        text="All medical examination records of persons employed or to be employed in a mine shall be "
             "retained by the manager of the mine so long as the person is employed in the mine and for "
             "five years thereafter.",
        change="Retention changed from ten years to employment plus five years, held by the manager. The "
               "old citation was also wrong: Mines Rules R. 29-K constituted the Appellate Medical Board."),
    ("Mines Rules 1955 · R. 29-Q", "Workmen's Inspectors appointed at 500+ employees"): dict(
        act="Mines Rules 1955 (superseded)", review=True,
        change="No equivalent found in the OSH Code 2020 or OSH (Central) Rules 2026. Kept and marked for review."),
    ("Mines Rules 1955 · R. 29-Q", "Workmen's Inspector site round"): dict(
        act="Mines Rules 1955 (superseded)", review=True,
        change="No equivalent found in the OSH Code 2020 or OSH (Central) Rules 2026. Kept and marked for review."),
    ("Mines Rules 1955 · R. 29-T", "Safety Committee constituted at 100+ workers"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 14(1)", title="Safety Committee constituted at 500+ workers",
        text="Every establishment employing five hundred or more workers shall constitute a Safety "
             "Committee of representatives of employers and workers, with a tenure of three years. The "
             "Central Government may specify different thresholds for different classes of establishment.",
        change="Threshold raised from 100 to 500 workers (R. 14(1))."),
    ("Mines Rules 1955 · R. 29-T", "Safety Committee meeting and minutes"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 14(3)", title="Safety Committee meets at least once a month",
        text="The Safety Committee shall meet at least once in every quarter; in the case of mines it "
             "shall meet at least once in a month.",
        change="Interval now stated for mines: at least once a month (R. 14(3))."),
    ("Mines Rules 1955 · R. 29-W", "Safety Committee recommendations implemented within 15 days"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 14(5)",
        text="The employer shall, within fifteen days from the date of receipt of the recommendations of "
             "the Safety Committee, take action to implement them.",
        change="Same fifteen days, now R. 14(5)."),
    ("Mines Rules 1955 · R. 72", "Welfare Officer appointed at 500+ workers"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 57", title="Welfare Officer appointed at 250+ workers",
        text="The employer of every mine ordinarily employing between two hundred and fifty and five hundred "
             "workers shall appoint at least one welfare officer, with an additional welfare officer "
             "where the number of workers exceeds five hundred.",
        change="Threshold lowered from 500 to 250 workers (OSH Code s.24; R. 57)."),
    ("Mines Rules 1955 · R. 77-A", "Identity tokens issued and reconciled"): dict(
        act="Mines Rules 1955 (superseded)", review=True,
        change="No equivalent found in the OSH Code 2020, OSH (Central) Rules 2026 or CMR 2017. Kept and marked for review."),
    ("Mines Rules 1955 · Form A", "Employee register maintained"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 72(1)(i)", title="Employee register in FORM XIII",
        text="Every employer shall maintain an employee register in FORM XIII, electronically or "
             "otherwise, preserved in original for five calendar years from the last entry.",
        change="Form A replaced by FORM XIII (R. 72(1)(i))."),
    ("Mines Rules 1955 · Form D", "Daily attendance register"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 72(1)(ii)",
        title="Attendance register-cum-muster roll in FORM XIV",
        text="Every employer shall maintain an attendance register-cum-muster roll in FORM XIV, "
             "electronically or otherwise, preserved in original for five calendar years from the last entry.",
        change="Form D replaced by FORM XIV (R. 72(1)(ii))."),
    ("Mines Rules 1955 · Form J", "Reportable accidents return"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 7", title="Accident notice in FORM-XI",
        text="Where an accident results in death, the employer shall inform the Inspector-cum-Facilitator "
             "forthwith in a notice in FORM-XI and inform the authorities electronically and by telephone. "
             "Where an injury prevents work for forty-eight hours or more, FORM-XI must be sent "
             "electronically within twelve hours after the forty-eight hours are complete. A dangerous "
             "occurrence must be intimated within twelve hours.",
        change="Form J replaced by the FORM-XI notice with fixed deadlines (R. 7)."),
    ("Mines Rules 1955 · Form K", "Minor accidents register"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 75",
        title="Register of accidents and dangerous occurrences in FORM-XIX",
        text="The register of accidents and dangerous occurrences required by section 33 of the Code "
             "shall be maintained in FORM-XIX.",
        change="Form K replaced by FORM-XIX, which also covers dangerous occurrences (R. 75)."),
    ("Mines Rules 1955 · Form B", "Overtime register"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 72(1)(iii)",
        title="Register of wages, overtime and deduction in FORM XV",
        text="Every employer shall maintain a register for wages, overtime and deduction in FORM XV, "
             "electronically or otherwise, preserved in original for five calendar years from the last entry.",
        change="Form B replaced by FORM XV, which combines wages, overtime and deductions (R. 72(1)(iii))."),
    ("Mines Rules 1955 · Form E", "Leave with wages register"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 76", title="Leave with wages record in FORM-XX",
        text="The employer shall maintain for every employee a record of leave with wages, electronically or "
             "otherwise, in FORM-XX, share it with the employee once a calendar year on demand, and "
             "preserve it for five years after the last entry.",
        change="Form E replaced by FORM-XX, kept five years (R. 76)."),
    ("Mines Rescue Rules 1985 · Rescue station", "Rescue station or rescue room within reach"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 125(1)",
        title="Rescue room where no rescue station within 35 km",
        text="At every below ground mine where more than 100 persons are ordinarily employed below ground "
             "and there is no rescue station within a radius of 35 km, the employer shall establish a "
             "rescue room on the surface close to the mine entrance.",
        change="Same requirement, now R. 125(1)."),
    ("Mines Rescue Rules 1985 · Brigade strength", "Trained rescue brigade of eighteen maintained"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 123(2)",
        title="Rescue brigade of not less than eighteen at a rescue station",
        text="A rescue station shall have a superintendent and at least two instructors, and a rescue "
             "brigade of not less than eighteen rescue trained persons shall be maintained.",
        change="Same eighteen, now R. 123(2), stated for a rescue station."),
    ("Mines Rescue Rules 1985 · Medical re-examination", "Annual medical re-examination of rescue personnel"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 142",
        title="Rescue trained persons re-examined every twelve months",
        text="Every rescue trained person shall be re-examined at least once in every twelve months by a "
             "qualified medical practitioner designated by the manager, to the standard in FORM IX.",
        change="Same interval, now R. 142; standard is FORM IX."),
    ("Mines Rescue Rules 1985 · Refresher training", "Rescue brigade refresher training current"): dict(
        act=CR, clause_ref="OSH Central Rules 2026 · R. 141(2)",
        title="Rescue trained persons keep up practices and instructions", frequency="continuous",
        text="Rescue trained persons shall undergo practices and receive instructions as specified by the "
             "Chief Inspector-cum-Facilitator through general or special order.",
        change="Now R. 141(2). The quarterly interval was removed: the current rule leaves the schedule to "
               "the Chief Inspector-cum-Facilitator's orders."),
}

# Clauses that already cited current law, whose wording the provision corrects.
REFINE: dict[tuple[str, str], dict] = {
    ("CMR 2017 · Reg. 4", "Annual return to Chief Inspector"): dict(
        act=CMR, clause_ref="CMR 2017 · Reg. 4(1)", title="Annual returns to the Chief Inspector by 1 February",
        text="On or before the 1st day of February in every year, the owner, agent or manager shall submit to "
             "the Chief Inspector, the Regional Inspector and the District Magistrate annual returns in "
             "respect of the preceding year in the Form and method specified by the Chief Inspector.",
        change="Text replaced with the provision: due 1 February, to three authorities."),
}

ALL_TYPES = ["underground", "opencast", "mixed"]

# Duties the rulebook did not have, each read in the provision it cites. Two
# more were drafted and dropped because the rulebook already held them: CMR
# Reg. 4 annual returns (corrected in REFINE instead) and a general Reg. 46
# ventilation officer duty, already covered by three specific Reg. 46 duties.
NEW_RULES = [
    dict(act=CR, clause_ref="OSH Central Rules 2026 · R. 20(1)", title="Safety Officer appointed at 100+ workers",
         text="At every mine wherein one hundred or more workers are ordinarily employed, the employer shall "
              "appoint a safety officer on a scale of one up to five hundred workers and an additional one "
              "for every additional five hundred workers or part thereof, holding the Manager's Certificate "
              "of Competency (Coal) specified in sub-rule (2).",
         owner_role="Owner/Agent", frequency="continuous", evidence_type="certificate", applies_to=ALL_TYPES),
    dict(act=CMR, clause_ref="CMR 2017 · Reg. 134(7)", title="Stop operations and evacuate on serious fire danger",
         text="The owner, agent and manager of every mine shall ensure that operations are stopped and workers "
              "are evacuated to a safe location when there is serious danger due to fire, threatening the "
              "safety and health of workers.",
         owner_role="Mine Manager", frequency="event_driven", evidence_type="document", applies_to=ALL_TYPES),
    dict(act=CMR, clause_ref="CMR 2017 · Reg. 104(1)", title="Safety management plan: hazards identified and risks assessed",
         text="The owner, agent and manager of every mine shall identify the hazards to health and safety of "
              "the persons employed at the mine to which they may be exposed while at work, and assess the "
              "risks to their health and safety.",
         owner_role="Mine Manager", frequency="continuous", evidence_type="document", applies_to=ALL_TYPES),
    dict(act=CR, clause_ref="OSH Central Rules 2026 · R. 158", title="Vocational training before employment",
         text="The owner or agent of every mine shall ensure that every person to be employed in a mine is, "
              "before being employed, imparted training as per the training scheme under these rules.",
         owner_role="Owner/Agent", frequency="event_driven", evidence_type="certificate", applies_to=ALL_TYPES),
    dict(act=CR, clause_ref="OSH Central Rules 2026 · R. 159", title="Refresher training at least once in four years",
         text="Every person in employment in a mine shall undergo refresher training at least once in four "
              "years, as per the training scheme.",
         owner_role="Mine Manager", frequency="continuous", evidence_type="certificate", applies_to=ALL_TYPES),
    dict(act=CMR, clause_ref="CMR 2017 · Reg. 62", title="HEMM operator inspects the machine at the start of each shift",
         text="Every person authorised to operate heavy earth moving machinery such as a dragline, shovel or "
              "excavator shall inspect the machine assigned to him at the beginning of his shift and test "
              "its various systems and sub-systems.",
         owner_role="HEMM Operator", frequency="daily", evidence_type="diary_entry", applies_to=["opencast", "mixed"]),
    dict(act=CMR, clause_ref="CMR 2017 · Reg. 33(1)", title="Overman in charge of each district on every shift",
         text="At every mine, one or more overmen shall be appointed to hold charge of the different districts "
              "of the mine on each working shift, unless otherwise specified by the Regional Inspector.",
         owner_role="Mine Manager", frequency="continuous", evidence_type="document", applies_to=ALL_TYPES),
    dict(act=CMR, clause_ref="CMR 2017 · Reg. 232(1)", title="Continuous methane monitoring along gas pipelines",
         text="A proper automatic on-line or continuous methane monitoring system fitted with an audio-visual "
              "alarm shall be installed along the gas pipelines.",
         owner_role="Ventilation Officer", frequency="continuous", evidence_type="reading",
         applies_to=["underground", "mixed"]),
]

CHANGEABLE = ("act", "clause_ref", "title", "text", "owner_role", "frequency", "evidence_type")


def seed_json(data: dict) -> str:
    """The file's own layout: string lists on one line, a blank line before
    the clauses, so the diff shows what changed and not how it was printed."""
    text = json.dumps(data, indent=2, ensure_ascii=False)
    text = re.sub(r"\[\s*((?:\"[^\"\n]*\",?\s*)+)\]",
                  lambda m: "[" + ", ".join(re.findall(r"\"[^\"\n]*\"", m.group(1))) + "]", text)
    return text.replace('\n  },\n  "clauses": [', '\n  },\n\n  "clauses": [', 1) + "\n"


def migrated(clause: dict, m: dict) -> dict:
    new = dict(clause)
    for k in CHANGEABLE:
        if k in m:
            new[k] = m[k]
    if m.get("review") and REVIEW not in new["text"]:
        new["text"] = new["text"].rstrip() + REVIEW
    return new


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    data = json.loads(SEED.read_text(encoding="utf-8"))
    clauses = data["clauses"]
    pairs = []  # (old clause, new clause, note)
    changes = {**MAPPING, **REFINE}
    for i, c in enumerate(clauses):
        m = changes.get((c["clause_ref"], c["title"]))
        if m:
            new = migrated(c, m)
            pairs.append((c, new, m["change"]))
            clauses[i] = new
    unmapped = [k for k in changes if not any((o["clause_ref"], o["title"]) == k for o, _, _ in pairs)]
    existing = {(c["clause_ref"], c["title"]) for c in clauses}
    added = [r for r in NEW_RULES if (r["clause_ref"], r["title"]) not in existing]
    clauses.extend(added)

    print(f"  seed: {len(pairs)} clauses migrated, {len(added)} added, {len(unmapped)} mappings unmatched")
    for k in unmapped:
        print(f"    UNMATCHED (already migrated?): {k}")
    if args.dry_run:
        for old, new, note in pairs:
            print(f"    {old['clause_ref']:<30} -> {new['clause_ref']:<38} {note[:70]}")
        return

    meta = data["_meta"]
    meta["count"] = len(clauses)
    meta["migration"] = (
        f"{VERSION}: clauses citing the repealed Mines Act 1952 and the superseded Mines Rules 1955 and "
        f"Mines Rescue Rules 1985 moved to the OSH Code 2020 and OSH (Central) Rules 2026, CMR Reg. 4 "
        f"corrected, and {len(NEW_RULES)} duties added from CMR 2017 and the Central Rules. Text for those "
        "clauses is drawn from the Gazette "
        "provision cited, not paraphrased from the research brief. See docs/CITATION_MAP.md."
    )
    if "HEMM Operator" not in meta["owner_roles"]:
        meta["owner_roles"].append("HEMM Operator")
    SEED.write_text(seed_json(data), encoding="utf-8")
    print(f"  wrote {SEED.relative_to(ROOT)}")

    apply_to_database(pairs, added)


def apply_to_database(pairs: list, added: list) -> None:
    sys.path.insert(0, str(API))
    os.chdir(API)
    from sentence_transformers import SentenceTransformer
    from sqlalchemy import select

    from config import settings
    from db import SessionLocal
    from models import Evidence, Mine, Obligation, Statute
    from seed.seed import CADENCE_DAYS
    from services.chain import verify_chain

    model = SentenceTransformer(settings.embedding_model)
    db = SessionLocal()
    try:
        mines = db.scalars(select(Mine)).all()

        def chains():
            return {m.id: verify_chain(db.scalars(select(Evidence).where(Evidence.mine_id == m.id)
                                                  .order_by(Evidence.id)).all())[0] for m in mines}

        before = chains()
        today = date.today()
        changed_st = changed_ob = 0

        for old, new, _ in pairs:
            sts = db.scalars(select(Statute).where(Statute.clause_ref == old["clause_ref"],
                                                   Statute.title == old["title"])).all()
            for st in sts:
                st.act, st.clause_ref, st.title, st.text = new["act"], new["clause_ref"], new["title"], new["text"]
                st.version = VERSION
                st.embedding = model.encode(f"{new['title']}. {new['text']}", normalize_embeddings=True).tolist()
                changed_st += 1
                for ob in db.scalars(select(Obligation).where(Obligation.statute_id == st.id)).all():
                    if ob.title == old["title"]:  # never overwrite a title someone edited
                        ob.title = new["title"]
                    ob.owner_role = new["owner_role"]
                    ob.evidence_type = new["evidence_type"]
                    if ob.frequency != new["frequency"]:
                        ob.frequency = new["frequency"]
                        if new["frequency"] not in CADENCE_DAYS:
                            ob.due_date = None
                            if ob.status in ("overdue", "due"):
                                ob.status = "pending"
                    changed_ob += 1

        made = 0
        for r in added:
            st = Statute(act=r["act"], clause_ref=r["clause_ref"], title=r["title"], text=r["text"], version=VERSION)
            st.embedding = model.encode(f"{r['title']}. {r['text']}", normalize_embeddings=True).tolist()
            db.add(st)
            db.flush()
            for mine in mines:
                if mine.type not in r["applies_to"]:
                    continue
                due = None
                if r["frequency"] in CADENCE_DAYS:
                    due = today + timedelta(days=(st.id * 7 + mine.id * 3) % 15 - 5)
                status = ("overdue" if due and due < today else "due" if due == today else "pending")
                db.add(Obligation(statute_id=st.id, mine_id=mine.id, title=r["title"], owner_role=r["owner_role"],
                                  frequency=r["frequency"], evidence_type=r["evidence_type"],
                                  due_date=due, status=status))
                made += 1

        db.commit()
        after = chains()
        print(f"  database: {changed_st} clauses migrated and re-embedded, {changed_ob} duties updated, "
              f"{len(added)} clauses added with {made} new duties")
        print("  evidence chain: " + ", ".join(
            f"mine {k} {'intact' if after[k] else 'BROKEN'} (was {'intact' if before[k] else 'broken'})" for k in after))
        if before != after:
            raise SystemExit("chain state changed - investigate before relying on this")
    finally:
        db.close()


if __name__ == "__main__":
    main()
