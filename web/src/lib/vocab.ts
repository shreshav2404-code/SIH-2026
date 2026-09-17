/**
 * The duty vocabulary, in one place.
 *
 * These are the values api/seed/clauses.json declares in `_meta` and the
 * database actually holds. The Ledger and the Rulebook each used to carry
 * their own copy, and the Ledger's had drifted: it offered "one_off" and
 * "register_entry", which no duty uses, and had no "continuous",
 * "event_driven" or "document" - the values on 150 of the duties. Opening
 * Edit on one of those showed a different frequency from the one stored.
 *
 * The API stores whatever string it is sent, so this list is the only thing
 * keeping new duties consistent with the rulebook.
 */

export const ROLES = [
  "Mine Manager",
  "Safety Officer",
  "Ventilation Officer",
  "Environment Officer",
  "Medical Officer",
  "Welfare Officer",
  "Workmen's Inspector",
  "Rescue Superintendent",
  "Owner/Agent",
  "Surveyor",
  "HEMM Operator",
];

export const FREQUENCIES = [
  "continuous",
  "daily",
  "4x_weekly",
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "half_yearly",
  "annual",
  "event_driven",
  "one_time",
];

export const EVIDENCE_TYPES = [
  "photo",
  "reading",
  "document",
  "register",
  "meeting_minutes",
  "diary_entry",
  "sample_result",
  "return_filing",
  "certificate",
  "survey",
];

/**
 * A select's options, with the current value added if the list lacks it. A
 * value from an older import must still be shown as what it is, not as the
 * first option - which is what a controlled select silently displays.
 */
export function optionsWith(list: readonly string[], current: string | undefined): string[] {
  return current && !list.includes(current) ? [current, ...list] : [...list];
}

export const label = (v: string) => v.replace(/_/g, " ");
