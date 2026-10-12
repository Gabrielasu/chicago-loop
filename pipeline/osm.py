"""Minimal OpenStreetMap XML reader: nodes, ways, relations and ring assembly."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

LatLon = tuple[float, float]


@dataclass
class Node:
    id: int
    lat: float
    lon: float
    tags: dict[str, str]


@dataclass
class Way:
    id: int
    nodes: list[int]
    tags: dict[str, str]

    @property
    def closed(self) -> bool:
        return len(self.nodes) > 3 and self.nodes[0] == self.nodes[-1]


@dataclass
class Member:
    type: str
    ref: int
    role: str


@dataclass
class Relation:
    id: int
    members: list[Member]
    tags: dict[str, str]


@dataclass
class OsmData:
    nodes: dict[int, Node] = field(default_factory=dict)
    ways: dict[int, Way] = field(default_factory=dict)
    relations: dict[int, Relation] = field(default_factory=dict)

    def coords(self, node_ids: list[int]) -> list[LatLon] | None:
        """Lat/lon for a list of node ids, or None if any node is missing."""
        out: list[LatLon] = []
        for nid in node_ids:
            n = self.nodes.get(nid)
            if n is None:
                return None
            out.append((n.lat, n.lon))
        return out


def _tags(el: ET.Element) -> dict[str, str]:
    return {t.get("k", ""): t.get("v", "") for t in el.findall("tag")}


def load(path: Path) -> OsmData:
    root = ET.parse(path).getroot()
    data = OsmData()
    for el in root.iter("node"):
        nid = int(el.get("id", "0"))
        data.nodes[nid] = Node(nid, float(el.get("lat", "0")), float(el.get("lon", "0")), _tags(el))
    for el in root.iter("way"):
        wid = int(el.get("id", "0"))
        refs = [int(nd.get("ref", "0")) for nd in el.findall("nd")]
        data.ways[wid] = Way(wid, refs, _tags(el))
    for el in root.iter("relation"):
        rid = int(el.get("id", "0"))
        members = [Member(m.get("type", ""), int(m.get("ref", "0")), m.get("role", "")) for m in el.findall("member")]
        data.relations[rid] = Relation(rid, members, _tags(el))
    return data


def join_ways(segments: list[list[int]]) -> list[list[int]]:
    """Join node sequences that share end points into as few chains as possible.

    Used to assemble multipolygon rings. Closed rings come back with the first
    node repeated at the end.
    """
    pending = [list(s) for s in segments if len(s) >= 2]
    chains: list[list[int]] = []
    while pending:
        chain = pending.pop(0)
        changed = True
        while changed and chain[0] != chain[-1]:
            changed = False
            for i, seg in enumerate(pending):
                if seg[0] == chain[-1]:
                    chain.extend(seg[1:])
                elif seg[-1] == chain[-1]:
                    chain.extend(reversed(seg[:-1]))
                elif seg[-1] == chain[0]:
                    chain[:0] = seg[:-1]
                elif seg[0] == chain[0]:
                    chain[:0] = list(reversed(seg[1:]))
                else:
                    continue
                pending.pop(i)
                changed = True
                break
        chains.append(chain)
    return chains


def chain_route(way_node_lists: list[list[int]]) -> list[int]:
    """Concatenate the ordered ways of a route relation into one node path.

    Each way may be stored in either direction; we orient it so it connects to
    the previous one. Gaps are bridged by simply continuing with the next way.
    """
    path: list[int] = []
    for i, nodes in enumerate(way_node_lists):
        if not nodes:
            continue
        seq = list(nodes)
        if not path:
            # Orient the first way towards the second one.
            if i + 1 < len(way_node_lists) and way_node_lists[i + 1]:
                nxt = way_node_lists[i + 1]
                if seq[0] in (nxt[0], nxt[-1]):
                    seq.reverse()
            path.extend(seq)
            continue
        if seq[-1] == path[-1]:
            seq.reverse()
        if seq[0] == path[-1]:
            path.extend(seq[1:])
        else:
            path.extend(seq)
    return path
