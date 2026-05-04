/* ==========================================================================
   WORKSPACE SUMMARY - Resumen, capas, previews y mini panel
   Split mechanically from workspace.js; keep global function names stable.
   ========================================================================== */

// ---------------------------------------------------------
// INDICATOR ROWS — Resumen tab accordion (dinámico)
// ---------------------------------------------------------
var _indActive         = null;  // key string activo, ej: 'vegetacion_NDVI', 'bosque'
var _chartDetailBosque = null;
var _bosqueRealData    = null;  // datos reales del último requestBosque() exitoso
var _climaFetchDone    = false; // Open-Meteo ya cargado para la zona actual

// Abre/cierra el panel de detalle por key (ej: 'vegetacion_NDVI', 'bosque', 'agua_NDWI')
function toggleIndDetail(key) {
    var panel = document.getElementById('ind-detail-panel');
    if (!panel) return;

    // Clic en la fila activa → cerrar
    if (_indActive === key) {
        var activeRow = document.getElementById('ind-row-' + key);
        if (activeRow) activeRow.classList.remove('active');
        _hideAllDetailContents();
        panel.style.display = 'none';
        _indActive = null;
        return;
    }

    // Cerrar la anterior
    if (_indActive !== null) {
        var prevRow = document.getElementById('ind-row-' + _indActive);
        if (prevRow) prevRow.classList.remove('active');
        _hideAllDetailContents();
    }

    _indActive = key;
    var row = document.getElementById('ind-row-' + key);
    if (row) row.classList.add('active');
    panel.style.display = 'block';

    // Activar capa GEE en el mapa (silencioso — no bloquea el detalle)
    try { _activateMapLayer(key); } catch(e) { console.warn('activateMapLayer:', e); }

    // Mostrar leyenda del índice en el mini-panel bottom-right
    try { showMiniLegend(key); } catch(e) { console.warn('showMiniLegend:', e); }

    if (key === 'bosque') {
        document.getElementById('ind-detail-bosque-content').style.display = 'block';
        setTimeout(initDetailBosqueChart, 60);
    } else if (key.indexOf('vegetacion_') === 0) {
        var arr  = WorkspaceState.resultados && WorkspaceState.resultados[key];
        var last = arr && arr.length ? arr[arr.length - 1] : null;
        if (last) updateDetailVegStats(last.indice, last.stats, last.fechaInicio, last.fechaFin);
        document.getElementById('ind-detail-veg-content').style.display = 'block';
    } else if (key.indexOf('biodiversidad_') === 0) {
        var arrBio  = WorkspaceState.resultados && WorkspaceState.resultados[key];
        var lastBio = arrBio && arrBio.length ? arrBio[arrBio.length - 1] : null;
        if (lastBio) populateBioDetail(lastBio);
        document.getElementById('ind-detail-bio-content').style.display = 'block';
    } else {
        var arr2  = WorkspaceState.resultados && WorkspaceState.resultados[key];
        var last2 = arr2 && arr2.length ? arr2[arr2.length - 1] : null;
        if (last2) populateGenericDetail(key, last2);
        document.getElementById('ind-detail-generic-content').style.display = 'block';
    }

    // Desplazar el panel lateral para que ind-detail-panel quede visible
    setTimeout(function() {
        var container = document.getElementById('tab-resumen-content');
        if (!container || !panel) return;
        var cRect = container.getBoundingClientRect();
        var pRect = panel.getBoundingClientRect();
        // Si el panel no está completamente dentro del área visible, desplazar
        if (pRect.top < cRect.top + 8 || pRect.top > cRect.bottom - 80) {
            var scrollTo = container.scrollTop + (pRect.top - cRect.top) - 16;
            container.scrollTo({ top: Math.max(0, scrollTo), behavior: 'smooth' });
        }
    }, 200);
}

function _hideAllDetailContents() {
    ['ind-detail-veg-content','ind-detail-bosque-content','ind-detail-generic-content','ind-detail-bio-content'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function initDetailBosqueChart() {
    var canvas = document.getElementById('chart-detail-bosque');
    if (!canvas) return;
    if (_chartDetailBosque) { try { _chartDetailBosque.destroy(); } catch(e){} }

    // Usar datos reales si ya se corrió el análisis; si no, datos demo
    var perdida = (_bosqueRealData && _bosqueRealData.perdida && _bosqueRealData.perdida.length)
        ? _bosqueRealData.perdida
        : [
            {year:2001,ha_zona:185,ha_buffer:72},{year:2002,ha_zona:143,ha_buffer:55},
            {year:2003,ha_zona:247,ha_buffer:93},{year:2004,ha_zona:112,ha_buffer:42},
            {year:2005,ha_zona:318,ha_buffer:121},{year:2006,ha_zona:198,ha_buffer:76},
            {year:2007,ha_zona:276,ha_buffer:104},{year:2008,ha_zona:189,ha_buffer:72},
            {year:2009,ha_zona:154,ha_buffer:59},{year:2010,ha_zona:304,ha_buffer:115},
            {year:2011,ha_zona:267,ha_buffer:102},{year:2012,ha_zona:221,ha_buffer:84},
            {year:2013,ha_zona:389,ha_buffer:148},{year:2014,ha_zona:319,ha_buffer:122},
            {year:2015,ha_zona:334,ha_buffer:127},{year:2016,ha_zona:251,ha_buffer:96},
            {year:2017,ha_zona:378,ha_buffer:144},{year:2018,ha_zona:456,ha_buffer:174},
            {year:2019,ha_zona:303,ha_buffer:115},{year:2020,ha_zona:371,ha_buffer:141},
            {year:2021,ha_zona:293,ha_buffer:111},{year:2022,ha_zona:312,ha_buffer:98},
            {year:2023,ha_zona:428,ha_buffer:163}
          ];

    var years    = perdida.map(function(d) { return d.year; });
    var zona     = perdida.map(function(d) { return d.ha_zona; });
    var buffer   = perdida.map(function(d) { return d.ha_buffer; });
    var lastYear = years[years.length - 1];

    _chartDetailBosque = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: years,
            datasets: [
                {
                    label: 'Zona',
                    data: zona,
                    backgroundColor: years.map(function(y) { return y === lastYear ? '#6aaa35' : '#3d8a3a'; }),
                    borderRadius: 2, borderSkipped: false
                },
                {
                    label: 'Buffer',
                    data: buffer,
                    backgroundColor: '#c8e8c5',
                    borderRadius: 2, borderSkipped: false
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,20,10,0.9)',
                    titleColor: '#c8e6c9', bodyColor: '#fff',
                    padding: 6, cornerRadius: 4,
                    callbacks: {
                        title: function(items) { return items[0].label; },
                        label: function(item) {
                            return item.dataset.label + ': ' +
                                   item.raw.toLocaleString('es-CL', {maximumFractionDigits:1}) + ' Ha';
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: false,
                    ticks: { color: 'rgba(100,120,100,0.6)', font: { size: 8 }, maxRotation: 0,
                             callback: function(v, i) { return years[i] % 5 === 1 ? years[i] : ''; } },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: 'rgba(100,120,100,0.6)', font: { size: 8 }, maxTicksLimit: 4,
                             callback: function(v) { return v >= 1000 ? (v/1000).toFixed(1)+'K' : v; } },
                    grid: { color: 'rgba(0,0,0,0.04)' }
                }
            },
            animation: { duration: 400 }
        }
    });
}

/**
 * Actualiza los stats del panel detalle de bosque (Resumen tab)
 * con datos reales devueltos por /api/bosque.
 */
function updateDetailBosqueStats(data) {
    var perdida  = data.perdida || [];
    var haZona   = data.total_ha_perdida || 0;
    var haBuf    = perdida.reduce(function(s, d) { return s + (d.ha_buffer || 0); }, 0);
    var haTotal  = haZona + haBuf;

    // Formato local: "10.798" en es-CL
    var fmt = function(n) { return Math.round(n).toLocaleString('es-CL'); };

    var set = function(id, v) { var el=document.getElementById(id); if(el) el.textContent=v; };
    set('bosque-stat-zona',  fmt(haZona));
    set('bosque-stat-buf',   fmt(haBuf));
    set('bosque-stat-total', fmt(haTotal));

    if (perdida.length) {
        var yr0 = perdida[0].year;
        var yr1 = perdida[perdida.length - 1].year;
        set('bosque-stat-zona-lbl',  'HA \u00B7 ZONA '   + yr0 + '\u2013' + yr1);
        set('bosque-stat-buf-lbl',   'HA \u00B7 BUFFER ' + yr0 + '\u2013' + yr1);
        set('bosque-stat-total-lbl', 'HA \u00B7 TOTAL '  + yr0 + '\u2013' + yr1);
    }

    // Si el detalle bosque está abierto, refrescar el chart
    if (_indActive === 'bosque') initDetailBosqueChart();

    // Actualizar fila de bosque en el panel Resumen
    refreshIndRows();
}

// ---------------------------------------------------------
// DETAIL PANEL STATS — conectar resultados reales
// ---------------------------------------------------------

/**
 * Actualiza los stats del detalle 1 (Vegetación) en el Resumen
 * con datos reales de requestVegetacion().
 */
function updateDetailVegStats(indice, stats, fechaInicio, fechaFin) {
    if (!stats) return;

    var fmt = function(v, dec) {
        if (v == null) return '—';
        return Number(v).toFixed(dec != null ? dec : 3);
    };

    // Título y fecha
    var titleEl = document.getElementById('d1-title');
    var dateEl  = document.getElementById('d1-date');
    if (titleEl) titleEl.textContent = 'Análisis ' + indice;
    if (dateEl && fechaInicio && fechaFin) {
        dateEl.textContent = fechaInicio.slice(0, 10) + ' → ' + fechaFin.slice(0, 10);
    }

    // Stats: el backend devuelve keys como 'NDVI_mean', 'NDVI_min', etc.
    var prefix = indice + '_';
    var mean = stats.mean   != null ? stats.mean   : stats[prefix + 'mean'];
    var min  = stats.min    != null ? stats.min    : stats[prefix + 'min'];
    var max  = stats.max    != null ? stats.max    : stats[prefix + 'max'];

    var meanEl   = document.getElementById('d1-mean');
    var minEl    = document.getElementById('d1-min');
    var maxEl    = document.getElementById('d1-max');
    var meanLbl  = document.getElementById('d1-mean-lbl');
    var minLbl   = document.getElementById('d1-min-lbl');
    var maxLbl   = document.getElementById('d1-max-lbl');

    if (meanEl) meanEl.textContent = fmt(mean);
    if (minEl)  minEl.textContent  = fmt(min);
    if (maxEl)  maxEl.textContent  = fmt(max);
    if (meanLbl) meanLbl.textContent = indice + ' · MEDIA ZONA';
    if (minLbl)  minLbl.textContent  = indice + ' · MÍNIMO ZONA';
    if (maxLbl)  maxLbl.textContent  = indice + ' · MÁXIMO ZONA';

    // Si el detalle de vegetación está abierto, scroll para que se vea actualizado
    if (_indActive && _indActive.indexOf('vegetacion_') === 0) {
        var panel = document.getElementById('ind-detail-panel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

/**
 * Restaura los stats de vegetación desde WorkspaceState.resultados
 * (usado al recargar la página con datos en localStorage).
 */
function restoreDetailVegStats() {
    if (!WorkspaceState.resultados) return;
    var best = null;
    Object.keys(WorkspaceState.resultados).forEach(function(k) {
        if (k.indexOf('vegetacion_') !== 0) return;
        var arr = WorkspaceState.resultados[k];
        if (!arr || !arr.length) return;
        var last = arr[arr.length - 1];
        if (!best || last.ts > best.ts) best = last;
    });
    if (best) updateDetailVegStats(best.indice, best.stats, best.fechaInicio, best.fechaFin);
}

// ---------------------------------------------------------
// IND-ROWS — conectar resultados reales al panel Resumen
// ---------------------------------------------------------

/**
 * Genera dinámicamente las filas de indicadores en el tab Resumen.
 * Una fila por cada índice calculado en WorkspaceState.resultados + bosque.
 */
function refreshIndRows() {
    var list     = document.getElementById('ind-list');
    var emptyEl  = document.getElementById('ind-empty-state');
    if (!list) return;

    // ── Recolectar resultados ─────────────────────────────────
    var rows = [];
    if (WorkspaceState.resultados) {
        Object.keys(WorkspaceState.resultados).forEach(function(key) {
            var arr = WorkspaceState.resultados[key];
            if (!arr || !arr.length) return;
            var last = arr[arr.length - 1];
            rows.push({ key: key, tipo: last.tipo, indice: last.indice, result: last });
        });
    }
    if (_bosqueRealData && _bosqueRealData.total_ha_perdida != null) {
        rows.push({ key: 'bosque', tipo: 'bosque', indice: 'Hansen', result: _bosqueRealData });
    }
    rows.sort(function(a, b) { return (b.result.ts || 0) - (a.result.ts || 0); });

    // ── Limpiar filas anteriores ──────────────────────────────
    list.querySelectorAll('.ind-row').forEach(function(r) { r.remove(); });
    if (emptyEl) emptyEl.style.display = rows.length ? 'none' : 'flex';

    // ── Generar nuevas filas ──────────────────────────────────
    rows.forEach(function(r) {
        var el = _buildIndRow(r);
        list.appendChild(el);
        if (_indActive === r.key) el.classList.add('active');
    });
}

function _buildIndRow(r) {
    var key    = r.key;
    var tipo   = r.tipo;
    var indice = r.indice;
    var result = r.result;

    var iconCls = 'ind-icon--veg',   iconFA = 'fas fa-seedling';
    if (tipo === 'bosque')        { iconCls = 'ind-icon--forest'; iconFA = 'fas fa-tree'; }
    else if (tipo === 'agua')     { iconCls = 'ind-icon--agua';   iconFA = 'fas fa-tint'; }
    else if (tipo === 'dem')      { iconCls = 'ind-icon--dem';    iconFA = 'fas fa-mountain'; }
    else if (tipo === 'biodiversidad') { iconCls = 'ind-icon--bio'; iconFA = 'fas fa-leaf'; }

    var val = '—', unit = '';
    if (tipo === 'bosque') {
        var ha = result.total_ha_perdida || 0;
        val  = ha >= 1000 ? (ha / 1000).toFixed(1) + 'K' : Math.round(ha).toString();
        unit = 'Ha pérdida total';
    } else if (tipo === 'biodiversidad' && result.stats) {
        val  = result.stats.n_especies != null ? String(result.stats.n_especies) : '—';
        unit = 'Spp. registradas';
    } else if (result.stats) {
        var mean = result.stats.mean;
        if (mean != null) val = Number(mean).toFixed(tipo === 'dem' ? 0 : 3);
        unit = 'Media · ' + indice;
    }

    var src = tipo === 'bosque'
        ? 'Hansen GFC · 2001–2023'
        : tipo === 'biodiversidad'
        ? 'iNaturalist · GBIF'
        : (tipo.charAt(0).toUpperCase() + tipo.slice(1)) +
          (result.fechaInicio ? ' · ' + result.fechaInicio.slice(0,4) +
          (result.fechaFin ? '–' + result.fechaFin.slice(0,4) : '') : '');
    var name = tipo === 'bosque' ? 'Pérdida de Bosque'
             : tipo === 'biodiversidad' ? 'Biodiversidad GBIF'
             : indice;

    var div = document.createElement('div');
    div.className  = 'ind-row has-data';
    div.id         = 'ind-row-' + key;
    div.setAttribute('onclick', 'toggleIndDetail("' + key + '")');
    div.innerHTML  =
        '<span class="ind-row-dot"></span>' +
        '<div class="ind-icon ' + iconCls + '"><i class="' + iconFA + '"></i></div>' +
        '<div class="ind-info">' +
            '<span class="ind-name">'   + name + '</span>' +
            '<span class="ind-source">' + src  + '</span>' +
        '</div>' +
        '<div class="ind-value-group">' +
            '<span class="ind-value">' + val  + '</span>' +
            '<span class="ind-unit">'  + unit + '</span>' +
        '</div>' +
        '<i class="fas fa-chevron-right ind-chev"></i>';
    return div;
}

/** Popula el panel genérico con stats de agua / elevación / otros. */
function populateGenericDetail(key, result) {
    var parts  = key.split('_');
    var tipo   = parts[0];
    var indice = parts.slice(1).join('_');
    var stats  = result.stats || {};
    var isDem  = tipo === 'dem';

    var fmt = function(v) {
        if (v == null) return '—';
        return isDem ? Math.round(v) + ' m' : Number(v).toFixed(3);
    };

    var titleEl = document.getElementById('dg-title');
    var dateEl  = document.getElementById('dg-date');
    if (titleEl) titleEl.textContent = 'Análisis ' + indice;
    if (dateEl && result.fechaInicio)
        dateEl.textContent = result.fechaInicio.slice(0,10) + ' → ' + (result.fechaFin||'').slice(0,10);

    var unit = isDem ? 'm.s.n.m.' : indice;
    var ids  = ['dg-mean','dg-min','dg-max','dg-mean-lbl','dg-min-lbl','dg-max-lbl'];
    var vals = [
        fmt(stats.mean  != null ? stats.mean  : stats.elev_mean),
        fmt(stats.min   != null ? stats.min   : stats.elev_min),
        fmt(stats.max   != null ? stats.max   : stats.elev_max),
        unit + ' · MEDIA ZONA', unit + ' · MÍNIMO ZONA', unit + ' · MÁXIMO ZONA'
    ];
    ids.forEach(function(id, i) {
        var el = document.getElementById(id);
        if (el) el.textContent = vals[i];
    });
}

/** Popula el panel de detalle de Biodiversidad con stats del último análisis. */
function populateBioDetail(entry) {
    var s = entry.stats || {};
    var set = function(id, v) {
        var el = document.getElementById(id);
        if (el) el.textContent = (v != null && v !== '') ? v : '—';
    };
    set('db-spp', s.n_especies);
    set('db-rce', s.n_rce);
    set('db-cr',  s.n_cr);
    set('db-en',  s.n_en);
    set('db-vu',  s.n_vu);

    var ivc = s.ivc != null ? Number(s.ivc).toFixed(2) : null;
    set('db-ivc', ivc);

    var interp = '';
    if (s.ivc != null) {
        if (s.ivc > 1.5)      interp = '— Alta sensibilidad';
        else if (s.ivc > 0.5) interp = '— Sensibilidad moderada';
        else                   interp = '— Baja sensibilidad';
    }
    set('db-ivc-interp', interp);
    set('db-piso', s.piso);
}

// ---------------------------------------------------------
// CLIMA WIDGET — Open-Meteo (temperatura + precipitación)
// ---------------------------------------------------------
function fetchClimaWidget() {
    if (!WorkspaceState.zonaGEE) return;
    if (_climaFetchDone) return;

    var geom   = WorkspaceState.zonaGEE.geometry;
    var coords = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    var lon = coords.reduce(function(s,c){return s+c[0];},0) / coords.length;
    var lat = coords.reduce(function(s,c){return s+c[1];},0) / coords.length;

    var widget  = document.getElementById('clima-widget');
    var loading = document.getElementById('clima-loading');
    if (widget) widget.style.display = 'block';
    if (loading) loading.style.display = 'block';

    var yr        = new Date().getFullYear() - 1;
    var startDate = yr + '-01-01';
    var endDate   = yr + '-12-31';

    fetch('https://archive-api.open-meteo.com/v1/archive?' +
          'latitude='  + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
          '&start_date=' + startDate + '&end_date=' + endDate +
          '&daily=temperature_2m_mean,temperature_2m_max,precipitation_sum&timezone=auto')
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (loading) loading.style.display = 'none';
        if (!data || !data.daily) return;

        var temps = (data.daily.temperature_2m_mean || []).filter(function(v){return v!=null;});
        var maxT  = (data.daily.temperature_2m_max  || []).filter(function(v){return v!=null;});
        var pp    = (data.daily.precipitation_sum    || []).filter(function(v){return v!=null;});

        var meanT  = temps.length ? temps.reduce(function(s,v){return s+v;},0)/temps.length : null;
        var topT   = maxT.length  ? Math.max.apply(null, maxT) : null;
        var totalP = pp.length    ? pp.reduce(function(s,v){return s+v;},0) : null;

        var set = function(id, v) { var el=document.getElementById(id); if(el&&v!=null) el.textContent=v; };
        set('clima-temp-mean', meanT  != null ? meanT.toFixed(1)  + '°C' : '—');
        set('clima-temp-max',  topT   != null ? topT.toFixed(1)   + '°C' : '—');
        set('clima-pp',        totalP != null ? Math.round(totalP) + ' mm' : '—');
        set('clima-period',    'Año ' + yr);
        _climaFetchDone = true;
    })
    .catch(function() { if (loading) loading.style.display = 'none'; });
}

// ---------------------------------------------------------
// RESET ANÁLISIS — borra resultados sin tocar la zona
// ---------------------------------------------------------
function resetAnalisis() {
    if (!confirm('¿Reiniciar todos los análisis? Se borrarán los resultados guardados pero se mantendrá la zona.')) return;

    // Remover capas de análisis del mapa
    if (typeof map !== 'undefined') {
        Object.keys(_layerRegistry).forEach(function(id) {
            var l = _layerRegistry[id];
            if (l && map.hasLayer(l)) map.removeLayer(l);
        });
        if (vegLayer        && map.hasLayer(vegLayer))        map.removeLayer(vegLayer);
        if (aguaLayer       && map.hasLayer(aguaLayer))       map.removeLayer(aguaLayer);
        if (_demLayerActual && map.hasLayer(_demLayerActual)) map.removeLayer(_demLayerActual);
    }
    vegLayer = null; aguaLayer = null; _demLayerActual = null;

    WorkspaceState.resultados = {};
    _bosqueRealData = null;
    _tilesCache     = {};
    _layerRegistry  = {};
    saveWorkspaceState();
    renderIndicadorCards();
    refreshIndRows();
    _refreshGeeLayersPanel();
    // Resetear mini-panel a demo
    var _DEMO_RESET = [
        {year:2001,ha_zona:185,ha_buffer:72},{year:2003,ha_zona:247,ha_buffer:93},
        {year:2005,ha_zona:318,ha_buffer:121},{year:2007,ha_zona:276,ha_buffer:104},
        {year:2010,ha_zona:304,ha_buffer:115},{year:2013,ha_zona:389,ha_buffer:148},
        {year:2015,ha_zona:334,ha_buffer:127},{year:2018,ha_zona:456,ha_buffer:174},
        {year:2020,ha_zona:371,ha_buffer:141},{year:2022,ha_zona:312,ha_buffer:98},
        {year:2023,ha_zona:428,ha_buffer:163}
    ];
    renderMiniPanel(_DEMO_RESET);
    if (typeof mostrarNotificacion === 'function') mostrarNotificacion('✅ Análisis reiniciados');
}

// ---------------------------------------------------------
// DRAW TOOLS TOGGLE (Resumen tab)
// ---------------------------------------------------------
function toggleDrawTools() {
    var wrap = document.getElementById('draw-tools-wrap');
    var btn  = document.getElementById('draw-toggle-btn');
    if (!wrap) return;
    var isOpen = wrap.classList.toggle('open');
    if (btn) btn.classList.toggle('open', isOpen);
}

// ---------------------------------------------------------
// LAYER REGISTRY — capas GEE por id
// ---------------------------------------------------------
var _layerRegistry = {};

function registerLayer(id, layerInstance) {
    _layerRegistry[id] = layerInstance;
    _refreshGeeLayersPanel();
}

// Labels legibles para cada clave de registro
var _GEE_LAYER_LABELS = {
    'vegetacion_NDVI':  'NDVI · Vegetación',
    'vegetacion_EVI':   'EVI · Vegetación',
    'vegetacion_SAVI':  'SAVI · Vegetación',
    'vegetacion_MSAVI': 'MSAVI · Vegetación',
    'vegetacion_NDRE':  'NDRE · Vegetación',
    'vegetacion_NBR':   'NBR · Área Quemada',
    'agua_NDWI':        'NDWI · Agua',
    'agua_MNDWI':       'MNDWI · Agua',
    'agua_NDMI':        'NDMI · Humedad',
    'dem_Elevacion':    'Elevación · DEM',
    'dem_Pendiente':    'Pendiente · DEM',
    'dem_Aspecto':      'Aspecto · DEM',
    'bosque':           'Pérdida de Bosque'
};

/** Reconstruye la sección dinámica de capas GEE en el panel de capas. */
function _refreshGeeLayersPanel() {
    var container = document.getElementById('gee-layers-dynamic');
    if (!container) return;
    var ids = Object.keys(_layerRegistry);
    if (ids.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    var html = '<div class="gee-layers-sep"></div><div class="gee-layers-header">Análisis GEE</div>';
    ids.forEach(function(id) {
        var label = _GEE_LAYER_LABELS[id] || id;
        var rowId = 'glayer-' + id.replace(/_/g, '-');
        html += '<div class="map-layer-row off" id="' + rowId + '"' +
                ' onclick="toggleLayerById(\'' + id + '\', this);">' +
                '<div class="map-layer-check"><i class="fas fa-check"></i></div>' +
                '<span class="map-layer-label">' + label + '</span>' +
                '<span class="map-gee-badge">GEE</span>' +
                '</div>' +
                '<div class="map-layer-opacity">' +
                '<span class="opacity-label">Opacidad</span>' +
                '<input type="range" min="0" max="100" value="80" class="opacity-slider"' +
                ' oninput="setLayerOpacity(\'' + id + '\', this.value/100);">' +
                '<span class="opacity-val">80%</span>' +
                '</div>';
    });
    container.innerHTML = html;
}

/**
 * Desactiva todas las capas de análisis del mapa y activa la indicada por key.
 * Llamado desde toggleIndDetail() al abrir una fila del panel Resumen.
 */
function _activateMapLayer(key) {
    if (typeof map === 'undefined') return;

    // Quitar todas las capas de análisis que puedan estar visibles
    var candidatos = [vegLayer, aguaLayer, _demLayerActual, _indicadorLayer];
    candidatos.forEach(function(l) {
        if (l && map.hasLayer(l)) map.removeLayer(l);
    });
    _indicadorLayer = null;

    // Quitar capas del registro que estén en el mapa y resetear filas
    Object.keys(_layerRegistry).forEach(function(id) {
        var l = _layerRegistry[id];
        if (l && map.hasLayer(l)) map.removeLayer(l);
        var rowEl = document.getElementById('glayer-' + id.replace(/_/g, '-'));
        if (rowEl) { rowEl.classList.remove('on'); rowEl.classList.add('off'); }
    });

    // Activar la capa solicitada
    var layer = _layerRegistry[key];
    if (!layer) return; // Sin capa registrada — silencioso (el detalle igual se muestra)

    layer.addTo(map);

    // Mantener referencias de tracking coherentes
    if (key.indexOf('vegetacion_') === 0) vegLayer = layer;
    else if (key.indexOf('agua_') === 0)  aguaLayer = layer;
    else if (key.indexOf('dem_') === 0)   _demLayerActual = layer;

    // Marcar fila de capas como activa
    var rowEl = document.getElementById('glayer-' + key.replace(/_/g, '-'));
    if (rowEl) { rowEl.classList.add('on'); rowEl.classList.remove('off'); }
}

function setLayerOpacity(id, val) {
    var layer = _layerRegistry[id];
    if (layer && typeof layer.setOpacity === 'function') {
        layer.setOpacity(parseFloat(val));
    }
}

function toggleLayerById(id, rowEl) {
    var layer = _layerRegistry[id];
    var row = rowEl || document.getElementById('layer-' + id);
    if (!row) return;
    var wasOn = row.classList.contains('on');
    row.classList.toggle('on',  !wasOn);
    row.classList.toggle('off', wasOn);
    if (typeof map !== 'undefined' && layer) {
        if (wasOn) map.removeLayer(layer);
        else       map.addLayer(layer);
    }
}

function setCuencasOpacity(val) {
    if (typeof cuencasLayer === 'undefined' || !cuencasLayer) return;
    if (typeof cuencasLayer.setStyle === 'function') {
        cuencasLayer.setStyle({ opacity: parseFloat(val), fillOpacity: parseFloat(val) * 0.3 });
    } else if (typeof cuencasLayer.setOpacity === 'function') {
        cuencasLayer.setOpacity(parseFloat(val));
    }
}

// ---------------------------------------------------------
// PREVIEW ESTÁTICO — captura, almacenamiento y restauración
// ---------------------------------------------------------

// Overlays de preview activos (imageOverlay por key)
var _previewOverlays = {};

/**
 * Captura el estado visual actual del mapa para un indicador y lo sube a Supabase Storage.
 * Se llama ~2s después de que el tile se agrega al mapa.
 * @param {string} key   - ej: 'vegetacion_NDVI'
 * @param {number} ts    - timestamp de la medición (para identificar la entrada)
 */
function captureAndSavePreview(key, ts) {
    if (!window._sbUserId || !WorkspaceState.zonaId) return;
    if (typeof leafletImage === 'undefined')           return;
    if (!WorkspaceState.zona || typeof map === 'undefined') return;
    var previewBounds = null;

    // Ajustar mapa exactamente a la zona antes de capturar
    try {
        var bounds = L.geoJSON(WorkspaceState.zona).getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20], animate: false });
            previewBounds = map.getBounds();
        }
    } catch(e) {}

    if (!previewBounds) {
        try { previewBounds = map.getBounds(); } catch(e) {}
    }

    // Esperar que los tiles terminen de renderizar tras el fitBounds
    setTimeout(function() {
        leafletImage(map, function(err, canvas) {
            if (err) { console.warn('[Preview] leafletImage error:', err); return; }

            // Convertir a JPEG (más liviano que PNG)
            var dataURL = canvas.toDataURL('image/jpeg', 0.80);
            var base64  = dataURL.split(',')[1];

            // Convertir base64 a Uint8Array para Supabase Storage
            var binary  = atob(base64);
            var bytes   = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            var filePath = window._sbUserId + '/' +
                           WorkspaceState.zonaId + '/' +
                           key + '_' + ts + '.jpg';

            _sb.storage
                .from('result-previews')
                .upload(filePath, bytes, { contentType: 'image/jpeg', upsert: true })
                .then(function(res) {
                    if (res.error) { console.warn('[Preview] upload error:', res.error); return; }

                    // Guardar la ruta del archivo en el resultado (para recuperarla luego)
                    var arr = (WorkspaceState.resultados || {})[key];
                    if (arr) {
                        var entry = arr.find(function(e) { return e.ts === ts; });
                        if (entry) {
                            entry.previewPath = filePath;
                            if (previewBounds && previewBounds.isValid && previewBounds.isValid()) {
                                entry.previewBounds = [
                                    [previewBounds.getSouth(), previewBounds.getWest()],
                                    [previewBounds.getNorth(), previewBounds.getEast()]
                                ];
                            }
                            saveWorkspaceState();
                            if (window._sbUserId && typeof saveResultsToCloud === 'function') {
                                saveResultsToCloud(window._sbUserId, key, WorkspaceState.resultados[key]);
                            }
                            console.log('[Preview] ✅ guardado:', filePath);
                        }
                    }
                });
        });
    }, 2000);
}

/**
 * Restaura la preview guardada como imageOverlay sobre la zona.
 * Se usa cuando el tile GEE ya expiró pero hay imagen guardada en Storage.
 * @param {string} key      - ej: 'vegetacion_NDVI'
 * @param {string} filePath - ruta en Storage
 */
function _restorePreviewOnMap(key, filePath, storedBounds) {
    if (!_sb || !WorkspaceState.zona || typeof map === 'undefined') return;

    // Quitar overlay anterior si existía
    if (_previewOverlays[key]) {
        try { map.removeLayer(_previewOverlays[key]); } catch(e) {}
        delete _previewOverlays[key];
    }

    _sb.storage
        .from('result-previews')
        .createSignedUrl(filePath, 60 * 60 * 24 * 365) // URL firmada por 1 año
        .then(function(res) {
            if (res.error || !res.data) { console.warn('[Preview] signed URL error:', res.error); return; }

            var url    = res.data.signedUrl;
            var bounds = storedBounds ? L.latLngBounds(storedBounds) : L.geoJSON(WorkspaceState.zona).getBounds();
            var overlay = L.imageOverlay(url, bounds, { opacity: 0.9, zIndex: 400 });
            overlay.addTo(map);
            _previewOverlays[key] = overlay;
            console.log('[Preview] 🖼️ overlay restaurado para', key);
        });
}

/**
 * Elimina todas las imágenes de preview de un workspace en Supabase Storage.
 * Se llama desde clearCloudData() al borrar una zona.
 */
async function deletePreviewsFromStorage(userId, workspaceId) {
    if (!_sb || !userId || !workspaceId) return;
    try {
        var folder   = userId + '/' + workspaceId + '/';
        var listRes  = await _sb.storage.from('result-previews').list(userId + '/' + workspaceId);
        if (listRes.error || !listRes.data || listRes.data.length === 0) return;

        var paths = listRes.data.map(function(f) { return folder + f.name; });
        await _sb.storage.from('result-previews').remove(paths);
        console.log('[Preview] 🗑️ eliminadas', paths.length, 'imágenes de', workspaceId);
    } catch(e) {
        console.warn('[Preview] deletePreviewsFromStorage:', e);
    }
}

// ---------------------------------------------------------
// MINI PANEL — leyenda dinámica + bosque
// ---------------------------------------------------------
var _miniChartInstance = null;
var _miniPanelData     = null;
var _miniSelectedYear  = null;

/**
 * Muestra en el mini-panel la leyenda de color del índice activo.
 * Para bosque → activa la vista de gráfico de pérdida.
 * Para todos los demás → activa la vista de gradiente + stats.
 */
function showMiniLegend(key) {
    var mp = document.getElementById('mini-panel');
    if (!mp) return;

    var bosqueView  = document.getElementById('mini-bosque-view');
    var legendView  = document.getElementById('mini-legend-view');
    var titleEl     = document.getElementById('mini-panel-title');
    var dotEl       = document.getElementById('mini-header-dot');
    var cfg         = IND_PALETTES[key];

    if (key === 'bosque') {
        // Activar vista de bosque
        if (legendView) legendView.style.display = 'none';
        if (bosqueView) bosqueView.style.display = 'block';
        if (titleEl)    titleEl.textContent = 'Pérdida de Bosque · Ha/año';
        if (dotEl)      dotEl.style.background = '#fc4e2a';
        mp.classList.remove('hidden');
        // El gráfico lo llena renderMiniPanel() cuando llegan los datos
        return;
    }

    if (!cfg) return; // índice sin paleta definida (ej. biodiversidad)

    // Activar vista de leyenda
    if (bosqueView) bosqueView.style.display = 'none';
    if (legendView) legendView.style.display = 'block';

    // Obtener el nombre del índice (segunda parte del key: 'vegetacion_NDVI' → 'NDVI')
    var indNombre = key.indexOf('_') >= 0 ? key.split('_').slice(1).join('_') : key;

    if (titleEl) titleEl.textContent = 'Leyenda · ' + indNombre;
    if (dotEl)   dotEl.style.background = cfg.dotColor || 'var(--accent)';

    // Nombre e descripción
    var nameEl = document.getElementById('mini-ind-name');
    var descEl = document.getElementById('mini-ind-desc');
    if (nameEl) nameEl.textContent = indNombre;
    if (descEl) descEl.textContent = cfg.desc || '';

    // Gradiente
    var barEl = document.getElementById('mini-gradient-bar');
    if (barEl) barEl.style.background = 'linear-gradient(to right, ' + cfg.colors.join(', ') + ')';

    // Etiquetas min / max
    var minLblEl = document.getElementById('mini-grad-min');
    var maxLblEl = document.getElementById('mini-grad-max');
    if (minLblEl) minLblEl.textContent = cfg.minLbl || 'Bajo';
    if (maxLblEl) maxLblEl.textContent = cfg.maxLbl || 'Alto';

    // Stats del último resultado guardado
    var arr  = (WorkspaceState.resultados || {})[key];
    var last = arr && arr.length ? arr[arr.length - 1] : null;
    var meanEl = document.getElementById('mini-stat-mean');
    var minEl  = document.getElementById('mini-stat-min');
    var maxEl  = document.getElementById('mini-stat-max');

    function _fmt(v) {
        if (v === null || v === undefined) return '—';
        var n = parseFloat(v);
        if (isNaN(n)) return '—';
        return Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(3);
    }

    if (last && last.stats) {
        if (meanEl) meanEl.textContent = _fmt(last.stats.mean);
        if (minEl)  minEl.textContent  = _fmt(last.stats.min);
        if (maxEl)  maxEl.textContent  = _fmt(last.stats.max);
    } else {
        if (meanEl) meanEl.textContent = '—';
        if (minEl)  minEl.textContent  = '—';
        if (maxEl)  maxEl.textContent  = '—';
    }

    mp.classList.remove('hidden');
}

function renderMiniPanel(perdida) {
    if (!perdida || perdida.length === 0) return;
    _miniPanelData = perdida;
    var mp = document.getElementById('mini-panel');
    if (!mp) return;

    // Asegurarse de que esté en vista bosque
    var bosqueView = document.getElementById('mini-bosque-view');
    var legendView = document.getElementById('mini-legend-view');
    var titleEl    = document.getElementById('mini-panel-title');
    var dotEl      = document.getElementById('mini-header-dot');
    if (legendView) legendView.style.display = 'none';
    if (bosqueView) bosqueView.style.display = 'block';
    if (titleEl)    titleEl.textContent = 'Pérdida de Bosque · Ha/año';
    if (dotEl)      dotEl.style.background = '#fc4e2a';

    mp.classList.remove('hidden');

    // Año más reciente por defecto
    _miniSelectedYear = perdida[perdida.length - 1].year;

    // Pills de años
    var strip = document.getElementById('mini-years-strip');
    if (strip) {
        strip.innerHTML = perdida.map(function(d) {
            return '<button class="mini-yr-pill' + (d.year === _miniSelectedYear ? ' active' : '') +
                '" onclick="selectMiniYear(' + d.year + ')">' + d.year + '</button>';
        }).join('');
    }

    updateMiniHero(_miniSelectedYear);
    renderMiniChart();
}

function selectMiniYear(year) {
    _miniSelectedYear = year;
    document.querySelectorAll('.mini-yr-pill').forEach(function(pill) {
        pill.classList.toggle('active', parseInt(pill.textContent) === year);
    });
    updateMiniHero(year);
    renderMiniChart();
}

function updateMiniHero(year) {
    if (!_miniPanelData) return;
    var entry = _miniPanelData.find(function(d) { return d.year === year; });
    if (!entry) return;
    var yearEl = document.getElementById('mini-year-big');
    var valEl  = document.getElementById('mini-val-num');
    if (yearEl) yearEl.textContent = year;
    if (valEl)  valEl.textContent  = Math.round(entry.ha_zona) + ' Ha';
}

function renderMiniChart() {
    if (!_miniPanelData) return;
    var canvas = document.getElementById('mini-chart');
    if (!canvas) return;
    if (_miniChartInstance) { try { _miniChartInstance.destroy(); } catch(e){} }

    var labels = _miniPanelData.map(function(d) { return d.year; });
    var values = _miniPanelData.map(function(d) { return d.ha_zona; });
    var colors = _miniPanelData.map(function(d) {
        return d.year === _miniSelectedYear ? '#6aaa35' : 'rgba(106,170,53,0.35)';
    });

    _miniChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ data: values, backgroundColor: colors, borderRadius: 2, borderSkipped: false }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: {
                    ticks: {
                        color: 'rgba(255,255,255,0.2)', font: { size: 8 }, maxRotation: 0,
                        callback: function(v, i) { return i % 5 === 0 ? labels[i] : ''; }
                    },
                    grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false }
                },
                y: {
                    ticks: { color: 'rgba(255,255,255,0.2)', font: { size: 8 }, maxTicksLimit: 3 },
                    grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false }
                }
            },
            animation: { duration: 300 }
        }
    });
}

function enviarZonaABiodiversidad() {
    var iframe = document.getElementById('iframe-biodiversidad');
    if (iframe && iframe.contentWindow && WorkspaceState.zona) {
        iframe.contentWindow.postMessage({ tipo: 'zona_activa', geojson: WorkspaceState.zona }, '*');
    }
}
