"""
Dissolve each city's district boundaries into one outer outline, so the map
can draw a single light border around "St. Paul as a whole" / "Minneapolis
as a whole" instead of (or in addition to) the individual district lines.

Also exports web/public/data/city_divider.geojson — the line segment(s) where
the two dissolved city outlines actually touch, so the frontend can style
the St. Paul/Minneapolis shared border distinctly from each city's outward-
facing perimeter (e.g. a dashed line vs. a solid one).

Also exports web/public/data/city_outline_zip.geojson — the dissolved outer
edge of every included ZIP code (a different shape than the district-based
outline, since the ZIP pool excludes/includes different area at the edges —
see core/load.py's load_zip_boundaries 98%-coverage filter), so the map's
outer border can switch to match whichever granularity is active instead of
always showing the district-shaped edge even in ZIP view.

Output:
  web/public/data/city_outline_{stpaul,mpls}.geojson — a single Feature per
    city (Polygon or MultiPolygon) with no per-district seams.
  web/public/data/city_outline_zip.geojson — a single Feature for the outer
    edge of the combined ZIP pool.
  web/public/data/city_divider.geojson — a single Feature (LineString or
    MultiLineString) for the shared St. Paul/Minneapolis border.
"""

import sys
from pathlib import Path as _BootstrapPath
sys.path.insert(0, str(_BootstrapPath(__file__).resolve().parent.parent))

import json
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from core.load import resolve_boundaries, load_zip_boundaries

PIPELINE_DIR = Path(__file__).resolve().parent.parent
WEB_DATA_DIR = PIPELINE_DIR.parent / "web" / "public" / "data"


def build_city_divider(stpaul_dissolved, mpls_dissolved):
    """The shared border as a thin polygon strip (not a snapped-to-vertices
    line): St. Paul's and Minneapolis's boundaries come from two
    independently-maintained ArcGIS layers, so even along their genuinely
    shared border the digitized vertices can sit tens of meters apart —
    an exact-geometry (or near-zero-buffer) intersection only catches the
    rare spots where they happen to coincide almost exactly, producing a
    sparse, geographically-misleading fragment instead of the real border
    (this is what a first attempt at this function did wrong). Buffering
    each boundary out by ~40m before intersecting bridges that typical
    digitization gap and reliably captures the whole shared border as a
    thin ribbon, which the frontend renders as a filled strip rather than
    trying to draw a perfectly precise single line."""
    buffer_deg = 0.0009  # ~90m at this latitude — 40m left small gaps where the
    # river (a wider natural feature) makes the two cities' digitized
    # boundaries diverge more than a typical street-following border does
    return stpaul_dissolved.boundary.buffer(buffer_deg).intersection(mpls_dissolved.boundary.buffer(buffer_deg))


def export_city_outlines():
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)

    dissolved_by_city = {}
    for city in ("stpaul", "mpls"):
        boundaries = resolve_boundaries(city=city, granularity="district")
        polygons = [shape(feature["geometry"]) for feature in boundaries["features"]]
        dissolved = unary_union(polygons)
        dissolved_by_city[city] = dissolved

        outline = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {"city": city}, "geometry": mapping(dissolved)}],
        }
        out_path = WEB_DATA_DIR / f"city_outline_{city}.geojson"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(outline, f)
        print(f"[OK] Wrote {city} city outline to {out_path}")

    divider = build_city_divider(dissolved_by_city["stpaul"], dissolved_by_city["mpls"])
    divider_geojson = {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {}, "geometry": mapping(divider)}] if not divider.is_empty else [],
    }
    divider_path = WEB_DATA_DIR / "city_divider.geojson"
    with open(divider_path, "w", encoding="utf-8") as f:
        json.dump(divider_geojson, f)
    print(f"[OK] Wrote city divider line to {divider_path}")

    zip_boundaries = load_zip_boundaries()
    zip_polygons = [shape(feature["geometry"]) for feature in zip_boundaries["features"]]
    zip_dissolved = unary_union(zip_polygons)
    zip_outline = {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {}, "geometry": mapping(zip_dissolved)}],
    }
    zip_outline_path = WEB_DATA_DIR / "city_outline_zip.geojson"
    with open(zip_outline_path, "w", encoding="utf-8") as f:
        json.dump(zip_outline, f)
    print(f"[OK] Wrote ZIP-pool outline to {zip_outline_path}")


if __name__ == "__main__":
    export_city_outlines()
