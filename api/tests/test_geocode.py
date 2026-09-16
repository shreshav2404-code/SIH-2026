"""Mapping an OpenStreetMap address onto the fields evidence stores.

The responses are real Nominatim replies, captured for two points this
project actually uses - a test capture in Bengaluru and the Gevra lease - so
the mapping is pinned against what Indian addresses really look like, not a
tidy imagined one. No network: CI never calls OpenStreetMap.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.evidence_notes import clean_place, format_place  # noqa: E402
from services.geocode import place_from_nominatim  # noqa: E402

BENGALURU = {
    "display_name": "Kakolu Road, Dhibburu, Ittagalapura, Yelahanka taluku, "
                    "Bengaluru Urban, Karnataka, 560089, India",
    "address": {
        "road": "Kakolu Road", "city_district": "Dhibburu",
        "village": "Ittagalapura", "county": "Yelahanka taluku",
        "state_district": "Bengaluru Urban", "state": "Karnataka",
        "postcode": "560089", "country": "India", "country_code": "in",
    },
}

GEVRA = {
    "display_name": "Urjanagar, Gevra, Katghora Tahsil, Korba, Chhattisgarh, "
                    "495452, India",
    "address": {
        "suburb": "Urjanagar", "town": "Gevra", "county": "Katghora Tahsil",
        "state_district": "Korba", "state": "Chhattisgarh",
        "postcode": "495452", "country": "India",
    },
}


def test_revenue_district_not_taluk():
    """state_district is the district a reviewer means; county is the taluk."""
    assert place_from_nominatim(BENGALURU)["district"] == "Bengaluru Urban"
    assert place_from_nominatim(GEVRA)["district"] == "Korba"


def test_pincode_and_full_line_survive_cleaning():
    place = clean_place(place_from_nominatim(GEVRA))
    assert place["pincode"] == "495452"
    assert format_place(place) == GEVRA["display_name"]


def test_source_is_marked_for_attribution():
    """ODbL: the dashboard must say where the address came from."""
    assert place_from_nominatim(GEVRA)["source"] == "osm"


def test_nominatim_error_is_no_place():
    assert place_from_nominatim({"error": "Unable to geocode"}) is None
    assert place_from_nominatim({}) is None
    assert place_from_nominatim(None) is None


def test_street_includes_house_number_when_there_is_one():
    data = {"display_name": "12, MG Road", "address": {"house_number": "12",
                                                       "road": "MG Road"}}
    assert place_from_nominatim(data)["street"] == "12 MG Road"
