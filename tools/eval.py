"""Ask the tuned model a fixed battery of questions and print what it says.

Run after every training round. The point is not a score - with a corpus this
small any number would be self-flattering - but to read the answers and see
which categories have actually been learned and which are still invented.

    .venv-train/Scripts/python tools/eval.py

Questions are split into three groups on purpose:

  GROUNDED   the clause or the rows are in the prompt. The model only has to
             read and phrase. This should be near-perfect.
  RECALL     the answer is a fact about this system that is NOT in the prompt.
             The model has to remember it. This is where the first training
             round failed - "does this need internet" came back "Yes".
  UNRELATED  nothing to do with the mine. A specialised model is allowed to be
             weak here, but it must not answer confidently with invented
             statute, which is the failure that would matter in the field.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# The Windows console is cp1252, and a quantised model occasionally emits a
# byte that decodes to U+FFFD. Printing that raised UnicodeEncodeError and
# killed the run outright - which is what made sweep.py appear to "die
# silently" twice: the crash came from print(), outside the try that guards a
# bad training round. Force UTF-8 on the way out instead.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / "tools" / "llama-bin" / "llama-cli.exe"
MODEL = ROOT / "models" / "gemma-anupalan-Q4_0.gguf"

GROUNDED = [
    ("Mines Act 1952 - S.17: Every mine must have a sole manager holding the "
     "prescribed statutory qualifications.\n\nwho is responsible for this"),
    ("Mines Act 1952 - S.17: Every mine must have a sole manager holding the "
     "prescribed statutory qualifications.\n\nwhat does Mines Act 1952 - S.17 require"),
    ("OVERDUE (2):\n  - Overtime register, owned by Mine Manager, due 2026-08-29\n"
     "  - Statutory registers maintained, owned by Mine Manager, due 2026-08-29\n\n"
     "2 of the duties listed are OVERDUE.\n\nwhat is overdue and who owns it"),
    ("OVERDUE (1):\n  - Safety Committee meeting and minutes, owned by Safety Officer, "
     "due 2026-09-02\n\n1 of the duties listed are OVERDUE.\n\nwho owns the overdue duty"),
]

RECALL = [
    "what is ANUPALAN",
    "does this need internet",
    "where does the AI run",
    "what is the hash chain",
    "can this file a statutory return",
    "what decides whether a reading is a breach",
    "how is the risk score calculated",
    "who are you",
    "what can you do",
    "how do you check if work happened inside the lease",
]

UNRELATED = [
    "what is the capital of France",
    "write me a poem about the sea",
    "what is 17 times 23",
    "who won the world cup in 2018",
]


def ask(q: str, n: int = 70) -> str:
    out = subprocess.run(
        [str(CLI), "-m", str(MODEL), "-p", q, "-n", str(n),
         "--temp", "0.2", "--single-turn",
         # NO repetition penalty, matching llm.ts for this model.
         #
         # A penalty was tried here and measured strictly worse at every level.
         # 1.0 answered all four grounded probes correctly; 1.05 already
         # miscounted ("4 duties are overdue" from a two-row prompt); 1.15
         # produced multilingual noise. The reason is structural rather than a
         # bad hyperparameter: this model answers by QUOTING the facts placed
         # in its prompt, and a repetition penalty is a penalty on quoting.
         "--repeat-penalty", "1.0"],
        capture_output=True, text=True, errors="replace", timeout=180,
    ).stdout
    # llama-cli echoes the prompt after "> "; the reply is what follows.
    if "\n> " in out:
        tail = out.split("\n> ", 1)[1]
    else:
        tail = out
    lines = [
        l for l in tail.splitlines()
        if l.strip() and not l.startswith("[ Prompt") and "Exiting" not in l
    ]
    # drop the echoed question itself
    # Both sides stripped. Comparing a stripped output line against an
    # UNSTRIPPED prompt line never matched for the indented ledger rows,
    # so llama-cli's own prompt echo was being read as model output - and
    # very nearly diagnosed as the model repeating itself.
    echoed = {l.strip() for l in q.splitlines()}
    body = [l for l in lines if l.strip() not in echoed]
    return " ".join(body).strip()[:300]


def main() -> None:
    if not MODEL.exists():
        sys.exit(f"no model at {MODEL}")
    for name, qs in (("GROUNDED", GROUNDED), ("RECALL", RECALL), ("UNRELATED", UNRELATED)):
        print(f"\n{'=' * 70}\n{name}\n{'=' * 70}")
        for q in qs:
            label = q.splitlines()[-1][:64]
            print(f"\n  Q: {label}")
            print(f"  A: {ask(q)}")


if __name__ == "__main__":
    main()
