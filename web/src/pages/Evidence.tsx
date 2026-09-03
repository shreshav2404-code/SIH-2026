import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, openReport } from "../api/client";
import { useAuth } from "../lib/auth";
import { Badge, Clause, Empty, Panel } from "../lib/ui";

/**
 * The evidence a regulator would actually want to look at.
 *
 * Captures were being stored, hash-chained and screened by YOLO, and then
 * shown to nobody - the photograph, the detection result and the chain hash
 * all lived only in the database. Evidence that cannot be inspected is not
 * evidence.
 */

interface Detection {
  label: string;
  confidence: number;
}

interface VisionResult {
  verdict?: string;
  detections?: Detection[];
  [k: string]: unknown;
}

interface EvidenceRow {
  id: number;
  mine_id: number;
  obligation_id: number;
  observation: string | null;
  lat: number;
  lon: number;
  captured_at: string;
  inside_lease: boolean | null;
  vision_result: VisionResult | null;
  photo_sha256: string | null;
  prev_hash: string | null;
  chain_hash: string;
  has_photo: boolean;
}

/**
 * The photo endpoint requires a bearer token, so a plain `<img src>` cannot
 * load it - the browser would send no Authorization header and get a 401.
 * Fetch it through the same axios client as everything else and hand the
 * `<img>` an object URL instead.
 */
function Photo({ id, has }: { id: number; has: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!has) return;
    let url: string | null = null;
    let cancelled = false;

    api
      .get(`/evidence/${id}/photo`, { responseType: "blob" })
      .then((r) => {
        if (cancelled) return;
        url = URL.createObjectURL(r.data as Blob);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      // An object URL pins its blob in memory until revoked, and this list can
      // hold dozens of photographs.
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, has]);

  const shell =
    "flex h-40 w-full items-center justify-center bg-slate-100 text-xs text-[var(--ink-soft)]";

  if (!has) return <div className={shell}>observation only</div>;
  if (failed) return <div className={shell}>photo unavailable</div>;
  if (!src) return <div className={shell}>loading…</div>;
  return (
    <img
      src={src}
      alt={`Evidence ${id}`}
      className="h-40 w-full object-cover"
    />
  );
}

function Vision({ result }: { result: VisionResult | null }) {
  if (!result) return <span className="text-[var(--ink-soft)]">not screened</span>;

  const dets = Array.isArray(result.detections) ? result.detections : [];
  const flagged = String(result.verdict ?? "").toLowerCase() === "flag";

  return (
    <div>
      <Badge kind={flagged ? "warning" : "verified"}>
        {flagged ? "flagged" : "pass"}
      </Badge>
      {dets.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {dets.map((d, i) => (
            <li key={i} className="text-[11px]">
              {d.label}{" "}
              <span className="text-[var(--ink-soft)]">
                {Math.round((d.confidence ?? 0) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      ) : (
        // A verdict with no reasons is not auditable. Say so rather than imply
        // the model looked and found nothing worth reporting.
        <div className="mt-1 text-[11px] text-[var(--ink-soft)]">
          no objects listed
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 border-t border-[var(--line)] px-3 py-1.5 text-[12px]">
      <span className="w-20 shrink-0 text-[var(--ink-soft)]">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export default function Evidence() {
  const { user } = useAuth();
  const mineId = user?.mine_id ?? 1;

  const { data: rows, isLoading } = useQuery({
    queryKey: ["evidence", mineId],
    queryFn: async () =>
      (await api.get<EvidenceRow[]>("/evidence", { params: { mine_id: mineId } }))
        .data,
    refetchInterval: 10_000,
  });

  const { data: chain } = useQuery({
    queryKey: ["evidence-verify", mineId],
    queryFn: async () =>
      (
        await api.get<{
          ok: boolean;
          broken_at?: number | null;
          checked: number;
        }>("/evidence/verify", { params: { mine_id: mineId } })
      ).data,
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <Panel
        title="Evidence chain"
        right={
          <div className="flex items-center gap-2">
            {chain && (
              <Badge kind={chain.ok ? "verified" : "critical"}>
                {chain.ok ? "chain intact" : "chain broken"}
              </Badge>
            )}
            <button
              type="button"
              onClick={() => void openReport(`/reports/compliance/${mineId}`)}
              className="rounded border border-[var(--line)] px-2 py-1 text-[11px] font-medium hover:bg-slate-50"
            >
              Compliance report
            </button>
          </div>
        }
      >
        <p className="text-[13px] text-[var(--ink-soft)]">
          Each capture is hashed onto the one before it, per mine. Editing a row
          in the database breaks every hash after it, which is what makes
          back-dating detectable rather than merely discouraged.
        </p>
        {chain && (
          <p className="mt-2 text-[12px]">
            {chain.checked} record{chain.checked === 1 ? "" : "s"} verified
            {chain.ok
              ? "."
              : ` — first break at evidence #${chain.broken_at ?? "?"}.`}
          </p>
        )}
      </Panel>

      <Panel title="Captures">
        {isLoading && (
          <span className="text-[13px] text-[var(--ink-soft)]">loading…</span>
        )}

        {!isLoading && (!rows || rows.length === 0) && (
          <Empty>
            No evidence captured yet. Capture a duty in the field app and it
            appears here within ten seconds.
          </Empty>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(rows ?? []).map((e) => (
            <article
              key={e.id}
              className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)]"
            >
              <Photo id={e.id} has={e.has_photo} />

              <div className="flex items-center justify-between px-3 py-2">
                <strong className="text-[13px]">#{e.id}</strong>
                <span className="text-[11px] text-[var(--ink-soft)]">
                  {new Date(e.captured_at).toLocaleString()}
                </span>
              </div>

              {e.observation && (
                <p className="px-3 pb-2 text-[12px] leading-relaxed">
                  {e.observation}
                </p>
              )}

              <Field label="Location">
                {e.lat.toFixed(5)}, {e.lon.toFixed(5)}{" "}
                {e.inside_lease === null ? (
                  <span className="text-[var(--ink-soft)]">unchecked</span>
                ) : (
                  <Badge kind={e.inside_lease ? "verified" : "critical"}>
                    {e.inside_lease ? "inside lease" : "outside lease"}
                  </Badge>
                )}
              </Field>

              <Field label="Vision">
                <Vision result={e.vision_result} />
              </Field>

              <Field label="Chain">
                <Clause>{e.chain_hash.slice(0, 20)}…</Clause>
              </Field>

              <Field label="Previous">
                <Clause>
                  {e.prev_hash ? `${e.prev_hash.slice(0, 20)}…` : "genesis"}
                </Clause>
              </Field>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
