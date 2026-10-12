"""Local metric coordinates for the Loop.

A transverse Mercator projection centred on State St & Madison St, the zero
point of Chicago's street address grid. x points east, y points north, units
are meters. Over the few kilometers we model the scale error is well under a
millimeter per meter.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property

from pyproj import Transformer

# Fallback if the intersection cannot be found in the OSM data: the shared node
# of State St and Madison St in OpenStreetMap (node 27446720).
DEFAULT_ORIGIN = (41.8820455, -87.6278089)


@dataclass(frozen=True)
class LocalProjection:
    lat0: float
    lon0: float

    @property
    def proj4(self) -> str:
        return f"+proj=tmerc +lat_0={self.lat0} +lon_0={self.lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"

    @cached_property
    def _fwd(self) -> Transformer:
        return Transformer.from_crs("EPSG:4326", self.proj4, always_xy=True)

    @cached_property
    def _inv(self) -> Transformer:
        return Transformer.from_crs(self.proj4, "EPSG:4326", always_xy=True)

    def _forward(self) -> Transformer:
        return self._fwd

    def _inverse(self) -> Transformer:
        return self._inv

    def to_local(self, lat: float, lon: float) -> tuple[float, float]:
        x, y = self._forward().transform(lon, lat)
        return float(x), float(y)

    def to_latlon(self, x: float, y: float) -> tuple[float, float]:
        lon, lat = self._inverse().transform(x, y)
        return float(lat), float(lon)

    def many_to_local(self, coords: list[tuple[float, float]]) -> list[tuple[float, float]]:
        if not coords:
            return []
        lats = [c[0] for c in coords]
        lons = [c[1] for c in coords]
        xs, ys = self._forward().transform(lons, lats)
        return [(float(x), float(y)) for x, y in zip(xs, ys, strict=True)]
