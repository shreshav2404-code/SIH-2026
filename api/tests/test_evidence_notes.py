"""What the dashboard says about a photograph, and what the phone may send.

Pure functions, no database. Each test pins a sentence a reviewer will read
or a value the server will refuse to store.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.evidence_notes import (  # noqa: E402
    MAX_DESCRIPTION,
    MAX_PROBLEM_LEN,
    clean_description,
    clean_place,
    clean_problems,
    format_place,
    review,
    summarise,
)

# ------------------------------------------------------------------ place


def test_place_keeps_known_fields_and_a_real_pincode():
    place = clean_place(json.dumps({
        "name": "Gevra Project", "district": "Korba", "state": "Chhattisgarh",
        "pincode": "495452", "source": "device", "evil": "<script>",
    }))
    assert place == {"name": "Gevra Project", "district": "Korba",
                     "state": "Chhattisgarh", "pincode": "495452",
                     "source": "device"}


def test_a_fake_pincode_is_dropped_not_stored():
    """A wrong PIN on evidence is worse than none."""
    for bad in ("12345", "0123456", "49545A", "4954521"):
        place = clean_place({"district": "Korba", "pincode": bad})
        assert "pincode" not in place, bad


def test_pincode_with_a_space_is_accepted():
    assert clean_place({"pincode": "495 452"})["pincode"] == "495452"


def test_source_alone_is_not_a_place():
    assert clean_place({"source": "device"}) is None


def test_garbage_place_is_none():
    for raw in (None, "", "not json", "[1,2]", 42):
        assert clean_place(raw) is None


def test_place_line_reads_most_specific_first_and_skips_repeats():
    line = format_place({"name": "Gevra Project", "city": "Korba",
                         "district": "Korba", "state": "Chhattisgarh",
                         "pincode": "495452"})
    assert line == "Gevra Project, Korba, Chhattisgarh 495452"


# ------------------------------------------------------- model annotations


def test_problems_are_trimmed_and_capped():
    raw = json.dumps(["  unsigned entry  ", "", "x" * 500] + ["p"] * 10)
    out = clean_problems(raw)
    assert out[0] == "unsigned entry"
    assert len(out[1]) <= MAX_PROBLEM_LEN
    assert len(out) == 5


def test_long_problem_is_cut_at_a_word_not_mid_word():
    reason = ('Does not appear to show "HEMM operator inspects the machine at the start of each shift": '
              + "the image depicts a laptop screen displaying a timer " * 12)
    out = clean_problems(json.dumps([reason]))[0]
    assert len(out) <= MAX_PROBLEM_LEN
    assert out.endswith("…")
    assert reason.startswith(out[:-1])
    assert out[-2] != " " and reason[len(out) - 1] == " "


def test_short_problem_is_untouched():
    assert clean_problems(json.dumps(["Blurred: sharpness 12"])) == ["Blurred: sharpness 12"]


def test_empty_description_is_none():
    assert clean_description("   ") is None
    assert len(clean_description("y" * 2000)) <= MAX_DESCRIPTION


# ---------------------------------------------------------------- summary


def test_summary_counts_detections_in_plain_words():
    vr = {"problems": [], "detections": [
        {"label": "laptop"}, {"label": "laptop"}, {"label": "laptop"},
        {"label": "person"},
    ]}
    assert summarise(vr, True) == "Usable photograph. Detected: 3 laptops and 1 person."


def test_summary_pluralises_people():
    vr = {"problems": [], "detections": [{"label": "person"}, {"label": "person"}]}
    assert summarise(vr, True) == "Usable photograph. Detected: 2 people."


def test_summary_leads_with_the_problem_when_there_is_one():
    vr = {"problems": [{"code": "too_dark", "text": "Too dark to verify"}],
          "detections": []}
    assert summarise(vr, True) == "Too dark to verify"


def test_summary_for_a_written_observation():
    assert summarise(None, False).startswith("Written observation only")


def test_summary_never_invents_an_object():
    vr = {"problems": [], "detections": []}
    assert "No people" in summarise(vr, True)


# ----------------------------------------------------------------- review


def test_review_names_the_source_of_every_reason():
    r = review(
        {"problems": [{"text": "Too dark to verify",
                       "because": "99.7% of the frame is near-black"}]},
        ["The register entry is not signed"],
        inside_lease=False,
    )
    assert r["needed"] is True
    assert [x["source"] for x in r["reasons"]] == ["measured", "geometry", "model"]
    assert "99.7%" in r["reasons"][0]["text"]


def test_a_clean_capture_needs_no_review():
    r = review({"problems": [], "detections": []}, None, inside_lease=True)
    assert r == {"needed": False, "reasons": []}


def test_unknown_lease_is_not_treated_as_outside():
    """None means the boundary check did not run, not that it failed."""
    assert review(None, None, inside_lease=None)["needed"] is False


def test_the_phones_formatted_address_is_preferred():
    line = format_place({"full": "Gevra Project Rd, Gevra, Korba, Chhattisgarh 495452, India",
                         "district": "Korba", "pincode": "495452"})
    assert line == "Gevra Project Rd, Gevra, Korba, Chhattisgarh 495452, India"


def test_pin_is_added_when_the_formatted_address_left_it_off():
    assert format_place({"full": "Gevra, Korba", "pincode": "495452"}) == "Gevra, Korba 495452"
