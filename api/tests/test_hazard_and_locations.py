"""Breach detection, and the catalogue of places it reports against.

Breach detection is the other thing this project promises never gets it wrong:
"a statutory alert cannot depend on a probabilistic system". That promise is
only worth anything if the arithmetic is actually tested, so these assert the
two triggers independently and check that a healthy window stays quiet.

The locations catalogue is tested for internal consistency rather than content.
Whether "Return airway - District 3" is the right place for a methane sensor is
a domain judgement; whether every point offers at least one sensor and no two
points share a key is a fact, and a duplicate key would silently merge two
places into one in every query that groups by it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import locations  # noqa: E402
from services.hazard import (  # noqa: E402
    THRESHOLDS,
    alert_message,
    evaluate,
    threshold_for,
)


# --------------------------------------------------------------- thresholds


def test_methane_threshold_matches_the_regulation():
    """1.25% is the figure CMR 2017 sets. It is not ours to round."""
    cfg = threshold_for("methane")
    assert cfg is not None
    assert cfg["threshold"] == 1.25


def test_unknown_sensor_has_no_threshold():
    """A sensor with no entry must return None, not a default.

    Inventing a threshold for an unrecognised stream would produce an alert
    citing a limit nobody set - the exact failure this system exists to
    prevent.
    """
    assert threshold_for("nonsense_sensor") is None


def test_absolute_breach_fires():
    cfg = threshold_for("methane")
    over = cfg["threshold"] * 1.4
    stats = evaluate("methane", [0.6] * 20 + [over])
    assert stats["breaching"] is True


def test_healthy_window_stays_quiet():
    """Readings well under the limit must not fire.

    A detector that cries wolf on normal operation gets switched off, and then
    it is not a detector at all.
    """
    cfg = threshold_for("methane")
    quiet = cfg["threshold"] * 0.4
    stats = evaluate("methane", [quiet] * 40)
    assert stats["breaching"] is False


def test_a_sharp_rise_below_the_limit_is_still_flagged():
    """The z-score trigger is the early warning, and it is separate.

    Waiting for the absolute limit means only reporting a breach that has
    already happened. A run of calm readings followed by a sharp jump is
    reported even while the value is legal - and the router downgrades that to
    a warning so "critical" keeps meaning "this has broken the law".
    """
    cfg = threshold_for("methane")
    calm = [0.30, 0.31, 0.29, 0.30, 0.32, 0.28, 0.31, 0.30] * 3
    spike = cfg["threshold"] * 0.8  # high for the window, still under the limit
    stats = evaluate("methane", calm + [spike])

    assert spike < cfg["threshold"]
    assert stats["breaching"] is True
    assert stats.get("reason") == "rising"


def test_alert_message_names_the_number_and_the_unit():
    cfg = threshold_for("methane")
    stats = evaluate("methane", [0.6] * 20 + [cfg["threshold"] * 1.5])
    msg = alert_message("methane", stats, "%")

    assert "methane" in msg.lower()
    assert str(cfg["threshold"]) in msg
    assert "%" in msg


def test_every_threshold_entry_is_usable():
    """Each configured sensor must have a numeric threshold and a severity."""
    for name, cfg in THRESHOLDS.items():
        if not isinstance(cfg, dict):
            continue
        assert isinstance(cfg.get("threshold"), (int, float)), name
        assert cfg.get("severity") in {"info", "warning", "critical"}, name


# ---------------------------------------------------------------- locations


def test_location_keys_are_unique():
    """A duplicate key silently merges two places in every grouped query."""
    keys = [p.key for p in locations.POINTS]
    assert len(keys) == len(set(keys))


def test_every_point_takes_at_least_one_sensor():
    for p in locations.POINTS:
        assert p.sensor_types, f"{p.key} offers no sensor"


def test_every_point_explains_itself():
    """`why` is shown in the app under the picker. An empty one is a bug."""
    for p in locations.POINTS:
        assert p.why.strip(), f"{p.key} has no reason"
        assert p.method in {"underground", "opencast", "both"}, p.key


def test_methane_is_offered_in_a_return_airway():
    """The regulated figure is methane in the general body of return air.

    If the catalogue ever stops offering a return airway for methane, the app
    can no longer record the reading regulation actually asks for.
    """
    points = locations.for_sensor("methane")
    assert any("return" in p.key for p in points)


def test_for_sensor_filters_rather_than_returning_everything():
    """Offering "methane at the water discharge point" invents instrumentation."""
    methane = {p.key for p in locations.for_sensor("methane")}
    assert methane
    assert methane != {p.key for p in locations.POINTS}
    assert "discharge_point" not in methane


@pytest.mark.parametrize("key", ["return_airway_d3", "dump_slope_north"])
def test_label_for_resolves_known_keys(key):
    label = locations.label_for(key)
    assert label and label != key


def test_label_for_passes_through_the_unknown():
    """A reading from a point the catalogue has not heard of is still a reading."""
    assert locations.label_for("some_new_gantry") == "some_new_gantry"
    assert locations.label_for(None) is None


def test_catalogue_is_serialisable():
    """It crosses the wire to the handset picker, so it must be plain data."""
    import json

    cat = locations.catalogue()
    assert len(cat) == len(locations.POINTS)
    json.dumps(cat)
