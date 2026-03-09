@echo off
echo Iniciando servidor Evergreen Biodiversidad...
echo Abre tu browser en: http://localhost:8888
echo Para detener: cierra esta ventana o presiona Ctrl+C
echo.
python -m http.server 8888
pause
