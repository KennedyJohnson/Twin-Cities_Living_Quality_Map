#!/usr/bin/env python3
"""
Fetch real St. Paul District Council boundaries from the City of Saint Paul's
ArcGIS FeatureServer and write them as GeoJSON for the web map.

Join key: ArcGIS `districtnumber` -> feature.id / properties.district_id,
matching the numeric district_id used in web/public/data/neighborhoods.json.
"""

import json
import urllib.request
import urllib.error

ARCGIS_URL = (
    "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/"
    "District_Councils/FeatureServer/0/query"
)

def fetch_boundaries():
    params = {
        'where': '1=1',
        'outFields': '*',
        'returnGeometry': 'true',
        'outSR': '4326',
        'f': 'geojson',
    }
    query_string = '&'.join(f'{k}={v}' for k, v in params.items())
    url = f"{ARCGIS_URL}?{query_string}"

    print("Fetching real district boundaries from ArcGIS...")
    with urllib.request.urlopen(url, timeout=30) as response:
        data = json.loads(response.read().decode('utf-8'))

    if 'features' not in data or not data['features']:
        raise RuntimeError("No features returned from ArcGIS query")

    for feature in data['features']:
        props = feature.get('properties', {})
        district_id = int(props['districtnumber'])
        feature['id'] = district_id
        props['district_id'] = district_id
        feature['properties'] = props

    return data

if __name__ == '__main__':
    geojson = fetch_boundaries()

    output_path = 'web/public/data/boundaries.geojson'
    with open(output_path, 'w') as f:
        json.dump(geojson, f)

    print(f"[OK] Wrote {len(geojson['features'])} real district boundaries to {output_path}")
