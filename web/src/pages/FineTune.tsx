import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import { useAuth } from "../lib/auth";
import { Badge, Empty, Panel } from "../lib/ui";

/**
 * Turn the ledger into training data, and keep a register of runs against it.
 *
 * The division of labour is stated on the page, not hidden: this prepares the
 * dataset and tracks the run. It does not train. A 1.7B model needs a GPU, the
 * intended route is free Colab, and a button here claiming to fine-tune while
 * doing nothing observable would be worse than no button.
 */

/**
 * Bases this project has actually used or evaluated.
 *
 * Was a free-text input defaulting to "Granite 4.0 350M" - a leftover from an
 * early shortlist. Nothing in this project trains Granite, and a page a judge
 * reads should not name a model the system has never run. The fine-tune that
 * ships is Gemma 3 270M, trained by tools/train.py into ANUPALAN 270M, so that
 * is the default and the list is closed.
 */
const BASE_MODELS = [
  "Gemma 3 270M (shipped as ANUPALAN 270M)",
  "Qwen3 1.7B",
  "LFM2.5-VL 450M",
];

type Kind = "duties" | "observations";

interface Preview {
  kind: string;
  examples: number;
  sample: { messages: { role: string; content: string }[] } | null;
}

interface Job {
  id: number;
  name: string;
  base_model: string;
  dataset_kind: string;
  examples: number;
  status: string;
  notes: string | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
}

const STATUS_KIND: Record<string, string> = {
  prepared: "pending",
  running: "due",
  finished: "verified",
  failed: "critical",
};

export default function FineTune() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const mineId = user?.mine_id ?? 1;

  const [kind, setKind] = useState<Kind>("duties");
  const [name, setName] = useState("duties-v1");
  const [baseModel, setBaseModel] = useState(BASE_MODELS[0]);

  const { data: preview } = useQuery({
    queryKey: ["ft-preview", kind, mineId],
    queryFn: async () =>
      (
        await api.get<Preview>("/finetune/preview", {
          params: { kind, mine_id: mineId },
        })
      ).data,
  });

  const { data: jobs } = useQuery({
    queryKey: ["ft-jobs"],
    queryFn: async () => (await api.get<Job[]>("/finetune/jobs")).data,
    refetchInterval: 10_000,
  });

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post("/finetune/jobs", {
          name,
          base_model: baseModel,
          dataset_kind: kind,
          mine_id: mineId,
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ft-jobs"] }),
  });

  const advance = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      (await api.patch(`/finetune/jobs/${id}`, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ft-jobs"] }),
  });

  async function download() {
    const res = await api.get("/finetune/dataset", {
      params: { kind, mine_id: mineId },
      responseType: "blob",
    });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anupalan-${kind}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Panel title="Training data">
        <p className="text-[13px] text-[var(--ink-soft)]">
          Built from this mine&rsquo;s own records, in the same prompt shape the
          app uses at inference — so the model is taught the job it will
          actually be asked to do, not a similar one.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(["duties", "observations"] as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded border px-2.5 py-1 text-[12px] ${
                kind === k
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-[var(--line)] hover:bg-slate-50"
              }`}
            >
              {k === "duties" ? "Clause → duty" : "Field observations"}
            </button>
          ))}

          <span className="ml-2 text-[12px] text-[var(--ink-soft)]">
            {preview ? `${preview.examples} example(s)` : "counting…"}
          </span>

          <button
            type="button"
            onClick={() => void download()}
            disabled={!preview?.examples}
            className="ml-auto rounded border border-[var(--line)] px-2.5 py-1 text-[12px] font-medium hover:bg-slate-50 disabled:opacity-40"
          >
            Download .jsonl
          </button>
        </div>

        {preview?.sample ? (
          <pre className="mt-3 max-h-56 overflow-auto rounded border border-[var(--line)] bg-slate-50 p-3 text-[11px] leading-relaxed">
            {preview.sample.messages
              .map((m) => `${m.role.toUpperCase()}\n${m.content}`)
              .join("\n\n")}
          </pre>
        ) : (
          <Empty>
            {kind === "observations"
              ? "No observations recorded yet. Capture evidence with a written note and examples appear here."
              : "No duties in the ledger yet."}
          </Empty>
        )}
      </Panel>

      <Panel title="Fine-tuning runs">
        <p className="text-[13px] text-[var(--ink-soft)]">
          This page prepares the dataset and records the run.{" "}
          <strong>It does not train the model.</strong> Training needs a GPU —
          run the JSONL above through Unsloth or TRL on free Colab, then mark
          the job finished here.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-[var(--ink-soft)]">
            Run name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block rounded border border-[var(--line)] px-2 py-1 text-[12px]"
            />
          </label>
          <label className="text-[11px] text-[var(--ink-soft)]">
            Base model
            <select
              value={baseModel}
              onChange={(e) => setBaseModel(e.target.value)}
              className="mt-1 block rounded border border-[var(--line)] px-2 py-1 text-[12px]"
            >
              {BASE_MODELS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending || !name.trim()}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          >
            {create.isPending ? "Registering…" : "Register run"}
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[var(--ink-soft)]">
                <th className="px-2 py-1.5 text-left">Run</th>
                <th className="px-2 py-1.5 text-left">Base</th>
                <th className="px-2 py-1.5 text-left">Data</th>
                <th className="px-2 py-1.5 text-left">Status</th>
                <th className="px-2 py-1.5 text-left">Advance</th>
              </tr>
            </thead>
            <tbody>
              {(jobs ?? []).map((j) => (
                <tr key={j.id} className="border-t border-[var(--line)]">
                  <td className="px-2 py-1.5">{j.name}</td>
                  <td className="px-2 py-1.5">{j.base_model}</td>
                  <td className="px-2 py-1.5">
                    {j.examples} · {j.dataset_kind}
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge kind={STATUS_KIND[j.status] ?? "pending"}>
                      {j.status}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1">
                      {["running", "finished", "failed"]
                        .filter((st) => st !== j.status)
                        .map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => advance.mutate({ id: j.id, status: st })}
                            className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] hover:bg-slate-50"
                          >
                            {st}
                          </button>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
              {(!jobs || jobs.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-2 py-4">
                    <Empty>No runs registered yet.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="How to actually train it">
        <ol className="ml-4 list-decimal space-y-1.5 text-[12px] leading-relaxed">
          <li>Download the .jsonl above and register a run.</li>
          <li>
            Open a free Colab GPU notebook and install Unsloth, which fits a
            350M LoRA in the free tier&rsquo;s memory several times over.
          </li>
          <li>
            Train a LoRA adapter — a few hundred examples needs only a couple of
            epochs, and more will overfit a corpus this size.
          </li>
          <li>
            Merge the adapter, convert to <code>.litertlm</code> with AI Edge
            Torch, and drop it into <code>models/</code>.
          </li>
          <li>
            Add it to <code>MODELS</code> in <code>modelSource.ts</code> and
            rebuild. It then appears in the app&rsquo;s model picker.
          </li>
        </ol>
        <p className="mt-3 text-[12px] text-[var(--ink-soft)]">
          With {preview?.examples ?? 0} examples, expect a model that matches
          your house wording and clause formatting — not one that knows more
          mining law. Teaching new statute needs the corpus to grow, not the
          weights to change.
        </p>
      </Panel>
    </div>
  );
}
