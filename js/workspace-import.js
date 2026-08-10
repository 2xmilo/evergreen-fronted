/* ==========================================================================
   WORKSPACE — Importar KML / KMZ como zona de estudio
   Flujo: archivo → texto KML (KMZ se descomprime con JSZip) → GeoJSON
   (togeojson) → polígono de mayor área → validar contra el tope global
   (50.000 ha, igual que al dibujar) → cargar como zona de estudio reutilizando
   la misma cadena que el dibujo (WorkspaceState + restoreZoneOnMap + save +
   sync Clima/Biodiversidad).
   Dependencias (CDN, cargadas en acceso-datos.html): toGeoJSON, JSZip, turf.
   ========================================================================== */
(function () {
    'use strict';

    var MAX_HA = 50000; // mismo tope que workspace-map.js al dibujar

    function _toast(msg) {
        if (typeof mostrarNotificacion === 'function') return mostrarNotificacion(msg);
        alert(msg);
    }

    async function _readKmlText(file) {
        var name = (file.name || '').toLowerCase();
        if (name.endsWith('.kmz')) {
            if (typeof JSZip === 'undefined') throw new Error('Falta la librería JSZip para leer KMZ.');
            var zip = await JSZip.loadAsync(file);
            var kmlName = Object.keys(zip.files).find(function (n) { return n.toLowerCase().endsWith('.kml'); });
            if (!kmlName) throw new Error('El KMZ no contiene ningún archivo .kml.');
            return await zip.files[kmlName].async('text');
        }
        if (name.endsWith('.kml')) return await file.text();
        throw new Error('Formato no soportado. Usa un archivo .kml o .kmz.');
    }

    function _extractBestPolygon(fc) {
        var feats = (fc.features || []).filter(function (f) {
            return f.geometry && /Polygon/.test(f.geometry.type);
        });
        if (!feats.length) return null;
        var best = null, bestArea = -1;
        feats.forEach(function (f) {
            var a = 0;
            try { a = turf.area(f); } catch (e) {}
            if (a > bestArea) { bestArea = a; best = f; }
        });
        return { feature: best, count: feats.length, areaM2: bestArea };
    }

    // KML puede traer coords 3D [lng,lat,alt]; GEE espera 2D. Aplanar.
    function _to2D(geom) {
        function ring(coords) { return coords.map(function (c) { return [c[0], c[1]]; }); }
        if (geom.type === 'Polygon') {
            return { type: 'Polygon', coordinates: geom.coordinates.map(ring) };
        }
        if (geom.type === 'MultiPolygon') {
            return { type: 'MultiPolygon', coordinates: geom.coordinates.map(function (poly) { return poly.map(ring); }) };
        }
        return geom;
    }

    window.importZonaKmlKmz = async function (file) {
        if (!file) return;
        var btn = document.getElementById('btn-import-kml');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
        try {
            if (typeof toGeoJSON === 'undefined') throw new Error('Falta la librería togeojson.');
            var kmlText = await _readKmlText(file);
            var dom = new DOMParser().parseFromString(kmlText, 'text/xml');
            var fc = toGeoJSON.kml(dom);

            var res = _extractBestPolygon(fc);
            if (!res || !res.feature) {
                _toast('El archivo no contiene polígonos. Solo se pueden importar áreas (no puntos ni líneas).');
                return;
            }

            var ha = Math.round(res.areaM2 / 10000);
            if (!(ha > 0)) { _toast('No se pudo calcular el área del polígono del archivo.'); return; }
            if (ha > MAX_HA) {
                _toast('La zona del archivo tiene ' + ha.toLocaleString('es-CL') +
                    ' ha y supera el límite de ' + MAX_HA.toLocaleString('es-CL') +
                    ' ha. Usa un área más pequeña.');
                return;
            }

            var geojson = { type: 'Feature', properties: {}, geometry: _to2D(res.feature.geometry) };

            // Reemplazar zona activa: limpiar análisis previos (igual que al dibujar).
            var replacedId = WorkspaceState.zonaId;
            if (WorkspaceState.zona && replacedId && typeof clearAnalysisStateForZoneChange === 'function') {
                var had = clearAnalysisStateForZoneChange();
                if (had && window._sbUserId && typeof clearResultsForWorkspace === 'function') {
                    clearResultsForWorkspace(window._sbUserId, replacedId);
                }
            }

            WorkspaceState.zona = geojson;
            WorkspaceState.zonaHa = ha;
            WorkspaceState.zonaGEE = (typeof simplifyZoneForGee === 'function')
                ? simplifyZoneForGee(geojson, ha) : geojson;

            if (typeof restoreZoneOnMap === 'function') restoreZoneOnMap();
            if (typeof zoomToZone === 'function') zoomToZone();
            if (typeof updateZoneUI === 'function') updateZoneUI();
            if (typeof saveWorkspaceState === 'function') saveWorkspaceState();
            if (typeof agregarPoligonoDesdeWorkspace === 'function') {
                agregarPoligonoDesdeWorkspace(geojson, WorkspaceState.zonaNombre, ha);
            }
            if (typeof enviarZonaABiodiversidad === 'function') enviarZonaABiodiversidad();

            var extra = res.count > 1
                ? ' (el archivo tenía ' + res.count + ' polígonos; se usó el de mayor área)'
                : '';
            _toast('Zona importada: ' + ha.toLocaleString('es-CL') + ' ha' + extra + '.');
        } catch (err) {
            if (window.console) console.warn('[import KML/KMZ]', err);
            _toast('No se pudo importar el archivo: ' + (err.message || err));
        } finally {
            if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        }
    };
})();
