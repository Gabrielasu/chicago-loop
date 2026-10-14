"""Checks on the real build output. Skipped when build/loop.json has not been built."""

import json
from pathlib import Path

import pytest

from pipeline.validate import LOOP_STATIONS, check

MODEL = Path(__file__).resolve().parent.parent / "build" / "loop.json"
pytestmark = pytest.mark.skipif(not MODEL.exists(), reason="run python -m pipeline.build first")


@pytest.fixture(scope="module")
def model():
    return json.loads(MODEL.read_text())


def test_validation_passes(model):
    assert check(model) == []


def test_eight_loop_stations(model):
    assert {s["name"] for s in model["stations"] if s["loop"]} == LOOP_STATIONS


def test_validation_catches_removed_station(model):
    broken = json.loads(json.dumps(model))
    broken["stations"].append({**broken["stations"][0], "name": "Randolph/Wabash", "loop": False})
    assert any("Randolph/Wabash" in e for e in check(broken))


def test_every_estimated_height_is_flagged(model):
    # Only a building's own OSM height counts as measured.
    for b in model["buildings"]:
        assert b["height_estimated"] == (b["height_source"] != "osm:height")
