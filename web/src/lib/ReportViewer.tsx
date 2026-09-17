import { ExternalLink, Loader2, Printer, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { api, REPORT_EVENT } from "../api/client";
import { EASE } from "./motion";

/**
 * Server-rendered reports, shown inside the dashboard.
 *
 * They used to open in a new browser tab, and that is what made the report
 * buttons look disconnected: the tab could only be opened after the report
 * had been fetched with the bearer token, and by then the click's user
 * activation had expired, so Chrome's popup blocker dropped it without a
 * message. Stricter browsers block it even when opened on the click. A viewer
 * in the page cannot be blocked. "New tab" is still offered, from a click on
 * a report that is already loaded, which no popup blocker refuses.
 */

export default function ReportViewer() {
  const [path, setPath] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setPath((e as CustomEvent<string>).detail);
      setHtml(null);
      setError(null);
    };
    window.addEventListener(REPORT_EVENT, onOpen);
    return () => window.removeEventListener(REPORT_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api
      .get<string>(path, { responseType: "text" })
      .then((r) => !cancelled && setHtml(r.data))
      .catch((e: unknown) => {
        if (cancelled) return;
        const status = (e as { response?: { status?: number } }).response?.status;
        setError(status ? `The report could not be built (HTTP ${status}).` : "The API could not be reached.");
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    if (!path) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPath(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path]);

  function openInTab() {
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <AnimatePresence>
      {path && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#050d1a]/70 p-3 backdrop-blur-sm sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setPath(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Report"
        >
          <motion.div
            className="flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            initial={{ y: 24, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 12, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
              <span className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ink-soft)] uppercase">Report</span>
              <span className="clause truncate">{path}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => frame.current?.contentWindow?.print()}
                  disabled={!html}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                >
                  <Printer size={13} /> Print
                </button>
                <button
                  type="button"
                  onClick={openInTab}
                  disabled={!html}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                >
                  <ExternalLink size={13} /> New tab
                </button>
                <button
                  type="button"
                  onClick={() => setPath(null)}
                  aria-label="Close report"
                  className="grid size-7 place-items-center rounded-md text-[var(--ink-soft)] hover:bg-slate-100"
                >
                  <X size={15} />
                </button>
              </div>
            </header>
            <div className="relative flex-1 bg-slate-50">
              {!html && !error && (
                <div className="absolute inset-0 grid place-items-center text-sm text-[var(--ink-soft)]">
                  <span className="flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Building the report…
                  </span>
                </div>
              )}
              {error && (
                <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-red-700">{error}</div>
              )}
              {html && (
                // Scripts stay blocked: the report is a document to read and
                // print, and allow-modals is what print() needs. The report's
                // own "Print / Save as PDF" button is an inline onclick, which
                // a script-less frame would render as a dead button - so it is
                // hidden here, and Print in the header above does its job.
                <iframe
                  ref={frame}
                  title="Report"
                  srcDoc={html.replace("</head>", "<style>.noprint{display:none!important}</style></head>")}
                  sandbox="allow-same-origin allow-modals"
                  className="h-full w-full border-0 bg-white"
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
