"""Coordinates to a postal address, through OpenStreetMap's Nominatim.

The fallback for when the phone cannot name the place itself. Measured on the
demo handset: Android's own geocoder returned nothing at a point in Bengaluru
where Nominatim returned "Kakolu Road, Dhibburu, Ittagalapura, Yelahanka
taluku, Bengaluru Urban, Karnataka, 560089". The phone was on a hotspot with
AdGuard as its private DNS, which is enough to break a Google endpoint.

Why through the API and not straight from each phone: Nominatim's usage policy
(https://operations.osmfoundation.org/policies/nominatim/) asks for at most one
request a second, an identifying User-Agent, and cached results. One server
can keep all three promises. Every phone calling it separately keeps none.

The data is ODbL and must be attributed - the dashboard prints "Address ©
OpenStreetMap contributors" on every address that came from here. A real
deployment would run its own Nominatim or an offline pincode table, and send
no coordinates outside government infrastructure at all.

Stdlib only (urllib), so this adds no dependency and runs on a CI runner.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
from collections import OrderedDict

ENDPOINT = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "ANUPALAN-SIH26024/0.1 (statutory compliance prototype)"
TIMEOUT_S = 8
MIN_INTERVAL_S = 1.1  # the policy says one a second; a margin costs nothing

# About 11 m at four decimal places - finer than any address changes over,
# and coarser than GPS jitter, so a phone standing still asks once.
CACHE_DECIMALS = 4
CACHE_SIZE = 512

_lock = threading.Lock()
_last_call = 0.0
_cache: OrderedDict[tuple[float, float], dict | None] = OrderedDict()


def place_from_nominatim(data: dict) -> dict | None:
    """Map a Nominatim reverse response onto the place fields evidence stores.

    Indian addresses do not fit OSM's generic keys neatly - a village inside a
    city district inside a taluk inside a revenue district - so the mapping is
    explicit, most specific first, and the full display_name is kept whole so
    nothing a reviewer might need is lost to the mapping.
    """
    if not isinstance(data, dict) or data.get("error"):
        return None
    a = data.get("address") or {}

    def first(*keys):
        for k in keys:
            v = a.get(k)
            if v:
                return str(v)
        return None

    street = " ".join(filter(None, [first("house_number"), first("road")])) or None
    place = {
        "full": data.get("display_name"),
        "name": first("amenity", "building", "industrial", "man_made", "quarry"),
        "street": street,
        "area": first("neighbourhood", "suburb", "hamlet", "village",
                      "city_district", "quarter"),
        "city": first("city", "town", "municipality", "village"),
        # state_district is the revenue district ("Korba", "Bengaluru Urban");
        # county is the taluk or tahsil, one level down.
        "district": first("state_district", "county"),
        "state": first("state"),
        "pincode": first("postcode"),
        "country": first("country"),
        "source": "osm",
    }
    out = {k: v for k, v in place.items() if v}
    return out if set(out) - {"source"} else None


def _fetch(lat: float, lon: float) -> dict | None:
    global _last_call
    query = urllib.parse.urlencode({
        "format": "jsonv2", "lat": f"{lat:.6f}", "lon": f"{lon:.6f}",
        "zoom": 18, "addressdetails": 1,
    })
    req = urllib.request.Request(
        f"{ENDPOINT}?{query}",
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
    )
    with _lock:
        wait = MIN_INTERVAL_S - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                return json.loads(resp.read().decode("utf-8"))
        finally:
            _last_call = time.monotonic()


def reverse(lat: float, lon: float) -> dict | None:
    """The address at a point, or None. Never raises - an address is never
    worth failing a capture over."""
    key = (round(lat, CACHE_DECIMALS), round(lon, CACHE_DECIMALS))
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    try:
        place = place_from_nominatim(_fetch(lat, lon))
    except Exception:  # noqa: BLE001 - offline, timeout, 429, bad JSON: all None
        return None  # not cached: a network blip should not stick for a session
    _cache[key] = place
    if len(_cache) > CACHE_SIZE:
        _cache.popitem(last=False)
    return place
