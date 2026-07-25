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
    'NDWI':  'linear-gradient(90deg,#8c510a,#bf812d,#d4a96a,#f5f5dc,#9ecae1,#2166ac,#084081)',
    'MNDWI': 'linear-gradient(90deg,#7a4f1d,#a97e3c,#c7a46b,#faf0dc,#74b9d4,#1a6aaa,#053061)',
    'NBR':   'linear-gradient(90deg,#d73027,#f46d43,#fdae61,#ffffbf,#a6d96a,#1a9850,#006837)',
    'NBR2':  'linear-gradient(90deg,#d73027,#f46d43,#fdae61,#ffffbf,#a6d96a,#1a9850,#006837)',
    'NDDI':  'linear-gradient(90deg,#2c7bb6,#abd9e9,#ffffbf,#fdae61,#d7191c)',
    'BSI':   'linear-gradient(90deg,#1a9850,#ffffbf,#d73027)',
    'NDSI':  'linear-gradient(90deg,#f7fbff,#c6dbef,#6baed6,#2171b5,#084594)'
};
var _VEG_GRADIENTE_DEFAULT = 'linear-gradient(90deg,#440154,#31688e,#35b779,#fde725)';

var vegLayer = null;
var demLayer = null;

function fetchBackendJson(url, payload) {
    var headersPromise = (typeof getBackendAuthHeaders === 'function')
        ? getBackendAuthHeaders({ 'Content-Type': 'application/json' })
        : Promise.resolve({ 'Content-Type': 'application/json' });
    return headersPromise.then(function(headers) {
        return fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
    });
}

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

    fetchBackendJson('https://evergreen-backend-awv1.onrender.com/api/vegetacion', payload)
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

        // Guardar en dashboard Resumen (n_imagenes va en stats para el historial)
        if (data.stats && data.n_imagenes) data.stats.n_imagenes = data.n_imagenes;
        var vegTs = saveResultado('vegetacion', payload.indice, data.stats, data.tiles,
                      payload.fecha_inicio, payload.fecha_fin);
        if (typeof uploadAnalysisPreviewFromPayload === 'function') {
            uploadAnalysisPreviewFromPayload('vegetacion_' + payload.indice, vegTs, data);
        }

        // Actualizar panel detalle 1 en Resumen con datos reales
        updateDetailVegStats(payload.indice, data.stats, payload.fecha_inicio, payload.fecha_fin);

        // Sincronizar leyenda flotante del mapa con el índice recién calculado
        try { showMiniLegend('vegetacion_' + payload.indice); } catch(e) {}

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

// Gradiente visual por índice — neutro al centro (escala simétrica en 0, igual que backend)
var AGUA_GRADIENTE = {
    'NDWI':  'linear-gradient(90deg, #8c510a, #bf812d, #d4a96a, #f5f5dc, #9ecae1, #2166ac, #084081)',
    'MNDWI': 'linear-gradient(90deg, #7a4f1d, #a97e3c, #c7a46b, #faf0dc, #74b9d4, #1a6aaa, #053061)',
    'NDMI':  'linear-gradient(90deg, #d7191c, #fdae61, #ffffbf, #abd9e9, #2c7bb6)'
};

// Etiquetas de extremos y nota de escala por índice
var AGUA_LABELS = {
    'NDWI':  { min: 'Sin agua', max: 'Agua',   nota: 'Escala simétrica centrada en 0 · azul = agua (valores > 0).' },
    'MNDWI': { min: 'Sin agua', max: 'Agua',   nota: 'Escala simétrica centrada en 0 · azul = agua (valores > 0).' },
    'NDMI':  { min: 'Seco',     max: 'Húmedo', nota: 'Escala simétrica centrada en 0 · azul = alta humedad (valores > 0).' }
};

// Modos de escala del análisis de agua activo (toggle Centrada en 0 / Adaptada al AOI)
var _aguaVizModes = null;   // { indice, centered:{url,min,max}, adaptive:{url,min,max}|null }

/**
 * Cambia la escala de visualización de la capa de agua activa.
 * Swap de tiles sobre la MISMA instancia Leaflet (setUrl) — mantiene el
 * registro del panel de capas y la opacidad. La escala canónica que se
 * persiste (tiles cache / preview Supabase) sigue siendo la centrada en 0.
 */
function setAguaScaleMode(mode) {
    if (!_aguaVizModes) return;
    var m = _aguaVizModes[mode];
    if (!m) return;

    var btnC = document.getElementById('agua-scale-centered');
    var btnA = document.getElementById('agua-scale-adaptive');
    if (btnC) btnC.classList.toggle('active', mode === 'centered');
    if (btnA) btnA.classList.toggle('active', mode === 'adaptive');

    if (aguaLayer && typeof aguaLayer.setUrl === 'function') aguaLayer.setUrl(m.url);

    var lblMin = document.getElementById('agua-legend-min');
    var lblMax = document.getElementById('agua-legend-max');
    var nota   = document.getElementById('agua-viz-note');
    var hasNums = (typeof m.min === 'number' && typeof m.max === 'number');

    if (mode === 'centered') {
        var lbls = AGUA_LABELS[_aguaVizModes.indice] || { min: 'Bajo', max: 'Alto', nota: '' };
        if (lblMin) lblMin.textContent = lbls.min + (hasNums ? ' (' + m.min.toFixed(2) + ')' : '');
        if (lblMax) lblMax.textContent = lbls.max + (hasNums ? ' (+' + m.max.toFixed(2) + ')' : '');
        if (nota && lbls.nota) nota.textContent = lbls.nota;
    } else {
        // En modo adaptativo el color NO indica agua absoluta — etiquetas neutras
        if (lblMin) lblMin.textContent = 'Mín AOI' + (hasNums ? ' (' + m.min.toFixed(2) + ')' : '');
        if (lblMax) lblMax.textContent = 'Máx AOI' + (hasNums ? ' (' + m.max.toFixed(2) + ')' : '');
        if (nota) nota.textContent = 'Escala adaptada al rango del AOI (p2–p98) · máximo contraste; el color no indica agua absoluta.';
    }
}

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

    fetchBackendJson('https://evergreen-backend-awv1.onrender.com/api/vegetacion', payload)
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

        // Modos de escala: centrada en 0 (canónica) + adaptada al AOI (si el backend la envía)
        _aguaVizModes = {
            indice: indice,
            centered: {
                url: data.tiles,
                min: (typeof data.min_viz === 'number') ? data.min_viz : null,
                max: (typeof data.max_viz === 'number') ? data.max_viz : null
            },
            adaptive: (data.tiles_adaptive && typeof data.min_viz_adaptive === 'number')
                ? { url: data.tiles_adaptive, min: data.min_viz_adaptive, max: data.max_viz_adaptive }
                : null
        };
        var scaleRow = document.getElementById('agua-scale-row');
        if (scaleRow) scaleRow.style.display = _aguaVizModes.adaptive ? 'flex' : 'none';
        setAguaScaleMode('centered');

        document.getElementById('agua-resultados').style.display = 'block';
        _fitToZone();

        // Registrar capa en el panel de capas
        registerLayer('agua_' + indice, aguaLayer);

        // Guardar en dashboard de Resumen (n_imagenes va en stats para el historial)
        if (data.stats && data.n_imagenes) data.stats.n_imagenes = data.n_imagenes;
        var aguaTs = saveResultado('agua', indice, data.stats, data.tiles,
                      payload.fecha_inicio, payload.fecha_fin);
        if (typeof uploadAnalysisPreviewFromPayload === 'function') {
            uploadAnalysisPreviewFromPayload('agua_' + indice, aguaTs, data);
        }

        // Sincronizar leyenda flotante del mapa con el índice recién calculado
        try { showMiniLegend('agua_' + indice); } catch(e) {}

        // Gráfico de evolución temporal
        renderAguaHistoryChart(indice);
    })
    .catch(function() {
        btn.innerHTML = '<i class="fas fa-tint"></i> Generar Análisis de Agua';
        btn.disabled = false;
        mostrarNotificacion('❌ Error de conexión al servidor.');
    });
}

// ---------------------------------------------------------
// AGUA — SERIE ESTACIONAL (análisis temporal real)
// ---------------------------------------------------------
var _serieData      = null;   // doc de la serie activa (respuesta backend + ts)
var _serieChart     = null;   // instancia Chart.js
var _serieChartMode = 'superficie';

var SERIE_SEASON_LABELS = { 'DJF': 'Verano', 'MAM': 'Otoño', 'JJA': 'Invierno', 'SON': 'Primavera' };
var SERIE_SEASON_MONTHS = { 'DJF': 'dic–feb', 'MAM': 'mar–may', 'JJA': 'jun–ago', 'SON': 'sep–nov' };

function _serieFmtHa(v) {
    if (v === null || v === undefined || isNaN(parseFloat(v))) return '—';
    var n = parseFloat(v);
    return (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
}

function requestAguaSerie() {
    if (!WorkspaceState.zonaGEE) return _noZonaGuard();

    var indice = document.getElementById('serie-indice').value;
    var season = document.getElementById('serie-season').value;
    var y0  = parseInt(document.getElementById('serie-year-start').value, 10);
    var y1  = parseInt(document.getElementById('serie-year-end').value, 10);
    var thr = parseFloat(document.getElementById('serie-threshold').value);

    var notif = (typeof mostrarNotificacion === 'function') ? mostrarNotificacion : alert;
    if (isNaN(y0) || isNaN(y1) || y1 < y0) { notif('⚠️ Revisa el rango de años.'); return; }
    if (y1 - y0 + 1 < 2)  { notif('⚠️ La serie necesita al menos 2 años.'); return; }
    if (y1 - y0 + 1 > 10) { notif('⚠️ Máximo 10 años por serie.'); return; }
    if (y0 < 2016)        { notif('⚠️ Sentinel-2 no tiene cobertura confiable antes de 2016.'); return; }

    var btn = document.getElementById('btn-serie-gen');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando serie (~1 min)...';
    btn.disabled = true;

    fetchBackendJson('https://evergreen-backend-awv1.onrender.com/api/agua/serie-estacional', {
        geojson: WorkspaceState.zonaGEE.geometry,
        indice: indice, season: season,
        year_start: y0, year_end: y1, threshold: thr
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        btn.innerHTML = '<i class="fas fa-chart-line"></i> Generar Serie Estacional';
        btn.disabled = false;
        if (data.error) { notif('❌ ' + data.error); return; }

        var doc = data;
        doc.ts = Date.now();

        // Persistir: localStorage (via WorkspaceState) + Supabase (result_data = [doc], CHECK de array)
        var key = 'agua_serie_' + doc.indice + '_' + doc.season;
        if (!WorkspaceState.series) WorkspaceState.series = {};
        WorkspaceState.series[key] = doc;
        saveWorkspaceState();
        if (window._sbUserId && typeof saveResultsToCloud === 'function') {
            saveResultsToCloud(window._sbUserId, key, [doc]);
        }

        renderAguaSerie(doc);
    })
    .catch(function() {
        btn.innerHTML = '<i class="fas fa-chart-line"></i> Generar Serie Estacional';
        btn.disabled = false;
        notif('❌ Error de conexión al servidor.');
    });
}

/** Pinta headline, tabla y gráfico de una serie estacional. */
function renderAguaSerie(doc) {
    if (!doc || !doc.periods || !doc.periods.length) return;
    _serieData = doc;

    var periods = doc.periods;
    var valid = periods.filter(function(p) { return p.water_ha !== null && p.water_ha !== undefined; });
    var seasonLbl = SERIE_SEASON_LABELS[doc.season] || doc.season;

    // Headline: última superficie válida
    var last = valid.length ? valid[valid.length - 1] : null;
    var lastEl  = document.getElementById('serie-last-ha');
    var lastLbl = document.getElementById('serie-last-lbl');
    if (lastEl)  lastEl.textContent  = last ? _serieFmtHa(last.water_ha) + ' ha' : '—';
    if (lastLbl) lastLbl.textContent = last ? 'Superficie · ' + seasonLbl.toLowerCase() + ' ' + last.year : 'Última superficie';

    // Delta del período (primera → última válida)
    var deltaEl = document.getElementById('serie-delta');
    if (deltaEl) {
        if (valid.length >= 2) {
            var delta = valid[valid.length - 1].water_ha - valid[0].water_ha;
            deltaEl.textContent = (delta > 0 ? '+' : '') + _serieFmtHa(delta) + ' ha';
            deltaEl.style.color = delta < 0 ? '#c0392b' : (delta > 0 ? '#1e6ea0' : '');
        } else {
            deltaEl.textContent = '—';
            deltaEl.style.color = '';
        }
    }

    // Tendencia (Sen + Mann-Kendall)
    var trendEl  = document.getElementById('serie-trend');
    var trendLbl = document.getElementById('serie-trend-lbl');
    if (trendEl) {
        if (doc.trend) {
            var s = doc.trend.sen_slope_ha;
            trendEl.textContent = (s > 0 ? '+' : '') + s.toFixed(2) + ' ha/año';
            trendEl.style.color = s < 0 ? '#c0392b' : (s > 0 ? '#1e6ea0' : '');
            if (trendLbl) trendLbl.textContent = doc.trend.significant
                ? 'Tendencia · significativa'
                : 'Tendencia · no significativa';
        } else {
            trendEl.textContent = '—';
            trendEl.style.color = '';
            if (trendLbl) trendLbl.textContent = 'Tendencia (mín. 4 años con datos)';
        }
    }

    // Tabla de períodos
    var cont = document.getElementById('serie-table');
    if (cont) {
        var html = '<table class="ap-history-table"><thead><tr>' +
            '<th>Período</th>' +
            '<th class="ht-num">Superficie</th>' +
            '<th class="ht-num">% AOI</th>' +
            '<th class="ht-num">Imgs</th>' +
            '<th class="ht-num">Cobert.</th>' +
            '<th></th>' +
            '</tr></thead><tbody>';
        for (var i = periods.length - 1; i >= 0; i--) {
            var p = periods[i];
            var sinDatos = (p.water_ha === null || p.water_ha === undefined);
            html += '<tr' + (i === periods.length - 1 ? ' class="latest"' : '') + '>' +
                '<td>' + seasonLbl + ' ' + p.year + ' <span style="color:#999;">(' + (SERIE_SEASON_MONTHS[doc.season] || '') + ')</span></td>' +
                '<td class="ht-num">' + (sinDatos ? 'sin datos' : _serieFmtHa(p.water_ha) + ' ha') + '</td>' +
                '<td class="ht-num">' + (p.water_pct !== null && p.water_pct !== undefined ? p.water_pct.toFixed(1) + '%' : '—') + '</td>' +
                '<td class="ht-num">' + p.n_images + '</td>' +
                '<td class="ht-num">' + (p.coverage_pct !== null && p.coverage_pct !== undefined ? p.coverage_pct.toFixed(0) + '%' : '—') + '</td>' +
                '<td>' + (sinDatos ? '' : (p.reliable ? '' : '⚠')) + '</td>' +
                '</tr>';
        }
        html += '</tbody></table>';
        cont.innerHTML = html;
    }

    // Reset a vista Superficie y dibujar
    setSerieChartMode('superficie');

    var res = document.getElementById('serie-resultados');
    if (res) res.style.display = 'block';
}

function setSerieChartMode(mode) {
    _serieChartMode = mode;
    ['superficie', 'indice', 'anomalias'].forEach(function(m) {
        var b = document.getElementById('serie-mode-' + m);
        if (b) b.classList.toggle('active', m === mode);
    });
    _renderSerieChart();
}

function _renderSerieChart() {
    var d = _serieData;
    var canvas = document.getElementById('serie-chart');
    if (!d || !canvas) return;
    if (_serieChart) { try { _serieChart.destroy(); } catch(e) {} }

    var periods = d.periods;
    var years = periods.map(function(p) { return p.year; });
    var valid = periods.filter(function(p) { return p.water_ha !== null && p.water_ha !== undefined; });
    var datasets = [];
    var yOpts = { beginAtZero: false, ticks: { font: { size: 9 } }, grid: { color: 'rgba(0,0,0,0.05)' } };
    var chartType = 'bar';

    function tooltipExtra(idx) {
        var p = periods[idx];
        var lines = ['Imágenes: ' + p.n_images];
        if (p.coverage_pct !== null && p.coverage_pct !== undefined) lines.push('Cobertura válida: ' + p.coverage_pct.toFixed(0) + '%');
        if (p.water_ha !== null && !p.reliable) lines.push('⚠ Período poco confiable');
        return lines;
    }

    if (_serieChartMode === 'superficie') {
        yOpts.beginAtZero = true;   // barras de superficie siempre desde 0
        datasets.push({
            type: 'bar',
            label: 'Superficie (ha)',
            data: periods.map(function(p) { return p.water_ha; }),
            backgroundColor: periods.map(function(p) {
                if (p.water_ha === null || p.water_ha === undefined) return 'rgba(0,0,0,0)';
                return p.reliable ? '#1e6ea0' : 'rgba(140,155,165,0.55)';
            }),
            borderRadius: 3, borderSkipped: false, order: 2
        });
        if (d.trend) {
            datasets.push({
                type: 'line',
                label: 'Tendencia (Sen)',
                data: years.map(function(y) { return d.trend.sen_slope_ha * y + d.trend.sen_intercept; }),
                borderColor: '#d98a3a', borderWidth: 2, borderDash: [5, 4],
                pointRadius: 0, fill: false, order: 1
            });
        }
    } else if (_serieChartMode === 'indice') {
        chartType = 'line';
        datasets.push({
            label: 'p75',
            data: periods.map(function(p) { return p.p75; }),
            borderColor: 'rgba(0,0,0,0)', pointRadius: 0, fill: false, spanGaps: true, order: 3
        });
        datasets.push({
            label: 'p25–p75',
            data: periods.map(function(p) { return p.p25; }),
            borderColor: 'rgba(0,0,0,0)', pointRadius: 0,
            fill: '-1', backgroundColor: 'rgba(30,110,160,0.15)', spanGaps: true, order: 2
        });
        datasets.push({
            label: 'Media ' + d.indice,
            data: periods.map(function(p) { return p.mean; }),
            borderColor: '#1e6ea0', borderWidth: 2,
            pointRadius: periods.map(function(p) { return p.reliable ? 3 : 4; }),
            pointBackgroundColor: periods.map(function(p) { return p.reliable ? '#1e6ea0' : '#fff'; }),
            pointBorderColor: '#1e6ea0',
            fill: false, spanGaps: true, order: 1
        });
    } else { // anomalías
        var avg = valid.length
            ? valid.reduce(function(a, p) { return a + p.water_ha; }, 0) / valid.length
            : 0;
        datasets.push({
            type: 'bar',
            label: 'Anomalía vs promedio (ha)',
            data: periods.map(function(p) {
                return (p.water_ha === null || p.water_ha === undefined) ? null : p.water_ha - avg;
            }),
            backgroundColor: periods.map(function(p) {
                if (p.water_ha === null || p.water_ha === undefined) return 'rgba(0,0,0,0)';
                var v = p.water_ha - avg;
                var col = v >= 0 ? '#2c7bb6' : '#d98a3a';
                return p.reliable ? col : 'rgba(140,155,165,0.55)';
            }),
            borderRadius: 3, borderSkipped: false
        });
    }

    _serieChart = new Chart(canvas.getContext('2d'), {
        type: chartType,
        data: { labels: years, datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,20,10,0.92)',
                    padding: 8, cornerRadius: 5,
                    filter: function(item) { return item.dataset.label !== 'p75' && item.dataset.label !== 'p25–p75'; },
                    callbacks: {
                        title: function(items) {
                            if (!items.length) return '';
                            var lbl = SERIE_SEASON_LABELS[d.season] || d.season;
                            return lbl + ' ' + items[0].label + ' (' + (SERIE_SEASON_MONTHS[d.season] || '') + ')';
                        },
                        label: function(item) {
                            if (item.parsed.y === null) return null;
                            var v = item.parsed.y;
                            if (item.dataset.label === 'Tendencia (Sen)') return 'Tendencia: ' + v.toFixed(1) + ' ha';
                            if (_serieChartMode === 'indice') return 'Media ' + d.indice + ': ' + v.toFixed(3);
                            return (_serieChartMode === 'anomalias' ? 'Anomalía: ' : 'Superficie: ') +
                                (v > 0 && _serieChartMode === 'anomalias' ? '+' : '') + _serieFmtHa(v) + ' ha';
                        },
                        afterLabel: function(item) {
                            if (item.dataset.label === 'Tendencia (Sen)') return null;
                            return tooltipExtra(item.dataIndex);
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { font: { size: 9 } }, grid: { display: false } },
                y: yOpts
            },
            animation: { duration: 300 }
        }
    });
}

/**
 * Restaura en la UI la serie estacional más reciente guardada
 * (localStorage o Supabase). Llamada desde loadWorkspaceState y auth.
 */
function restoreAguaSerieUI() {
    var series = (WorkspaceState && WorkspaceState.series) || {};
    var best = null;
    Object.keys(series).forEach(function(k) {
        if (k.indexOf('agua_serie_') !== 0) return;
        var doc = series[k];
        if (doc && doc.periods && (!best || (doc.ts || 0) > (best.ts || 0))) best = doc;
    });
    if (!best) return;

    // Reflejar parámetros en el formulario
    var selIdx = document.getElementById('serie-indice');
    var selSea = document.getElementById('serie-season');
    var inY0   = document.getElementById('serie-year-start');
    var inY1   = document.getElementById('serie-year-end');
    var selThr = document.getElementById('serie-threshold');
    if (selIdx && best.indice) selIdx.value = best.indice;
    if (selSea && best.season) selSea.value = best.season;
    if (inY0 && best.year_start) inY0.value = best.year_start;
    if (inY1 && best.year_end)   inY1.value = best.year_end;
    if (selThr && best.threshold !== undefined) selThr.value = String(best.threshold);

    renderAguaSerie(best);
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

    var key = (tipo === 'slope') ? 'dem_Pendiente' : 'dem_Elevacion';

    // Quitar del mapa ambas capas DEM (instancia suelta y las del registro de capas)
    // y desmarcar sus filas en el panel — evita rasters DEM apilados.
    if (_demLayerActual) { map.removeLayer(_demLayerActual); _demLayerActual = null; }
    ['dem_Elevacion', 'dem_Pendiente'].forEach(function(k) {
        var l = (typeof _layerRegistry !== 'undefined') ? _layerRegistry[k] : null;
        if (l && map.hasLayer(l)) map.removeLayer(l);
        var rowEl = document.getElementById('glayer-' + k.replace(/_/g, '-'));
        if (rowEl) { rowEl.classList.remove('on'); rowEl.classList.add('off'); }
    });

    // Reusar la MISMA instancia registrada en el panel de capas (si existe)
    _demLayerActual = (typeof _layerRegistry !== 'undefined' && _layerRegistry[key])
        ? _layerRegistry[key]
        : L.tileLayer(_demTiles[tipo], { pane: 'overlayPane', zIndex: 390, crossOrigin: 'anonymous' });
    _demLayerActual.addTo(map);

    // Marcar la fila correspondiente como activa en el panel de capas
    var rowOn = document.getElementById('glayer-' + key.replace(/_/g, '-'));
    if (rowOn) { rowOn.classList.add('on'); rowOn.classList.remove('off'); }

    // Sincronizar leyenda flotante del mapa
    try { showMiniLegend(key); } catch(e) {}
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

    fetchBackendJson('https://evergreen-backend-awv1.onrender.com/api/dem', payload)
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

        // Rango de visualización de pendiente adaptado a la zona (backend: p98, 5°–60°).
        // Fallback 60° si el backend aún no envía slope_viz_max.
        var slopeVizMax = (data.slope_viz_max !== undefined && data.slope_viz_max !== null)
            ? data.slope_viz_max : 60;
        var slopeRangeMeta = document.getElementById('dem-slope-range-meta');
        if (slopeRangeMeta) slopeRangeMeta.textContent = '0°–' + slopeVizMax + '°';
        var slopeMaxLbl = document.getElementById('dem-slope-max-lbl');
        if (slopeMaxLbl) slopeMaxLbl.textContent = 'Escarpado (' + slopeVizMax + '°)';
        // Mantener coherente la leyenda flotante del mini-panel
        if (typeof IND_PALETTES !== 'undefined' && IND_PALETTES['dem_Pendiente']) {
            IND_PALETTES['dem_Pendiente'].maxLbl = slopeVizMax + '°';
        }

        // Mostrar panel y activar capa DEM por defecto
        document.getElementById('dem-resultados').style.display = 'block';

        // Limpiar capas anteriores
        if (demLayer) { map.removeLayer(demLayer); demLayer = null; }
        if (_demLayerActual) { map.removeLayer(_demLayerActual); _demLayerActual = null; }

        // Registrar capas DEM en el panel de capas ANTES de activarlas:
        // switchDemLayer() reutiliza estas mismas instancias (una sola capa por tipo)
        registerLayer('dem_Elevacion', L.tileLayer(data.tiles_dem, { pane: 'overlayPane', zIndex: 390, crossOrigin: 'anonymous' }));
        if (data.tiles_slope) registerLayer('dem_Pendiente', L.tileLayer(data.tiles_slope, { pane: 'overlayPane', zIndex: 390, crossOrigin: 'anonymous' }));

        // Reset pills al DEM (activa capa + leyenda) y centrar mapa
        switchDemLayer('dem');
        _fitToZone();

        // Guardar en dashboard de Resumen
        var demTs = saveResultado('dem', 'Elevacion',
            { mean: data.stats.elev_mean, min: data.stats.elev_min, max: data.stats.elev_max },
            data.tiles_dem, null, null);
        if (typeof uploadAnalysisPreviewFromPayload === 'function') {
            uploadAnalysisPreviewFromPayload('dem_Elevacion', demTs, {
                preview_data_url: data.preview_dem_data_url,
                preview_url: data.preview_dem_url,
                preview_bounds: data.preview_dem_bounds
            });
        }
        if (data.stats.slope_mean !== undefined && data.stats.slope_mean !== null) {
            var slopeTs = saveResultado('dem', 'Pendiente',
                { mean: data.stats.slope_mean, min: 0, max: slopeVizMax },
                data.tiles_slope, null, null);
            if (typeof uploadAnalysisPreviewFromPayload === 'function') {
                uploadAnalysisPreviewFromPayload('dem_Pendiente', slopeTs, {
                    preview_data_url: data.preview_slope_data_url,
                    preview_url: data.preview_slope_url,
                    preview_bounds: data.preview_slope_bounds
                });
            }
        }

        // Re-sincronizar leyenda ahora que las stats ya están guardadas
        try { showMiniLegend('dem_Elevacion'); } catch(e) {}
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

async function clearZone() {
    if (!WorkspaceState.zona) return;
    if (!confirm('¿Eliminar la zona activa y todos sus análisis?\n\nEsta acción no se puede deshacer.')) return;

    var deletedId = WorkspaceState.zonaId;

    // Actualizar lista local INMEDIATAMENTE (optimistic update antes del delete async)
    // Esto evita que checkZoneQuota cuente la zona que se está eliminando
    window._sbUserZones = (window._sbUserZones || []).filter(function(z) { return z.id !== deletedId; });

    // Borrar datos en Supabase (cascade borra también los results)
    if (window._sbUserId && typeof clearCloudData === 'function') {
        await clearCloudData(window._sbUserId, deletedId);
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

// Usar sub-subcuenca BNA seleccionada como zona de estudio.
// UX guiada: si no hay cuenca seleccionada y la capa no está visible,
// activa la capa y muestra mensaje guía amigable en vez de un alert.
function usarCuencaEnWorkspace() {
    if (typeof cuencaSeleccionada === 'undefined' || !cuencaSeleccionada) {
        var notif = (typeof mostrarNotificacion === 'function')
            ? mostrarNotificacion
            : function(m) { console.warn(m); alert(m); };

        // Si la capa no está visible, activarla automáticamente
        if (typeof _cuencasVisible !== 'undefined' && !_cuencasVisible
            && typeof toggleCapasCuencas === 'function') {
            try { toggleCapasCuencas(); } catch(e) {}
            notif('💧 Capa de sub-subcuencas activada. Haz click sobre una en el mapa para seleccionarla.');
        } else {
            notif('💧 Selecciona primero una sub-subcuenca haciendo click sobre ella en el mapa.');
        }
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
        var replacedWorkspaceId = WorkspaceState.zonaId;
        var replacingCurrentZone = !!(WorkspaceState.zona && replacedWorkspaceId);
        if (replacingCurrentZone && typeof clearAnalysisStateForZoneChange === 'function') {
            var hadResults = clearAnalysisStateForZoneChange();
            if (hadResults && window._sbUserId && typeof clearResultsForWorkspace === 'function') {
                clearResultsForWorkspace(window._sbUserId, replacedWorkspaceId);
            }
        }

        WorkspaceState.zona       = geojson;
        WorkspaceState.zonaHa     = ha;
        WorkspaceState.zonaNombre = props.nombre || 'Sub-subcuenca BNA';

        WorkspaceState.zonaGEE = (typeof simplifyZoneForGee === 'function')
            ? simplifyZoneForGee(geojson, ha)
            : geojson;

        // Quitar el highlight naranja de la cuenca en la capa de cuencas
        // (la cuenca seguirá visible si la capa está activa, pero sin marca de "seleccionada")
        if (cuencaSeleccionada && typeof cuencaSeleccionada.setStyle === 'function') {
            try {
                cuencaSeleccionada.setStyle({
                    fillOpacity: 0.05, weight: 1.2, color: '#0080FF',
                });
            } catch(e) {}
        }
        cuencaSeleccionada = null;

        // Crear la capa AOI verde sobre el mapa (globalWorkspaceAOILayer).
        // Esto hace que la cuenca aparezca en el panel de capas como
        // "Zona de estudio", togglable y con slider de opacidad.
        if (typeof restoreZoneOnMap === 'function') {
            try { restoreZoneOnMap(); } catch(e) { console.warn('restoreZoneOnMap:', e); }
        }

        if (typeof agregarPoligonoDesdeWorkspace === 'function') {
            agregarPoligonoDesdeWorkspace(geojson, WorkspaceState.zonaNombre, ha);
        }

        updateZoneUI();
        saveWorkspaceState();
        enviarZonaABiodiversidad();

        if (typeof mostrarNotificacion === 'function') {
            mostrarNotificacion('✅ Cuenca "' + WorkspaceState.zonaNombre + '" establecida como zona de estudio');
        }
    }

    // Si ya tiene zona → solo reemplaza el polígono en el mismo workspace
    if (WorkspaceState.zona) {
        _aplicarCuenca();
        return;
    }

    // Primera zona: verificar cuota usando _sbUserZones local (evita race condition)
    if (window._sbUserId) {
        var _LIMITS2  = { 'free': 1, 'pro': 3, 'enterprise': 10, 'admin': Infinity };
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
            if (entry.previewPath && (typeof _isLegacyPreviewPath !== 'function' || !_isLegacyPreviewPath(entry.previewPath))) return;
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

    // 1ª prioridad: activar el más reciente con preview guardada en Storage
    for (var i = 0; i < keys.length; i++) {
        var key    = keys[i];
        var arr    = resultados[key];
        var latest = arr[arr.length - 1];
        if (latest.previewPath && (typeof _isLegacyPreviewPath !== 'function' || !_isLegacyPreviewPath(latest.previewPath))) {
            activarIndicador(key);
            return;
        }
    }

    // 2ª prioridad: usar tile temporal GEE solo si aún no existe PNG persistente
    for (var j = 0; j < keys.length; j++) {
        var k2     = keys[j];
        var arr2   = resultados[k2];
        var latest2 = arr2[arr2.length - 1];
        var cacheKey = k2 + '_' + latest2.ts;
        if (_tilesCache[cacheKey]) {
            activarIndicador(k2);
            return;
        }
    }
}
