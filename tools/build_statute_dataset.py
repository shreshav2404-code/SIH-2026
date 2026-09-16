"""Build training examples from current coal-mine law, plus a held-out test.

    .venv-train/Scripts/python tools/build_statute_dataset.py

Reads data/statutes.jsonl (tools/extract_statutes.py) and writes:

  data/statutes-train.jsonl   examples built from the TRAINING provisions
  data/statutes-test.jsonl    checkable questions on HELD-OUT provisions only
  data/anupalan-v2.jsonl      the full training set: every example the current
                              model was trained on, plus the statute examples

THE RULE IS THE SAME AS tools/build_dataset.py: NOTHING INVENTED. Every
answer is either copied from the provision shown in the prompt, or says that
the provision does not state the thing asked. No summary is written by a
model and no fact is added from general knowledge.

GROUNDED, NOT RECALLED. The provision is always in the prompt, in the same
"<ref>: <text>\\n\\n<question>" shape the app sends and the current model was
trained on. The notes from the first training round are explicit that recall
does not work at 270M, and that a small model asked to remember statute
invents a plausible regulation number. Training it to recite 500 regulations
from memory would teach exactly that. What it learns here is to READ a
provision: who is responsible, how often, what it requires - and to say so
when the text does not say.

WHY ABSTENTION EXAMPLES. "How often must this be done" asked of a provision
that sets no interval should get "it does not say", not an invented "monthly".
Those examples are what teach the difference, so they are kept in, capped at
the number of positive examples so the model does not learn to refuse.

WHY THE HELD-OUT SPLIT IS BY PROVISION. Splitting examples at random would
put a paraphrase of a test question in training, and the score would measure
memory. Here a held-out regulation contributes nothing at all to training, so
the test measures whether the model can read a provision it has never seen.

WHY THE OLD EXAMPLES ARE REPEATED. The first round of training made clause
examples 47% of the corpus and the model answered everything in clause style -
asked "does this need internet" it cited a lease boundary. Statute examples
would dominate far harder than that, so the examples that carry the app's own
behaviour (system facts, ledger answers, conversation) are repeated to hold
their share.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "statutes.jsonl"
OLD = ROOT / "data" / "anupalan-full.jsonl"
TRAIN_OUT = ROOT / "data" / "statutes-train.jsonl"
TEST_OUT = ROOT / "data" / "statutes-test.jsonl"
FULL_OUT = ROOT / "data" / "anupalan-v3.jsonl"

random.seed(2020)  # the OSH Code
TEST_SHARE = 0.12
EXCERPT = 1100  # characters of provision text shown in a prompt

# Longest first, so "mining sirdar" wins over "sirdar" and "assistant manager"
# over "manager".
ROLES = sorted([
    "ventilation officer", "safety officer", "assistant manager", "manager", "owner",
    "agent", "overman", "mining sirdar", "sirdar", "shot firer", "shotfirer", "shot-firer",
    "surveyor", "mining mate", "foreman", "blaster", "dump man", "fitter", "electrician",
    "engineer", "electrical supervisor", "competent person", "employer",
    "Chief Inspector", "Inspector", "welfare officer", "medical officer",
    "occupier", "attendance clerk", "banksman", "onsetter", "fire officer",
    "winding engine driver", "contractor", "principal employer",
    "Chief Inspector-cum-Facilitator", "Inspector-cum-Facilitator",
    "appropriate Government", "Central Government",
], key=len, reverse=True)

_ROLE_ALT = "|".join(re.escape(r) for r in ROLES)
# The role as the subject of an obligation: "The shotfirer shall", "the owner,
# agent and manager shall", "it shall be the duty of the manager".
ROLE_RE = re.compile(
    r"\b(?:the|every|each|an?|such)\s+(" + _ROLE_ALT + r")\b[^.;:]{0,50}?\b(?:shall|must|is responsible)"
    r"|\bduty of (?:the|every|each)\s+(" + _ROLE_ALT + r")\b",
    re.I,
)
# Any mention at all. An abstention is only written when this finds nothing -
# otherwise a pattern that missed its phrasing would teach the model to deny a
# responsibility that is in front of it. The first build wrote 62 "does not
# name who is responsible" answers and 42 sat on text naming a role, among
# them "The shotfirer shall", missed because the list said "shot firer".
ANY_ROLE = re.compile(r"\b(" + _ROLE_ALT + r"|officer|supervisor|person in charge)\b", re.I)

NUM = r"(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-eight|twenty-four|sixty|ninety|\d+)"
FREQ_RE = re.compile(
    r"\b("
    r"at least once in every " + NUM + r"? ?(?:days?|weeks?|months?|years?|shifts?|hours?)"
    r"|once in every " + NUM + r"? ?(?:days?|weeks?|months?|years?|shifts?|hours?)"
    r"|at intervals not exceeding " + NUM + r" (?:days|weeks|months|years|hours)"
    # The connector is required but not captured: "within ninety days from"
    # became the answer "Within ninety days from, under Reg. 109".
    r"|within " + NUM + r" (?:days|hours|months|weeks)(?= (?:of|from|after)\b)"
    r"|once (?:a|in a|in each|in every) (?:" + NUM + r" )?(?:days?|weeks?|months?|years?|shifts?)"
    r"|not less than once (?:in|every) (?:every )?(?:" + NUM + r" )?(?:days?|weeks?|months?|years?|shifts?)"
    r"|twice (?:a|in a|in every) (?:days?|weeks?|months?|years?|shifts?)"
    r"|every " + NUM + r" (?:days|weeks|months|years|hours)"
    r"|(?:every|each) (?:shift|day|week|month|year|quarter)"
    r"|daily|weekly|fortnightly|monthly|quarterly|half-yearly|annually"
    r")\b",
    re.I,
)

# Any time wording at all, durations included. An "it does not say how often"
# answer is only written when this finds nothing. The first build wrote 40 of
# them and 27 sat on text containing time wording, some of it genuine
# intervals the frequency pattern had not anticipated.
ANY_TIME = re.compile(
    r"\b(once|twice|every|each|daily|weekly|fortnightly|monthly|annual\w*|yearly|quarter\w*|"
    r"periodic\w*|interval\w*|days?|weeks?|months?|years?|shifts?|hours?|minutes?)\b",
    re.I,
)

SAFETY = re.compile(
    r"ventilat|gas|fire|dust|explosive|shot|roof|support|inundat|water|electric|machin|"
    r"safety|precaution|lighting|haulage|winding|protective|rescue|emergency|danger|"
    r"accident|firedamp|methane|spontaneous|blasting|slope|dump|equipment|health",
    re.I,
)
WORKFLOW = re.compile(
    r"notice|return|register|record|report|inspection|plan|examination|permit|"
    r"registration|licen[cs]|appointment|procedure|approval|intimation|information|"
    r"certificate|application|form|maintenance of|submission|audit|review",
    re.I,
)


def excerpt(text: str, n: int = EXCERPT) -> str:
    """Cut on a clause boundary, never mid-word, so the prompt reads as law."""
    if len(text) <= n:
        return text
    cut = text[:n]
    for sep in ("; ", ". ", ": "):
        k = cut.rfind(sep)
        if k > n * 0.6:
            return cut[: k + 1].strip()
    return cut[: cut.rfind(" ")].strip() + " ..."


def first_requirement(text: str, limit: int = 260) -> str:
    s = re.sub(r"^\(\w{1,3}\)\s*", "", text).strip()
    end = min([i for i in (s.find("; "), s.find(". ")) if i > 30] or [len(s)])
    s = s[: end + 1] if end < len(s) else s
    if len(s) > limit:
        s = s[: s.rfind(" ", 0, limit)].rstrip(",;:- ") + " ..."
    return s.rstrip(";") + ("" if s.endswith((".", "...")) else ".")


def roles_in(text: str) -> list[str]:
    seen: list[str] = []
    for m in ROLE_RE.finditer(text):
        r = m.group(1) or m.group(2)
        canon = next(x for x in ROLES if x.lower() == r.lower())
        if canon not in seen:
            seen.append(canon)
    return seen


def freqs_in(text: str) -> list[str]:
    seen: list[str] = []
    for m in FREQ_RE.finditer(text):
        f = m.group(1).lower()
        if f not in seen:
            seen.append(f)
    return seen


def ex(user: str, assistant: str) -> dict:
    return {"messages": [{"role": "user", "content": user},
                         {"role": "assistant", "content": assistant}]}


def is_test(ref: str) -> bool:
    h = int(hashlib.sha256(ref.encode()).hexdigest()[:8], 16)
    return (h % 1000) / 1000 < TEST_SHARE


def article(term: str) -> str:
    return "an" if term[:1].lower() in "aeiou" else "a"


# ---------------------------------------------------------------------------


def provision_examples(p: dict, abstain_budget: Counter) -> tuple[list[dict], list[dict]]:
    """Training examples and test items for one provision."""
    ref, body = p["ref"], excerpt(p["text"])
    prompt = f"{ref}: {body}\n\n"
    train: list[dict] = []
    tests: list[dict] = []

    # What it requires - the first obligation, copied.
    req = first_requirement(body)
    train.append(ex(prompt + "what does " + ref + " require", f"{req} This is {ref}."))
    # Two separate scores for one question. Citation alone rewarded a model
    # trained to end "This is Reg. X" and failed correct answers that did not
    # repeat the number - Reg. 36 answered "The owner, agent and manager shall
    # provide for the safety and proper discipline of persons employed" and
    # was marked wrong. Content is what the provision actually requires.
    stop = set("the a an of or and in to by any as such which is be for with that under shall "
               "such every all this these those".split())
    content = [w for w in re.findall(r"[a-z]{4,}", req.lower()) if w not in stop][:8]
    tests.append({"prompt": prompt + "what does " + ref + " require", "check": "cites",
                  "expect": [str(p["number"])], "ref": ref, "task": "requires:cites"})
    if len(content) >= 3:
        tests.append({"prompt": prompt + "what does " + ref + " require", "check": "contains_most",
                      "expect": content, "ref": ref, "task": "requires:content"})

    if p.get("heading"):
        h = p["heading"][0].lower() + p["heading"][1:]
        train.append(ex(prompt + "what is this about", f"{ref} is about {h}."))

    # Who is responsible - only from the text shown.
    roles = roles_in(body)
    q = "who is responsible for this"
    if len(roles) == 1:
        train.append(ex(prompt + q, f"The {roles[0]} is responsible under {ref}."))
        tests.append({"prompt": prompt + q, "check": "contains_any", "expect": roles,
                      "ref": ref, "task": "role"})
    elif 2 <= len(roles) <= 3:
        joined = ", the ".join(roles[:-1]) + " and the " + roles[-1]
        train.append(ex(prompt + q, f"{ref} places duties on the {joined}."))
        tests.append({"prompt": prompt + q, "check": "contains_any", "expect": roles,
                      "ref": ref, "task": "role"})
    elif not roles and not ANY_ROLE.search(body) and abstain_budget["role"] > 0:
        abstain_budget["role"] -= 1
        train.append(ex(prompt + q, f"This text of {ref} does not name who is responsible."))

    # How often - copied verbatim, or an honest "it does not say".
    fs = freqs_in(body)
    q = "how often must this be done"
    if fs:
        phrase = fs[0] if len(fs) == 1 else f"{fs[0]}, and {fs[1]}"
        answer = f"{phrase[0].upper() + phrase[1:]}, under {ref}."
        # Three phrasings of the one question. Both models scored 0 of 7 on
        # held-out intervals, and the first retrain answered "how often" with
        # "Yes, under OSH Code 2020 S.26" - fifty positive examples, one
        # wording each, had not taught the shape of the answer.
        for asked in (q, "at what interval is this required", "how frequently does this have to happen"):
            train.append(ex(prompt + asked, answer))
        filler = {"at", "least", "once", "in", "every", "of", "from", "after", "within", "each", "a"}
        # Any interval the provision gives is a right answer, not only the first.
        alternatives = [[w for w in re.findall(r"[a-z0-9-]+", f) if w not in filler] for f in fs]
        tests.append({"prompt": prompt + q, "check": "any_alternative", "expect": alternatives,
                      "ref": ref, "task": "frequency"})
    elif not ANY_TIME.search(body) and abstain_budget["freq"] > 0:
        abstain_budget["freq"] -= 1
        train.append(ex(prompt + q, f"{ref} does not state how often in this text."))
        tests.append({"prompt": prompt + q, "check": "no_invented_interval", "expect": [],
                      "ref": ref, "task": "frequency_abstain"})
    return train, tests


def definition_examples(d: dict) -> tuple[list[dict], list[dict]]:
    ref, term, text = d["ref"], d["term"], d["text"]
    meaning = re.sub(r'^"[^"]+"\s+', "", text).rstrip(";. ")
    prompt = f"{ref}: {text}\n\n"
    a = article(term)
    train = [
        ex(prompt + f"what is {a} {term}", f"Under {ref}, {a} {term} {meaning}."),
        ex(prompt + f"what does {term} mean", f"Under {ref}, \"{term}\" {meaning}."),
    ]
    stop = set("the a an of or and in to by any as such which is be for with that under".split())
    key = [w for w in re.findall(r"[a-z]{4,}", meaning.lower()) if w not in stop][:6]
    tests = [{"prompt": prompt + f"what is {a} {term}", "check": "contains_most",
              "expect": key, "ref": ref, "task": "definition"}]
    return train, tests


def no_source_examples(provisions: list[dict], n: int = 120) -> list[dict]:
    """A reference named with no text behind it: decline to quote from memory.

    Added after the first retrain, which read held-out law far better and had
    also learned that every answer ends in a citation. Asked plain questions,
    it cited laws that do not exist - "Yes, under the Digital Services Act,
    2019". Every statute example it had seen carried its text in the prompt,
    so it had never once been shown what to do when there was none. These
    show it: name what is missing, and say where to get it.
    """
    out = []
    picks = random.sample(provisions, min(n, len(provisions)))
    for i, p in enumerate(picks):
        ref = p["ref"]
        q = [f"what does {ref} require", f"who is responsible under {ref}",
             f"how often does {ref} require it", f"explain {ref}"][i % 4]
        out.append(ex(q, f"I don't have the text of {ref} in front of me, so I won't quote it "
                         f"from memory. Open it in the Rulebook and ask again."))
    return out


def categorised(provisions: list[dict], definitions: list[dict]) -> dict[str, list[dict]]:
    """The four hundred category questions: mine, security, workflow, structure.

    Each is grounded like everything else - the provision or definition is in
    the prompt - and phrased the way a person in that role would ask, so the
    same law is met from four directions rather than one.
    """
    out: dict[str, list[dict]] = {"mine": [], "security": [], "workflow": [], "structure": []}

    for d in definitions:
        if len(out["structure"]) >= 100:
            break
        meaning = re.sub(r'^"[^"]+"\s+', "", d["text"]).rstrip(";. ")
        a = article(d["term"])
        q = random.choice([
            f"in a mine, what counts as {a} {d['term']}",
            f"how does the law define {a} {d['term']}",
            f"explain the term {d['term']}",
        ])
        out["structure"].append(ex(f"{d['ref']}: {d['text']}\n\n{q}",
                                   f"Under {d['ref']}, {a} {d['term']} {meaning}."))

    random.shuffle(provisions)
    for p in provisions:
        head = (p.get("heading") or "")
        body = excerpt(p["text"])
        prompt = f"{p['ref']}: {body}\n\n"
        req = first_requirement(body)
        topic = head[0].lower() + head[1:] if head else None
        if len(out["security"]) < 100 and SAFETY.search(head + " " + (p.get("chapter") or "")):
            q = f"what safety precaution does this set for {topic}" if topic else "what safety precaution does this set"
            out["security"].append(ex(prompt + q, f"{req} This is {p['ref']}."))
        elif len(out["workflow"]) < 100 and WORKFLOW.search(head + " " + (p.get("chapter") or "")):
            q = f"what is the procedure for {topic}" if topic else "what procedure does this set out"
            out["workflow"].append(ex(prompt + q, f"{req} This is {p['ref']}."))
        elif len(out["mine"]) < 100 and re.search(r"\bmines?\b", body, re.I):
            q = random.choice([
                "what must a mine do under this",
                "how does this apply to a coal mine",
                "what does this require of the mine",
            ])
            out["mine"].append(ex(prompt + q, f"{req} This is {p['ref']}."))
    return out


def main() -> None:
    units = [json.loads(l) for l in SRC.read_text(encoding="utf-8").splitlines() if l.strip()]
    provisions = [u for u in units if u["kind"] == "provision"]
    definitions = [u for u in units if u["kind"] == "definition"]

    train_p = [p for p in provisions if not is_test(p["ref"])]
    test_p = [p for p in provisions if is_test(p["ref"])]
    train_d = [d for d in definitions if not is_test(d["ref"])]
    test_d = [d for d in definitions if is_test(d["ref"])]

    # Abstentions capped near the positives they sit beside.
    pos_freq = sum(1 for p in train_p if freqs_in(excerpt(p["text"])))
    pos_role = sum(1 for p in train_p if roles_in(excerpt(p["text"])))
    budget = Counter(freq=pos_freq, role=pos_role // 2)

    parts: dict[str, list[dict]] = {"provision": [], "definition": []}
    tests: list[dict] = []
    for p in train_p:
        tr, _ = provision_examples(p, budget)
        parts["provision"] += tr
    for d in train_d:
        tr, _ = definition_examples(d)
        parts["definition"] += tr

    test_budget = Counter(freq=10**6, role=10**6)
    for p in test_p:
        _, te = provision_examples(p, test_budget)
        tests += te
    for d in test_d:
        _, te = definition_examples(d)
        tests += te

    cats = categorised(list(train_p), list(train_d))
    for name, items in cats.items():
        parts[f"category:{name}"] = items
    parts["no-source"] = no_source_examples(list(train_p))

    statute_rows = [r for items in parts.values() for r in items]
    random.shuffle(statute_rows)

    # The examples the current model was trained on, all of them, with the
    # ones that carry the app's own behaviour repeated to hold their share.
    old = [json.loads(l) for l in OLD.read_text(encoding="utf-8").splitlines() if l.strip()]
    clause_like = re.compile(r"^[A-Z][^\n]{2,60}(?:S\.|R\.|Reg\.|Form|Section)[^\n]*:\s")
    behaviour = [r for r in old if not clause_like.match(r["messages"][0]["content"])]
    # Six, up from three. At three, statute examples still taught the model
    # that every answer ends in a citation; the app's own answers - "No. It
    # runs entirely on this device" - need the weight to hold their style.
    repeats = 6
    full = old + behaviour * (repeats - 1) + statute_rows
    random.shuffle(full)

    for path, rows in ((TRAIN_OUT, statute_rows), (TEST_OUT, tests), (FULL_OUT, full)):
        path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")

    print("  statute training examples")
    for name, items in parts.items():
        print(f"    {len(items):>5}  {name}")
    print(f"    {len(statute_rows):>5}  total")
    print(f"  held out: {len(test_p)} provisions + {len(test_d)} definitions -> {len(tests)} test questions")
    print(f"    by task: {dict(Counter(t['task'] for t in tests))}")
    print(f"  old examples: {len(old)} (behaviour examples x{repeats}: {len(behaviour)})")
    share = len(statute_rows) / len(full)
    print(f"  full set: {len(full)} examples, {share:.0%} statute  -> {FULL_OUT.relative_to(ROOT)} "
          f"({FULL_OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
