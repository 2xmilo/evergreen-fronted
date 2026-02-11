import os
import time
import ee
import pandas as pd
from functools import wraps
from dotenv import load_dotenv
from flask import (
    Flask, render_template, request, jsonify,
    redirect, url_for, session
)
from supabase import create_client, Client

# ===============================
# CARGA .ENV Y CONFIG FLASK
# ===============================
load_dotenv()

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
# ¡IMPORTANTE! En producción, usa una clave por variable de entorno.
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "tu_clave_secreta_aqui")

# ===============================
# SUPABASE
# ===============================
SUPABASE_URL: str = os.environ.get("SUPABASE_URL")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ===============================
# GOOGLE EARTH ENGINE
# ===============================
# IMPORTANTE: El proyecto 'dmc-demo-1709' debe estar activo y autenticado.
try:
    ee.Initialize(project='dmc-demo-1709')
    print("Google Earth Engine ha sido inicializado con éxito.")
except Exception as e:
    print(f"Error al inicializar Google Earth Engine: {e}")

# ===============================
# PRODUCTOS SATELITALES
# ===============================
products = {
    'CHIRPS': {
        'id': 'UCSB-CHG/CHIRPS/DAILY',
        'band': 'precipitation',
        'factor': 1,
        'scale': 5566
    },
    'IMERG': {
        'id': 'NASA/GPM_L3/IMERG_V07',
        'band': 'precipitation',
        'factor': 0.5,
        'scale': 11132,
        'needs_daily_aggregation': True
    },
    'CMORPH': {
        'id': 'projects/climate-engine-pro/assets/noaa-cpc-cmorph/daily',
        'band': 'precip',
        'factor': 1,
        'scale': 25000
    },
    'PERSIANN-CDR': {
        'id': 'NOAA/PERSIANN-CDR',
        'band': 'precipitation',
        'factor': 1,
        'scale': 27830
    },
    'ERA5-Land': {
        'id': 'ECMWF/ERA5_LAND/DAILY_AGGR',
        'band': 'total_precipitation_sum',
        'factor': 1000,  # m a mm
        'scale': 11132
    }
}

# ===============================
# HELPERS (LOGIN REQUIRED)
# ===============================
def login_required(view):
    """Decorador simple para proteger rutas si no hay sesión."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return view(*args, **kwargs)
    return wrapped

# ===============================
# FUNCIONES GEE
# ===============================
def get_sampling_scale(collection, product_info):
    if 'scale' in product_info:
        return product_info['scale']
    return ee.Image(collection.first()).projection().nominalScale()

def start_export_task(product_name, product_info, point, start_date, end_date, station_name):
    print(f"  > Creando tarea para {product_name}...")
    collection = ee.ImageCollection(product_info['id'])
    filtered_collection = collection.filterDate(start_date, end_date)
    band_name_out = 'precipitacion_mm'

    if product_info.get('needs_daily_aggregation', False):
        print(f"    - Agregando {product_name} a escala diaria...")
        date_list = ee.List.sequence(
            ee.Date(start_date).millis(),
            ee.Date(end_date).millis(),
            24 * 60 * 60 * 1000
        )

        def aggregate_daily(date_millis):
            start_of_day = ee.Date(date_millis)
            end_of_day = start_of_day.advance(1, 'day')
            daily_collection = filtered_collection.filterDate(start_of_day, end_of_day)

            empty_img = (
                ee.Image.constant(0)
                .rename(band_name_out)
                .updateMask(ee.Image(0))
                .set('system:time_start', start_of_day.millis())
            )

            daily_img = (
                daily_collection
                .select(product_info['band'])
                .sum()
                .multiply(product_info.get('factor', 1))
                .rename(band_name_out)
                .set('system:time_start', start_of_day.millis())
            )

            return ee.Image(ee.Algorithms.If(daily_collection.size().gt(0), daily_img, empty_img))

        daily_images = date_list.map(aggregate_daily)
        collection_to_sample = ee.ImageCollection.fromImages(daily_images)

    else:
        def process_image(image):
            processed_image = (
                image
                .select([product_info['band']], [band_name_out])
                .multiply(product_info.get('factor', 1))
            )
            return processed_image.copyProperties(image, ['system:time_start'])

        collection_to_sample = filtered_collection.map(process_image)

    def extract_value(image):
        sampling_scale = get_sampling_scale(collection, product_info)
        value = image.reduceRegion(
            reducer=ee.Reducer.first(),
            geometry=point,
            scale=sampling_scale
        ).get(band_name_out)
        return ee.Feature(None, {
            'date': image.date().format('YYYY-MM-dd'),
            'precipitacion_mm': value
        })

    feature_collection = (
        collection_to_sample
        .map(extract_value)
        .filter(ee.Filter.notNull(['precipitacion_mm']))
    )

    clean_station_name = (
        station_name.lower()
        .replace(" ", "_")
        .replace("(", "")
        .replace(")", "")
    )
    filename = f"{clean_station_name}_{product_name}"
    task_description = f"Export_{filename}"

    task = ee.batch.Export.table.toDrive(
        collection=feature_collection,
        description=task_description,
        folder='GEE_precipitation',
        fileNamePrefix=filename,
        fileFormat='CSV',
        selectors=['date', 'precipitacion_mm']
    )
    task.start()
    return task

# ===============================
# RUTAS
# ===============================
@app.route("/")
def index():
    return render_template("index.html")
@app.route("/acceso-datos")  # ← AGREGAR ESTA RUTA
def acceso_datos():
    return render_template("acceso-datos.html")


# ---------- Auth ----------
@app.route("/login", methods=["GET", "POST"])
def login():
    """Login con Supabase; guarda user_id en sesión y redirige a dashboard."""
    if request.method == "POST":
        email = request.form.get("email")
        password = request.form.get("password")
        try:
            response = supabase.auth.sign_in_with_password({"email": email, "password": password})
            # La SDK retorna un objeto con .user cuando es exitoso
            if getattr(response, "user", None):
                session['user_id'] = response.user.id
                return redirect(url_for("dashboard"))
            # Si no hay .user, fuerza un error genérico
            return render_template("login.html", error="Credenciales inválidas.")
        except Exception as e:
            error_message = f"Error de autenticación: {e}"
            return render_template("login.html", error=error_message)

    return render_template("login.html")

@app.route("/logout")
def logout():
    """Cierra sesión local; si quieres, también puedes llamar supabase.auth.sign_out()."""
    session.pop('user_id', None)
    try:
        # No es estrictamente necesario para tu caso, pero lo dejamos seguro.
        supabase.auth.sign_out()
    except Exception:
        pass
    return redirect(url_for('index'))

@app.route("/register", methods=["GET", "POST"])
def register():
    """
    Placeholder sencillo para no romper el enlace "Regístrate".
    Más adelante aquí puedes llamar:
    supabase.auth.sign_up({"email": email, "password": password})
    """
    if request.method == "POST":
        # Aquí luego procesas form y haces sign_up
        return redirect(url_for('login'))
    # Si no tienes templates/register.html todavía, puedes devolver uno básico:
    return render_template("register.html")  # crea templates/register.html o cambia por un string si prefieres.

# ---------- Vistas protegidas ----------
@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html")

@app.route('/download_data', methods=['POST'])
@login_required
def download_data_web():
    """
    Descarga/Exportación de datos desde GEE a Drive por estación.
    Además del decorador, se mantiene la verificación por si se reusa en otro contexto.
    """
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'Acceso no autorizado. Por favor, inicia sesión para usar esta función.'}), 401

    try:
        # Archivo de estaciones
        if 'stations_file' not in request.files:
            return jsonify({'success': False, 'message': 'No se encontró el archivo de estaciones.'})

        stations_file = request.files['stations_file']
        if stations_file.filename == '':
            return jsonify({'success': False, 'message': 'El archivo seleccionado está vacío.'})

        # Parámetros del form
        product_name = request.form.get('product_type')
        start_date = request.form.get('start_date')
        end_date = request.form.get('end_date')

        if not product_name or not start_date or not end_date:
            return jsonify({'success': False, 'message': 'Faltan parámetros en el formulario.'})

        # Carga CSV (separador y encoding según tu dato de ejemplo)
        df_stations = pd.read_csv(stations_file, encoding='latin1', sep=';')

        if product_name not in products:
            return jsonify({'success': False, 'message': f'El producto "{product_name}" no es válido.'})

        product_info = products[product_name]

        # Itera estaciones
        for _, station_row in df_stations.iterrows():
            station_name = station_row['estacion']
            lat = float(station_row['latitud'])
            lon = float(station_row['longitud'])

            print(f"\n--- Enviando tareas para la Estación: {station_name} ---")
            point = ee.Geometry.Point([lon, lat])

            start_export_task(product_name, product_info, point, start_date, end_date, station_name)
            time.sleep(1)  # leve backoff

        return jsonify({
            'success': True,
            'message': 'Proceso completado. Todas las tareas han sido enviadas a Google Earth Engine. Revisa tu Google Drive (carpeta "GEE_precipitation").'
        })

    except Exception as e:
        print(f"Ocurrió un error inesperado: {e}")
        return jsonify({
            'success': False,
            'message': f'Ocurrió un error inesperado en el servidor: {e}'
        })

# ===============================
# RUN (DESARROLLO)
# ===============================
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
