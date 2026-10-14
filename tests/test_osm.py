from pipeline.osm import chain_route, join_ways


def test_join_ways_closes_a_ring_from_reversed_pieces():
    rings = join_ways([[1, 2, 3], [5, 4, 3], [5, 6, 1]])
    assert len(rings) == 1
    ring = rings[0]
    assert ring[0] == ring[-1]
    assert sorted(set(ring)) == [1, 2, 3, 4, 5, 6]


def test_join_ways_keeps_separate_rings():
    rings = join_ways([[1, 2, 3, 1], [7, 8, 9, 7]])
    assert len(rings) == 2


def test_chain_route_orients_ways():
    # The first and last ways are stored against the direction of travel.
    path = chain_route([[2, 1][::-1], [2, 3], [5, 4, 3]])
    assert path == [1, 2, 3, 4, 5]


def test_chain_route_first_way_reversed():
    path = chain_route([[3, 2, 1], [3, 4], [4, 5]])
    assert path == [1, 2, 3, 4, 5]
