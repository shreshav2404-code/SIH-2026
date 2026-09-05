"""Train, convert, quantise and score - repeatedly, keeping the best.

Fine-tuning a model this small is not a single run. The first three rounds
here each failed differently: clause examples drowned everything else, then
answers were too long to memorise, then a yes/no prior refused to shift. Each
was only visible by reading the answers afterwards, so this automates the loop
and scores it rather than trusting an impression.

    .venv-train/Scripts/python tools/sweep.py

Scoring is keyword-based and deliberately crude. It cannot tell a good
sentence from an awkward one, but it reliably catches the failures that matter:
an answer that says "Yes" where the truth is "No", or that names a role the
ledger never mentioned. The best checkpoint by score is kept at
models/gemma-anupalan-Q4_0.gguf and the rest are discarded.
"""

from __future__ import annotations

import json
import shutil
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
PY = ROOT / ".venv-train" / "Scripts" / "python.exe"
CLI = ROOT / "tools" / "llama-bin" / "llama-cli.exe"
QUANT = ROOT / "tools" / "llama-bin" / "llama-quantize.exe"
CONV = ROOT / "tools" / "llama.cpp" / "convert_hf_to_gguf.py"
HF = ROOT / "out" / "gemma-anupalan"
F16 = ROOT / "out" / "gemma-anupalan-f16.gguf"
GGUF = ROOT / "models" / "gemma-anupalan-Q4_0.gguf"
BEST = ROOT / "out" / "best-score.json"

# (prompt, must-contain, must-NOT-contain)
#
# The negatives carry most of the value. "does this need internet" answered
# "Yes" through three rounds, and only a must-not check makes that visible
# without reading every transcript.
CHECKS: list[tuple[str, list[str], list[str]]] = [
    (
        "ANUPALAN runs its language model entirely on this device. It needs no internet, "
        "no server and no cloud, and it answers in airplane mode.\n\ndoes this need internet",
        ["no"], ["yes."],
    ),
    (
        "This system never files anything. It drafts returns and stamps them DRAFT - NOT "
        "FILED.\n\ncan this file a statutory return",
        ["no", "draft"], ["yes."],
    ),
    (
        "Mines Act 1952 - S.17: Every mine must have a sole manager holding the prescribed "
        "statutory qualifications.\n\nwhat does Mines Act 1952 - S.17 require",
        ["sole manager", "s.17"], [],
    ),
    (
        "OVERDUE (2):\n  - Overtime register, owned by Mine Manager, due 2026-08-29\n"
        "  - Safety Committee meeting and minutes, owned by Safety Officer, due 2026-09-02\n\n"
        "2 of the duties listed are OVERDUE.\n\nwhat is overdue and who owns it",
        ["overtime register", "mine manager", "safety officer"], [],
    ),
    (
        "Breach detection is arithmetic, not the model. A rolling mean and a z-score are "
        "compared against a static threshold table.\n\nwhat decides whether a reading is a breach",
        ["arithmetic", "threshold"], [],
    ),
    (
        "Every evidence record stores the previous record's hash for that mine, forming a "
        "chain.\n\nwhat is the hash chain",
        ["hash"], [],
    ),
    (
        "You can ask what is overdue and who owns it, what a particular clause requires, or "
        "what a sensor reading means.\n\nhow can you help me understand this app",
        ["overdue", "clause"], [],
    ),
    ("hi", ["hello"], []),
]


def ask(prompt: str, n: int = 60) -> str:
    out = subprocess.run(
        [str(CLI), "-m", str(GGUF), "-p", prompt, "-n", str(n),
         "--temp", "0.1", "--single-turn"],
        capture_output=True, text=True, errors="replace", timeout=180,
    ).stdout
    tail = out.split("\n> ", 1)[1] if "\n> " in out else out
    lines = [
        l for l in tail.splitlines()
        if l.strip() and not l.startswith("[ Prompt") and "Exiting" not in l
    ]
    echoed = {l.strip() for l in prompt.splitlines()}
    body = [l for l in lines if l.strip() not in echoed]
    return " ".join(body).strip().lower()


def score() -> tuple[float, list[str]]:
    hits, total, notes = 0.0, 0, []
    for prompt, must, mustnot in CHECKS:
        a = ask(prompt)
        ok = all(m in a for m in must) and not any(m in a for m in mustnot)
        hits += 1 if ok else 0
        total += 1
        label = prompt.splitlines()[-1][:48]
        notes.append(f"    {'PASS' if ok else 'FAIL'}  {label}  ->  {a[:110]}")
    return hits / max(total, 1), notes


def train(epochs: int, lr: float) -> None:
    if HF.exists():
        shutil.rmtree(HF)
    env_args = [str(PY), str(ROOT / "tools" / "train.py")]
    subprocess.run(env_args + [f"--epochs={epochs}", f"--lr={lr}"], check=True)


def convert() -> None:
    for f in (F16, GGUF):
        if f.exists():
            f.unlink()
    subprocess.run(
        [str(PY), "-c",
         "import torch;from transformers import AutoModelForCausalLM,AutoTokenizer;"
         f"t=AutoTokenizer.from_pretrained(r'{HF}');"
         f"m=AutoModelForCausalLM.from_pretrained(r'{HF}',dtype=torch.bfloat16);"
         f"m.resize_token_embeddings(len(t));m.save_pretrained(r'{HF}')"],
        check=True, capture_output=True,
    )
    subprocess.run([str(PY), str(CONV), str(HF), "--outtype", "f16",
                    "--outfile", str(F16)], check=True, capture_output=True)
    subprocess.run([str(QUANT), str(F16), str(GGUF), "Q4_0"],
                   check=True, capture_output=True)


def main() -> None:
    # Ordered by how likely each is to help, so a good result arrives early.
    grid = [
        (6, 5e-5), (10, 5e-5), (10, 1e-4), (16, 1e-4),
        (16, 5e-5), (24, 1e-4), (24, 2e-4), (32, 1e-4),
    ]
    best = -1.0
    keep = ROOT / "out" / "gemma-anupalan-BEST.gguf"

    for i, (ep, lr) in enumerate(grid, 1):
        print(f"\n{'=' * 70}\nround {i}/{len(grid)}  epochs={ep}  lr={lr}\n{'=' * 70}")
        try:
            train(ep, lr)
            convert()
            s, notes = score()
        except Exception as e:  # a bad rung must not end the sweep
            print(f"  round failed: {e}")
            continue
        print(f"  score {s:.0%}")
        for n in notes:
            print(n)
        if s > best:
            best = s
            shutil.copy(GGUF, keep)
            BEST.write_text(json.dumps({"score": s, "epochs": ep, "lr": lr}), encoding="utf-8")
            print(f"  -> new best ({s:.0%}), kept")
        if s == 1.0:
            print("  all checks pass; stopping early")
            break

    if keep.exists():
        shutil.copy(keep, GGUF)
    print(f"\n  BEST: {best:.0%}  ->  {GGUF}")


if __name__ == "__main__":
    sys.exit(main())
