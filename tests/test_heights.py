import pytest

from pipeline.heights import (
    METERS_PER_FLOOR,
    ROOF_THICKNESS,
    material_of,
    parse_count,
    parse_length,
    resolve_height,
)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("120", 120.0),
        ("120 m", 120.0),
        ("120m", 120.0),
        ("12,5", 12.5),
        ("394'", 394 * 0.3048),
        ("100 ft", 30.48),
        ("12'6\"", 12.5 * 0.3048),
        ("tall", None),
        (None, None),
    ],
)
def test_parse_length(value, expected):
    result = parse_length(value)
    if expected is None:
        assert result is None
    else:
        assert result == pytest.approx(expected)


def test_parse_count():
    assert parse_count("12") == 12
    assert parse_count("3;4") == 3
    assert parse_count("0") is None
    assert parse_count("x") is None


def test_osm_height_wins_and_is_not_estimated():
    h = resolve_height({"height": "442", "building:levels": "108"}, city_stories=100)
    assert h.height == 442 and not h.estimated and h.source == "osm:height"


def test_levels_fall_back_at_3_9_m_per_floor():
    h = resolve_height({"building:levels": "10"}, city_stories=40)
    assert h.height == pytest.approx(10 * METERS_PER_FLOOR)
    assert h.estimated and h.source == "osm:building:levels"


def test_roof_levels_count():
    h = resolve_height({"building:levels": "10", "roof:levels": "1"})
    assert h.height == pytest.approx(11 * METERS_PER_FLOOR)


def test_city_stories_when_osm_has_nothing():
    h = resolve_height({"building": "yes"}, city_stories=22)
    assert h.height == pytest.approx(22 * METERS_PER_FLOOR)
    assert h.estimated and h.source == "city:stories"


def test_default_when_nothing_is_known():
    h = resolve_height({"building": "yes"}, None, area=800)
    assert h.estimated and h.source == "default" and h.height > METERS_PER_FLOOR


def test_small_structures_get_one_floor():
    assert resolve_height({"building": "kiosk"}, None, area=500).height == pytest.approx(METERS_PER_FLOOR)
    assert resolve_height({"building": "yes"}, None, area=20).source == "default:small"


def test_roofs_are_thin_slabs():
    h = resolve_height({"building": "roof"})
    assert h.height - h.min_height == pytest.approx(ROOF_THICKNESS)
    assert h.min_height > 2


def test_min_height_and_min_level():
    assert resolve_height({"height": "50", "min_height": "20"}).min_height == 20
    h = resolve_height({"building:levels": "30", "building:min_level": "10"})
    assert h.min_height == pytest.approx(10 * METERS_PER_FLOOR)
    assert h.height == pytest.approx(30 * METERS_PER_FLOOR)


def test_material():
    assert material_of({"building:material": "glass"}) == ("glass", True)
    assert material_of({"building:material": "Limestone"}) == ("limestone", False)
    assert material_of({}) == (None, False)
