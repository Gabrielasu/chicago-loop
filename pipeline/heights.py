"""Building height rules.

Order of preference:
1. OSM `height` (meters, or feet when written with ' or ft).
2. OSM `building:levels` (+ `roof:levels`) times METERS_PER_FLOOR. Estimated.
3. City of Chicago footprint `stories` times METERS_PER_FLOOR. Estimated.
4. A default by building type and size. Estimated:
   - `building=roof` (canopies) becomes a thin slab at street canopy height,
   - small structures (kiosks, booths, under SMALL_AREA m2) get one floor,
   - everything else gets DEFAULT_FLOORS.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

METERS_PER_FLOOR = 3.9
DEFAULT_FLOORS = 4
SMALL_AREA = 60.0
ROOF_HEIGHT = 4.5
ROOF_THICKNESS = 0.5
SMALL_TYPES = {"kiosk", "security_booth", "guardhouse", "elevator", "service", "shed", "toilets", "pavilion"}
FEET = 0.3048

_NUMBER = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|')?\s*$", re.I)
_FEET_INCHES = re.compile(r"^\s*(\d+)\s*'\s*(\d+(?:\.\d+)?)\s*\"\s*$")


def parse_length(value: str | None) -> float | None:
    """Parse an OSM length such as "120", "120 m", "394'" or "12'6\"" into meters."""
    if value is None:
        return None
    value = value.strip().replace(",", ".")
    m = _FEET_INCHES.match(value)
    if m:
        return (float(m.group(1)) + float(m.group(2)) / 12) * FEET
    m = _NUMBER.match(value)
    if not m:
        return None
    number = float(m.group(1))
    unit = (m.group(2) or "m").lower()
    if unit in ("ft", "feet", "'"):
        number *= FEET
    return number


def parse_count(value: str | int | float | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        n = float(str(value).strip().split(";")[0])
    except ValueError:
        return None
    return n if n > 0 else None


@dataclass(frozen=True)
class Height:
    height: float
    min_height: float
    estimated: bool
    source: str


def resolve_height(tags: dict[str, str], city_stories: float | None = None, area: float | None = None) -> Height:
    """Height and base height for an OSM building or building part."""
    min_height = parse_length(tags.get("min_height"))
    if min_height is None:
        min_level = parse_count(tags.get("building:min_level"))
        min_height = min_level * METERS_PER_FLOOR if min_level else 0.0

    height = parse_length(tags.get("height"))
    if height is not None and height > 0:
        return Height(height, min_height, False, "osm:height")

    levels = parse_count(tags.get("building:levels"))
    if levels:
        roof_levels = parse_count(tags.get("roof:levels")) or 0.0
        return Height((levels + roof_levels) * METERS_PER_FLOOR, min_height, True, "osm:building:levels")

    if city_stories:
        return Height(city_stories * METERS_PER_FLOOR, min_height, True, "city:stories")

    kind = tags.get("building") or tags.get("building:part") or ""
    if kind == "roof":
        top = max(min_height + ROOF_THICKNESS, ROOF_HEIGHT)
        return Height(top, top - ROOF_THICKNESS, True, "default:roof")
    if kind in SMALL_TYPES or (area is not None and area < SMALL_AREA):
        return Height(min_height + METERS_PER_FLOOR, min_height, True, "default:small")
    return Height(min_height + DEFAULT_FLOORS * METERS_PER_FLOOR, min_height, True, "default")


GLASS_VALUES = {"glass", "glass_curtain_wall", "curtain_wall", "glass;steel", "steel;glass"}


def material_of(tags: dict[str, str]) -> tuple[str | None, bool]:
    """Facade material recorded in OSM, and whether the facade is glass."""
    material = tags.get("building:material") or tags.get("building:facade:material") or tags.get("facade:material")
    if material:
        material = material.strip().lower()
    glass = bool(material and (material in GLASS_VALUES or material.startswith("glass")))
    return material, glass
