/**
 * Facts about this system, retrieved and put into the prompt.
 *
 * WHY THIS EXISTS. A fine-tuned Gemma 3 270M was measured answering "does this
 * need internet" with "Yes" - the opposite of the truth - across three
 * training rounds. Shortening the answers and raising the epochs moved other
 * facts but never that one: a 270M model has an overwhelming prior that a
 * yes/no question takes "Yes", and eighteen training examples do not overturn
 * it.
 *
 * The same model, given the clause IN THE PROMPT, answered clause questions
 * perfectly. It reads well and remembers badly. So facts about the app are
 * retrieved and handed to it exactly as ledger rows are, and answering becomes
 * reading rather than recall.
 *
 * This is the project's own rule applied one level up: the model does
 * language, deterministic code supplies the facts. A fact in a table can be
 * corrected by editing one line; a fact in the weights needs a retrain and may
 * still come out wrong.
 */

export interface SystemFact {
  /** Words that mean the question is probably about this fact. */
  keys: string[];
  /** The answer, stated once, plainly. */
  fact: string;
  /**
   * Answer with this text VERBATIM, without calling the model.
   *
   * For claims where a wrong answer is not merely unhelpful but false about
   * the system's legal behaviour. "Can this file a statutory return" was
   * answered "Yes" by the tuned model in six consecutive training rounds,
   * even with the correct fact in its prompt - the base model's prior for a
   * yes/no question is that strong. The project's own rule applies: a
   * statement that matters cannot depend on a probabilistic system, so this
   * one is returned by code.
   */
  direct?: boolean;
}

export const SYSTEM_FACTS: SystemFact[] = [
  {
    keys: ["internet", "offline", "network", "wifi", "airplane", "online", "connection", "signal"],
    fact:
      "ANUPALAN runs its language model entirely on this device. It needs no internet, " +
      "no server and no cloud, and it answers in airplane mode.",
    direct: true,
  },
  {
    keys: ["anupalan", "app", "system", "project", "purpose"],
    fact:
      "ANUPALAN is an on-device compliance monitoring system for Coal India. It tracks " +
      "statutory duties, captures geo-tagged evidence into a hash chain, watches sensor " +
      "readings against statutory thresholds, and drafts returns for a qualified person to sign.",
  },
  {
    keys: ["help", "understand", "guide", "companion", "usage"],
    fact:
      "You can ask what is overdue and who owns it, what a particular clause requires, " +
      "what an officer is responsible for, which duties need a photograph, or what a " +
      "sensor reading means. Every compliance answer cites the clause it came from.",
  },
  {
    keys: ["hash", "chain", "tamper", "evidence", "integrity", "proof", "audit"],
    fact:
      "Every evidence record stores the previous record's hash for that mine, forming a " +
      "chain. Editing any row breaks every hash after it, and the verification endpoint " +
      "reports the first broken link.",
  },
  {
    keys: ["file", "filing", "submit", "return", "dgms", "sign", "signed", "statutory"],
    fact:
      "This system never files anything. It drafts returns and stamps them DRAFT - NOT " +
      "FILED. A return reaches the DGMS because a certificated officer signed and sent " +
      "it, never because software decided it was ready.",
    direct: true,
  },
  {
    keys: ["breach", "threshold", "alert", "hazard", "trigger", "decides", "detection"],
    fact:
      "Breach detection is arithmetic, not the model. A rolling mean and a z-score are " +
      "compared against a static threshold table. A statutory alert cannot depend on a " +
      "probabilistic system.",
    direct: true,
  },
  {
    keys: ["risk", "score", "xgboost", "band", "priority", "ranked"],
    fact:
      "Risk is scored by XGBoost on the backend, and the score comes back with its top " +
      "contributing features - days overdue, past violations, days since last inspection " +
      "- so the reasons are auditable.",
  },
  {
    keys: ["lease", "boundary", "gps", "location", "inside", "outside", "postgis", "geo"],
    fact:
      "The captured GPS point is tested against the lease polygon with PostGIS " +
      "ST_Contains, and any area outside is computed with ST_Difference. It is geometry, " +
      "not judgement.",
  },
  {
    keys: ["model", "llm", "device", "phone", "gemma", "qwen", "onboard"],
    fact:
      "The language model is bundled inside the app and runs on the phone's own " +
      "processor. The backend does no model work at all.",
  },
  {
    keys: ["invent", "hallucinate", "wrong", "made", "up", "fake", "verify", "trust"],
    fact:
      "Any statute the model names that was not among the retrieved facts is flagged as " +
      "not in the ledger and marked unverified, so an invented regulation number cannot " +
      "pass as a citation.",
  },
  {
    keys: ["sync", "queue", "underground", "capture", "lost", "later"],
    fact:
      "A capture taken with no signal is queued on the device and uploaded when the app " +
      "can reach the server again. Nothing is lost underground.",
  },
  {
    keys: ["assistant", "yourself", "chatbot", "bot"],
    fact:
      "This is the ANUPALAN on-device assistant. It answers questions about this mine's " +
      "statutory compliance and runs entirely on this phone.",
  },
];

/** Words too common to indicate which fact is wanted. */
const STOP = new Set([
  "the", "a", "an", "is", "are", "was", "of", "to", "in", "on", "for", "and",
  "or", "it", "this", "that", "with", "can", "does", "did", "you", "i", "me",
  "my", "your", "we", "us", "be", "been", "have", "has", "will", "would",
]);

/**
 * The fact most likely to answer this question, or null.
 *
 * Scored rather than first-match: "how does the app decide a breach" hits both
 * the app fact and the breach fact, and the breach one should win because its
 * words are rarer. Returns null when nothing scores, so a question that is not
 * about the system falls through to ordinary chat rather than having an
 * irrelevant paragraph pushed in front of it.
 */
export function findFact(question: string): SystemFact | null {
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length) return null;

  let best: SystemFact | null = null;
  let bestScore = 0;

  for (const f of SYSTEM_FACTS) {
    let score = 0;
    for (const w of words) {
      if (f.keys.includes(w)) {
        // A key that appears in only one fact is a strong signal; one that
        // appears in several says little.
        const spread = SYSTEM_FACTS.filter((g) => g.keys.includes(w)).length;
        score += 1 / spread;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }

  // The threshold does real work. An earlier version listed "what", "how" and
  // "who" as keys, so "what is the capital of France" scored against the
  // ANUPALAN fact and had a paragraph about compliance monitoring pushed in
  // front of it. Interrogatives are gone from the keys and the bar is higher:
  // a question must hit a CONTENT word to be treated as a question about the
  // system, and anything else falls through to ordinary chat.
  return bestScore >= 0.9 ? best : null;
}
