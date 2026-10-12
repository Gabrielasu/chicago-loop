"""The area we model.

The Loop proper runs from Lake St to Congress Pkwy and from Wells St to
Michigan Ave. We add one block on every side: Wacker Dr and the river to the
north, Harrison St to the south, Franklin St and Wacker Dr to the west and
Columbus Dr to the east.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BBox:
    south: float
    west: float
    north: float
    east: float

    def contains(self, lat: float, lon: float) -> bool:
        return self.south <= lat <= self.north and self.west <= lon <= self.east


BBOX = BBox(south=41.8728, west=-87.6385, north=41.8895, east=-87.6205)
