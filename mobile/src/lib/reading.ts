/**
 * Turn a vision model's replies into a verification summary and a list of problems.
 *
 * Pure: no model, no native module, no storage. So it can be reasoned about
 * - and type-checked - apart from the models, which will not always do as
 * they are asked.
 *
 * Two shapes arrive here:
 *
 *   readingFromAnswers()  the on-device model, asked three short plain
 *                         questions in turn. A JSON grammar returned an empty
 *                         string from LFM2.5-VL on the M31s every time, so the
 *                         structure comes from asking three things separately
 *                         rather than from constraining one answer.
 *   parseReading()        the cloud model, which returns JSON when asked.
 *                         The labelled-line fallback inside it covers a model
 *                         that answers in text anyway.
 */

export type Match = "yes" | "no" | "unclear";

export interface Reading {
  seen: string | null;
  match: Match;
  why: string | null;
  problem: string | null;
}

/** What is stored with the capture and sent to the server. */
export interface Annotation {
  description: string;
  problems: string[];
  model: string;
}

// The instruction text itself. If a line comes back as exactly this, the model
// copied the prompt rather than looking at the photo.
const ECHOES = [
  "what is in the photo",
  "yes, no or unclear, and why",
  "anything unsafe or wrong, or none",
];

// "none", "None visible.", "no problems seen", "nothing unsafe visible"... all
// mean the same, and "None visible." once went through as a PROBLEM - a
// warning on the dashboard that said there was nothing to warn about.
const NONE =
  /^(none|no|nothing|n\/?a|no problems?|nothing (unsafe|wrong))( (seen|visible|found|observed|detected))?\.?$/i;

const LABEL = /^(seen|match(?:es)?(?:\s+(?:the\s+)?duty)?|problems?)\s*[:\-–]\s*/i;

function tidy(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "") // list markers
    .replace(/\*\*/g, "") //                    markdown bold
    .trim();
}

function isEcho(value: string): boolean {
  const v = value.toLowerCase().replace(/[.\s]+$/, "");
  return ECHOES.some((e) => v === e || v.startsWith(e));
}

function value(line: string, label: RegExp): string | null {
  const m = tidy(line).match(label);
  if (!m) return null;
  const v = m[1].trim();
  return v && !isEcho(v) ? v : null;
}

/**
 * The grammar-constrained answer. describeEvidence() forces this shape, so
 * this is the normal path; the labelled-line parser below it is kept for a
 * model or engine that returns text anyway.
 */
function fromJson(raw: string): Reading | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const str = (v: unknown) => {
    const t = typeof v === "string" ? tidy(v) : "";
    return t && !isEcho(t) ? t : null;
  };
  const verdict = str(d.matches_duty)?.toLowerCase();
  const problem = str(d.problem);
  return {
    seen: str(d.seen),
    match: verdict === "yes" || verdict === "no" ? verdict : "unclear",
    why: str(d.why),
    problem: problem && !NONE.test(problem) ? problem : null,
  };
}

export function parseReading(raw: string): Reading {
  const structured = fromJson(raw);
  if (structured) return structured;

  const lines = raw.split(/\r?\n/).map(tidy).filter(Boolean);

  let seen: string | null = null;
  let matchLine: string | null = null;
  let problem: string | null = null;

  for (const line of lines) {
    seen ??= value(line, /^seen\s*[:\-–]\s*(.+)$/i);
    matchLine ??= value(line, /^match(?:es)?(?:\s+(?:the\s+)?duty)?\s*[:\-–]\s*(.+)$/i);
    problem ??= value(line, /^problems?\s*[:\-–]\s*(.+)$/i);
  }

  let match: Match = "unclear";
  let why: string | null = null;
  if (matchLine) {
    const m = matchLine.match(/^(yes|no|unclear|partly|partially)\b[\s,.:;\-–]*(.*)$/i);
    if (m) {
      const word = m[1].toLowerCase();
      match = word === "yes" ? "yes" : word === "no" ? "no" : "unclear";
      why = m[2].trim() || null;
    } else {
      why = matchLine;
    }
  }

  if (problem && NONE.test(problem)) problem = null;

  // Nothing usable under any label: either the model answered in prose, or it
  // copied the prompt back. Keep prose as the description, and claim nothing
  // about whether it matches. A copied prompt is not a reading - strip each
  // label, drop what is left if it is the instruction, and if nothing
  // survives, nothing was read. (It once came back as the description
  // "Seen: Seen: what is in the photo Matches duty: yes, no or unclear...".)
  if (!seen && !matchLine && !problem) {
    const prose = lines
      .filter((l) => !isEcho(l.replace(LABEL, "")))
      .join(" ")
      .trim();
    seen = prose ? prose.slice(0, 400) : null;
  }

  return { seen, match, why, problem };
}

const MATCH_WORDS: Record<Match, string> = {
  yes: "yes",
  no: "no",
  unclear: "unclear",
};

/**
 * Strip what a small model wraps round an answer: markdown bold, an "Answer:"
 * label, and a question it made up and answered itself.
 *
 * The invented question is not hypothetical. Before the image was moved inside
 * the message, every reply opened "**Question:** What is the primary function
 * of the metal bars...". That cause is fixed, but the habit comes from
 * training, and a leading Question line is never part of an answer.
 */
function cleanAnswer(raw: string): string {
  let s = raw.replace(/\*\*/g, "").trim();
  s = s.replace(/^question\s*:[^\n]*\n+/i, "");
  s = s.replace(/^answer\s*:\s*/i, "");
  return s.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
}

/** "No, nothing unsafe" is none. "No guard rail on the conveyor" is a problem. */
function isNoProblem(s: string): boolean {
  const t = s.trim();
  return (
    NONE.test(t) ||
    /^no[,.]/i.test(t) ||
    /\bnothing (appears |looks |seems )?(unsafe|wrong|damaged)\b/i.test(t) ||
    /\bno (visible )?(problems?|issues?|hazards?)\b/i.test(t)
  );
}

/**
 * The on-device reading: three short answers, each to one plain question.
 *
 * describe: "Describe this photo in one sentence."
 * verdict:  "Does this photo show <duty> being done? Start with yes, no or
 *            unclear, then give one short reason."
 * problem:  "Is anything in this photo unsafe, damaged or wrong? If nothing,
 *            answer none."
 *
 * The verdict word is taken from the START of the answer only. A reason can
 * easily contain "no" ("no workers are visible") and must not flip the answer.
 */
export function readingFromAnswers(
  describe: string,
  verdict: string,
  problem: string,
): Reading {
  const seen = cleanAnswer(describe) || null;

  const v = cleanAnswer(verdict);
  const m = v.match(/^(yes|no|unclear|not sure|uncertain|partly|partially)\b[\s,.:;\-–]*(.*)$/i);
  let match: Match = "unclear";
  let why: string | null = v || null;
  if (m) {
    const word = m[1].toLowerCase();
    match = word === "yes" ? "yes" : word === "no" ? "no" : "unclear";
    why = m[2].trim() || null;
  }

  const p = cleanAnswer(problem);
  return {
    seen: seen ? seen.slice(0, 300) : null,
    match,
    why: why ? why.slice(0, 200) : null,
    problem: p && !isNoProblem(p) ? p.slice(0, 200) : null,
  };
}

/**
 * The verification summary shown on the dashboard, and the problems that ask for a
 * human to look.
 *
 * A "no" on whether the photo shows the duty is itself a problem worth
 * raising - a sharp, well-lit photograph of the wrong thing passes every pixel
 * check there is, and this is the only layer that can notice. It is raised
 * for review, never as a finding: the dashboard labels it as the model's.
 */
export function toAnnotation(
  r: Reading,
  dutyTitle: string,
  model: string,
): Annotation {
  if (!r.seen && !r.problem && !r.why) {
    throw new Error("The model returned nothing that describes the photo.");
  }

  const parts: string[] = [];
  if (r.seen) parts.push(`Seen: ${r.seen.replace(/\.$/, "")}.`);
  parts.push(
    `Matches duty: ${MATCH_WORDS[r.match]}${r.why ? ` - ${r.why.replace(/\.$/, "")}` : ""}.`,
  );
  parts.push(`Problem: ${r.problem ? r.problem.replace(/\.$/, "") : "none seen"}.`);

  const problems: string[] = [];
  if (r.match === "no") {
    problems.push(
      `Does not appear to show "${dutyTitle}"${r.why ? `: ${r.why.replace(/\.$/, "")}` : ""}`,
    );
  }
  if (r.problem) problems.push(r.problem.replace(/\.$/, ""));

  return { description: parts.join(" "), problems, model };
}
