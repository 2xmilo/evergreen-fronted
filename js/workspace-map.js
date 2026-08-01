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

            var replacedWorkspaceId = WorkspaceState.zonaId;
            var replacingCurrentZone = !!(WorkspaceState.zona && replacedWorkspaceId);
            if (replacingCurrentZone && typeof clearAnalysisStateForZoneChange === 'function') {
                var hadResults = clearAnalysisStateForZoneChange();
                if (hadResults && window._sbUserId && typeof clearResultsForWorkspace === 'function') {
                    clearResultsForWorkspace(window._sbUserId, replacedWorkspaceId);
                }
            }

            WorkspaceState.zona = geojson;
            WorkspaceState.zonaHa = ha;

            // Simplificar para GEE usando Turf si está disponible - SOLO a poligonos
            WorkspaceState.zonaGEE = (typeof simplifyZoneForGee === 'function')
                ? simplifyZoneForGee(geojson, ha)
                : geojson;

            updateZoneUI();
            saveWorkspaceState();   // saveWorkspaceToCloud se encarga de insert/update según zonaId

            // Si estamos en clima, inyectar el polígono
            if (typeof agregarPoligonoDesdeWorkspace === 'function') {
                agregarPoligonoDesdeWorkspace(geojson, WorkspaceState.zonaNombre, ha);
            }

            enviarZonaABiodiversidad();
        });

        // DRAWSTOP se dispara tanto al cerrar el polígono como al cancelar:
        // punto único para devolver el botón y el hint a su estado normal.
        map.on(L.Draw.Event.DRAWSTOP, function () {
            _setBotonDibujo(false);
            _quitarHintDibujo();
            if (WorkspaceState.zona && globalDrawnItems && !globalDrawnItems.getLayers().length
                && typeof restoreZoneOnMap === 'function') {
                try { restoreZoneOnMap(); } catch(e) {}
            }
        });
    }

    // Esc cancela el dibujo o la edición en curso — la salida que la gente
    // busca por instinto cuando se arrepiente a medio camino.
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (typeof _dibujandoZona !== 'undefined' && _dibujandoZona) { cancelarDibujoZona(); return; }
        if (typeof edicionZonaActiva === 'function' && edicionZonaActiva()) cancelarEdicionZona();
    });
}

// ---------------------------------------------------------
// EDICIÓN DE LA ZONA (mover vértices)
// ---------------------------------------------------------
// El botón antiguo llamaba a activarEdicion() de acceso-datos.js, que
// opera sobre `drawControl` (el L.Control.Draw del módulo Clima) y su
// featureGroup `drawnItems`. La zona del workspace vive en otro grupo
// (`globalDrawnItems`) y su control es un L.Draw.Polygon —un handler sin
// _toolbars—, así que aquel botón no editaba nada: por eso "no hacía
// nada". Este editor apunta al grupo correcto.
var _zonaEditor = null;

function edicionZonaActiva() { return !!_zonaEditor; }

function toggleEdicionZona() {
    if (_zonaEditor) { _guardarEdicionZona(); return; }

    if (!globalDrawnItems || !globalDrawnItems.getLayers().length) {
        var avisar = (typeof mostrarNotificacion === 'function') ? mostrarNotificacion : alert;
        avisar('✏️ Primero dibuja una zona o selecciona una cuenca.');
        return;
    }
    if (!L.EditToolbar || !L.EditToolbar.Edit) {
        console.warn('Leaflet.Draw sin EditToolbar disponible');
        return;
    }

    try {
        _zonaEditor = new L.EditToolbar.Edit(map, {
            featureGroup: globalDrawnItems,
            selectedPathOptions: { maintainColor: true, opacity: 0.8, dashArray: '6,6' }
        });
        _zonaEditor.enable();
    } catch (e) {
        console.warn('No se pudo iniciar la edición de zona:', e);
        _zonaEditor = null;
        return;
    }

    _setBotonEdicion(true);
    if (typeof mostrarNotificacion === 'function') {
        mostrarNotificacion('✏️ Arrastra los vértices y pulsa "Guardar cambios" al terminar.');
    }
}

function cancelarEdicionZona() {
    if (!_zonaEditor) return;
    try { _zonaEditor.revertLayers(); _zonaEditor.disable(); } catch(e) {}
    _zonaEditor = null;
    _setBotonEdicion(false);
}

function _guardarEdicionZona() {
    if (!_zonaEditor) return;
    try { _zonaEditor.save(); _zonaEditor.disable(); } catch(e) {}
    _zonaEditor = null;
    _setBotonEdicion(false);

    var layer = globalWorkspaceAOILayer || globalDrawnItems.getLayers()[0];
    if (!layer) return;

    var ha = 0;
    if (typeof layer.getLatLngs === 'function') {
        try { ha = Math.round(L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]) / 10000); } catch(e) {}
    }
    if (ha > 50000) {
        alert('La zona editada supera el límite de 50.000 ha (' + ha.toLocaleString('es-CL') + ' ha).\n' +
              'Se mantiene la geometría, pero los análisis GEE no podrán ejecutarse.');
    }

    var geojson = layer.toGeoJSON();

    // La geometría cambió: los análisis previos ya no corresponden a esta
    // zona. Mismo criterio que al redibujarla.
    if (typeof clearAnalysisStateForZoneChange === 'function') {
        var habia = clearAnalysisStateForZoneChange();
        if (habia && window._sbUserId && WorkspaceState.zonaId &&
            typeof clearResultsForWorkspace === 'function') {
            clearResultsForWorkspace(window._sbUserId, WorkspaceState.zonaId);
        }
    }

    WorkspaceState.zona   = geojson;
    WorkspaceState.zonaHa = ha;
    WorkspaceState.zonaGEE = (typeof simplifyZoneForGee === 'function')
        ? simplifyZoneForGee(geojson, ha) : geojson;

    updateZoneUI();
    saveWorkspaceState();
    if (typeof agregarPoligonoDesdeWorkspace === 'function') {
        agregarPoligonoDesdeWorkspace(geojson, WorkspaceState.zonaNombre, ha);
    }
    enviarZonaABiodiversidad();

    if (typeof mostrarNotificacion === 'function') {
        mostrarNotificacion('✅ Zona actualizada: ' + ha.toLocaleString('es-CL') + ' ha');
    }
}

function _setBotonEdicion(editando) {
    var btn = document.getElementById('btn-edit');
    if (!btn) return;
    btn.classList.toggle('active', editando);
    btn.innerHTML = editando
        ? '<i class="fas fa-check"></i> Guardar cambios'
        : '<i class="fas fa-edit"></i> Editar zona';
}

function _enableDrawing() {
    // Si se empieza a dibujar mientras se edita, cancelar la edición
    if (typeof cancelarEdicionZona === 'function') cancelarEdicionZona();
    if (!globalDrawControl) return;
    // NO se limpia globalDrawnItems aquí: si el usuario se arrepiente a
    // medio dibujar, la zona anterior debe seguir en el mapa. El handler
    // de CREATED ya hace clearLayers() antes de agregar la nueva.
    if (typeof poligonos !== 'undefined') poligonos = [];
    if (typeof puntos !== 'undefined') {
        puntos.forEach(function(p) { if (p.marker) try { map.removeLayer(p.marker); } catch(e){} });
        puntos = [];
    }
    globalDrawControl.enable();
}

// ---------------------------------------------------------
// DIBUJO DE ZONA — con salida y aviso previo
// ---------------------------------------------------------
var _dibujandoZona = false;

/** Cuenta análisis guardados de la zona activa (para advertir antes de perderlos). */
function _nAnalisisZona() {
    var res = (WorkspaceState && WorkspaceState.resultados) || {};
    return Object.keys(res).reduce(function(n, k) {
        var v = res[k];
        return n + (Array.isArray(v) ? v.length : (v ? 1 : 0));
    }, 0);
}

function _setBotonDibujo(dibujando) {
    _dibujandoZona = dibujando;
    var btn = document.getElementById('btn-draw-polygon');
    if (!btn) return;
    btn.classList.toggle('active', dibujando);
    btn.innerHTML = dibujando
        ? '<i class="fas fa-times"></i> Cancelar dibujo'
        : '<i class="fas fa-pen-alt"></i> Dibujar zona';
}

function _mostrarHintDibujo() {
    if (document.getElementById('draw-hint')) return;
    var d = document.createElement('div');
    d.id = 'draw-hint';
    d.className = 'draw-hint';
    d.innerHTML = '<i class="fas fa-pen-alt"></i>' +
        '<span>Haz clic para marcar vértices · <b>doble clic</b> para cerrar la zona</span>' +
        '<button type="button" onclick="cancelarDibujoZona()">Cancelar (Esc)</button>';
    document.body.appendChild(d);
    _centrarHintSobreMapa();
}

/** Centra el hint sobre el área visible del mapa, no sobre la ventana:
    si no, queda montado a medias sobre el panel izquierdo. */
function _centrarHintSobreMapa() {
    var d = document.getElementById('draw-hint');
    if (!d) return;
    var panel = document.getElementById('ws-left-panel');
    var desde = 0;
    if (panel && !panel.classList.contains('hidden')) {
        var r = panel.getBoundingClientRect();
        if (r.width > 0) desde = r.right;
    }
    var ancho = d.offsetWidth || 440;
    if (window.innerWidth - desde < ancho + 24) { desde = 0; }  // no cabe al lado: centrar en la ventana
    var centro = desde + (window.innerWidth - desde) / 2;
    // Mantenerlo entero dentro de la ventana (con translateX(-50%) el borde
    // queda a ±ancho/2 del centro).
    var min = ancho / 2 + 12, max = window.innerWidth - ancho / 2 - 12;
    if (max < min) { centro = window.innerWidth / 2; }
    else { centro = Math.max(min, Math.min(max, centro)); }
    d.style.left = Math.round(centro) + 'px';
}
function _quitarHintDibujo() {
    var d = document.getElementById('draw-hint');
    if (d) d.remove();
}

/** Sale del modo dibujo y devuelve el mapa a como estaba. */
function cancelarDibujoZona() {
    if (globalDrawControl) { try { globalDrawControl.disable(); } catch(e) {} }
    _setBotonDibujo(false);
    _quitarHintDibujo();
    // Si se abandonó a medio dibujar, la zona previa sigue en el estado:
    // volver a pintarla para que el mapa no quede vacío.
    if (WorkspaceState.zona && globalDrawnItems && !globalDrawnItems.getLayers().length
        && typeof restoreZoneOnMap === 'function') {
        try { restoreZoneOnMap(); } catch(e) {}
    }
}

function _iniciarDibujo() {
    _enableDrawing();
    _setBotonDibujo(true);
    _mostrarHintDibujo();
}

function startDrawingZone() {
    // Segundo clic en el botón = salir del modo dibujo
    if (_dibujandoZona) { cancelarDibujoZona(); return; }

    // Si ya tiene zona activa → redibuja en el mismo workspace (sin chequeo
    // de cuota), pero avisando: reemplaza la forma y descarta los análisis.
    if (WorkspaceState.zona) {
        var n = _nAnalisisZona();
        var msg = 'Ya tienes «' + (WorkspaceState.zonaNombre || 'una zona') + '» como zona de estudio.\n\n' +
                  'Dibujar una nueva reemplazará su forma' +
                  (n ? ' y se perderán sus ' + n + ' análisis guardados' : '') + '.\n\n' +
                  '¿Continuar?';
        if (!confirm(msg)) return;
        _iniciarDibujo();
        return;
    }
    // Primera zona: verificar cuota usando _sbUserZones local (evita race condition
    // cuando el delete async aún no confirmó en Supabase)
    if (window._sbUserId) {
        var _LIMITS  = { 'free': 1, 'pro': 3, 'enterprise': 10, 'admin': Infinity };
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
    _iniciarDibujo();
}

// Crear una zona NUEVA (workspace adicional) — llamada desde el selector de zonas.
// NO fuerza el dibujo: solo prepara el estado vacío y abre el panel de herramientas
// para que el usuario elija si dibujar, usar cuenca, o cargar desde otro lado.
function startNewZone() {
    closeZoneSelector();

    function _prepararNueva() {
        WorkspaceState.zona       = null;
        WorkspaceState.zonaGEE    = null;
        WorkspaceState.zonaHa     = 0;
        WorkspaceState.zonaId     = null;
        WorkspaceState.zonaNombre = 'Mi zona de estudio';
        if (typeof clearAnalysisStateForZoneChange === 'function') {
            clearAnalysisStateForZoneChange();
        } else {
            WorkspaceState.resultados = {};
        }
        if (globalDrawnItems) globalDrawnItems.clearLayers();
        updateZoneUI();
        renderIndicadorCards();

        // Abrir panel de herramientas de dibujo si está colapsado (guía visual)
        var drawWrap   = document.getElementById('draw-tools-wrap');
        var drawToggle = document.getElementById('draw-toggle-btn');
        if (drawWrap && drawToggle && !drawWrap.classList.contains('open')
            && typeof toggleDrawTools === 'function') {
            toggleDrawTools();
        }
        if (typeof mostrarNotificacion === 'function') {
            mostrarNotificacion('🆕 Nueva zona lista. Dibuja un polígono o usa una sub-subcuenca.');
        }
    }

    if (window._sbUserId && typeof checkZoneQuota === 'function') {
        checkZoneQuota(window._sbUserId).then(function(result) {
            if (!result.ok) { mostrarModalLimite(result); return; }
            _prepararNueva();
        });
    } else {
        _prepararNueva();
    }
}

// ---------------------------------------------------------
// CUENCAS — Toggle de visibilidad en el mapa
// ---------------------------------------------------------
var _cuencasVisible = false;

async function toggleCapasCuencas() {
    // Lazy-load: si la capa no existe, descargarla la primera vez
    if ((typeof cuencasLayer === 'undefined' || !cuencasLayer)
        && typeof cargarCuencasDGA === 'function') {
        try {
            await cargarCuencasDGA();
        } catch (e) {
            console.warn('[Cuencas] no se pudo cargar:', e);
            return;
        }
    }
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
