/* ==========================================================================
   WORKSPACE GEE MODULES - Vegetacion, agua, DEM y zona
   Split mechanically from workspace.js; keep global function names stable.
   ========================================================================== */

// ---------------------------------------------------------
// FUNCIONES DE TABS ESPECÍFICOS (Vegetación y Elevación)
// ---------------------------------------------------------
// GRADIENTES FRONTEND — deben coincidir exactamente con VIZ_PALETTES del backend
// ---------------------------------------------------------
var VEG_GRADIENTE = {
    'NDVI':  'linear-gradient(90deg,#d73027,#f46d43,#fdae61,#fee08b,#ffffbf,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)',
    'EVI':   'linear-gradient(90deg,#d73027,#f46d43,#fdae61,#fee08b,#ffffbf,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)',
    'EVI2':  'linear-gradient(90deg,#d73027,#f46d43,#fdae61,#fee08b,#ffffbf,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)',
    'SAVI':  'linear-gradient(90deg,#d73027,#f46d43,#fdae61,#fee08b,#ffffbf,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)',
    'LAI':   'linear-gradient(90deg,#fff7bc,#fec44f,#fe9929,#ec7014,#cc4c02,#8c2d04)',
    'VARI':  'linear-gradient(90deg,#d73027,#f46d43,#fdae61,#ffffbf,#a6d96a,#1a9850,#006837)',
    'NDMI':  'linear-gradient(90deg,#d7191c,#fdae61,#ffffbf,#abd9e9,#2c7bb6)',
    'MSI':   'linear-gradient(90deg,#2c7bb6,#abd9e9,#ffffbf,#fdae61,#d7191c)',
    'NDWI':  'linear-gradient(90deg,#d4a96a,#f5f5dc,#9ecae1,#2166ac,#084081)',
    'MNDWI': 'linear-gradient(90deg,#c7a46b,#faf0dc,#74b9d4,#1a6aaa,#053061)',
    'NBR':   'linear-gradient(90deg,#006837,#1a9850,#a6d96a,#ffffbf,#fdae61,#f46d43,#d73027)',
    'NBR2':  'linear-gradient(90deg,#006837,#1a9850,#a6d96a,#ffffbf,#fdae61,#f46d43,#d73027)',
    'NDDI':  'linear-gradient(90deg,#2c7bb6,#abd9e9,#ffffbf,#fdae61,#d7191c)',
    'BSI':   'linear-gradient(90deg,#1a9850,#ffffbf,#d73027)',
    'NDSI':  'linear-gradient(90deg,#f7fbff,#c6dbef,#6baed6,#2171b5,#084594)'
};
var _VEG_GRADIENTE_DEFAULT = 'linear-gradient(90deg,#440154,#31688e,#35b779,#fde725)';

var vegLayer = null;
var demLayer = null;

function requestVegetacion() {
    if (!WorkspaceState.zonaGEE) return _noZonaGuard();

    var btn = document.getElementById('btn-veg-gen');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
    btn.disabled = true;

    var payload = {
        geojson: WorkspaceState.zonaGEE.geometry,
        indice: document.getElementById('veg-indice').value,
        fecha_inicio: document.getElementById('veg-inicio').value,
        fecha_fin: document.getElementById('veg-fin').value
    };

    fetch('https://evergreen-backend-awv1.onrender.com/api/vegetacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        btn.innerHTML = '<i class="fas fa-seedling"></i> Generar Análisis';
        btn.disabled = false;
        if (data.error) {
            if (typeof mostrarNotificacion === 'function') mostrarNotificacion('❌ ' + data.error);
            else alert('Error: ' + data.error);
            return;
        }

        if (vegLayer) map.removeLayer(vegLayer);
        vegLayer = L.tileLayer(data.tiles, { pane: 'overlayPane', zIndex: 400, crossOrigin: 'anonymous' });
        vegLayer.addTo(map);

        // Stats
        document.getElementById('veg-mean').textContent = (data.stats.mean !== null ? data.stats.mean.toFixed(3) : '—');
        document.getElementById('veg-min').textContent  = (data.stats.min  !== null ? data.stats.min.toFixed(3)  : '—');
        document.getElementById('veg-max').textContent  = (data.stats.max  !== null ? data.stats.max.toFixed(3)  : '—');

        // N imágenes
        var nimEl = document.getElementById('veg-nimages');
        if (nimEl) nimEl.textContent = 'Mediana de ' + (data.n_imagenes || '?') + ' imágenes · p2–p98 adaptado';

        // Leyenda min/max reales
        var lblMin = document.getElementById('veg-legend-min');
        var lblMax = document.getElementById('veg-legend-max');
        if (lblMin && data.min_viz !== undefined) lblMin.textContent = data.min_viz.toFixed(2);
        if (lblMax && data.max_viz !== undefined) lblMax.textContent = data.max_viz.toFixed(2);

        // Gradiente dinámico según índice (coincide con palette del backend)
        var gradBar = document.getElementById('veg-gradient-bar');
        if (gradBar) gradBar.style.background = VEG_GRADIENTE[payload.indice] || _VEG_GRADIENTE_DEFAULT;

        // Mostrar panel y centrar mapa
        document.getElementById('veg-resultados').style.display = 'block';
        _fitToZone();

        // Registrar capa en el panel de capas (todas las variantes)
        registerLayer('vegetacion_' + payload.indice, vegLayer);

        // Guardar en dashboard Resumen
        saveResultado('vegetacion', payload.indice, data.stats, data.tiles,
                      payload.fecha_inicio, payload.fecha_fin);

        // Actualizar panel detalle 1 en Resumen con datos reales
        updateDetailVegStats(payload.indice, data.stats, payload.fecha_inicio, payload.fecha_fin);

        // Gráfico de evolución temporal (aparece desde la 2.ª medición)
        renderVegHistoryChart(payload.indice);
    })
    .catch(function() {
        btn.innerHTML = '<i class="fas fa-seedling"></i> Generar Análisis';
        btn.disabled = false;
        if (typeof mostrarNotificacion === 'function') mostrarNotificacion('❌ Error de conexión al servidor.');
        else alert('Error de conexión al servidor.');
    });
}

// ---------------------------------------------------------
// AGUA — Análisis NDWI / MNDWI / NDMI
// ---------------------------------------------------------
var aguaLayer = null;

// Info descriptiva por índice
var AGUA_INFO = {
    'NDWI':  'Detecta agua superficial usando Verde (B3) e Infrarrojo Cercano (B8). Valores > 0 indican presencia de agua.',
    'MNDWI': 'Versión mejorada del NDWI usando Verde (B3) e Infrarrojo de Onda Corta (B11). Más eficiente en zonas urbanas y turbias.',
    'NDMI':  'Índice de humedad foliar y del suelo usando NIR (B8) y SWIR (B11). Útil para detectar estrés hídrico en vegetación.'
};

// Gradiente visual por índice
var AGUA_GRADIENTE = {
    'NDWI':  'linear-gradient(90deg, #d4a96a, #f5f5dc, #9ecae1, #2166ac, #084081)',
    'MNDWI': 'linear-gradient(90deg, #c7a46b, #faf0dc, #74b9d4, #1a6aaa, #053061)',
    'NDMI':  'linear-gradient(90deg, #d7191c, #fdae61, #ffffbf, #abd9e9, #2c7bb6)'
};

function actualizarInfoAgua() {
    var sel = document.getElementById('agua-indice');
    if (!sel) return;
    var indice = sel.value;
    var infoEl = document.getElementById('agua-info-text');
    if (infoEl) infoEl.textContent = AGUA_INFO[indice] || '';
}

function requestAgua() {
    if (!WorkspaceState.zonaGEE) return _noZonaGuard();

    var indice = document.getElementById('agua-indice').value;
    var btn = document.getElementById('btn-agua-gen');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
    btn.disabled = true;

    var payload = {
        geojson: WorkspaceState.zonaGEE.geometry,
        indice: indice,
        fecha_inicio: document.getElementById('agua-inicio').value,
        fecha_fin: document.getElementById('agua-fin').value
    };

    fetch('https://evergreen-backend-awv1.onrender.com/api/vegetacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        btn.innerHTML = '<i class="fas fa-tint"></i> Generar Análisis de Agua';
        btn.disabled = false;
        if (data.error) {
            mostrarNotificacion('❌ ' + data.error);
            return;
        }

        // Capa en el mapa
        if (aguaLayer) map.removeLayer(aguaLayer);
        aguaLayer = L.tileLayer(data.tiles, { pane: 'overlayPane', zIndex: 400, crossOrigin: 'anonymous' });
        aguaLayer.addTo(map);

        // Actualizar stats (null-safe)
        document.getElementById('agua-mean').textContent = (data.stats.mean !== null ? data.stats.mean.toFixed(3) : '—');
        document.getElementById('agua-min').textContent  = (data.stats.min  !== null ? data.stats.min.toFixed(3)  : '—');
        document.getElementById('agua-max').textContent  = (data.stats.max  !== null ? data.stats.max.toFixed(3)  : '—');
        document.getElementById('agua-indice-label').textContent = indice;

        // Gradiente según índice
        var gradBar = document.getElementById('agua-gradient-bar');
        if (gradBar) gradBar.style.background = AGUA_GRADIENTE[indice] || AGUA_GRADIENTE['NDWI'];

        document.getElementById('agua-resultados').style.display = 'block';
        _fitToZone();

        // Registrar capa en el panel de capas
        registerLayer('agua_' + indice, aguaLayer);

        // Guardar en dashboard de Resumen
        saveResultado('agua', indice, data.stats, data.tiles,
                      payload.fecha_inicio, payload.fecha_fin);

        // Gráfico de evolución temporal
        renderAguaHistoryChart(indice);
    })
    .catch(function() {
        btn.innerHTML = '<i class="fas fa-tint"></i> Generar Análisis de Agua';
        btn.disabled = false;
        mostrarNotificacion('❌ Error de conexión al servidor.');
    });
}

// Almacena las 3 URLs de tiles del DEM para alternar sin re-procesar
var _demTiles = { dem: null, slope: null, aspect: null };
var _demLayerActual = null;

function switchDemLayer(tipo) {
    if (!_demTiles[tipo]) return;

    // Actualizar pill activo
    ['dem', 'slope'].forEach(function(t) {
        var pill = document.getElementById('dem-pill-' + t);
        var panel = document.getElementById('dem-panel-' + t);
        if (pill)  pill.classList.toggle('active', t === tipo);
        if (panel) panel.style.display = (t === tipo) ? 'block' : 'none';
    });

    // Cambiar capa en el mapa
    if (_demLayerActual) map.removeLayer(_demLayerActual);
    _demLayerActual = L.tileLayer(_demTiles[tipo], { pane: 'overlayPane', zIndex: 390, crossOrigin: 'anonymous' });
    _demLayerActual.addTo(map);
}

function requestElevacion() {
    if (!WorkspaceState.zonaGEE) return _noZonaGuard();

    var fuente = document.getElementById('dem-fuente').value;
    var btn = document.getElementById('btn-dem-gen');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
    btn.disabled = true;

    var payload = {
        geojson: WorkspaceState.zonaGEE.geometry,
        fuente: fuente
    };

    fetch('https://evergreen-backend-awv1.onrender.com/api/dem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        btn.innerHTML = '<i class="fas fa-layer-group"></i> Procesar Capas';
        btn.disabled = false;
        if (data.error) {
            mostrarNotificacion('❌ ' + data.error);
            return;
        }

        // Guardar URLs
        _demTiles.dem   = data.tiles_dem;
        _demTiles.slope = data.tiles_slope;

        // Botón descarga GeoTIFF
        var dlBtn = document.getElementById('dem-download-btn');
        if (dlBtn) {
            if (data.download_url) {
                dlBtn.href = data.download_url;
                dlBtn.style.display = 'flex';
            } else {
                dlBtn.style.display = 'none';
            }
        }

        // Etiqueta de fuente
        var srcLabel = document.getElementById('dem-source-label');
        if (srcLabel) srcLabel.textContent = fuente === 'copernicus' ? 'Copernicus GLO-30' : 'ALOS AW3D30';

        // Stats elevación (null-safe)
        document.getElementById('dem-mean').textContent = (data.stats.elev_mean !== null ? data.stats.elev_mean.toFixed(1) + ' m' : '—');
        document.getElementById('dem-min').textContent  = (data.stats.elev_min  !== null ? data.stats.elev_min.toFixed(1)  + ' m' : '—');
        document.getElementById('dem-max').textContent  = (data.stats.elev_max  !== null ? data.stats.elev_max.toFixed(1)  + ' m' : '—');

        // Stats pendiente
        var slopeMeanEl = document.getElementById('dem-slope-mean');
        if (slopeMeanEl && data.stats.slope_mean !== undefined && data.stats.slope_mean !== null) {
            slopeMeanEl.textContent = data.stats.slope_mean.toFixed(1) + '°';
        }

        // Mostrar panel y activar capa DEM por defecto
        document.getElementById('dem-resultados').style.display = 'block';

        // Limpiar capas anteriores
        if (demLayer) { map.removeLayer(demLayer); demLayer = null; }
        if (_demLayerActual) { map.removeLayer(_demLayerActual); _demLayerActual = null; }

        // Reset pills al DEM y centrar mapa
        switchDemLayer('dem');
        _fitToZone();

        // Registrar capas DEM en el panel de capas (instancias independientes para el registro)
        registerLayer('dem_Elevacion', L.tileLayer(data.tiles_dem, { pane: 'overlayPane', zIndex: 390, crossOrigin: 'anonymous' }));
        if (data.tiles_slope) registerLayer('dem_Pendiente', L.tileLayer(data.tiles_slope, { pane: 'overlayPane', zIndex: 390, crossOrigin: 'anonymous' }));

        // Guardar en dashboard de Resumen
        saveResultado('dem', 'Elevacion',
            { mean: data.stats.elev_mean, min: data.stats.elev_min, max: data.stats.elev_max },
            data.tiles_dem, null, null);
        if (data.stats.slope_mean !== undefined && data.stats.slope_mean !== null) {
            saveResultado('dem', 'Pendiente',
                { mean: data.stats.slope_mean },
                data.tiles_slope, null, null);
        }
    })
    .catch(function() {
        btn.innerHTML = '<i class="fas fa-layer-group"></i> Procesar Capas';
        btn.disabled = false;
        mostrarNotificacion('❌ Error de conexión al servidor.');
    });
}

function exportarGeoJSON() {
    if (!WorkspaceState.zona) return alert("No hay zona definida.");
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(WorkspaceState.zona));
    var dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "zona_estudio.geojson");
    dlAnchorElem.click();
}

// Limpiar zona activa
function clearZoneState() {
    WorkspaceState.zona       = null;
    WorkspaceState.zonaGEE    = null;
    WorkspaceState.zonaHa     = 0;
    WorkspaceState.zonaId     = null;
    WorkspaceState.zonaNombre = 'Mi zona de estudio';
    _climaFetchDone = false;
    _layerRegistry  = {};
    _refreshGeeLayersPanel();
    var w = document.getElementById('clima-widget');
    if (w) w.style.display = 'none';

    if (globalDrawnItems) globalDrawnItems.clearLayers();

    var nameInput = document.getElementById('ws-zone-name');
    if (nameInput) nameInput.value = WorkspaceState.zonaNombre;

    updateZoneUI();
    saveWorkspaceState();
}

function clearZone() {
    if (!WorkspaceState.zona) return;
    if (!confirm('¿Eliminar la zona activa y todos sus análisis?\n\nEsta acción no se puede deshacer.')) return;

    var deletedId = WorkspaceState.zonaId;

    // Actualizar lista local INMEDIATAMENTE (optimistic update antes del delete async)
    // Esto evita que checkZoneQuota cuente la zona que se está eliminando
    window._sbUserZones = (window._sbUserZones || []).filter(function(z) { return z.id !== deletedId; });

    // Borrar datos en Supabase (cascade borra también los results)
    if (window._sbUserId && typeof clearCloudData === 'function') {
        clearCloudData(window._sbUserId, deletedId);
    }

    WorkspaceState.resultados = {};
    clearZoneState();

    // Si queda otra zona en la lista, cambiar a ella automáticamente
    var remaining = window._sbUserZones; // ya filtrada arriba
    if (remaining.length > 0 && window._sbUserId) {
        switchToZone(remaining[0].id);
        return;
    }

    // Actualizar selector
    if (typeof renderZoneSelector === 'function') renderZoneSelector(window._sbUserZones || []);

    if (typeof mostrarNotificacion === 'function') {
        mostrarNotificacion('✅ Zona y análisis eliminados');
    }
}

// Usar cuenca DGA seleccionada como zona de estudio
function usarCuencaEnWorkspace() {
    if (typeof cuencaSeleccionada === 'undefined' || !cuencaSeleccionada) {
        alert('⚠️ Selecciona primero una cuenca haciendo click en el mapa.');
        return;
    }

    var feature = cuencaSeleccionada.feature;
    var geojson = cuencaSeleccionada.toGeoJSON();
    var props   = feature.properties;

    var latLngs  = cuencaSeleccionada.getLatLngs();
    var flatLngs = Array.isArray(latLngs[0]) && Array.isArray(latLngs[0][0])
        ? latLngs[0][0]
        : (Array.isArray(latLngs[0]) ? latLngs[0] : latLngs);
    var areaSqM  = L.GeometryUtil.geodesicArea(flatLngs);
    var ha       = Math.round(areaSqM / 10000);

    if (ha > 50000) {
        alert('⚠️ La cuenca supera el límite de 50,000 ha (' + ha.toLocaleString('es-CL') + ' ha). Elige otra más pequeña.');
        return;
    }

    function _aplicarCuenca() {
        WorkspaceState.zona       = geojson;
        WorkspaceState.zonaHa     = ha;
        WorkspaceState.zonaNombre = props.nombre || 'Cuenca DGA';

        if (typeof turf !== 'undefined') {
            WorkspaceState.zonaGEE = turf.simplify(geojson, { tolerance: 0.001, highQuality: true });
        } else {
            WorkspaceState.zonaGEE = geojson;
        }

        if (typeof agregarPoligonoDesdeWorkspace === 'function') {
            agregarPoligonoDesdeWorkspace(geojson, WorkspaceState.zonaNombre, ha);
        }

        updateZoneUI();
        saveWorkspaceState();
        enviarZonaABiodiversidad();

        if (typeof mostrarNotificacion === 'function') {
            mostrarNotificacion('✅ Cuenca "' + WorkspaceState.zonaNombre + '" establecida como zona activa');
        }
    }

    // Si ya tiene zona → solo reemplaza el polígono en el mismo workspace
    if (WorkspaceState.zona) {
        _aplicarCuenca();
        return;
    }

    // Primera zona: verificar cuota usando _sbUserZones local (evita race condition)
    if (window._sbUserId) {
        var _LIMITS2  = { 'free': 1, 'pro': 3, 'admin': Infinity };
        var plan2     = window._sbUserPlan || 'free';
        var maxZones2 = _LIMITS2[plan2] !== undefined ? _LIMITS2[plan2] : 1;
        var zones2    = (typeof getValidStoredZones === 'function')
            ? getValidStoredZones(window._sbUserZones)
            : (window._sbUserZones || []).filter(function(z) { return z && z.polygon_geojson; });
        var count2    = zones2.length;
        if (maxZones2 !== Infinity && count2 >= maxZones2) {
            mostrarModalLimite({ ok: false, reason: 'LIMIT_REACHED', plan: plan2, used: count2, max: maxZones2 });
            return;
        }
    }
    _aplicarCuenca();
}

/**
 * Redibuja el AOI guardado en el mapa al recargar la página.
 * Debe llamarse DESPUÉS de initWorkspaceMap().
 */
function restoreZoneOnMap() {
    if (!WorkspaceState.zona || typeof map === 'undefined' || !globalDrawnItems) return;
    try {
        globalDrawnItems.clearLayers();
        L.geoJSON(WorkspaceState.zona, {
            style: {
                color: '#00C88E',
                weight: 2,
                opacity: 0.9,
                fillColor: '#00C88E',
                fillOpacity: _aoiVisible ? _aoiOpacity : 0
            }
        }).eachLayer(function(layer) {
            globalDrawnItems.addLayer(layer);
            globalWorkspaceAOILayer = layer;
        });
    } catch(e) { console.warn('restoreZoneOnMap:', e); }
}

// ==========================================================================
//  TILES CACHE — Restaurar URLs guardadas en result_data
// ==========================================================================

/**
 * Reconstruye _tilesCache a partir de las URLs guardadas en WorkspaceState.resultados.
 * Las URLs de GEE duran ~24-48h — si expiraron el tile simplemente no carga
 * y el usuario puede recalcular.
 */
function _restoreTilesCache() {
    var resultados = WorkspaceState.resultados || {};
    Object.keys(resultados).forEach(function(key) {
        var arr = resultados[key];
        if (!Array.isArray(arr)) return;
        arr.forEach(function(entry) {
            if (entry.tilesUrl && entry.ts) {
                _tilesCache[key + '_' + entry.ts] = entry.tilesUrl;
            }
        });
    });
}

/**
 * Activa automáticamente la capa del indicador más reciente en el mapa.
 * Se llama tras restoreZoneOnMap() cuando hay resultados guardados.
 */
function restoreLastActiveLayer() {
    var resultados = WorkspaceState.resultados || {};
    var keys = Object.keys(resultados).filter(function(k) {
        return Array.isArray(resultados[k]) && resultados[k].length > 0;
    });
    if (keys.length === 0) return;

    // Ordenar por ts más reciente
    keys.sort(function(a, b) {
        var aLast = resultados[a][resultados[a].length - 1];
        var bLast = resultados[b][resultados[b].length - 1];
        return bLast.ts - aLast.ts;
    });

    // 1ª prioridad: activar el más reciente con tile en caché (URL viva)
    for (var i = 0; i < keys.length; i++) {
        var key    = keys[i];
        var arr    = resultados[key];
        var latest = arr[arr.length - 1];
        var cacheKey = key + '_' + latest.ts;
        if (_tilesCache[cacheKey]) {
            activarIndicador(key);
            return;
        }
    }

    // 2ª prioridad: activar el más reciente con preview guardada en Storage
    for (var j = 0; j < keys.length; j++) {
        var k2     = keys[j];
        var arr2   = resultados[k2];
        var latest2 = arr2[arr2.length - 1];
        if (latest2.previewPath) {
            activarIndicador(k2); // activarIndicador detectará previewPath y restaurará la imagen
            return;
        }
    }
}
