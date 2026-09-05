"""Build the fine-tuning corpus for the on-device model.

Everything here is generated from material that already exists in this
repository: the 52-clause statutory corpus, the seeded ledger, the alert
history, and the project's own documentation. Nothing is invented.

That restriction is the point, not a limitation. A 270M model trained on
plausible-sounding mining advice would repeat that advice with total
confidence, and a compliance tool that fabricates guidance is worse than one
that says nothing. So every answer below traces to a file or a database row,
and questions whose answers would have to be made up are simply absent.

    python tools/build_dataset.py            -> data/anupalan-train.jsonl

The output is OpenAI `messages` format, which is what TRL's SFTTrainer and
the tokenizer's chat template both consume.
"""

from __future__ import annotations

import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "anupalan-train.jsonl"

# Deterministic: the same corpus produces the same dataset, so a retrain is a
# controlled change rather than a new roll of the dice.
random.seed(1952)  # the Mines Act


# --------------------------------------------------------------------------
# Source 1: the statutory corpus. 52 clauses, each with real text.
# --------------------------------------------------------------------------

def load_clauses() -> list[dict]:
    raw = json.loads((ROOT / "api" / "seed" / "clauses.json").read_text(encoding="utf-8"))
    return raw if isinstance(raw, list) else raw.get("clauses", [])


def clause_examples(clauses: list[dict]) -> list[dict]:
    """Question forms an officer might use about a clause they already have.

    Deliberately several phrasings per clause: the app answers whatever a
    person types, so the model has to have seen the same fact asked for in
    more than one way. One phrasing per clause teaches recall of a string;
    six teaches the shape of the task.
    """
    out: list[dict] = []
    for c in clauses:
        ref, text = c.get("clause_ref"), (c.get("text") or "").strip()
        if not ref or not text:
            continue
        title = c.get("title") or ""
        owner = c.get("owner_role") or ""
        freq = c.get("frequency") or ""
        ev = c.get("evidence_type") or ""
        act = c.get("act") or ""

        # TWO phrasings, not five. The first build gave clauses 416 of 530
        # examples and the model learned to answer EVERYTHING in clause
        # style - asked "does this need internet" it replied "Yes" and cited
        # a lease boundary. Breadth across tasks beats repetition within one.
        asks = [f"what does {ref} require", f"explain {ref}"]

        for q in asks:
            out.append(
                {
                    "messages": [
                        {"role": "user", "content": f"{ref}: {text}\n\n{q}"},
                        {"role": "assistant", "content": f"{text} This is {ref}."},
                    ]
                }
            )

        if owner:
            out.append(
                {
                    "messages": [
                        {"role": "user", "content": f"{ref}: {text}\n\nwho is responsible for this"},
                        {"role": "assistant", "content": f"The {owner} is responsible under {ref}."},
                    ]
                }
            )
        if freq:
            out.append(
                {
                    "messages": [
                        {"role": "user", "content": f"{ref}: {text}\n\nhow often must this be done"},
                        {"role": "assistant", "content": f"{freq.capitalize()}, under {ref}."},
                    ]
                }
            )
        if ev:
            out.append(
                {
                    "messages": [
                        {"role": "user", "content": f"{ref}: {text}\n\nwhat evidence proves this was done"},
                        {"role": "assistant", "content": f"A {ev.replace('_', ' ')} records compliance with {ref}."},
                    ]
                }
            )
    return out


def role_examples(clauses: list[dict]) -> list[dict]:
    """What a given officer is responsible for, across the whole corpus.

    This is the "mine manager companion" question - what falls to me? - and
    it is answerable entirely from owner_role, so no expertise is invented.
    """
    by_role: dict[str, list[dict]] = {}
    for c in clauses:
        r = c.get("owner_role")
        if r:
            by_role.setdefault(r, []).append(c)

    out: list[dict] = []
    for role, items in by_role.items():
        listing = "\n".join(
            f"- {c.get('title') or c['clause_ref']} [{c['clause_ref']}]" for c in items[:8]
        )
        n = len(items)
        for q in (
            f"what is the {role} responsible for",
            f"what are the duties of the {role}",
            f"what does a {role} have to do",
            f"as {role} what am I accountable for",
        ):
            out.append(
                {
                    "messages": [
                        {"role": "user", "content": f"{listing}\n\n{q}"},
                        {
                            "role": "assistant",
                            "content": (
                                f"The {role} carries {n} statutory duties in this corpus, including "
                                + ", ".join((c.get("title") or c["clause_ref"]) for c in items[:3])
                                + "."
                            ),
                        },
                    ]
                }
            )
    return out


def evidence_examples(clauses: list[dict]) -> list[dict]:
    """Which duties need a photograph, a reading, a register - grouped by kind."""
    by_ev: dict[str, list[dict]] = {}
    for c in clauses:
        e = c.get("evidence_type")
        if e:
            by_ev.setdefault(e, []).append(c)

    out: list[dict] = []
    for ev, items in by_ev.items():
        human = ev.replace("_", " ")
        listing = "\n".join(
            f"- {c.get('title') or c['clause_ref']} [{c['clause_ref']}]" for c in items[:8]
        )
        for q in (
            f"which duties need a {human}",
            f"what requires a {human}",
            f"where do I have to record a {human}",
        ):
            out.append(
                {
                    "messages": [
                        {"role": "user", "content": f"{listing}\n\n{q}"},
                        {
                            "role": "assistant",
                            "content": (
                                f"{len(items)} duties are evidenced by a {human}, including "
                                + ", ".join((c.get("title") or c["clause_ref"]) for c in items[:3])
                                + "."
                            ),
                        },
                    ]
                }
            )
    return out


# --------------------------------------------------------------------------
# Source 2: the project's own documentation. What the system is and does.
# --------------------------------------------------------------------------

# Answers quoted or condensed from CLAUDE.md and docs/. Each one is a fact
# about THIS system, not a claim about mining practice.
# (question, fact supplied in the prompt, the answer wanted)
#
# The third field is the point. An earlier version made the answer identical
# to the fact, and the model learned to ECHO rather than answer: given the
# fact and "does this need internet" it repeated the paragraph, and given a
# fact it had not memorised it ignored the prompt entirely and said "Yes".
# A direct answer teaches it to USE what it is given.
SYSTEM_QA = [
    ("does this need internet",
     "ANUPALAN runs its language model entirely on this device. It needs no internet, no server and no cloud.",
     "No. It runs entirely on this device and works in airplane mode."),
    ("does it work offline",
     "ANUPALAN runs its language model entirely on this device and answers in airplane mode.",
     "Yes. Everything runs on the phone with no network."),
    ("can this file a statutory return",
     "This system never files anything. It drafts returns and stamps them DRAFT - NOT FILED.",
     "No. It only drafts returns. A certificated officer must sign and file them."),
    ("can it file returns",
     "This system never files anything. It drafts returns and stamps them DRAFT - NOT FILED.",
     "No. It only drafts returns; a certificated officer files them."),
    ("will this file the return for me",
     "This system never files anything. Filing is a deliberate act by a qualified person.",
     "No. You must sign and file it yourself."),
    ("can the app submit a return",
     "This system never files anything. It drafts returns and stamps them DRAFT - NOT FILED.",
     "No. It drafts only. Filing needs a certificated officer."),
    ("is the return filed automatically",
     "This system never files anything. A return reaches the DGMS because a certificated officer sent it.",
     "No. Nothing is filed automatically."),
    ("does this send returns to the regulator",
     "This system never files anything. Filing is a deliberate act by a qualified person.",
     "No. It cannot send anything to a regulator."),
    ("does this submit anything to the DGMS",
     "This system never files anything. A return reaches the DGMS because a certificated officer sent it.",
     "No. Filing is a deliberate act by a qualified person."),
    ("does the model decide if something is a hazard",
     "Breach detection is arithmetic. A rolling mean and a z-score are compared against a static threshold table.",
     "No. Breach detection is deterministic code, not the model."),
    ("is my data sent anywhere",
     "The model runs on this device. Nothing is uploaded for it to answer.",
     "No. Nothing leaves the device."),
    ("what is ANUPALAN",
     "ANUPALAN is an on-device compliance monitoring system for Coal India that tracks statutory duties and evidence.",
     "ANUPALAN is an on-device compliance monitoring system for Coal India."),
    ("what does this app do",
     "It tracks statutory duties, captures geo-tagged evidence, watches sensor readings, and drafts returns.",
     "It tracks statutory duties, captures evidence, and answers questions about the compliance ledger."),
    ("how can you help me understand this app",
     "You can ask what is overdue and who owns it, what a clause requires, what an officer is responsible for, or what a reading means.",
     "Ask me what is overdue, what a clause requires, what an officer is responsible for, or what a sensor reading means."),
    ("how do I use this",
     "The Duties tab lists overdue work, Capture records evidence, and Ask answers questions.",
     "Start on the Duties tab for overdue work, Capture for evidence, and Ask for questions."),
    ("where does the AI run",
     "The language model is bundled inside the app and runs on the phone's own processor.",
     "On this phone. There is no server model and no cloud."),
    ("what decides whether a reading is a breach",
     "Breach detection is arithmetic. A rolling mean and a z-score are compared against a static threshold table.",
     "Arithmetic, not the model. A threshold table decides."),
    ("what is the hash chain",
     "Every evidence record stores the previous record's hash, so an edit breaks every hash after it.",
     "A tamper-evident ledger. Each record carries the previous record's hash."),
    ("how is evidence protected from tampering",
     "Every evidence record stores the previous record's hash, forming a chain.",
     "Each record stores the previous record's hash, so any edit breaks the chain."),
    ("how do you check if work happened inside the lease",
     "The captured GPS point is tested against the lease polygon with PostGIS ST_Contains.",
     "PostGIS compares the GPS point against the lease polygon."),
    ("how is the risk score calculated",
     "Risk is scored by XGBoost on the backend, returned with its top contributing features.",
     "XGBoost on the backend, with the top contributing features shown."),
    ("who signs a return",
     "A return reaches the DGMS because a certificated officer signed it. An unsigned draft has no standing.",
     "A certificated officer. An unsigned draft has no legal standing."),
    ("what happens if the model invents a regulation number",
     "Any statute named that was not among the retrieved facts is flagged as not in the ledger.",
     "It is flagged as not in the ledger and marked unverified."),
    ("why cite the clause",
     "A compliance statement without a citation is an opinion; the clause reference makes it a record.",
     "So the answer can be checked against the statute it came from."),
    ("what happens to a capture with no signal",
     "A capture taken with no signal is queued on the device and uploaded when a connection returns.",
     "It is queued on the device and synced when a connection returns."),
]


# Ways the same question gets typed. A fact the model must RECALL - rather
# than read out of the prompt - needs to be seen from many angles, because at
# 270M recall is weak and one phrasing teaches only that phrasing.
_PARAPHRASE = [
    "{q}",
    "{q}?",
    "{Q}",
    "{Q}?",
    "tell me {q}",
    "can you tell me {q}",
    "I want to know {q}",
    "explain {q}",
    "quick question - {q}",
    "hey, {q}?",
]


def _vary(answer: str, i: int) -> str:
    """Small wording changes so repeated targets are not byte-identical.

    Deliberately conservative - it must never change what the answer MEANS. A
    compliance answer that says "No" keeps saying "No"; only the framing moves.
    """
    if i % 5 == 1 and answer.startswith("No. "):
        return "No - " + answer[4:]
    if i % 5 == 2 and answer.startswith("Yes. "):
        return "Yes - " + answer[5:]
    if i % 5 == 3 and not answer.endswith("."):
        return answer + "."
    return answer


def system_examples() -> list[dict]:
    """Facts about the app, taught as READING with a DIRECT answer.

    Two things were learned the hard way here. First, recall does not work at
    270M: "does this need internet" came back "Yes" across three rounds of
    training, because the base model's prior for a yes/no question is
    overwhelming and eighteen examples do not shift it. Second, supplying the
    fact is not enough on its own - when the target answer WAS the fact, the
    model learned to echo the paragraph rather than answer the question, and
    fell straight back on "Yes" for any fact it had not memorised.

    So each example now supplies the fact and expects a direct answer derived
    from it. The app does the same at inference; see facts.ts.
    """
    out: list[dict] = []
    for q, fact, answer in SYSTEM_QA:
        for i, tmpl in enumerate(_PARAPHRASE):
            asked = tmpl.format(q=q, Q=q.capitalize())
            out.append(
                {
                    "messages": [
                        {"role": "user", "content": fact + "\n\n" + asked},
                        # Vary the target. Ten paraphrases mapping to ONE
                        # identical answer is a lesson in repeating
                        # yourself, and the model learned it: the tuned
                        # build looped on ledger answers and the vision
                        # model repeated a sentence fifteen times.
                        {"role": "assistant", "content": _vary(answer, i)},
                    ]
                }
            )
    return out


# --------------------------------------------------------------------------
# Source 3: conversation. Kept in deliberately, to resist forgetting.
# --------------------------------------------------------------------------

CHAT_QA = [
    ("hi", "Hello. Ask me about this mine's compliance ledger, a clause, or a sensor reading."),
    ("hello", "Hello. What would you like to check?"),
    ("who are you", "I am the on-device assistant for ANUPALAN."),
    ("how can you help me understand this app",
     "Ask me what is overdue, what a clause requires, what an officer is responsible for, "
     "or what a sensor reading means."),
    ("how do I use this",
     "Start on the Duties tab for overdue work, Capture for evidence, and Ask for questions."),
    ("what should I ask you",
     "Ask about overdue duties, a clause reference, an officer's responsibilities, or a reading."),
    ("what can you do", "I answer questions about this mine's duties, clauses and sensor readings."),
    ("thanks", "You're welcome."),
    ("can you help me", "Yes. Ask about overdue duties, a clause, or an officer's responsibilities."),
    ("are you online", "No. I run on this device with no network."),
    ("what should I check first", "Start with the overdue duties, sorted by risk."),
    ("good morning", "Good morning. What would you like to check?"),
    ("are you an AI", "Yes, a small model running on this phone."),
]


def chat_examples() -> list[dict]:
    """General conversation, mixed in on purpose.

    A 270M model trained only on ledger tasks forgets how to hold a
    conversation - catastrophic forgetting is real at this size. These
    examples are the replay set that keeps it able to answer a person who is
    not asking about a duty.
    """
    out: list[dict] = []
    for q, a in CHAT_QA:
        for tmpl in _PARAPHRASE[:6]:
            out.append(
                {
                    "messages": [
                        {"role": "user", "content": tmpl.format(q=q, Q=q.capitalize())},
                        {"role": "assistant", "content": a},
                    ]
                }
            )
    return out


def main() -> None:
    clauses = load_clauses()
    parts = {
        "clause": clause_examples(clauses),
        "role": role_examples(clauses),
        "evidence": evidence_examples(clauses),
        "system": system_examples(),
        "chat": chat_examples(),
    }

    rows: list[dict] = []
    for name, items in parts.items():
        print(f"  {len(items):>5}  {name}")
        rows.extend(items)

    random.shuffle(rows)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"  {'-' * 30}")
    print(f"  {len(rows):>5}  total -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
