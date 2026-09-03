/**
 * Find the API, whichever way the phone happens to be connected.
 *
 * Three transports, all of which the app supports at once so nothing has to be
 * decided in advance:
 *
 *   USB      adb reverse tcp:8000 -> http://localhost:8000 on the device.
 *            Instant, immune to wifi, and what scrcpy needs anyway.
 *   HOTSPOT  The PHONE shares its connection and the LAPTOP joins it. Android
 *            hands itself 192.168.43.1 and leases clients from 192.168.43.2 up,
 *            so the laptop's address is not known ahead of time - hence the
 *            sweep below.
 *   LAN      Both on the same wifi. Works only if the router does not isolate
 *            its clients, which this one does (ADR-005), so it is tried last
 *            rather than relied on.
 *
 * Everything here is a plain /health GET on the local network. The model runs
 * on-device and never touches any of it: airplane mode breaks sync, not
 * intelligence.
 */

import axios from "axios";

import { LAN_HOST, USB_HOST } from "./config";

/** A probe has to be quick — several run at once and the user is waiting. */
const PROBE_TIMEOUT_MS = 1200;

/**
 * Android's hotspot subnet. The phone is .1 and leases start at .2, handed out
 * in order, so a laptop that joined first is very near the bottom. Sweeping
 * the whole /24 would mean 253 requests; the first dozen finds it in practice
 * and keeps discovery under two seconds.
 */
const HOTSPOT_PREFIX = "192.168.43";
const HOTSPOT_RANGE = 12;

/** Some Android builds use this subnet for tethering instead. */
const HOTSPOT_PREFIX_ALT = "192.168.137";

export interface Discovered {
  url: string;
  /** How it was reached, for the UI to show. */
  via: "usb" | "hotspot" | "lan" | "saved";
}

function candidates(saved: string | null): { url: string; via: Discovered["via"] }[] {
  const list: { url: string; via: Discovered["via"] }[] = [];

  // A previously working address is tried first: it costs one request and is
  // right most of the time.
  if (saved) list.push({ url: saved, via: "saved" });

  // The cable, if there is one. Cheap and always correct when present.
  list.push({ url: USB_HOST, via: "usb" });

  // The laptop as a hotspot client.
  for (let i = 1; i <= HOTSPOT_RANGE; i++) {
    list.push({ url: `http://${HOTSPOT_PREFIX}.${i}:8000`, via: "hotspot" });
    list.push({ url: `http://${HOTSPOT_PREFIX_ALT}.${i}:8000`, via: "hotspot" });
  }

  // Same-wifi, last because this router isolates clients.
  list.push({ url: LAN_HOST, via: "lan" });

  return list;
}

async function alive(url: string): Promise<boolean> {
  try {
    const { data } = await axios.get(`${url}/health`, { timeout: PROBE_TIMEOUT_MS });
    // Any HTTP server can return 200. Only ours says this.
    return typeof data === "object" && data !== null && "status" in data;
  } catch {
    return false;
  }
}

/**
 * Probe every candidate at once and take the first that answers.
 *
 * Parallel rather than sequential on purpose: serially, a dozen dead hotspot
 * addresses at 1.2s each would be fifteen seconds of staring before the LAN
 * address is even tried.
 */
export async function discover(saved: string | null): Promise<Discovered | null> {
  const list = candidates(saved);

  const attempts = list.map(
    ({ url, via }) =>
      new Promise<Discovered>((resolve, reject) => {
        alive(url).then((ok) => (ok ? resolve({ url, via }) : reject(new Error(url))));
      }),
  );

  try {
    // Promise.any resolves on the FIRST success and ignores the failures, which
    // is exactly the semantics wanted: most of these are expected to fail.
    return await Promise.any(attempts);
  } catch {
    return null; // every candidate refused
  }
}

/** For the UI: "over the cable", "over the phone's hotspot". */
export function describeTransport(via: Discovered["via"]): string {
  switch (via) {
    case "usb":
      return "over the cable";
    case "hotspot":
      return "over the phone's hotspot";
    case "lan":
      return "over wifi";
    case "saved":
      return "saved address";
  }
}
