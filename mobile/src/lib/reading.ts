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
 * A JSON answer - what the cloud vision model returns when asked. The
 * labelled-line parser below it covers a model that answers in text anyway.
 * (The on-device model does not come through here: a JSON grammar returned an
 * empty string from it, so it answers three plain questions instead.)
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

/**
 * End a model's text on a whole sentence, or failing that a whole word.
 *
 * Answers are capped in tokens, so they stop wherever the cap lands. On the
 * dashboard that read "there is no visible ind." and "illuminated by
 * colorful" - text that looks broken even when the reading is right.
 */
function wholeSentences(s: string, max: number): string {
  let t = s.trim().slice(0, max);
  if (/[.!?]$/.test(t)) return t;
  const end = Math.max(t.lastIndexOf(". "), t.lastIndexOf("! "), t.lastIndexOf("? "));
  // A short unfinished tail is noise; drop it. A long one usually carries the
  // actual reason ("a close-up of an industrial setting with metal bars and
  // lighting fixtures, but there is no visible ind") - keep it, cut on a word.
  if (end > 20 && t.length - end < 60) return t.slice(0, end + 1);
  // Cut before a trailing clause the cap broke off - ", but there is no
  // visible" says less than stopping at the comma - then on a word.
  const comma = t.lastIndexOf(", ");
  if (comma > t.length * 0.6) t = t.slice(0, comma);
  else {
    const space = t.lastIndexOf(" ");
    if (space > 20) t = t.slice(0, space);
  }
  return `${t.replace(/[,;:\-–]+$/, "")}…`;
}

/**
 * Drop a reason's opening sentence when it only repeats the question.
 *
 * Asked whether a photo shows "Notice of opening a mine", the model answers
 * 'no - it doesn't show "Notice of opening a mine". The image displays an HP
 * laptop...'. The first sentence adds nothing and put the duty title on the
 * dashboard twice in one line; the second is the actual reason.
 */
function withoutRestatement(why: string, dutyTitle: string): string {
  const first = why.match(/^[^.!?]*[.!?]\s*/)?.[0] ?? "";
  const restates =
    first &&
    (first.toLowerCase().includes(dutyTitle.toLowerCase()) ||
      /^(it|this|the (photo|image|picture))\s+(does not|doesn't|do not|don't)\s+(appear to\s+)?show\b/i.test(first));
  const rest = restates ? why.slice(first.length).trim() : why;
  // Nothing but the restatement: there is no reason to show. Better no reason
  // than the duty title a second time.
  if (!rest) return "";
  // "no - The image displays" reads as a typo; lower-case a capital that
  // starts an ordinary word, but leave acronyms like "HP" alone.
  return rest.replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());
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
    // A lone quote mark before the reason - 'no - " The image depicts' - is
    // the model opening a quotation it never closes. A quote followed by a
    // word ('"Notice of opening" is not shown') is kept.
    why = m[2].replace(/^["'“”‘’]\s+/, "").trim() || null;
  }

  const p = cleanAnswer(problem);
  return {
    seen: seen ? wholeSentences(seen, 300) : null,
    match,
    why: why ? wholeSentences(why, 400) : null,
    problem: p && !isNoProblem(p) ? wholeSentences(p, 200) : null,
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

  // One sentence of reason is enough in a line that already names the duty.
  // The server keeps a problem to 360 characters and cuts on a word; the
  // title takes up to ~70 of them, so 250 here keeps a normal reason whole.
  const why = r.why ? withoutRestatement(r.why, dutyTitle) : null;
  const shortWhy = why ? wholeSentences(why.match(/^[^.!?]*[.!?]/)?.[0] ?? why, 250) : null;
  // End each part with one full stop - unless the text was cut, in which
  // case the ellipsis stays, so a reader can see it was.
  const stop = (s: string) => s.replace(/\.$/, "");
  const end = (s: string) => (s.endsWith("…") ? s : `${stop(s)}.`);

  const parts: string[] = [];
  if (r.seen) parts.push(`Seen: ${end(r.seen)}`);
  parts.push(`Matches duty: ${MATCH_WORDS[r.match]}${why ? ` - ${end(why)}` : "."}`);
  parts.push(`Problem: ${r.problem ? end(r.problem) : "none seen."}`);

  const problems: string[] = [];
  if (r.match === "no") {
    problems.push(`Does not appear to show "${dutyTitle}"${shortWhy ? `: ${stop(shortWhy)}` : ""}`);
  }
  if (r.problem) problems.push(stop(r.problem));

  return { description: parts.join(" "), problems, model };
}
