/* ==========================================================================
   WORKSPACE CORE - Estado, dashboard, tabs
   Split mechanically from workspace.js; keep global function names stable.
   ========================================================================== */

/* ==========================================================================
   WORKSPACE.JS - Estado Compartido y Lógica de Tabs
   ========================================================================== */

   var WorkspaceState = {
    zona: null,       // GeoJSON completo
    zonaGEE: null,    // GeoJSON simplificado
    zonaNombre: 'Mi zona de estudio',
    zonaHa: 0,
    zonaId: null,     // UUID del workspace en Supabase
    capasActivas: {},
    resultados: {}    // Cache de análisis: key = 'tipo_indice' (sin tilesUrl — expiran)
};

// Caché en MEMORIA de URLs de tiles GEE (expiran ~24h, nunca van a localStorage)
// Clave: 'tipo_indice_ts'  (ej: 'vegetacion_NDVI_1737500000000')
var _tilesCache = {};

// Instancias Chart.js del panel de monitoreo (para poder destruirlas en re-render)
var _monitorCharts = {};

// Cargar estado inicial
function loadWorkspaceState() {
    var stored = localStorage.getItem('evergreen_workspace');
    if (stored) {
        try {
            var parsed = JSON.parse(stored);
            WorkspaceState = parsed;
            if (!WorkspaceState.resultados) WorkspaceState.resultados = {};
            // Migrar formato viejo (objeto) → nuevo (array por índice)
            Object.keys(WorkspaceState.resultados).forEach(function(k) {
                var v = WorkspaceState.resultados[k];
                if (v && !Array.isArray(v)) WorkspaceState.resultados[k] = [v];
            });
            // Asegurar zonaGEE siempre disponible si hay zona
            if (WorkspaceState.zona && !WorkspaceState.zonaGEE) {
                try {
                    WorkspaceState.zonaGEE = (typeof turf !== 'undefined')
                        ? turf.simplify(WorkspaceState.zona, { tolerance: 0.001, highQuality: true })
                        : WorkspaceState.zona;
                } catch(e) { WorkspaceState.zonaGEE = WorkspaceState.zona; }
            }
            // Restaurar URLs de tiles guardadas en result_data
            _restoreTilesCache();
            updateZoneUI();
            renderIndicadorCards();
            refreshIndRows();
            restoreDetailVegStats();
        } catch (e) {
            console.error("Error restaurando workspace", e);
        }
    }
}

function saveWorkspaceState() {
    localStorage.setItem('evergreen_workspace', JSON.stringify(WorkspaceState));
    // Cloud sync (no bloquea — async en segundo plano).
    // Solo sincroniza si existe una zona real o un workspace ya creado.
    // Evita crear workspaces vacíos que bloquean la cuota free.
    if (window._sbUserId && typeof saveWorkspaceToCloud === 'function' &&
        (WorkspaceState.zona || WorkspaceState.zonaId)) {
        saveWorkspaceToCloud(window._sbUserId, WorkspaceState);
    }
}

// ---------------------------------------------------------
// INDICATOR DASHBOARD — Resultados cacheados
// ---------------------------------------------------------

var IND_CONFIG = {
    'vegetacion':   { icon: 'fas fa-seedling',   iconClass: 'rs-ind-icon--veg',  cat: 'Vegetación' },
    'agua':         { icon: 'fas fa-tint',        iconClass: 'rs-ind-icon--agua', cat: 'Agua' },
    'dem':          { icon: 'fas fa-mountain',    iconClass: 'rs-ind-icon--dem',  cat: 'Elevación' },
    'biodiversidad':{ icon: 'fas fa-leaf',        iconClass: 'rs-ind-icon--bio',  cat: 'Biodiversidad' }
};

/**
 * Configuración de paletas y etiquetas para la leyenda del mini-panel.
 * colors: colores del gradiente (igual que VIZ_PALETTES en backend).
 * minLbl / maxLbl: etiquetas del extremo bajo/alto de la escala.
 * desc: descripción corta del índice.
 * dotColor: color del puntito en el header del mini-panel.
 */
var IND_PALETTES = {
    // ── Vegetación ──────────────────────────────────────────────
    'vegetacion_NDVI':  { colors:['#d73027','#f46d43','#fdae61','#fee08b','#ffffbf','#d9ef8b','#a6d96a','#66bd63','#1a9850','#006837'], minLbl:'Sin vegetación', maxLbl:'Densa',      desc:'Índice de Vegetación de Diferencia Normalizada', dotColor:'#6aaa35' },
    'vegetacion_EVI':   { colors:['#d73027','#f46d43','#fdae61','#fee08b','#ffffbf','#d9ef8b','#a6d96a','#66bd63','#1a9850','#006837'], minLbl:'Sin vegetación', maxLbl:'Densa',      desc:'Índice de Vegetación Mejorado',                  dotColor:'#6aaa35' },
    'vegetacion_EVI2':  { colors:['#d73027','#f46d43','#fdae61','#fee08b','#ffffbf','#d9ef8b','#a6d96a','#66bd63','#1a9850','#006837'], minLbl:'Sin vegetación', maxLbl:'Densa',      desc:'EVI de Dos Bandas',                              dotColor:'#6aaa35' },
    'vegetacion_SAVI':  { colors:['#d73027','#f46d43','#fdae61','#fee08b','#ffffbf','#d9ef8b','#a6d96a','#66bd63','#1a9850','#006837'], minLbl:'Suelo desnudo',  maxLbl:'Vegetación', desc:'Índice de Vegetación Ajustado al Suelo',         dotColor:'#6aaa35' },
    'vegetacion_LAI':   { colors:['#fff7bc','#fec44f','#fe9929','#ec7014','#cc4c02','#8c2d04'],                                         minLbl:'0',              maxLbl:'8 m²/m²',   desc:'Índice de Área Foliar',                          dotColor:'#fe9929' },
    'vegetacion_VARI':  { colors:['#d73027','#f46d43','#fdae61','#ffffbf','#a6d96a','#1a9850','#006837'],                               minLbl:'Sin follaje',    maxLbl:'Verde vivo', desc:'Índice de Resistencia Atmosférica Visible',      dotColor:'#6aaa35' },
    'vegetacion_NDMI':  { colors:['#d7191c','#fdae61','#ffffbf','#abd9e9','#2c7bb6'],                                                   minLbl:'Estrés hídrico', maxLbl:'Húmedo',     desc:'Índice de Humedad de la Vegetación',             dotColor:'#2c7bb6' },
    'vegetacion_MSI':   { colors:['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c'],                                                   minLbl:'Húmedo',         maxLbl:'Estrés',     desc:'Índice de Estrés de Humedad',                    dotColor:'#fd8d3c' },
    'vegetacion_NDWI':  { colors:['#d4a96a','#f5f5dc','#9ecae1','#2166ac','#084081'],                                                   minLbl:'Tierra',         maxLbl:'Agua',       desc:'Índice de Agua de Vegetación (Gao)',             dotColor:'#2166ac' },
    'vegetacion_MNDWI': { colors:['#c7a46b','#faf0dc','#74b9d4','#1a6aaa','#053061'],                                                   minLbl:'Tierra',         maxLbl:'Agua',       desc:'NDWI Modificado (Xu)',                            dotColor:'#1a6aaa' },
    'vegetacion_NBR':   { colors:['#d73027','#f46d43','#fdae61','#ffffbf','#a6d96a','#1a9850','#006837'],                               minLbl:'Quemado',        maxLbl:'Vegetación', desc:'Índice de Área Quemada Normalizado',             dotColor:'#6aaa35' },
    'vegetacion_NBR2':  { colors:['#d73027','#f46d43','#fdae61','#ffffbf','#a6d96a','#1a9850','#006837'],                               minLbl:'Afectado',       maxLbl:'Recuperado', desc:'NBR de Segunda Banda SWIR',                      dotColor:'#6aaa35' },
    'vegetacion_NDDI':  { colors:['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c'],                                                   minLbl:'Sin déficit',    maxLbl:'Déficit',    desc:'Índice de Déficit Hídrico Normalizado',          dotColor:'#d7191c' },
    'vegetacion_BSI':   { colors:['#1a9850','#ffffbf','#d73027'],                                                                       minLbl:'Vegetado',       maxLbl:'Suelo',      desc:'Índice de Suelo Desnudo',                        dotColor:'#d73027' },
    'vegetacion_NDSI':  { colors:['#f7fbff','#c6dbef','#6baed6','#2171b5','#084594'],                                                   minLbl:'Sin nieve',      maxLbl:'Nieve/Hielo',desc:'Índice de Nieve Normalizado',                    dotColor:'#6baed6' },
    // ── Agua ─────────────────────────────────────────────────────
    'agua_NDWI':        { colors:['#d4a96a','#f5f5dc','#9ecae1','#2166ac','#084081'],                                                   minLbl:'Tierra',         maxLbl:'Agua',       desc:'Índice de Agua Normalizado',                     dotColor:'#2166ac' },
    'agua_MNDWI':       { colors:['#c7a46b','#faf0dc','#74b9d4','#1a6aaa','#053061'],                                                   minLbl:'Tierra',         maxLbl:'Agua',       desc:'NDWI Modificado',                                dotColor:'#1a6aaa' },
    'agua_NDMI':        { colors:['#d7191c','#fdae61','#ffffbf','#abd9e9','#2c7bb6'],                                                   minLbl:'Seco',           maxLbl:'Húmedo',     desc:'Índice de Humedad Normalizado',                  dotColor:'#2c7bb6' },
    // ── Elevación ────────────────────────────────────────────────
    'dem_Elevacion':    { colors:['#440154','#3b528b','#21918c','#5ec962','#fde725'],                                                   minLbl:'Bajo',           maxLbl:'Alto (m)',   desc:'Modelo Digital de Elevación · 30 m',             dotColor:'#21918c' },
    'dem_Pendiente':    { colors:['#ffffcc','#c7e9b4','#7fcdbb','#1d91c0','#225ea8','#253494'],                                         minLbl:'0°',             maxLbl:'60°',        desc:'Pendiente del terreno',                          dotColor:'#1d91c0' },
    // ── Bosque ───────────────────────────────────────────────────
    'bosque':           { colors:['#ffffcc','#ffeda0','#fed976','#feb24c','#fd8d3c','#fc4e2a','#e31a1c','#bd0026','#800026'],           minLbl:'2001',           maxLbl:'2023',       desc:'Pérdida de bosque · Hansen GFC 2023',            dotColor:'#fc4e2a' },
};

var _indicadorActivo = null;
var _indicadorLayer  = null;

/**
 * Guarda un resultado de análisis y actualiza el dashboard.
 * @param {string} tipo - 'vegetacion' | 'agua' | 'dem'
 * @param {string} indice - Nombre del índice (NDVI, NDWI, etc.)
 * @param {object} stats - Objeto con mean, min, max, etc.
 * @param {string} tilesUrl - URL del tile layer
 * @param {string|null} fechaInicio - Fecha inicio del rango
 * @param {string|null} fechaFin - Fecha fin del rango
 */
function saveResultado(tipo, indice, stats, tilesUrl, fechaInicio, fechaFin) {
    var key = tipo + '_' + indice;
    var ts  = Date.now();

    // URL en memoria — clave incluye ts para soportar múltiples mediciones
    if (tilesUrl) _tilesCache[key + '_' + ts] = tilesUrl;

    if (!WorkspaceState.resultados) WorkspaceState.resultados = {};
    // Migración defensiva: si existe formato viejo, convertir
    if (WorkspaceState.resultados[key] && !Array.isArray(WorkspaceState.resultados[key])) {
        WorkspaceState.resultados[key] = [WorkspaceState.resultados[key]];
    }
    if (!WorkspaceState.resultados[key]) WorkspaceState.resultados[key] = [];

    WorkspaceState.resultados[key].push({
        tipo: tipo, indice: indice, stats: stats,
        tilesUrl: tilesUrl || null,   // guardada para reutilizar sin recalcular en GEE
        fechaInicio: fechaInicio, fechaFin: fechaFin, ts: ts
    });

    // Máximo 12 mediciones por índice — eliminar la más antigua
    var arr = WorkspaceState.resultados[key];
    if (arr.length > 12) {
        var old = arr.shift();
        delete _tilesCache[key + '_' + old.ts];
    }

    saveWorkspaceState();
    // Sincronizar resultados de este índice con la nube
    if (window._sbUserId && typeof saveResultsToCloud === 'function') {
        saveResultsToCloud(window._sbUserId, key, WorkspaceState.resultados[key]);
    }
    renderIndicadorCards();
    refreshIndRows();

    // Capturar preview visual para el repositorio (async — no bloquea el flujo)
    // Solo para indicadores con capa de mosaico (excluye biodiversidad)
    if (tipo !== 'biodiversidad' && tilesUrl) {
        (function(_k, _t) { captureAndSavePreview(_k, _t); })(key, ts);
    }
}

/** Formatea el valor principal a mostrar en la tarjeta */
function _getIndicadorValue(r) {
    if (!r || !r.stats) return '—';
    var s = r.stats;
    // Biodiversidad
    if (r.tipo === 'biodiversidad') {
        return s.n_especies !== undefined ? s.n_especies + ' spp.' : '—';
    }
    // Elevación
    if (r.tipo === 'dem' && r.indice === 'Elevacion') {
        return s.mean !== undefined ? Math.round(s.mean) + ' m' : '—';
    }
    // Pendiente
    if (r.tipo === 'dem' && r.indice === 'Pendiente') {
        return s.mean !== undefined ? s.mean.toFixed(1) + '°' : '—';
    }
    // Aspecto sin valor útil
    if (r.tipo === 'dem' && r.indice === 'Aspecto') return '—';
    // Índices espectrales (mean genérico)
    return s.mean !== undefined ? s.mean.toFixed(3) : '—';
}

/** Calcula tendencia entre la última y penúltima medición */
function _calcTrend(arr) {
    if (arr.length < 2) return null;
    var last = arr[arr.length - 1], prev = arr[arr.length - 2];
    var a = last.stats && last.stats.mean, b = prev.stats && prev.stats.mean;
    if (a === null || a === undefined || b === null || b === undefined) return null;
    var delta = a - b;
    return { delta: delta, dir: Math.abs(delta) < 0.005 ? 'flat' : (delta > 0 ? 'up' : 'down') };
}

/** Renderiza la sparkline Chart.js para una card de monitoreo */
function _renderSparkline(key, arr) {
    var chartId = 'mon-chart-' + key;
    var canvas = document.getElementById(chartId);
    if (!canvas) return;
    if (_monitorCharts[key]) { try { _monitorCharts[key].destroy(); } catch(e){} }

    var labels = arr.map(function(e) {
        return e.fechaFin ? e.fechaFin.substring(0, 7) : new Date(e.ts).toLocaleDateString('es-CL');
    });
    var values = arr.map(function(e) {
        return (e.stats && e.stats.mean !== null && e.stats.mean !== undefined)
            ? parseFloat(parseFloat(e.stats.mean).toFixed(3)) : null;
    });

    // Si todos son null, no renderizar
    if (values.every(function(v) { return v === null; })) { canvas.style.display = 'none'; return; }

    var tipo = arr[0].tipo;
    var lineColor = tipo === 'vegetacion' ? '#66bb6a' : tipo === 'agua' ? '#42a5f5' : '#a1887f';
    var fillColor = tipo === 'vegetacion' ? 'rgba(102,187,106,0.10)' : tipo === 'agua' ? 'rgba(66,165,245,0.10)' : 'rgba(161,136,127,0.10)';

    _monitorCharts[key] = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                borderColor: lineColor,
                backgroundColor: fillColor,
                fill: true,
                tension: 0.35,
                pointRadius: arr.length <= 6 ? 3 : 0,
                pointHoverRadius: 4,
                pointBackgroundColor: lineColor,
                borderWidth: 1.5,
                spanGaps: true
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,20,10,0.9)',
                    titleColor: '#c8e6c9', bodyColor: '#fff',
                    padding: 6, cornerRadius: 4
                }
            },
            scales: {
                x: { ticks: { color: 'rgba(100,140,100,0.6)', font: { size: 8 }, maxRotation: 0, maxTicksLimit: 4 }, grid: { display: false } },
                y: { ticks: { color: 'rgba(100,140,100,0.6)', font: { size: 8 }, maxTicksLimit: 3 }, grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false } }
            },
            animation: { duration: 300 }
        }
    });
}

/** Panel de monitoreo principal */
function renderMonitorPanel() {
    var container = document.getElementById('rs-indicators-list');
    if (!container) return;

    // Destruir charts existentes
    Object.keys(_monitorCharts).forEach(function(k) {
        if (_monitorCharts[k]) { try { _monitorCharts[k].destroy(); } catch(e){} delete _monitorCharts[k]; }
    });

    var resultados = WorkspaceState.resultados || {};
    var keys = Object.keys(resultados).filter(function(k) {
        return Array.isArray(resultados[k]) && resultados[k].length > 0;
    });

    // Ordenar por ts de última medición descendente
    keys.sort(function(a, b) {
        var aLast = resultados[a][resultados[a].length - 1];
        var bLast = resultados[b][resultados[b].length - 1];
        return bLast.ts - aLast.ts;
    });

    // Badge
    var countBadge = document.getElementById('rs-ind-count');
    if (countBadge) {
        countBadge.textContent = keys.length;
        countBadge.className = keys.length > 0 ? 'rs-badge rs-badge--active' : 'rs-badge rs-badge--empty';
    }

    if (keys.length === 0) {
        container.innerHTML =
            '<div class="rs-ind-empty"><i class="fas fa-chart-area"></i>' +
            '<p>Los resultados aparecerán aquí al procesar Vegetación, Agua o Elevación.</p>' +
            '<small>Click en una tarjeta para activar la capa en el mapa</small></div>';
        return;
    }

    var html = '';
    keys.forEach(function(key) {
        var arr = resultados[key];
        var latest = arr[arr.length - 1];
        var cfg = IND_CONFIG[latest.tipo] || { icon: 'fas fa-chart-line', iconClass: '', cat: latest.tipo };
        var latestActiveKey = key + '_' + latest.ts;
        var isActive = _indicadorActivo === latestActiveKey;
        var val = _getIndicadorValue(latest);
        var trend = _calcTrend(arr);
        var chartId = 'mon-chart-' + key;

        // Tendencia HTML
        var trendHtml = '';
        if (trend) {
            var arrow = trend.dir === 'up' ? '▲' : trend.dir === 'down' ? '▼' : '—';
            var trendClass = 'mon-trend--' + trend.dir;
            var trendVal = trend.dir !== 'flat'
                ? arrow + ' ' + Math.abs(trend.delta).toFixed(3)
                : arrow;
            trendHtml = '<span class="mon-trend ' + trendClass + '">' + trendVal + '</span>';
        }

        // Fecha última medición
        var lastDate = '';
        if (latest.fechaInicio && latest.fechaFin) {
            lastDate = latest.fechaInicio.substring(0, 7) + ' → ' + latest.fechaFin.substring(0, 7);
        }

        html += '<div class="mon-card' + (isActive ? ' active' : '') + '">';

        // Header
        html += '<div class="mon-card-header" onclick="activarIndicador(\'' + key + '\')">';
        html += '<div class="rs-ind-icon ' + cfg.iconClass + '"><i class="' + cfg.icon + '"></i></div>';
        html += '<div class="mon-card-title">';
        html += '<span class="rs-ind-name">' + latest.indice + '</span>';
        html += '<span class="rs-ind-cat">' + cfg.cat + '</span>';
        html += '</div>';
        if (arr.length > 1) html += '<span class="mon-count-badge">' + arr.length + '</span>';
        html += '<button class="rs-ind-delete" title="Eliminar índice" onclick="event.stopPropagation(); eliminarIndicador(\'' + key + '\')">×</button>';
        html += '</div>';

        // Valor + tendencia
        html += '<div class="mon-main-row">';
        html += '<span class="mon-val">' + val + '</span>';
        html += trendHtml;
        html += '</div>';
        if (lastDate) html += '<div class="mon-last-date">' + lastDate + '</div>';

        // Bio mini-stats grid (RCE / CR / EN / VU)
        if (latest.tipo === 'biodiversidad' && latest.stats) {
            var bs = latest.stats;
            html += '<div class="mon-bio-stats">';
            html += '<div class="mon-bio-stat"><span class="mon-bio-stat-val rce">' + (bs.n_rce != null ? bs.n_rce : '—') + '</span><span class="mon-bio-stat-lbl">RCE</span></div>';
            html += '<div class="mon-bio-stat"><span class="mon-bio-stat-val cr">'  + (bs.n_cr  != null ? bs.n_cr  : '—') + '</span><span class="mon-bio-stat-lbl">CR</span></div>';
            html += '<div class="mon-bio-stat"><span class="mon-bio-stat-val en">'  + (bs.n_en  != null ? bs.n_en  : '—') + '</span><span class="mon-bio-stat-lbl">EN</span></div>';
            html += '<div class="mon-bio-stat"><span class="mon-bio-stat-val vu">'  + (bs.n_vu  != null ? bs.n_vu  : '—') + '</span><span class="mon-bio-stat-lbl">VU</span></div>';
            html += '</div>';
        }

        // Sparkline (solo si hay ≥2 mediciones)
        if (arr.length >= 2) {
            html += '<div class="mon-chart-wrap"><canvas id="' + chartId + '"></canvas></div>';
        }

        // Historial de mediciones (solo si hay ≥2)
        if (arr.length >= 2) {
            html += '<div class="mon-history">';
            // Más reciente primero
            var arrDesc = arr.slice().reverse();
            arrDesc.forEach(function(e) {
                var eKey = key + '_' + e.ts;
                var eActive = _indicadorActivo === eKey;
                var eVal = _getIndicadorValue(e);
                var eDate = (e.fechaInicio && e.fechaFin)
                    ? e.fechaInicio.substring(0, 7) + ' → ' + e.fechaFin.substring(0, 7)
                    : new Date(e.ts).toLocaleDateString('es-CL');
                html += '<div class="mon-history-item' + (eActive ? ' active' : '') + '"' +
                    ' onclick="activarIndicador(\'' + key + '\',' + e.ts + ')">';
                html += '<span class="mon-history-date">' + eDate + '</span>';
                html += '<span class="mon-history-val">' + eVal + '</span>';
                html += '<button class="rs-ind-delete" style="opacity:1;font-size:11px;" title="Eliminar medición"' +
                    ' onclick="event.stopPropagation(); eliminarMedicion(\'' + key + '\',' + e.ts + ')">×</button>';
                html += '</div>';
            });
            html += '</div>';
        }

        html += '</div>'; // /mon-card
    });

    container.innerHTML = html;

    // Renderizar sparklines tras DOM update
    keys.forEach(function(key) {
        var arr = resultados[key];
        if (arr.length >= 2) {
            setTimeout(function() { _renderSparkline(key, arr); }, 0);
        }
    });
}

/** Alias para compatibilidad con código existente */
function renderIndicadorCards() { renderMonitorPanel(); }

/**
 * Elimina el índice completo (todas sus mediciones) del dashboard.
 */
function eliminarIndicador(key) {
    var arr = WorkspaceState.resultados && WorkspaceState.resultados[key];
    if (arr) {
        arr.forEach(function(e) {
            var tileKey = key + '_' + e.ts;
            if (_indicadorActivo === tileKey) {
                if (_indicadorLayer) { map.removeLayer(_indicadorLayer); _indicadorLayer = null; }
                _indicadorActivo = null;
            }
            delete _tilesCache[tileKey];
        });
        delete WorkspaceState.resultados[key];
    }
    saveWorkspaceState();
    renderIndicadorCards();
}

/**
 * Elimina una medición individual de un índice.
 */
function eliminarMedicion(key, ts) {
    var tileKey = key + '_' + ts;
    if (_indicadorActivo === tileKey) {
        if (_indicadorLayer) { map.removeLayer(_indicadorLayer); _indicadorLayer = null; }
        _indicadorActivo = null;
    }
    delete _tilesCache[tileKey];
    if (WorkspaceState.resultados && WorkspaceState.resultados[key]) {
        WorkspaceState.resultados[key] = WorkspaceState.resultados[key].filter(function(e) {
            return e.ts !== ts;
        });
        if (WorkspaceState.resultados[key].length === 0) {
            delete WorkspaceState.resultados[key];
        }
    }
    saveWorkspaceState();
    renderIndicadorCards();
}

/**
 * Activa o desactiva una capa de indicador en el mapa.
 * @param {string} key   - 'tipo_indice'
 * @param {number} [ts]  - timestamp de la medición (default: última)
 */
function activarIndicador(key, ts) {
    var arr = (WorkspaceState.resultados || {})[key];
    if (!arr || arr.length === 0) return;

    // Resolver la medición a activar
    var entry = ts
        ? arr.find(function(e) { return e.ts === ts; })
        : arr[arr.length - 1];
    if (!entry) return;

    var activeKey = key + '_' + entry.ts;

    // Limpiar todas las capas de análisis activas
    if (vegLayer)          { map.removeLayer(vegLayer);         vegLayer = null; }
    if (aguaLayer)         { map.removeLayer(aguaLayer);        aguaLayer = null; }
    if (_demLayerActual)   { map.removeLayer(_demLayerActual);  _demLayerActual = null; }
    if (_indicadorLayer)   { map.removeLayer(_indicadorLayer);  _indicadorLayer = null; }

    // Limpiar overlays de preview anteriores
    Object.keys(_previewOverlays).forEach(function(k) {
        try { map.removeLayer(_previewOverlays[k]); } catch(e) {}
    });
    _previewOverlays = {};

    // Toggle: si ya estaba activo, desactivar
    if (_indicadorActivo === activeKey) {
        _indicadorActivo = null;
        renderIndicadorCards();
        return;
    }

    var url = _tilesCache[activeKey];
    if (!url) {
        // Tile GEE expirado — intentar mostrar preview guardada en Storage
        if (entry.previewPath) {
            _restorePreviewOnMap(key, entry.previewPath, entry.previewBounds);
            _indicadorActivo = activeKey;
            renderIndicadorCards();
            mostrarNotificacion('🖼️ Mostrando vista guardada — el tile GEE expiró');
        } else {
            mostrarNotificacion('⏱️ Capa expirada. Recalcula en el tab correspondiente.');
            _indicadorActivo = null;
            renderIndicadorCards();
        }
        return;
    }

    _indicadorLayer = L.tileLayer(url, { pane: 'overlayPane', zIndex: 400, crossOrigin: 'anonymous' });
    _indicadorLayer.addTo(map);
    _indicadorActivo = activeKey;
    renderIndicadorCards();
}

// Actualiza el UI del panel izquierdo con la info de la zona
function updateZoneUI() {
    var zonaActiva = WorkspaceState.zonaHa > 0;
    var haTexto = zonaActiva
        ? WorkspaceState.zonaHa.toLocaleString('es-CL') + ' hectáreas'
        : 'Sin zona definida';

    // --- Header (siempre visible) ---
    var displayName = document.getElementById('ws-zone-name-display');
    if (displayName) displayName.textContent = WorkspaceState.zonaNombre;

    var headerName = document.getElementById('ws-header-zone-name');
    if (headerName) headerName.innerText = WorkspaceState.zonaNombre;

    var haHeader = document.getElementById('ws-zone-ha');
    if (haHeader) haHeader.innerText = haTexto;

    // --- Resumen Tab ---
    var nameInput = document.getElementById('ws-zone-name');
    if (nameInput) nameInput.value = WorkspaceState.zonaNombre;

    var haCard = document.getElementById('ws-zone-ha-card');
    if (haCard) haCard.textContent = zonaActiva ? WorkspaceState.zonaHa.toLocaleString('es-CL') : '—';

    var subtitle = document.getElementById('rs-subtitle');
    if (subtitle) subtitle.textContent = zonaActiva
        ? 'Última modificación: ' + new Date().toLocaleDateString('es-CL')
        : 'Define tu área de análisis en el mapa';

    var badge = document.getElementById('rs-status-badge');
    if (badge) {
        badge.textContent = zonaActiva ? 'Zona activa' : 'Sin zona';
        badge.className = zonaActiva ? 'rs-badge rs-badge--active' : 'rs-badge rs-badge--empty';
    }

    var geeEl = document.getElementById('rs-meta-gee');
    if (geeEl) {
        geeEl.textContent = zonaActiva ? '✓ Listo' : 'Pendiente';
        geeEl.style.color = zonaActiva ? 'var(--accent)' : 'var(--muted)';
    }

    // Vértices
    if (WorkspaceState.zona && WorkspaceState.zona.geometry) {
        var coords = WorkspaceState.zona.geometry.coordinates;
        if (coords && coords[0]) {
            var verticesEl = document.getElementById('rs-meta-vertices');
            if (verticesEl) verticesEl.textContent = coords[0].length;
        }
    } else {
        var verticesEl = document.getElementById('rs-meta-vertices');
        if (verticesEl) verticesEl.textContent = '—';
    }

    // Botón zoom a zona — visible solo cuando hay zona activa
    var btnZoom = document.getElementById('btn-zoom-zona');
    if (btnZoom) btnZoom.style.display = zonaActiva ? 'inline-flex' : 'none';

    // Cargar clima de la zona si hay zona y aún no se cargó
    if (zonaActiva) fetchClimaWidget();
}

/**
 * Centra y ajusta el mapa exactamente a los límites de la zona de estudio.
 */
function zoomToZone() {
    if (!WorkspaceState.zona || typeof map === 'undefined') return;
    try {
        var bounds = L.geoJSON(WorkspaceState.zona).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], animate: true });
    } catch(e) { console.warn('zoomToZone:', e); }
}

// Al cambiar el input del nombre
function onZoneNameChange(e) {
    WorkspaceState.zonaNombre = e.target.value || 'Mi zona de estudio';
    var headerName = document.getElementById('ws-header-zone-name');
    if (headerName) headerName.innerText = WorkspaceState.zonaNombre;
    saveWorkspaceState();
}

// Metadatos por tab — icono y título del panel header
var TAB_META = {
    'resumen':       { icon: 'fas fa-th-large',   title: 'Resumen' },
    'vegetacion':    { icon: 'fas fa-seedling',   title: 'Vegetación' },
    'agua':          { icon: 'fas fa-tint',        title: 'Agua' },
    'elevacion':     { icon: 'fas fa-mountain',   title: 'Elevación' },
    'bosque':        { icon: 'fas fa-tree',        title: 'Bosque' },
    'biodiversidad': { icon: 'fas fa-leaf',        title: 'Biodiversidad' },
    'clima':         { icon: 'fas fa-cloud',       title: 'Clima' }
};

// Cambiar de Módulo (Tab)
function switchWorkspaceTab(tabId) {
    // 1. Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.classList.remove('active'); });
    var activeBtn = document.getElementById('tab-btn-' + tabId);
    if (activeBtn) activeBtn.classList.add('active');

    // 2. Hide all modules
    document.querySelectorAll('.ws-module-content').forEach(function(mod) { mod.classList.remove('active'); });

    // 3. Show selected module
    var activeMod = document.getElementById('tab-' + tabId + '-content');
    if (activeMod) activeMod.classList.add('active');

    // 4. Update panel header icon + title
    var meta = TAB_META[tabId] || { icon: 'fas fa-chart-bar', title: tabId };
    var iconEl = document.getElementById('panel-icon-i');
    var titleEl = document.getElementById('panel-title');
    if (iconEl) iconEl.className = meta.icon;
    if (titleEl) titleEl.textContent = meta.title;

    // 5. Make sure panel is visible
    var panel = document.getElementById('ws-left-panel');
    if (panel && panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
    }

    // 6. Biodiversidad iframe — siempre en background, nunca full-screen
    var bioIframe = document.getElementById('iframe-biodiversidad');
    if (bioIframe) {
        bioIframe.classList.remove('ws-iframe-active');
        if (!bioIframe.src || bioIframe.src === window.location.href) {
            bioIframe.src = 'inaturalist/index.html';
        }
        if (tabId === 'biodiversidad') {
            setTimeout(function() { enviarZonaABiodiversidad(); }, 800);
        }
    }

    // 7. Auto-activar la capa más reciente del módulo en el mapa
    _autoActivateTabLayer(tabId);
}

/**
 * Al cambiar de tab, activa automáticamente la última capa calculada
 * de ese módulo y actualiza el mini-panel con su leyenda.
 */
function _autoActivateTabLayer(tabId) {
    // Mapeo tab → prefijo de key en _layerRegistry / resultados
    var prefijoPorTab = {
        'vegetacion': 'vegetacion_',
        'agua':       'agua_',
        'elevacion':  'dem_',
        'bosque':     'bosque'
    };

    var prefijo = prefijoPorTab[tabId];
    if (!prefijo) {
        try { hideMiniPanelForTab(tabId); } catch(e) {}
        return; // resumen, clima, biodiversidad → sin capa automática
    }

    // Buscar keys del registro en memoria y de resultados persistidos.
    // Esto mantiene la leyenda correcta después de recargar desde Supabase/localStorage,
    // incluso cuando la capa GEE todavía no se ha vuelto a registrar en memoria.
    var registryKeys = (typeof _layerRegistry !== 'undefined') ? Object.keys(_layerRegistry) : [];
    var resultKeys = Object.keys(WorkspaceState.resultados || {});
    var keysDisponibles = registryKeys.concat(resultKeys).filter(function(k, idx, arr) {
        if (arr.indexOf(k) !== idx) return false;
        return k === prefijo || k.indexOf(prefijo) === 0;
    });
    if (keysDisponibles.length === 0) {
        try { hideMiniPanelForTab(tabId); } catch(e) {}
        return; // No hay capas calculadas aún
    }

    // Encontrar la key con el timestamp más reciente en resultados
    var mejorKey = null;
    var mejorTs  = -1;

    keysDisponibles.forEach(function(k) {
        if (k === 'bosque') {
            // Bosque no tiene timestamp de resultado estándar — priorizar siempre
            mejorKey = 'bosque';
            mejorTs  = Infinity;
            return;
        }
        var arr  = (WorkspaceState.resultados || {})[k];
        var last = arr && arr.length ? arr[arr.length - 1] : null;
        var ts   = last ? (last.ts || 0) : 0;
        if (ts > mejorTs) { mejorTs = ts; mejorKey = k; }
    });

    if (!mejorKey) return;

    // Activar la capa en el mapa y mostrar su leyenda
    try { _activateMapLayer(mejorKey); } catch(e) {}
    try { showMiniLegend(mejorKey); }    catch(e) {}
}

function hideMiniPanelForTab(tabId) {
    var tabsSinLeyenda = { resumen: true, clima: true, biodiversidad: true };
    if (!tabsSinLeyenda[tabId]) return;
    var mp = document.getElementById('mini-panel');
    if (mp) mp.classList.add('hidden');
}

// Toggle Left Panel
function toggleLeftPanel() {
    var panel = document.getElementById('ws-left-panel');
    if (panel) panel.classList.toggle('hidden');
}

// Toggle Mini Panel (Bosque widget bottom-right)
function toggleMiniPanel() {
    var mp = document.getElementById('mini-panel');
    if (mp) mp.classList.toggle('hidden');
}

// Toggle map layers dropdown
function toggleLayersPanel() {
    var body = document.getElementById('map-layers-body');
    var chev = document.getElementById('layers-chevron');
    var overlay = document.getElementById('map-overlay');
    if (!body) return;
    body.classList.toggle('collapsed');
    if (overlay) overlay.classList.toggle('open', !body.classList.contains('collapsed'));
    if (chev) chev.style.transform = body.classList.contains('collapsed') ? '' : 'rotate(180deg)';
}

// Cambiar opacidad AOI directamente desde slider (0-1)
function changeAoiOpacityDirect(val) {
    _aoiOpacity = val;
    if (globalWorkspaceAOILayer && typeof globalWorkspaceAOILayer.setStyle === 'function') {
        globalWorkspaceAOILayer.setStyle({ fillOpacity: _aoiVisible ? _aoiOpacity : 0 });
    }
}
