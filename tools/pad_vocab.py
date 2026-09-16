"""Copy a Gemma 3 270M checkpoint with embeddings padded 262144 -> 262145.

    .venv-train/Scripts/python tools/pad_vocab.py out/gemma-anupalan-v3 out/gemma-anupalan-v3-conv
    .venv-train/Scripts/python tools/llama.cpp/convert_hf_to_gguf.py out/gemma-anupalan-v3-conv \
        --outtype f16 --outfile out/gemma-anupalan-v3-f16.gguf
    tools/llama-bin/llama-quantize out/gemma-anupalan-v3-f16.gguf models/gemma-anupalan-v3-Q4_0.gguf Q4_0


The GGUF converter's vocab includes <image_soft_token> at id 262144, one past
the text model's embedding table. The new row is the mean embedding; the
token is never produced by a text-only model.
"""
import json, shutil, sys
from pathlib import Path
import torch
from safetensors.torch import load_file, save_file

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
for f in src.iterdir():
    if f.name not in ("model.safetensors", "config.json", "training_args.bin"):
        shutil.copy2(f, dst / f.name)
sd = load_file(src / "model.safetensors")
for k, v in sd.items():
    if v.dim() == 2 and v.shape[0] == 262144:
        sd[k] = torch.cat([v, v.mean(0, keepdim=True)], 0).contiguous()
        print("padded", k, tuple(sd[k].shape))
save_file(sd, dst / "model.safetensors", metadata={"format": "pt"})
cfg = json.loads((src / "config.json").read_text())
tc = cfg.get("text_config", cfg)
tc["vocab_size"] = 262145
(dst / "config.json").write_text(json.dumps(cfg, indent=2))
print("vocab_size ->", tc["vocab_size"])
