/**
 * Where a capture was taken, as an address a person can read.
 *
 * Coordinates alone do not answer a reviewer's first question. "22.3412,
 * 82.5807" means nothing at a glance; "Gevra, Korba, Chhattisgarh 495452"
 * does. The coordinates stay the evidence - they are hashed, the address is
 * not - and the address is the reading aid.
 *
 * Two sources, in order:
 *
 *   1. Android's own geocoder, through expo-location. No key, no account.
 *   2. The ANUPALAN API's /geo/address, which asks OpenStreetMap.
 *
 * The second exists because the first failed on the demo handset: Android
 * returned no address at a point in Bengaluru where OpenStreetMap named the
 * road, the village, the taluk and the PIN (560089). That phone was on a
 * hotspot with AdGuard as its private DNS, which is enough to break a Google
 * endpoint - so "the phone's geocoder will work" is not a safe assumption for
 * a device someone else configured. Going through the API, not calling
 * OpenStreetMap from each phone, keeps its one-a-second usage policy.
 *
 * Both need a network, so underground both fail and the sync at the surface
 * looks the address up instead. Either way the coordinates leave the device;
 * a deployment that must keep them inside government infrastructure would run
 * its own geocoder or an offline pincode table.
 */

import * as Location from "expo-location";

import { api } from "./api";

export interface Place {
  /** Android's formatted one-line address, when it gives one. */
  full?: string;
  name?: string;
  street?: string;
  /** Neighbourhood or locality within a city. */
  area?: string;
  city?: string;
  /** The administrative district - "Korba", not the neighbourhood. */
  district?: string;
  state?: string;
  pincode?: string;
  country?: string;
  /** device = Android's geocoder; osm = OpenStreetMap, via the API. */
  source: "device" | "osm";
}

/**
 * Why the last lookup found nothing, in words, for the capture screen.
 *
 * "no address found here" with no reason reads as a broken feature. It was
 * one on the demo handset, and the reason - a geocoder failing behind a DNS
 * filter - was only findable by guessing, because the error was swallowed.
 */
export let lastPlaceFailure: string | null = null;

const PIN = /^[1-9]\d{5}$/;

function clean(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * Look the address up, or return null - never throw.
 *
 * A capture must never fail because an address could not be found. Offline,
 * a geocoder outage, a point in the middle of an opencast pit with no named
 * street: all of these are null, and the coordinates still stand.
 */
export async function lookupPlace(lat: number, lon: number): Promise<Place | null> {
  const reasons: string[] = [];

  const fromDevice = await deviceGeocoder(lat, lon).catch((e: unknown) => {
    reasons.push(`phone geocoder: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  });
  if (fromDevice) {
    lastPlaceFailure = null;
    return fromDevice;
  }
  if (!reasons.length) reasons.push("phone geocoder: no address for this point");

  try {
    const { data } = await api.get<{ place: Place | null }>("/geo/address", {
      params: { lat, lon },
      timeout: 15_000,
    });
    if (data.place) {
      lastPlaceFailure = null;
      return data.place;
    }
    reasons.push("OpenStreetMap: no address for this point");
  } catch (e: unknown) {
    const status =
      typeof e === "object" && e && "response" in e
        ? (e as { response?: { status?: number } }).response?.status
        : undefined;
    reasons.push(
      status ? `server said ${status}` : "server unreachable for the address lookup",
    );
  }

  lastPlaceFailure = reasons.join("; ");
  return null;
}

async function deviceGeocoder(lat: number, lon: number): Promise<Place | null> {
  const [hit] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
  if (!hit) return null;

  const street = [clean(hit.streetNumber), clean(hit.street)].filter(Boolean).join(" ");
  const pin = clean(hit.postalCode)?.replace(/\s/g, "");

  const place: Place = {
    full: clean(hit.formattedAddress),
    name: clean(hit.name),
    street: street || undefined,
    // Android maps sub-locality to `district` and the administrative
    // district to `subregion`. The names are swapped relative to how an
    // Indian address reads, so they are renamed here, once.
    area: clean(hit.district),
    city: clean(hit.city),
    district: clean(hit.subregion),
    state: clean(hit.region),
    // A malformed PIN is dropped rather than shown. The server applies the
    // same rule, but a wrong PIN should not reach the screen either.
    pincode: pin && PIN.test(pin) ? pin : undefined,
    country: clean(hit.country),
    source: "device",
  };

  const hasSomething = Object.entries(place).some(
    ([k, v]) => k !== "source" && v,
  );
  return hasSomething ? place : null;
}

/** One readable line. Prefers Android's own formatting, adds the PIN if it left it off. */
export function placeLine(place: Place | null | undefined): string | null {
  if (!place) return null;
  if (place.full) {
    if (place.pincode && !place.full.includes(place.pincode)) {
      return `${place.full} ${place.pincode}`;
    }
    return place.full;
  }
  const parts: string[] = [];
  for (const v of [place.name, place.street, place.area, place.city, place.district, place.state]) {
    if (v && !parts.includes(v)) parts.push(v);
  }
  const line = parts.join(", ");
  return (place.pincode ? `${line} ${place.pincode}` : line) || null;
}

/** Metres between two points. Used to decide when a moving fix needs a new address. */
export function metresBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
