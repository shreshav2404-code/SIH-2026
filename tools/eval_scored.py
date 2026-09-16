"""Score models on questions they were never trained on, and compare them.

    .venv-train/Scripts/python tools/eval_scored.py models/a.gguf models/b.gguf

tools/eval.py prints answers for a person to read, and says why: with a small
corpus any score is self-flattering. That holds for questions drawn from the
training data. It does not hold here - every provision in
data/statutes-test.jsonl was held out of training entirely - so these answers
CAN be scored, and a new model can be shipped on evidence rather than on a
reading of a dozen answers.

Two batteries:

  HELD-OUT   125 questions on 57 provisions and 19 definitions the model has
             never seen. Can it read law it was not taught?
  BEHAVIOUR  the app's own behaviour, which a statute-heavy retrain could
             break: ledger answers, system facts, and unrelated questions. The
             first training round, heavy on clauses, answered "does this need
             internet" by citing a lease boundary. That regression is what
             this battery exists to catch.

Every check is mechanical and printed with the answer, so a pass can be read
and disagreed with. Greedy decoding (temperature 0) so a rerun gives the same
score.

WHY llama-server AND NOT llama-cli. The first version passed each prompt to
llama-cli on the command line. Windows converted the argument through the
console code page, so "CMR 2017 · Reg. 153" reached the model as
"CMR 2017 Â· Reg. 153" - and the echo filter, comparing against the
unmangled prompt, no longer recognised llama-cli's echo of it. The prompt was
then scored AS the answer, which would have passed every "does it cite the
regulation" check on its own. The server takes UTF-8 JSON, applies the chat
template exactly as the app does, and returns only the reply.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "tools" / "llama-bin" / "llama-server.exe"
PORT = 8089
TESTS = ROOT / "data" / "statutes-test.jsonl"

INTERVAL = re.compile(
    r"\b(daily|weekly|fortnightly|monthly|quarterly|annually|yearly|half-yearly|"
    r"once|twice|every (?:day|week|month|year|shift)|"
    r"\d+\s*(?:days?|weeks?|months?|years?|hours?)|"
    r"(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|thirty|ninety)\s+(?:days?|weeks?|months?|years?|hours?))\b",
    re.I,
)
STATUTE = re.compile(r"\b(Reg\.|Regulation|Mines Act|CMR|OSH|Rule \d|R\. \d|S\.\s?\d|section \d)", re.I)

BEHAVIOUR = [
    # (task, prompt, check, expect)
    ("ledger",
     "OVERDUE (2):\n  - Overtime register, owned by Mine Manager, due 2026-08-29\n"
     "  - Statutory registers maintained, owned by Mine Manager, due 2026-08-29\n\n"
     "2 of the duties listed are OVERDUE.\n\nwhat is overdue and who owns it",
     "contains_all", ["overtime", "registers", "mine manager"]),
    ("ledger",
     "OVERDUE (1):\n  - Safety Committee meeting and minutes, owned by Safety Officer, "
     "due 2026-09-02\n\n1 of the duties listed are OVERDUE.\n\nwho owns the overdue duty",
     "contains_all", ["safety officer"]),
    ("clause",
     "Mines Act 1952 - S.17: Every mine must have a sole manager holding the "
     "prescribed statutory qualifications.\n\nwho is responsible for this",
     "contains_any", ["manager"]),
    ("system", "does this need internet", "not_yes_and_any", ["no", "offline", "device", "phone"]),
    ("system", "can this file a statutory return", "not_yes_and_any", ["no", "cannot", "sign", "officer"]),
    ("system", "where does the AI run", "contains_any", ["device", "phone"]),
    ("system", "what is ANUPALAN", "contains_any", ["compliance"]),
    ("system", "who are you", "contains_any", ["assistant", "anupalan"]),
    ("unrelated", "what is the capital of France", "no_statute", []),
    ("unrelated", "write me a poem about the sea", "no_statute", []),
    ("unrelated", "what is 17 times 23", "no_statute", []),
    ("unrelated", "who won the world cup in 2018", "no_statute", []),
]


class Model:
    """One llama-server per model, started once and stopped when done."""

    def __init__(self, path: Path):
        self.path = path
        self.proc = subprocess.Popen(
            [str(SERVER), "-m", str(path), "--port", str(PORT), "-ngl", "0",
             "-c", "2048", "--log-disable"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for _ in range(120):
            try:
                if b"ok" in urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2).read():
                    return
            except Exception:  # noqa: BLE001 - not up yet
                time.sleep(1)
        self.close()
        raise SystemExit(f"llama-server did not start for {path}")

    def ask(self, prompt: str, n: int = 90) -> str:
        body = {
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "max_tokens": n,
            # NO repetition penalty, matching llm.ts and tools/eval.py for this
            # model: it answers by quoting its prompt.
            "repeat_penalty": 1.0,
        }
        req = urllib.request.Request(
            f"http://127.0.0.1:{PORT}/v1/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        reply = json.loads(urllib.request.urlopen(req, timeout=300).read())
        return (reply["choices"][0]["message"]["content"] or "").strip()

    def close(self) -> None:
        self.proc.kill()
        self.proc.wait(timeout=30)


# A named law in an answer: "Digital Services Act, 2019", "Mines Rules 1955".
LAW = re.compile(
    r"\b((?:[A-Z][A-Za-z()'’-]+\s){1,7}(?:Act|Rules|Regulations|Code))\s*,?\s*(\d{4})\b"
)


def invented_laws(prompt: str, answer: str) -> list[str]:
    """Laws named in the answer that appear nowhere in the prompt.

    Added after the first retrain. Asked "does this need internet" with no
    text in front of it, the new model answered "Yes, under the Digital
    Services Act, 2019"; asked whether the app can file a return, "Yes, under
    the Merchant Recommender Act, 2009". Neither Act exists. The behaviour
    battery scored those as ordinary wrong answers and the table showed
    behaviour IMPROVING - so every answer, on every task, is now checked for
    a law it could only have made up.
    """
    p = prompt.lower()
    out = []
    for m in LAW.finditer(answer):
        name = m.group(1).strip().lower()
        core = re.sub(r"^(the|under|of|in)\s+", "", name)
        if core not in p and m.group(2) not in p:
            out.append(f"{m.group(1).strip()}, {m.group(2)}")
    return out


def app_style_behaviour() -> list[tuple[str, str, str, list[str]]]:
    """System questions asked the way the app asks them: fact first.

    facts.ts retrieves the relevant fact and puts it in front of the question,
    so a raw "does this need internet" is not what the model meets on the
    phone. These use the same fact/question/answer triples the model is
    trained on (tools/build_dataset.py SYSTEM_QA) and check the polarity of
    the answer - a "No" that comes back "Yes" is a false statement about the
    software, whatever else the sentence says.
    """
    sys.path.insert(0, str(ROOT / "tools"))
    from build_dataset import SYSTEM_QA  # noqa: E402

    items = []
    for q, fact, answer in SYSTEM_QA:
        word = answer.split()[0].rstrip(".,-").lower()
        if word in ("yes", "no"):
            items.append(("app-system", f"{fact}\n\n{q}", "starts_with", [word]))
        else:
            keys = [w for w in re.findall(r"[a-z]{5,}", answer.lower())][:4]
            items.append(("app-system", f"{fact}\n\n{q}", "contains_most", keys))
    return items


def passes(check: str, expect: list[str], answer: str) -> bool:
    a = answer.lower()
    if check == "cites":
        return any(re.search(rf"\b{re.escape(e)}\b", a) for e in expect)
    if check == "contains_any":
        return any(e.lower() in a for e in expect)
    if check == "contains_all":
        return all(e.lower() in a for e in expect)
    if check == "any_alternative":
        # Several intervals in one provision: naming any of them is right.
        return any(alt and all(w.lower() in a for w in alt) for alt in expect)
    if check == "contains_most":
        return bool(expect) and sum(e.lower() in a for e in expect) / len(expect) >= 0.5
    if check == "no_invented_interval":
        return not INTERVAL.search(answer)
    if check == "not_yes_and_any":
        return not a.lstrip().startswith("yes") and any(re.search(rf"\b{re.escape(e)}\b", a) for e in expect)
    if check == "no_statute":
        return not STATUTE.search(answer)
    if check == "starts_with":
        return a.lstrip(" \"'*").startswith(expect[0])
    raise ValueError(check)


def score(path: Path, verbose: bool) -> dict[str, list[bool]]:
    tests = [json.loads(l) for l in TESTS.read_text(encoding="utf-8").splitlines() if l.strip()]
    results: dict[str, list[bool]] = defaultdict(list)
    items = [(f"held-out:{t['task']}", t["prompt"], t["check"], t["expect"]) for t in tests]
    items += [(f"behaviour:{task}", p, c, e) for task, p, c, e in BEHAVIOUR]
    items += [(f"behaviour:{task}", p, c, e) for task, p, c, e in app_style_behaviour()]
    model = Model(path)
    try:
        return _run(model, items, results, verbose)
    finally:
        model.close()


def _run(model: "Model", items: list, results: dict[str, list[bool]], verbose: bool) -> dict[str, list[bool]]:
    for i, (task, prompt, check, expect) in enumerate(items, 1):
        answer = model.ask(prompt)
        ok = passes(check, expect, answer)
        results[task].append(ok)
        made_up = invented_laws(prompt, answer)
        results["integrity:no_invented_law"].append(not made_up)
        if made_up:
            print(f"  [{i:>3}/{len(items)}] INVENTED LAW {made_up} in answer to: {prompt.splitlines()[-1][:50]}")
        if verbose or not ok:
            q = prompt.splitlines()[-1][:60]
            print(f"  [{i:>3}/{len(items)}] {'PASS' if ok else 'FAIL'} {task:<28} {q}")
            print(f"            A: {answer[:180]}")
    return results


def main() -> None:
    models = [Path(a) for a in sys.argv[1:] if not a.startswith("--")]
    verbose = "--verbose" in sys.argv
    if not models:
        sys.exit(__doc__)
    table: dict[str, dict[str, list[bool]]] = {}
    for m in models:
        print(f"\n{'=' * 78}\n{m.name}\n{'=' * 78}")
        table[m.name] = score(m, verbose)
        out = ROOT / "out" / f"eval-{m.stem}.json"
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps({k: v for k, v in table[m.name].items()}, indent=1), encoding="utf-8")

    tasks = sorted({t for r in table.values() for t in r})
    names = list(table)
    print(f"\n{'task':<30}" + "".join(f"{n[:24]:>26}" for n in names))
    for t in tasks:
        row = ""
        for n in names:
            r = table[n].get(t, [])
            row += f"{sum(r):>13}/{len(r):<3} {100 * sum(r) / max(len(r), 1):>5.0f}%   "
        print(f"{t:<30}{row}")
    for n in names:
        held = [x for t, r in table[n].items() if t.startswith("held-out") for x in r]
        beh = [x for t, r in table[n].items() if t.startswith("behaviour") for x in r]
        clean = table[n].get("integrity:no_invented_law", [])
        print(f"\n  {n}: held-out {sum(held)}/{len(held)} ({100 * sum(held) / len(held):.0f}%), "
              f"behaviour {sum(beh)}/{len(beh)} ({100 * sum(beh) / len(beh):.0f}%), "
              f"answers inventing a law {len(clean) - sum(clean)}/{len(clean)}")


if __name__ == "__main__":
    main()
