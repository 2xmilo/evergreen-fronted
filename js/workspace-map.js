/* ==========================================================================
   WORKSPACE MAP - Dibujo, cuencas y helpers
   Split mechanically from workspace.js; keep global function names stable.
   ========================================================================== */

// Funciones de Dibujo compartidas (se enlaza con Leaflet)
var globalDrawControl = null;
var globalDrawnItems = null;
var globalWorkspaceAOILayer = null;
var _aoiVisible = true;
var _aoiOpacity = 0.25;

function initWorkspaceMap() {
    // Se asume que el map base está en `map` global (desde acceso-datos.js)
    if (typeof map !== 'undefined') {
        globalDrawnItems = new L.FeatureGroup();
        map.addLayer(globalDrawnItems);

        // Remove old draw controls if any
        
        globalDrawControl = new L.Draw.Polygon(map, {
            shapeOptions: {
                color: '#6AAA35',
                weight: 2,
                fillOpacity: 0.2
            }
        });

        var aoiButton = document.getElementById('btn-aoi-opacity');
        if (aoiButton) {
            aoiButton.textContent = 'AOI opacidad ' + Math.round(_aoiOpacity * 100) + '%';
        }

        map.on(L.Draw.Event.CREATED, function (e) {
            var layer = e.layer;
            globalDrawnItems.clearLayers();
            globalDrawnItems.addLayer(layer);
            globalWorkspaceAOILayer = layer;
            
            // Mantener AOI visible en el mapa (zona de estudio)
            if (typeof layer.setStyle === 'function') {
                layer.setStyle({
                    color: '#00C88E',
                    weight: 2,
                    opacity: 0.9,
                    fillColor: '#00C88E',
                    fillOpacity: _aoiVisible ? _aoiOpacity : 0
                });
            }
            
            var geojson = layer.toGeoJSON();
            var ha = 0;
            
            // Solo calcular área para polígonos
            if (typeof layer.getLatLngs === 'function') {
                var areaSqM = L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]);
                ha = Math.round(areaSqM / 10000);
            }

            if (ha > 50000) {
                alert("La zona supera el límite de 50.000 ha (" + ha + " ha). Por favor dibuja una zona más pequeña.");
                globalDrawnItems.clearLayers();
                return;
            }

            WorkspaceState.zona = geojson;
            WorkspaceState.zonaHa = ha;

            // Simplificar para GEE usando Turf si está disponible - SOLO a poligonos
            if (typeof turf !== 'undefined' && geojson.geometry.type.includes('Polygon')) {
                WorkspaceState.zonaGEE = turf.simplify(geojson, { tolerance: 0.001, highQuality: true });
            } else {
                WorkspaceState.zonaGEE = geojson; // Fallback para puntos (no necesitan simplificar)
            }

            updateZoneUI();
            saveWorkspaceState();   // saveWorkspaceToCloud se encarga de insert/update según zonaId

            // Si estamos en clima, inyectar el polígono
            if (typeof agregarPoligonoDesdeWorkspace === 'function') {
                agregarPoligonoDesdeWorkspace(geojson, WorkspaceState.zonaNombre, ha);
            }

            enviarZonaABiodiversidad();
        });
    }
}

function _enableDrawing() {
    if (!globalDrawControl) return;
    globalDrawnItems.clearLayers();
    if (typeof poligonos !== 'undefined') poligonos = [];
    if (typeof puntos !== 'undefined') {
        puntos.forEach(function(p) { if (p.marker) try { map.removeLayer(p.marker); } catch(e){} });
        puntos = [];
    }
    globalDrawControl.enable();
}

function startDrawingZone() {
    // Si ya tiene zona activa → solo redibuja en el mismo workspace (sin chequeo de cuota)
    if (WorkspaceState.zona) {
        _enableDrawing();
        return;
    }
    // Primera zona: verificar cuota usando _sbUserZones local (evita race condition
    // cuando el delete async aún no confirmó en Supabase)
    if (window._sbUserId) {
        var _LIMITS  = { 'free': 1, 'pro': 3, 'admin': Infinity };
        var plan     = window._sbUserPlan || 'free';
        var maxZones = _LIMITS[plan] !== undefined ? _LIMITS[plan] : 1;
        var zones    = (typeof getValidStoredZones === 'function')
            ? getValidStoredZones(window._sbUserZones)
            : (window._sbUserZones || []).filter(function(z) { return z && z.polygon_geojson; });
        var count    = zones.length;
        if (maxZones !== Infinity && count >= maxZones) {
            mostrarModalLimite({ ok: false, reason: 'LIMIT_REACHED', plan: plan, used: count, max: maxZones });
            return;
        }
    }
    _enableDrawing();
}

// Crear una zona NUEVA (workspace adicional) — llamada desde el selector de zonas
function startNewZone() {
    closeZoneSelector();
    if (window._sbUserId && typeof checkZoneQuota === 'function') {
        checkZoneQuota(window._sbUserId).then(function(result) {
            if (!result.ok) { mostrarModalLimite(result); return; }
            // Limpiar estado local para el nuevo workspace
            WorkspaceState.zona       = null;
            WorkspaceState.zonaGEE    = null;
            WorkspaceState.zonaHa     = 0;
            WorkspaceState.zonaId     = null;
            WorkspaceState.zonaNombre = 'Mi zona de estudio';
            WorkspaceState.resultados = {};
            if (globalDrawnItems) globalDrawnItems.clearLayers();
            updateZoneUI();
            renderIndicadorCards();
            _enableDrawing();
        });
    } else {
        _enableDrawing();
    }
}

// ---------------------------------------------------------
// CUENCAS — Toggle de visibilidad en el mapa
// ---------------------------------------------------------
var _cuencasVisible = false;

function toggleCapasCuencas() {
    if (typeof cuencasLayer === 'undefined' || !cuencasLayer) return;
    _cuencasVisible = !_cuencasVisible;
    if (_cuencasVisible) {
        cuencasLayer.addTo(map);
    } else {
        map.removeLayer(cuencasLayer);
    }
    var btn = document.getElementById('btn-toggle-cuencas');
    if (btn) btn.classList.toggle('off', !_cuencasVisible);
}

function toggleAoiVisibility() {
    _aoiVisible = !_aoiVisible;
    if (globalWorkspaceAOILayer && typeof globalWorkspaceAOILayer.setStyle === 'function') {
        globalWorkspaceAOILayer.setStyle({
            opacity: _aoiVisible ? 0.9 : 0,
            fillOpacity: _aoiVisible ? _aoiOpacity : 0
        });
    }
    var btn = document.getElementById('btn-toggle-aoi');
    if (btn) {
        btn.classList.toggle('off', !_aoiVisible);
        btn.textContent = _aoiVisible ? '⛰️ AOI Visible' : '🚫 AOI Oculto';
    }
}

function changeAoiOpacity() {
    var levels = [0.08, 0.2, 0.4, 0.6];
    var idx = levels.indexOf(_aoiOpacity);
    _aoiOpacity = levels[(idx + 1) % levels.length];
    if (globalWorkspaceAOILayer && typeof globalWorkspaceAOILayer.setStyle === 'function') {
        globalWorkspaceAOILayer.setStyle({
            fillOpacity: _aoiVisible ? _aoiOpacity : 0
        });
    }
    var btn = document.getElementById('btn-aoi-opacity');
    if (btn) btn.textContent = `AOI opacidad ${Math.round(_aoiOpacity * 100)}%`;
}

// ---------------------------------------------------------
// HELPERS COMPARTIDOS — usados por todos los módulos GEE
// ---------------------------------------------------------

/**
 * Guard: si no hay zona definida, muestra toast + va al tab Resumen.
 * Usar con: if (!WorkspaceState.zonaGEE) return _noZonaGuard();
 */
function _noZonaGuard() {
    if (typeof mostrarNotificacion === 'function') {
        mostrarNotificacion('⚠️ Dibuja una zona en el mapa o selecciona una cuenca DGA.');
    }
    switchWorkspaceTab('resumen');
}

/**
 * Centra el mapa en la zona activa después de un análisis.
 */
function _fitToZone() {
    if (!WorkspaceState.zona || typeof map === 'undefined') return;
    try {
        var bounds = L.geoJSON(WorkspaceState.zona).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
    } catch (e) { /* silent — mapa no listo todavía */ }
}

// ---------------------------------------------------------
