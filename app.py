from flask import Flask, render_template, request, redirect, url_for
from supabase import create_client, Client
import os
from dotenv import load_dotenv
 
# Carga las variables de entorno del archivo .env
load_dotenv() 

app = Flask(__name__)

# Configuración de Supabase
# Obtiene las claves de forma segura desde las variables de entorno
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email")
        password = request.form.get("password")
        try:
            # Intenta iniciar sesión con Supabase
            response = supabase.auth.sign_in_with_password({"email": email, "password": password})
            # Si el login es exitoso, redirige a una página de dashboard
            if response.user:
                return redirect(url_for("dashboard"))
        except Exception as e:
            # Maneja el error de login
            error_message = f"Error de autenticación: {e}"
            return render_template("login.html", error=error_message)
    
    return render_template("login.html")

@app.route("/dashboard")
def dashboard():
    # Esta página solo es accesible si el usuario está logueado
    return render_template("dashboard.html")

if __name__ == "__main__":
    app.run(debug=True)