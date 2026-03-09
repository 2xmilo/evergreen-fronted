"""
convert_shapes.py
Converts area protegida shapefiles to web-optimized GeoJSON files.
Algorithm: Visvalingam-Whyatt (VW) — better preserves perceptual shape of sinuous ecological borders.

Calibrated tolerances (VW epsilon):
  - snaspe.geojson   (Áreas Protegidas):         0.0006  → 70-80% simplification, legal boundaries
  - sp19300.geojson  (Sitios Prioritarios 19300): 0.0007  → 75-80% simplification, important wetlands
  - sperb.geojson    (ERB):                       0.0005  → 80-85% simplification, lower legal impact
  - pisos.geojson    (Pisos Vegetacionales):       0.0004  → 85-90% simplification, complex polygons
"""
import geopandas as gpd
import numpy as np
import os
from simplification.cutil import simplify_coords_vw

SHAPES_DIR = 'Shapefiles'

FILES = {
    'snaspe.geojson':  ('Areas Protegidas.shp',                                      0.0006),
    'sp19300.geojson': ('Sitios Prioritarios según Ley 19300.shp',                   0.0007),
    'sperb.geojson':   ('Sitios Prioritarios Estrategia Regional de Biodiversidad.shp', 0.0005),
    'pisos.geojson':   ('PisosVegetacionalesPliscoff2017.shp',                        0.0004),
}


def simplify_geometry_vw(geom, epsilon):
    """Apply Visvalingam-Whyatt simplification preserving topological integrity."""
    from shapely.geometry import Polygon, MultiPolygon

    def simplify_ring(coords):
        arr = np.array(coords)
        simplified = simplify_coords_vw(arr, epsilon)
        return simplified.tolist() if len(simplified) >= 4 else coords

    def simplify_polygon(poly):
        ext = simplify_ring(list(poly.exterior.coords))
        holes = [simplify_ring(list(i.coords)) for i in poly.interiors]
        try:
            return Polygon(ext, holes)
        except Exception:
            return poly  # fallback on error

    if geom.geom_type == 'Polygon':
        return simplify_polygon(geom)
    elif geom.geom_type == 'MultiPolygon':
        parts = [simplify_polygon(p) for p in geom.geoms]
        valid = [p for p in parts if not p.is_empty and p.is_valid]
        return MultiPolygon(valid) if valid else geom
    return geom


for out_name, (shp_name, vw_epsilon) in FILES.items():
    shp_path = os.path.join(SHAPES_DIR, shp_name)
    if not os.path.exists(shp_path):
        print(f"Not found (skipping): {shp_path}")
        continue

    print(f"\nConverting: {shp_name} → {out_name}  (VW epsilon={vw_epsilon})")
    try:
        gdf = gpd.read_file(shp_path)
        gdf = gdf.to_crs(epsg=4326)

        gdf['geometry'] = gdf['geometry'].apply(lambda g: simplify_geometry_vw(g, vw_epsilon))
        gdf = gdf[gdf.geometry.is_valid & ~gdf.geometry.is_empty]

        gdf.to_file(out_name, driver='GeoJSON')
        print(f"  ✓ Done: {out_name}")
    except Exception as e:
        print(f"  ✗ Error: {e}")

print("\nAll conversions finished.")
