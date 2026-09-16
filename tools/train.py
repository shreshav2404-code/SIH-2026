"""Fine-tune the on-device model on this mine's own corpus.

Runs on the laptop's GPU. Nothing is uploaded: the training data is built from
the clause corpus, the seeded ledger and this repository's documentation, and
the weights never leave the machine. That is the same premise as the rest of
the project - the model runs on hardware you own, at no cost.

    .venv-train/Scripts/python tools/train.py

Base model is Gemma 3 270M. Google positions it as a specialisation base
rather than a usable chat model, which is exactly the job here: it is not
meant to be good raw, it is meant to be taught one thing thoroughly. At 270M
every weight fits in 6 GB of VRAM, so this is a FULL fine-tune rather than a
LoRA adapter - the whole model learns, not a low-rank correction to it.

Afterwards, convert and quantise:

    python tools/pad_vocab.py out/gemma-anupalan-v3 out/gemma-anupalan-v3-conv
    python convert_hf_to_gguf.py out/gemma-anupalan-v3-conv --outtype f16 --outfile g.gguf
    llama-quantize g.gguf gemma-anupalan-v3-Q8_0.gguf Q8_0

Q8_0, not Q4_0: at Q4_0 the v3 weights contradicted the facts in their own
prompt (see the tuned entry in mobile/src/lib/modelSource.ts).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from datasets import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "anupalan-full.jsonl"
OUT = ROOT / "out" / "gemma-anupalan"

BASE = "google/gemma-3-270m-it"


def main() -> None:
    # Overridable so tools/sweep.py can walk a grid without editing this file.
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--lr", type=float, default=5e-5)
    # Both overridable so a new model trains BESIDE the one on the phone
    # rather than over it. The shipped model is only replaced after the new
    # one has beaten it on tools/eval_scored.py.
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--out", type=Path, default=OUT)
    cli = ap.parse_args()

    if not torch.cuda.is_available():
        raise SystemExit("No CUDA device. This needs the GPU build of torch.")
    print(f"  device: {torch.cuda.get_device_name(0)}")

    rows = [json.loads(l) for l in cli.data.read_text(encoding="utf-8").splitlines() if l.strip()]
    print(f"  {len(rows)} training examples from {cli.data.name}")

    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForCausalLM.from_pretrained(
        BASE,
        dtype=torch.bfloat16,
        attn_implementation="eager",  # Gemma 3 wants eager attention
    ).to("cuda")

    def render(ex: dict) -> dict:
        # The tokenizer's own chat template, so training sees exactly the
        # formatting llama.cpp will apply at inference. Training on a
        # different shape teaches a job the model will never be asked to do.
        return {"text": tok.apply_chat_template(ex["messages"], tokenize=False)}

    ds = Dataset.from_list(rows).map(render, remove_columns=["messages"])
    print("  sample:\n" + "\n".join("    " + l for l in ds[0]["text"].splitlines()[:6]))

    trainer = SFTTrainer(
        model=model,
        train_dataset=ds,
        args=SFTConfig(
            output_dir=str(cli.out),
            per_device_train_batch_size=4,
            gradient_accumulation_steps=4,
            num_train_epochs=cli.epochs,
            learning_rate=cli.lr,
            warmup_steps=20,
            lr_scheduler_type="cosine",
            logging_steps=10,
            save_strategy="no",
            bf16=True,
            max_length=1024,
            report_to=[],
        ),
    )
    trainer.train()

    cli.out.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(cli.out))
    tok.save_pretrained(str(cli.out))
    print(f"  saved -> {cli.out}")


if __name__ == "__main__":
    main()
