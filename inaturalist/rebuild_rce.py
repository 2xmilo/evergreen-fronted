import pandas as pd
import json
import os
import math

# Archivo de entrada y salida
excel_file = "NominaDeEspecies_SegunEstadoConservacion-Chile_actualizado_19noProcesoRCE_rev30junio2025.xlsx"
json_output = "rce_data.json"

if not os.path.exists(excel_file):
    print(f"Error: {excel_file} no encontrado.")
    exit()

print("Leyendo Excel...")
df = pd.read_excel(excel_file, sheet_name=0)

# Mapeo de columnas de regiones según el RCE (pueden variar según la versión, verificamos las comunes)
region_map = {
    'Arica y Parinacota': 'XV',
    'Tarapacá': 'I',
    'Antofagasta': 'II',
    'Atacama': 'III',
    'Coquimbo': 'IV',
    'Valparaíso continental': 'V',
    'Metropolitana': 'RM',
    "O'higgins": 'VI',
    'Maule': 'VII',
    'Ñuble': 'XVI', # Not traditionally in the old matrix but good to have
    'Bío-Bío': 'VIII',
    'Araucanía': 'IX',
    'De Los Ríos': 'XIV',
    'De Los Lagos': 'X',
    'Aysén': 'XI',
    'Magallanes continental e insular': 'XII',
    'Juan Fernandez': 'Juan Fernández',
    'Desventuradas': 'Desventuradas'
}

print(f"Columnas regionales preparadas para mapeo.")

df['NOMBRE CIENTÍFICO'] = df['NOMBRE CIENTÍFICO'].fillna('').astype(str).str.strip().str.lower()
df['NOMBRE COMÚN'] = df['NOMBRE COMÚN'].fillna('').astype(str).str.strip()
df['REINO'] = df['REINO'].fillna('').astype(str).str.strip()
df['CLASE'] = df['CLASE'].fillna('').astype(str).str.strip()

output_dict = {}

for _, row in df.iterrows():
    sci_name = row['NOMBRE CIENTÍFICO']
    
    if not sci_name or sci_name.lower() == 'nan':
        continue
        
    # Obtener el nombre de la especie
    nombre_oficial = sci_name.replace("  ", " ")
    
    # Extraer Categoria
    cat = ""
    # Search for the column that contains 'CATEGORÍA VIGENTE'
    cat_col = next((c for c in df.columns if 'CATEGORÍA VIGENTE' in str(c).upper()), None)
    
    if cat_col and pd.notnull(row[cat_col]):
        cat = str(row[cat_col]).strip()
        # Some explicit cleaning since it might contain garbage or long strings, we only want the acronym
        if cat.upper() in ['CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'EX', 'EW']:
            cat = cat.upper()
        else:
            # Handle possible combined strings like "EN (En peligro)"
            parts = str(cat).split()
            if parts and parts[0].upper() in ['CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'EX', 'EW']:
                cat = parts[0].upper()
        
    # Si la categoria es Na, DD o vacia, seguimos incluyendolo pero con la categoria q tenga (LC, etc)
    if cat == 'nan':
        cat = ""
        
    # Extraer Nombre Comun
    comun = row['NOMBRE COMÚN']
        
    # Extraer Grupo
    grupo = f"{row['REINO']}-{row['CLASE']}"

    # Extraer Regiones (dict)
    regiones = {}
    for excel_col, short_key in region_map.items():
        val = row.get(excel_col, 0)
        if isinstance(val, str) and val.strip().lower() in ['x', 'si', 'sí', '1']:
            regiones[short_key] = 1
        elif isinstance(val, (int, float)) and val == 1:
            regiones[short_key] = 1
        else:
            regiones[short_key] = 0

    output_dict[nombre_oficial] = {
        "categoria": cat,
        "nombre_comun": comun,
        "grupo": grupo,
        "regiones": regiones
    }

with open(json_output, 'w', encoding='utf-8') as f:
    json.dump(output_dict, f, ensure_ascii=False, indent=2)

print(f"¡Éxito! Base de datos RCE exportada a {json_output} con {len(output_dict)} registros.")
