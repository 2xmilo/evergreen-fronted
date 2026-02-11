# -*- coding: utf-8 -*-
import os
import ee
import pandas as pd

# ================== CONFIGURACIÓN EN GEE ==================
EE_PROJECT          = os.environ.get("EE_PROJECT", "dmc-demo-1709")  # <-- Ingresa el nombre de tu proyecto GEE aquí
INPUT_CSV           = os.environ.get("INPUT_CSV", "estaciones_all.csv")  # CSV con las estaciones; y columnas: estacion;latitud;longitud (sep=';')
START_DATE          = os.environ.get("START_DATE", "1980-01-01")     # inicio de descarga (formato 'YYYY-MM-DD')
END_DATE            = os.environ.get("END_DATE",   "2025-09-24")     # rango semicluso: [START_DATE, END_DATE)
GDRIVE_ROOT_FOLDER  = os.environ.get("GDRIVE_ROOT_FOLDER", "GEE_pp")    # carpeta en tu Drive

# ================== INICIALIZACIÓN DE TAREAS GEE ==================
def init_gee(project_id: str):
    try:
        ee.Initialize(project=project_id)
        print(f"GEE inicializado con el proyecto: {project_id}")
    except Exception:
        print("Autenticando en Google Earth Engine...")
        ee.Authenticate()
        ee.Initialize(project=project_id)
        print(f"GEE inicializado con el proyecto: {project_id}")

# ================== ESTACIONES DESDE CSV ==================
def load_stations_fc(csv_path: str) -> ee.FeatureCollection:
    # CSV con separador ';' y encoding latin1. Columnas: estacion;latitud;longitud
    df = pd.read_csv(csv_path, sep=';', encoding='latin1')
    required = {'estacion', 'latitud', 'longitud'}
    missing = required - set(map(str.lower, df.columns))
    if missing:
        raise ValueError(f"Faltan columnas en {csv_path}: {missing}. Se requieren {sorted(required)}")
    # normaliza a lowercase por seguridad
    df.columns = [c.lower() for c in df.columns]
    feats = []
    for _, row in df.iterrows():
        est = str(row['estacion'])
        lat = float(row['latitud'])
        lon = float(row['longitud'])
        geom = ee.Geometry.Point([lon, lat])
        feats.append(ee.Feature(geom, {'estacion': est, 'latitud': lat, 'longitud': lon}))
    return ee.FeatureCollection(feats)

# ================== PRODUCTOS SATELITALES  ==================
def build_collections(start: str, end: str):
    # CHIRPS (base de proyección y escala)
    icCHIRPS = (ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
                .filterDate(start, end)
                .select(['precipitation'], ['pp_CHIRPS'])
                .map(lambda img: img.set(
                    'key', ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')
                )))
    proj = icCHIRPS.first().projection()
    res  = proj.nominalScale()

    # ERA5-Land (m -> mm)
    def map_era5(img):
        return (img.select('total_precipitation_sum')
                .multiply(1000).rename('pp_ERA5')
                .reproject(proj)
                .set('key', ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')))
    icERA5 = (ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
              .filterDate(start, end)
              .map(map_era5))

    # PERSIANN-CDR
    def map_persiann(img):
        return (img.select('precipitation').rename('pp_PERSIANN')
                .reproject(proj)
                .set('key', ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')))
    icPERSIANN = (ee.ImageCollection('NOAA/PERSIANN-CDR')
                  .filterDate(start, end)
                  .map(map_persiann))

    # CMORPH (asset público de daily)
    def map_cmorph(img):
        return (img.select('precip').rename('pp_CMORPH')
                .reproject(proj)
                .set('key', ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')))
    icCMORPH = (ee.ImageCollection('projects/climate-engine-pro/assets/noaa-cpc-cmorph/daily')
                .filterDate(start, end)
                .map(map_cmorph))

    # IMERG V07 (30-min → suma diaria con factor 0.5), desde 2000-06-01
    inimerg    = ee.Date('2000-06-01')
    startDate  = ee.Date(start)
    endDate    = ee.Date(end)
    startDate2 = ee.Date(ee.Algorithms.If(startDate.millis().lt(inimerg.millis()), inimerg, startDate))

    icIMERG_halfhour = (ee.ImageCollection('NASA/GPM_L3/IMERG_V07')
                        .filterDate(start, end)
                        .select('precipitation'))

    nDaysIMERG = endDate.difference(startDate2, 'day')

    def imerg_daily_map(d):
        d = ee.Number(d)
        dayStart = startDate2.advance(d, 'day')
        dayEnd   = dayStart.advance(1, 'day')
        dayColl  = icIMERG_halfhour.filterDate(dayStart, dayEnd)
        daily = (dayColl.sum()
                 .multiply(0.5)              # mm/h * 0.5h
                 .rename('pp_IMERG')
                 .set('key', dayStart.format('YYYY-MM-dd'))
                 .set('system:time_start', dayStart.millis()))
        return ee.Image(daily).reproject(proj)

    icIMERG_daily = ee.ImageCollection(ee.List.sequence(0, nDaysIMERG.subtract(1)).map(imerg_daily_map))

    return {
        'icCHIRPS': icCHIRPS,
        'icERA5': icERA5,
        'icPERSIANN': icPERSIANN,
        'icCMORPH': icCMORPH,
        'icIMERG_daily': icIMERG_daily,
        'proj': proj,
        'res': res,
        'startDate': ee.Date(start),
        'endDate': ee.Date(end)
    }

# ================== CALENDARIO COMPLETO ==================
def build_calendar(startDate: ee.Date, endDate: ee.Date) -> ee.ImageCollection:
    nDaysCAL = endDate.difference(startDate, 'day')

    def map_calendar(d):
        d = ee.Number(d)
        dayStart = startDate.advance(d, 'day')
        # imagen "vacía" con banda 'keep' y clave de fecha
        return (ee.Image(1).rename('keep').toFloat()
                .set('system:time_start', dayStart.millis())
                .set('key', dayStart.format('YYYY-MM-dd')))

    return ee.ImageCollection(ee.List.sequence(0, nDaysCAL.subtract(1)).map(map_calendar))

# ================== JOIN POR FECHA Y AÑADIR BANDA ==================
def add_product_band(baseIC: ee.ImageCollection, prodIC: ee.ImageCollection, bandName: str) -> ee.ImageCollection:
    cond   = ee.Filter.equals(leftField='key', rightField='key')
    joined = ee.Join.saveFirst(matchKey='match', outer=True).apply(baseIC, prodIC, cond)

    def attach_band(img):
        img   = ee.Image(img)
        match = img.get('match')  # ee.Image o None
        # Si no hay match -> banda NULL (todo enmascarado)
        null_band = ee.Image(0).updateMask(ee.Image(0)).rename(bandName).toFloat()
        band = ee.Image(ee.Algorithms.If(ee.Algorithms.IsEqual(match, None),
                                          null_band,
                                          ee.Image(match).select(bandName).toFloat()))
        return (img.addBands(band)
                   .copyProperties(img, ['system:time_start', 'key']))

    return ee.ImageCollection(joined.map(attach_band))

# ================== PIPELINE PRINCIPAL ==================
def run_export():
    # 1) Init
    init_gee(EE_PROJECT)

    # 2) Estaciones
    stations_fc = load_stations_fc(INPUT_CSV)

    # 3) Colecciones y proyección/escala base
    cols = build_collections(START_DATE, END_DATE)
    icCHIRPS      = cols['icCHIRPS']
    icERA5        = cols['icERA5']
    icPERSIANN    = cols['icPERSIANN']
    icCMORPH      = cols['icCMORPH']
    icIMERG_daily = cols['icIMERG_daily']
    proj          = cols['proj']
    res           = cols['res']
    startDate     = cols['startDate']
    endDate       = cols['endDate']

    # 4) Calendario completo
    icCAL = build_calendar(startDate, endDate)

    # 5) Encadenar productos a calendario (outer join por 'key')
    icOUT = add_product_band(icCAL, icCHIRPS,      'pp_CHIRPS')
    icOUT = add_product_band(icOUT, icERA5,        'pp_ERA5')
    icOUT = add_product_band(icOUT, icPERSIANN,    'pp_PERSIANN')
    icOUT = add_product_band(icOUT, icCMORPH,      'pp_CMORPH')
    icOUT = add_product_band(icOUT, icIMERG_daily, 'pp_IMERG')

    # 6) Muestreo por estaciones (unmask a -999) + agregar 'date'
    def sample_image(img):
        key = ee.String(img.get('key'))
        img = ee.Image(img).unmask(-999).toFloat()
        fc = (img.sampleRegions(collection=stations_fc, scale=res, geometries=False)
                .map(lambda ft: ee.Feature(ft).set('date', key))
                .select(['estacion','latitud','longitud','date',
                         'pp_CHIRPS','pp_ERA5','pp_PERSIANN','pp_CMORPH','pp_IMERG']))
        return fc

    sampled = ee.FeatureCollection(icOUT.map(sample_image)).flatten()

    # 7) Export único a Drive (CSV apilado)
    description    = 'pp_satelital_COMPLETO'
    fileNamePrefix = 'pp_satelital_COMPLETO'
    selectors = ['estacion','date','latitud','longitud',
                 'pp_CHIRPS','pp_ERA5','pp_PERSIANN','pp_CMORPH','pp_IMERG']

    task = ee.batch.Export.table.toDrive(
        collection=sampled,
        description=description,
        folder=GDRIVE_ROOT_FOLDER,
        fileNamePrefix=fileNamePrefix,
        fileFormat='CSV',
        selectors=selectors
    )
    task.start()
    print(f"✅ Tarea '{description}' enviada. Revisa la pestaña 'Tasks' en la interfaz de GEE y presiona RUN si es necesario.")

if __name__ == "__main__":
    run_export()
