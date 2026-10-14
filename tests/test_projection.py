import math

import pytest
from pyproj import Geod

from pipeline.projection import DEFAULT_ORIGIN, LocalProjection

PROJ = LocalProjection(*DEFAULT_ORIGIN)
GEOD = Geod(ellps="WGS84")


def test_origin_maps_to_zero():
    x, y = PROJ.to_local(*DEFAULT_ORIGIN)
    assert abs(x) < 1e-6 and abs(y) < 1e-6


def test_axes_point_east_and_north():
    lat0, lon0 = DEFAULT_ORIGIN
    x, y = PROJ.to_local(lat0 + 0.001, lon0)
    assert y > 100 and abs(x) < 0.01
    x, y = PROJ.to_local(lat0, lon0 + 0.001)
    assert x > 80 and abs(y) < 0.01


@pytest.mark.parametrize(
    "lat,lon",
    [(41.8857, -87.6339), (41.8755, -87.6244), (41.8790, -87.6359), (41.8888, -87.6340)],
)
def test_round_trip(lat, lon):
    x, y = PROJ.to_local(lat, lon)
    lat2, lon2 = PROJ.to_latlon(x, y)
    assert lat2 == pytest.approx(lat, abs=1e-9)
    assert lon2 == pytest.approx(lon, abs=1e-9)


def test_distances_match_the_ellipsoid():
    # Clark/Lake to Harold Washington Library: about 1.3 km across the Loop.
    a = (41.8857528, -87.6313736)
    b = (41.8769158, -87.6289437)
    _, _, geodesic = GEOD.inv(a[1], a[0], b[1], b[0])
    xa, ya = PROJ.to_local(*a)
    xb, yb = PROJ.to_local(*b)
    assert math.dist((xa, ya), (xb, yb)) == pytest.approx(geodesic, rel=1e-5)


def test_many_matches_single():
    pts = [(41.8857, -87.6339), (41.8755, -87.6244)]
    many = PROJ.many_to_local(pts)
    for (lat, lon), (x, y) in zip(pts, many, strict=True):
        sx, sy = PROJ.to_local(lat, lon)
        assert x == pytest.approx(sx) and y == pytest.approx(sy)
