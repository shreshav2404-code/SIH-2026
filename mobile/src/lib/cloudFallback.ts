/**
 * Optional cloud models, used only when the officer selects CLOUD.
 *
 * This cuts against the project's central claim - that everything runs on the
 * phone with no network, no API and no cost - so it is built to be honest
 * about itself rather than quietly convenient:
 *
 *   - OFF unless a profile is saved. No key, no network call, no code path.
 *   - Never automatic. The on-device model answers unless CLOUD is selected.
 *   - Never given the ledger. askCloud() takes the question string and nothing
 *     else, so there is no parameter to put duty rows in even by mistake.
 *   - Every answer it produces is labelled as having left the device.
 *
 * MANY profiles rather than one key. Depending on a single provider means a
 * revoked key, an exhausted free tier or a retired model ends the demo; with
 * several saved, switching is one tap. Each profile is a complete connection -
 * endpoint, model and key together - because those three travel as a set, and
 * pairing a Groq key with an OpenRouter URL just produces a 401.
 *
 * Keys are stored with the app's other preferences. Adequate for a demo and
 * NOT adequate for a real deployment: on a rooted or backed-up phone they are
 * readable. A production build would use the Android keystore.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PROFILES_STORE = "anupalan.cloud.profiles";
const ACTIVE_STORE = "anupalan.cloud.active";
const ON_STORE = "anupalan.cloud.on";

// Legacy single-config keys, read once and migrated. See loadProfiles().
const LEGACY_KEY = "anupalan.cloud.key";
const LEGACY_URL = "anupalan.cloud.url";
const LEGACY_MODEL = "anupalan.cloud.model";

export const DEFAULT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
// Verified working against NVIDIA in September 2026. Their /v1/models listing
// is NOT a reliable source for this - it answers 200 to an invalid key, and
// every model it returned was either 410 Gone or 404 for the account.
export const DEFAULT_MODEL = "moonshotai/kimi-k3";

/**
 * Endpoints for providers that speak the OpenAI chat-completions shape, so
 * connecting one is a tap rather than typing a URL on a phone keyboard.
 *
 * Reachability probed 2026-09-05 by POSTing a deliberately invalid key and
 * model to each URL. A 401/400 proves the path exists and the request got as
 * far as auth or body validation; only a 404 suggests a wrong path:
 *
 *   401  OpenRouter, Groq, Cerebras, Mistral, Together, DeepInfra,
 *        DeepSeek, OpenAI
 *   400  Google AI, xAI  (reachable, rejected the body before auth)
 *   404  NVIDIA, Fireworks
 *
 * NVIDIA's 404 is NOT a bad path - it answers 404 to an unknown model rather
 * than 401 to a bad key, and a real key against this exact URL returned a
 * correct answer in testing. Fireworks is the one genuinely ambiguous entry:
 * the probe cannot tell a wrong path from an unknown model there, so treat it
 * as unconfirmed until a real key proves it.
 *
 * Reachable is not the same as working. Only the NVIDIA url+model pair has
 * been verified end to end with a real key; use the Test button in Sync before
 * relying on any of the others.
 *
 * Model is left blank everywhere except NVIDIA on purpose: catalogues change
 * constantly, and a plausible-looking model ID that does not exist fails as a
 * 404 somebody has to debug mid-demo. Copy the exact string from the
 * provider's model list.
 */
export const PROVIDERS: { name: string; url: string; model?: string; hint: string }[] = [
  {
    name: "NVIDIA",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    model: DEFAULT_MODEL,
    hint: "build.nvidia.com - free tier, no card - verified",
  },
  {
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    hint: "openrouter.ai - one key, many providers, some free models",
  },
  {
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    hint: "console.groq.com - free tier - fastest replies",
  },
  {
    name: "Cerebras",
    url: "https://api.cerebras.ai/v1/chat/completions",
    hint: "cloud.cerebras.ai - free tier",
  },
  {
    name: "Google AI",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    hint: "aistudio.google.com - free tier - Gemini",
  },
  {
    name: "Mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    hint: "console.mistral.ai - free tier",
  },
  {
    name: "Together",
    url: "https://api.together.xyz/v1/chat/completions",
    hint: "api.together.ai - trial credit",
  },
  {
    name: "DeepInfra",
    url: "https://api.deepinfra.com/v1/openai/chat/completions",
    hint: "deepinfra.com - pay as you go",
  },
  {
    name: "Fireworks",
    url: "https://api.fireworks.ai/inference/v1/chat/completions",
    hint: "fireworks.ai - trial credit",
  },
  {
    name: "DeepSeek",
    url: "https://api.deepseek.com/chat/completions",
    hint: "platform.deepseek.com - paid, cheap",
  },
  {
    name: "xAI",
    url: "https://api.x.ai/v1/chat/completions",
    hint: "console.x.ai - paid - Grok",
  },
  {
    name: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    hint: "platform.openai.com - paid",
  },
];

/** One complete connection: where to send, what to ask for, what to sign with. */
export interface CloudProfile {
  id: string;
  /** Shown in the picker - the provider name, or whatever the officer typed. */
  label: string;
  url: string;
  model: string;
  key: string;
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function saveProfiles(list: CloudProfile[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILES_STORE, JSON.stringify(list));
  } catch {
    /* best effort */
  }
}

export async function getActiveProfileId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ACTIVE_STORE);
  } catch {
    return null;
  }
}

export async function setActiveProfileId(id: string | null): Promise<void> {
  try {
    if (id) await AsyncStorage.setItem(ACTIVE_STORE, id);
    else await AsyncStorage.removeItem(ACTIVE_STORE);
  } catch {
    /* best effort */
  }
}

/**
 * Every saved profile, oldest first.
 *
 * Migrates the earlier single-key storage on first read, so a key entered
 * before this screen existed is not silently lost.
 */
export async function loadProfiles(): Promise<CloudProfile[]> {
  try {
    const raw = await AsyncStorage.getItem(PROFILES_STORE);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as CloudProfile[];
    }

    const legacyKey = await AsyncStorage.getItem(LEGACY_KEY);
    if (!legacyKey) return [];
    const migrated: CloudProfile = {
      id: newId(),
      label: "Saved",
      url: (await AsyncStorage.getItem(LEGACY_URL)) || DEFAULT_URL,
      model: (await AsyncStorage.getItem(LEGACY_MODEL)) || DEFAULT_MODEL,
      key: legacyKey,
    };
    await saveProfiles([migrated]);
    await setActiveProfileId(migrated.id);
    await AsyncStorage.multiRemove([LEGACY_KEY, LEGACY_URL, LEGACY_MODEL]);
    return [migrated];
  } catch {
    return [];
  }
}

/** Add a profile and make it active - adding it is the intent to use it. */
export async function addProfile(p: Omit<CloudProfile, "id">): Promise<CloudProfile[]> {
  const list = await loadProfiles();
  const added: CloudProfile = { ...p, id: newId() };
  const next = [...list, added];
  await saveProfiles(next);
  await setActiveProfileId(added.id);
  return next;
}

/**
 * Remove a profile. If it was the active one, the first remaining profile
 * takes over rather than leaving CLOUD pointing at nothing.
 */
export async function removeProfile(id: string): Promise<CloudProfile[]> {
  const next = (await loadProfiles()).filter((p) => p.id !== id);
  await saveProfiles(next);
  if ((await getActiveProfileId()) === id) {
    await setActiveProfileId(next[0]?.id ?? null);
  }
  return next;
}

/**
 * The profile CLOUD will use, or null.
 *
 * Falls back to the first saved profile when the stored id no longer resolves
 * - a deleted profile should not disable a fallback that still has keys.
 */
export async function getActiveProfile(): Promise<CloudProfile | null> {
  const list = await loadProfiles();
  if (!list.length) return null;
  const id = await getActiveProfileId();
  return list.find((p) => p.id === id) ?? list[0];
}

export async function cloudConfigured(): Promise<boolean> {
  return (await getActiveProfile()) !== null;
}

/**
 * Whether CLOUD is the selected answerer, remembered across restarts.
 *
 * Persisted so the choice survives closing the app, and so the Ask screen can
 * know it BEFORE deciding whether to show the model load gate - with CLOUD on
 * there is nothing local to warm.
 */
export async function loadCloudOn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ON_STORE)) === "1";
  } catch {
    return false;
  }
}

export async function saveCloudOn(on: boolean): Promise<void> {
  try {
    if (on) await AsyncStorage.setItem(ON_STORE, "1");
    else await AsyncStorage.removeItem(ON_STORE);
  } catch {
    /* best effort */
  }
}

/**
 * Ask the active cloud profile one question.
 *
 * Takes the question ALONE - no ledger rows, no clause text, no mine name.
 * This signature is the guarantee: there is nowhere to put the facts even if
 * a caller wanted to send them.
 *
 * `profile` overrides the active one, which is how the Test button in Sync
 * checks a connection before anything is relied on.
 */
export async function askCloud(
  question: string,
  profile?: CloudProfile,
): Promise<string> {
  const cfg = profile ?? (await getActiveProfile());
  if (!cfg) throw new Error("No API key set. Add a provider in Sync to use CLOUD.");
  if (!cfg.model) {
    throw new Error(
      `${cfg.label} has no model name set. Open Sync and enter one from that ` +
        `provider's model list.`,
    );
  }

  // A timeout, because fetch has none and a queued free tier will happily
  // leave the screen blank forever. Measured 2026-09-05: the same request to
  // NVIDIA's moonshotai/kimi-k3 took 144s and 115s on two different keys -
  // long enough that the app looked frozen rather than slow. Ninety seconds is
  // past any usable provider and short of an officer deciding the app is dead.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90_000);

  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: question }],
        // NO max_tokens on purpose - the provider's own default applies, which
        // is the model's full output limit. A cap of 400 was carried over from
        // the on-device budget, where it exists because every token costs
        // seconds on the phone. That constraint does not exist here, and the
        // cap actively broke reasoning models: they spend the budget on hidden
        // thinking BEFORE writing, so gemini-3.8-flash came back truncated
        // mid-sentence. Nothing is charged for headroom that goes unused.
      }),
      signal: ac.signal,
    });
  } catch (e) {
    if (ac.signal.aborted) {
      throw new Error(
        `${cfg.label} did not answer within 90 seconds. Free tiers queue heavily ` +
          `at busy times - try a faster provider, or use the on-device model.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // The status is the useful part; a provider's HTML error page is not.
    throw new Error(`${cfg.label} returned ${res.status}. ${detail.slice(0, 160)}`);
  }

  // Parsed defensively. Google answered 200 with a top-level ARRAY on one
  // request, which a straight `json.choices` read turns into a confusing
  // "returned no answer" instead of showing what actually came back.
  const parsed: unknown = await res.json();
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${cfg.label} sent a reply in an unexpected shape: ` +
        `${JSON.stringify(parsed).slice(0, 200)}`,
    );
  }
  const json = parsed as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = json.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) throw new Error(`${cfg.label} returned no answer.`);

  // Truncation has to be visible. Reasoning models spend the token budget on
  // hidden thinking before they write anything, so max_tokens buys far less
  // visible answer than it looks like: measured 2026-09-05, gemini-3.8-flash
  // stopped mid-sentence at "a Ventilation" on a 400-token budget while
  // gemini-2.5-flash-lite answered the same question in full. Without this the
  // officer just sees a sentence that stops, with nothing saying why.
  if (choice?.finish_reason === "length") {
    return (
      `${text}

[cut off - ${cfg.model} hit the length limit. Reasoning ` +
      `models spend most of the budget thinking; a non-reasoning model such as ` +
      `a "flash-lite" answers this in full.]`
    );
  }
  return text;
}
