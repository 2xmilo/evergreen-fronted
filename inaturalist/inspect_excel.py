import pandas as pd
import json

excel_file = 'NominaDeEspecies_SegunEstadoConservacion-Chile_actualizado_19noProcesoRCE_rev30junio2025.xlsx'
df = pd.read_excel(excel_file)

print("Columns:")
for col in df.columns:
    print(f"- {col}")

print("\nFirst 3 rows:")
print(df.head(3).to_markdown())
