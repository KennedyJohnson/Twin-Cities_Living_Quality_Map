"""
Compute a Zillow-style Walk/Bike Score per district: distance-decay
proximity to daily-need amenities (groceries, restaurants/bars, schools,
transit, healthcare) + street-intersection density (a block-size /
bikeability proxy) + trail km per capita.

Bypasses the generic aggregate_by_source per-district-count pipeline (like
compute_affordability_index in health_score.py) because this metric needs
point-level distance calculations across a sampled grid, not a simple
district-level count or sum.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))


import time
import numpy as np
from shapely.geometry import Point, shape
from core.load import load_boundaries, load_population, load_zip_boundaries, load_zip_population
from core.http_cache import cached_post
from cleaners.clean_transit import _fetch_nodes as _fetch_transit_nodes
from cleaners.clean_schools import _fetch_nodes as _fetch_school_nodes
from cleaners.clean_groceries import _fetch_nodes as _fetch_grocery_nodes
from cleaners.clean_healthcare import _fetch_nodes as _fetch_healthcare_nodes
from cleaners.clean_restaurants import _fetch_nodes as _fetch_restaurant_nodes
from cleaners.clean_walkability import clean_walkability

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Twin Cities bounding box (south, west, north, east) - matches the other
# OSM-based cleaners so results line up across sources.
BBOX = "44.85, -93.35, 45.05, -92.95"

STREET_QUERY = f"""
[out:json][timeout:90];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)$"]({BBOX});
out geom;
"""

# category -> weight, mirroring Walk Score's emphasis on groceries/dining
# over single-purpose destinations like schools or healthcare.
AMENITY_WEIGHTS = {
    "grocery": 3.0,
    "restaurant": 3.0,
    "transit": 1.5,
    "school": 1.0,
    "healthcare": 1.0,
}

GRID_SIZE = 6  # points per side of each district's bounding-box grid
DECAY_KM = 1.6  # ~1 mile: distance at which proximity score reaches 0

# Final blend of the three sub-scores into one 0-100 Walk/Bike Score.
PROXIMITY_WEIGHT = 0.55
INTERSECTION_WEIGHT = 0.30
TRAIL_WEIGHT = 0.15


def _fetch_street_ways(max_retries=3):
    """Query Overpass for real street ways (not trails/paths) so we can
    derive intersection density. Same retry pattern as the other cleaners."""
    headers = {
        "User-Agent": "StPaulNeighborhoodHealth/1.0 (data pipeline)",
        "Accept": "*/*"
    }
    last_error = None
    for attempt in range(max_retries):
        try:
            response = cached_post(OVERPASS_URL, data={"data": STREET_QUERY}, headers=headers, timeout=150)
            response.raise_for_status()
            return response.json()["elements"]
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                time.sleep(15 * (attempt + 1))
    raise last_error


def _extract_points(elements):
    """elements: Overpass node/way elements -> Nx2 array of (lon, lat)."""
    pts = []
    for el in elements:
        lat, lon = el.get("lat"), el.get("lon")
        if lat is None or lon is None:
            center = el.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue
        pts.append((lon, lat))
    return np.array(pts) if pts else np.empty((0, 2))


def _intersection_points(ways):
    """A node referenced by >=2 distinct street ways approximates a street
    intersection. Overpass's "out geom" includes each way's node-id list
    alongside its coordinate list (same order/length), so we can join them
    without a separate node query."""
    node_ways = {}
    node_coord = {}
    for way in ways:
        node_ids = way.get("nodes") or []
        geometry = way.get("geometry") or []
        if len(node_ids) != len(geometry):
            continue
        way_id = way.get("id")
        for node_id, pt in zip(node_ids, geometry):
            node_ways.setdefault(node_id, set()).add(way_id)
            node_coord[node_id] = (pt["lon"], pt["lat"])
    pts = [node_coord[nid] for nid, way_ids in node_ways.items() if len(way_ids) >= 2]
    return np.array(pts) if pts else np.empty((0, 2))


def _grid_points(polygon, n=GRID_SIZE):
    """Sample an n x n grid over the polygon's bounding box, clipped to
    points actually inside the polygon (falls back to the centroid for
    slivers too thin for any grid point to land inside)."""
    minx, miny, maxx, maxy = polygon.bounds
    xs = np.linspace(minx, maxx, n)
    ys = np.linspace(miny, maxy, n)
    points = [(x, y) for x in xs for y in ys if polygon.contains(Point(x, y))]
    if not points:
        c = polygon.centroid
        points = [(c.x, c.y)]
    return np.array(points)


def _nearest_distances_km(grid_pts, amenity_pts):
    """Nearest-amenity distance (km) for each grid point, via flat-earth
    degree distance * 111 km/degree (fine at this latitude for short
    distances, same approximation used by clean_walkability.py)."""
    if len(amenity_pts) == 0 or len(grid_pts) == 0:
        return np.full(len(grid_pts), np.inf)
    diff = grid_pts[:, None, :] - amenity_pts[None, :, :]
    dist_deg = np.sqrt((diff ** 2).sum(axis=2)).min(axis=1)
    return dist_deg * 111.0


def _proximity_scores(grid_pts, amenity_pts):
    dist_km = _nearest_distances_km(grid_pts, amenity_pts)
    return np.clip(100.0 * (1.0 - dist_km / DECAY_KM), 0.0, 100.0)


def _normalize(values_dict):
    """Z-score + logistic squash to (0, 100), same method as health_score's
    min_max_normalize (kept separate to avoid a cross-module dependency)."""
    if not values_dict:
        return {}
    vals = np.array(list(values_dict.values()), dtype=float)
    mean, std = vals.mean(), vals.std()
    if std == 0:
        return {k: 50.0 for k in values_dict}
    z = (vals - mean) / std
    norm = 100 / (1 + np.exp(-z))
    return dict(zip(values_dict.keys(), norm))


def _raw_walk_components(city):
    """
    Fetch amenities/streets/trails once and compute the un-normalized,
    per-district proximity score, intersection density, and trail-km-per-
    capita for one city. Split out from compute_walk_score so
    compute_walk_score_combined() can pool both cities before normalizing
    (Severity 1 in the pipeline fairness audit) instead of each city
    normalizing its intersection-density/trail values against only itself.

    Returns:
        (proximity_by_district, intersection_density_by_district, trail_pc_by_district)
    """
    boundaries = load_boundaries(city=city)
    boundary_map = {}
    for feature in boundaries["features"]:
        district_id = feature["properties"]["district_id"]
        boundary_map[district_id] = shape(feature["geometry"])

    population = load_population(city=city).set_index("district_id")["population"].to_dict()

    amenity_fetchers = {
        "grocery": _fetch_grocery_nodes,
        "restaurant": _fetch_restaurant_nodes,
        "school": _fetch_school_nodes,
        "transit": _fetch_transit_nodes,
        "healthcare": _fetch_healthcare_nodes,
    }
    amenity_points = {}
    for name, fetch_fn in amenity_fetchers.items():
        try:
            amenity_points[name] = _extract_points(fetch_fn())
        except Exception as e:
            print(f"  [WARNING] {name} fetch failed for walk score ({e}); excluded")
            amenity_points[name] = np.empty((0, 2))

    try:
        intersection_pts = _intersection_points(_fetch_street_ways())
    except Exception as e:
        print(f"  [WARNING] Street network fetch failed ({e}); intersection density excluded")
        intersection_pts = np.empty((0, 2))

    try:
        trails = clean_walkability(city=city)
        trail_km_by_district = trails.groupby("district_id")["value"].sum().to_dict() if not trails.empty else {}
    except Exception:
        trail_km_by_district = {}

    proximity_by_district = {}
    intersection_density_by_district = {}

    for district_id, polygon in boundary_map.items():
        grid_pts = _grid_points(polygon)

        weighted_sum, weight_total = 0.0, 0.0
        for name, weight in AMENITY_WEIGHTS.items():
            scores = _proximity_scores(grid_pts, amenity_points.get(name, np.empty((0, 2))))
            weighted_sum += scores.mean() * weight
            weight_total += weight
        proximity_by_district[district_id] = weighted_sum / weight_total if weight_total else 0.0

        area_km2 = polygon.area * (111.0 ** 2)
        count = sum(1 for x, y in intersection_pts if polygon.contains(Point(x, y))) if len(intersection_pts) else 0
        intersection_density_by_district[district_id] = count / area_km2 if area_km2 > 0 else 0.0

    trail_pc_by_district = {}
    for district_id in boundary_map:
        pop = population.get(district_id) or 0
        trail_km = trail_km_by_district.get(district_id, 0.0)
        trail_pc_by_district[district_id] = (trail_km / pop * 1000) if pop else 0.0

    return proximity_by_district, intersection_density_by_district, trail_pc_by_district


def _raw_walk_components_zip():
    """
    Same computation as _raw_walk_components(), but over the whole metro's
    ZIP boundary set in one pass rather than per-city — ZIP boundaries are
    already metro-wide (not split by city), so looping per city would
    recompute the same zip grids twice.

    Returns:
        (proximity_by_zip, intersection_density_by_zip, trail_pc_by_zip)
    """
    boundaries = load_zip_boundaries()
    boundary_map = {}
    for feature in boundaries["features"]:
        zone_id = feature["properties"]["district_id"]
        boundary_map[zone_id] = shape(feature["geometry"])

    population = load_zip_population().set_index("district_id")["population"].to_dict()

    amenity_fetchers = {
        "grocery": _fetch_grocery_nodes,
        "restaurant": _fetch_restaurant_nodes,
        "school": _fetch_school_nodes,
        "transit": _fetch_transit_nodes,
        "healthcare": _fetch_healthcare_nodes,
    }
    amenity_points = {}
    for name, fetch_fn in amenity_fetchers.items():
        try:
            amenity_points[name] = _extract_points(fetch_fn())
        except Exception as e:
            print(f"  [WARNING] {name} fetch failed for zip walk score ({e}); excluded")
            amenity_points[name] = np.empty((0, 2))

    try:
        intersection_pts = _intersection_points(_fetch_street_ways())
    except Exception as e:
        print(f"  [WARNING] Street network fetch failed ({e}); intersection density excluded")
        intersection_pts = np.empty((0, 2))

    trail_km_by_zip = {}
    for city in ("stpaul", "mpls"):
        try:
            trails = clean_walkability(city=city, granularity="zip")
            if not trails.empty:
                for zone_id, total in trails.groupby("district_id")["value"].sum().items():
                    trail_km_by_zip[zone_id] = trail_km_by_zip.get(zone_id, 0.0) + total
        except Exception:
            continue

    proximity_by_zip = {}
    intersection_density_by_zip = {}

    for zone_id, polygon in boundary_map.items():
        grid_pts = _grid_points(polygon)

        weighted_sum, weight_total = 0.0, 0.0
        for name, weight in AMENITY_WEIGHTS.items():
            scores = _proximity_scores(grid_pts, amenity_points.get(name, np.empty((0, 2))))
            weighted_sum += scores.mean() * weight
            weight_total += weight
        proximity_by_zip[zone_id] = weighted_sum / weight_total if weight_total else 0.0

        area_km2 = polygon.area * (111.0 ** 2)
        count = sum(1 for x, y in intersection_pts if polygon.contains(Point(x, y))) if len(intersection_pts) else 0
        intersection_density_by_zip[zone_id] = count / area_km2 if area_km2 > 0 else 0.0

    trail_pc_by_zip = {}
    for zone_id in boundary_map:
        pop = population.get(zone_id) or 0
        trail_km = trail_km_by_zip.get(zone_id, 0.0)
        trail_pc_by_zip[zone_id] = (trail_km / pop * 1000) if pop else 0.0

    return proximity_by_zip, intersection_density_by_zip, trail_pc_by_zip


def compute_walk_score_zip():
    """
    Compute a 0-100 Walk/Bike Score for every ZIP in the metro, pooled into
    one normalization (mirrors compute_walk_score_combined() but at zip
    granularity).

    Returns:
        dict: {zip_code: walk_score_value (0-100)}
    """
    proximity, intersections, trails = _raw_walk_components_zip()
    return _blend_walk_score(proximity, intersections, trails)


def _blend_walk_score(proximity_by_district, intersection_density_by_district, trail_pc_by_district):
    intersection_norm = _normalize(intersection_density_by_district)
    trail_norm = _normalize(trail_pc_by_district)

    walk_score = {}
    for district_id in proximity_by_district:
        proximity = proximity_by_district.get(district_id, 0.0)
        intersections = intersection_norm.get(district_id, 50.0)
        trails_score = trail_norm.get(district_id, 50.0)
        walk_score[district_id] = round(
            PROXIMITY_WEIGHT * proximity + INTERSECTION_WEIGHT * intersections + TRAIL_WEIGHT * trails_score, 2
        )
    return walk_score


def compute_walk_score(city="stpaul"):
    """
    Compute a 0-100 Walk/Bike Score per district, normalized against only
    that city's own districts. Superseded by compute_walk_score_combined()
    for the real map/build pipeline (see Severity 1 in the pipeline
    fairness audit). Kept for standalone single-city testing/debugging.

    Returns:
        dict: {district_id: walk_score_value (0-100)}
    """
    proximity, intersections, trails = _raw_walk_components(city)
    return _blend_walk_score(proximity, intersections, trails)


def compute_walk_score_combined():
    """
    Compute a 0-100 Walk/Bike Score for all 28 districts, with intersection
    density and trail-km-per-capita normalized once across both cities
    instead of each city separately (proximity scores are already an
    absolute 0-100 distance-decay value, not normalized against the
    district set, so they need no pooling).

    Returns:
        dict: {district_id: walk_score_value (0-100)} for all 28 districts
    """
    stpaul = _raw_walk_components("stpaul")
    mpls = _raw_walk_components("mpls")

    proximity = {**stpaul[0], **mpls[0]}
    intersections = {**stpaul[1], **mpls[1]}
    trails = {**stpaul[2], **mpls[2]}

    return _blend_walk_score(proximity, intersections, trails)


if __name__ == "__main__":
    for city in ("stpaul", "mpls"):
        print(f"Computing walk score for {city}...")
        scores = compute_walk_score(city=city)
        for district_id in sorted(scores):
            print(f"  District {district_id}: {scores[district_id]}")
        print()
