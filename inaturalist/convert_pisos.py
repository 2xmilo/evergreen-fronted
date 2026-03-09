"""
convert_pisos.py
Converts Pisos Vegetacionales shapefile to web-optimized GeoJSON.
Algorithm: Visvalingam-Whyatt (weighted) — preserves perceptual shape of sinuous borders.
Tolerance: 12% (85–90% simplification equivalent)
"""
import geopandas as gpd
import numpy as np
import os
from simplification.cutil import simplify_coords_vw

SHP_PATH = 'Shapefiles/PisosVegetacionalesPliscoff2017.shp'
OUT_NAME = 'pisos.geojson'
VW_EPSILON = 0.0004  # ~85-90% simplification: preserves shape, reduces vertices

def simplify_geometry_vw(geom, epsilon):
    """Apply Visvalingam-Whyatt simplification to a geometry."""
    from shapely.geometry import Polygon, MultiPolygon, mapping
    from shapely.ops import unary_union

    def simplify_ring(coords):
        arr = np.array(coords)
        simplified = simplify_coords_vw(arr, epsilon)
        if len(simplified) < 4:
            return coords  # fallback: keep original if too few points
        return simplified.tolist()

    def simplify_polygon(poly):
        ext = simplify_ring(list(poly.exterior.coords))
        holes = [simplify_ring(list(i.coords)) for i in poly.interiors]
        try:
            return Polygon(ext, holes)
        except Exception:
            return poly  # fallback on invalid geometry

    if geom.geom_type == 'Polygon':
        return simplify_polygon(geom)
    elif geom.geom_type == 'MultiPolygon':
        parts = [simplify_polygon(p) for p in geom.geoms]
        valid = [p for p in parts if not p.is_empty and p.is_valid]
        return MultiPolygon(valid) if valid else geom
    return geom


if os.path.exists(SHP_PATH):
    print("Converting Pisos Vegetacionales (Visvalingam-Whyatt)...")
    gdf = gpd.read_file(SHP_PATH)
    gdf = gdf.to_crs(epsg=4326)

    # Keep only the name column to save space
    if 'Piso_veget' in gdf.columns:
        gdf = gdf[['Piso_veget', 'geometry']]

    print(f"  Original vertices: {sum(gdf.geometry.apply(lambda g: len(list(g.exterior.coords)) if g.geom_type == 'Polygon' else sum(len(list(p.exterior.coords)) for p in g.geoms) if g.geom_type == 'MultiPolygon' else 0))}")

    gdf['geometry'] = gdf['geometry'].apply(lambda g: simplify_geometry_vw(g, VW_EPSILON))
    gdf = gdf[gdf.geometry.is_valid & ~gdf.geometry.is_empty]

    gdf.to_file(OUT_NAME, driver='GeoJSON')
    print(f"Success: {OUT_NAME}")
else:
    print(f"Shapefile not found: {SHP_PATH}")
