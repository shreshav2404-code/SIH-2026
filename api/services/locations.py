"""Where a mine is actually monitored.

Regulation names PLACES, not mines. CMR 2017 sets the methane limit in the
general body of return air of a district, not "in the mine"; CPCB consent
conditions specify ambient dust at the lease boundary and the nearest
habitation; blast vibration limits protect structures, so the monitor stands at
the nearest house rather than at the blast.

A reading without a location is therefore not far off useless: "methane is
high" is not actionable, "methane is high in the return airway of District 3"
sends someone somewhere. This module is the catalogue the app offers and the
alert text quotes.

Underground and opencast are different sets on purpose - Gevra is opencast and
has no return airway, while a bord-and-pillar mine has no overburden dump. The
`method` field says which points apply.
"""

from __future__ import annotations

from typing import Literal

Method = Literal["underground", "opencast", "both"]


class Point:
    __slots__ = ("key", "label", "sensor_types", "method", "why")

    def __init__(
        self,
        key: str,
        label: str,
        sensor_types: list[str],
        method: Method,
        why: str,
    ) -> None:
        self.key = key
        self.label = label
        self.sensor_types = sensor_types
        self.method = method
        self.why = why

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "sensor_types": self.sensor_types,
            "method": self.method,
            "why": self.why,
        }


POINTS: list[Point] = [
    # ---- underground: gas ------------------------------------------------
    Point(
        "return_airway_d1",
        "Return airway — District 1",
        ["methane", "carbon_monoxide"],
        "underground",
        "The regulated figure is methane in the general body of return air.",
    ),
    Point(
        "return_airway_d3",
        "Return airway — District 3",
        ["methane", "carbon_monoxide"],
        "underground",
        "The regulated figure is methane in the general body of return air.",
    ),
    Point(
        "face_roof_d3",
        "Working face, within 300mm of roof — District 3",
        ["methane"],
        "underground",
        "Methane layers at the roof; a sensor at chest height reads safe while a layer sits above it.",
    ),
    Point(
        "main_return",
        "Main return, near the ventilator",
        ["methane", "carbon_monoxide"],
        "underground",
        "Whole-mine methane, and where the fan's own performance shows up.",
    ),
    Point(
        "sealed_area_7",
        "Behind stoppings — sealed area 7",
        ["carbon_monoxide", "methane"],
        "underground",
        "Rising CO behind a seal is the earliest sign of spontaneous heating.",
    ),
    Point(
        "belt_road_b2",
        "Belt roadway B2",
        ["carbon_monoxide"],
        "underground",
        "CO is the detector for a conveyor fire.",
    ),
    # ---- underground: ventilation and strata ------------------------------
    Point(
        "main_ventilator",
        "Main mechanical ventilator",
        ["air_quantity", "illumination"],
        "underground",
        "Reg. 46 requires the main ventilator to be checked daily and the result recorded.",
    ),
    Point(
        "intake_split_a",
        "Intake split A",
        ["air_quantity"],
        "underground",
        "Air quantity per district is what makes a split adequate or not.",
    ),
    Point(
        "convergence_d3_g4",
        "Convergence station — District 3, gate road 4",
        ["strata_convergence"],
        "underground",
        "Roof movement is measured at fixed stations, not sampled at random.",
    ),
    Point(
        "junction_d1_load",
        "Support load cell — District 1 junction",
        ["strata_convergence"],
        "underground",
        "Junctions carry the worst roof loading in a bord-and-pillar layout.",
    ),
    # ---- opencast ---------------------------------------------------------
    Point(
        "dump_slope_north",
        "Overburden dump — north slope",
        ["strata_convergence", "water_level"],
        "opencast",
        "Dump slope movement and pore pressure are what precede a slip.",
    ),
    Point(
        "dump_slope_east",
        "Overburden dump — east slope",
        ["strata_convergence", "water_level"],
        "opencast",
        "Dump slope movement and pore pressure are what precede a slip.",
    ),
    Point(
        "highwall_bench_5",
        "Highwall — bench 5",
        ["strata_convergence", "vibration"],
        "opencast",
        "Highwall stability governs whether men and machines may work below it.",
    ),
    Point(
        "nearest_habitation",
        "Nearest habitation — Bhilaikhurd",
        ["vibration", "pm10"],
        "opencast",
        "The blast vibration limit protects structures, so it is measured at the house, not at the blast.",
    ),
    Point(
        "lease_boundary_west",
        "Ambient station — west lease boundary",
        ["pm10", "pm25"],
        "both",
        "CPCB consent conditions specify ambient dust at the lease boundary.",
    ),
    Point(
        "haul_road_main",
        "Main haul road",
        ["pm10"],
        "opencast",
        "Haul roads are the dominant dust source on an opencast mine.",
    ),
    Point(
        "discharge_point",
        "Mine water discharge point",
        ["water_level", "ph", "tss"],
        "both",
        "Effluent is regulated where it leaves the lease, before it reaches a watercourse.",
    ),
    # ---- everywhere -------------------------------------------------------
    Point(
        "workshop",
        "Workshop and stores",
        ["illumination", "pm10"],
        "both",
        "Illumination at working places is a statutory duty in its own right.",
    ),
]


def for_sensor(sensor_type: str) -> list[Point]:
    """Points where this sensor type is actually installed."""
    return [p for p in POINTS if sensor_type in p.sensor_types]


def label_for(key: str | None) -> str | None:
    if not key:
        return None
    for p in POINTS:
        if p.key == key:
            return p.label
    # An unknown key is shown as itself rather than dropped - a reading from a
    # point this catalogue has not heard of is still a reading.
    return key


def catalogue() -> list[dict]:
    return [p.as_dict() for p in POINTS]
