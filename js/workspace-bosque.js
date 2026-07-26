/* ==========================================================================
   WORKSPACE BOSQUE - Hansen, carbono e historia
   Split mechanically from workspace.js; keep global function names stable.
   ========================================================================== */

// BOSQUE — Hansen Forest Loss + Carbon Stock Charts
// ---------------------------------------------------------
var _chartCarbon = null;
var _chartBosque = null;

var CHART_DEFAULTS = {
    scales: {
        x: {
            ticks: { color: 'rgba(180,220,180,0.55)', font: { size: 9 }, maxRotation: 0 },
            grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false }
        },
        y: {
            ticks: { color: 'rgba(180,220,180,0.55)', font: { size: 9 }, maxTicksLimit: 4 },
            grid:  { color: 'rgba(255,255,255,0.06)', drawBorder: false }
        }
    },
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: 'rgba(10,30,10,0.9)',
            titleColor: '#c8e6c9',
            bodyColor: '#fff',
            padding: 8,
            cornerRadius: 6
        }
    },
    animation: { duration: 600 },
    responsive: true,
    maintainAspectRatio: false
};

function requestBosque() {
    if (!WorkspaceState.zonaGEE) return _noZonaGuard();

    var bufferKm = parseFloat(document.getElementById('bosque-buffer').value) || 5;
    var btn = document.getElementById('btn-bosque-gen');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
    btn.disabled = true;

    // Mostrar mensaje de espera (Hansen es rápido, ~15-30s)
    var emptyEl = document.getElementById('bosque-empty');
    if (emptyEl) emptyEl.innerHTML =
        '<i class="fas fa-spinner fa-spin" style="font-size:22px; color:var(--accent); display:block; margin-bottom:10px;"></i>' +
        '<p style="font-size:12px; color:var(--muted); margin:0;">Consultando Hansen GFC + NASA ORNL…<br><small>30–60 segundos en primera consulta</small></p>';

    var payload = {
        geojson:   WorkspaceState.zonaGEE.geometry,
        buffer_km: bufferKm
    };

    var request = (typeof fetchBackendJson === 'function')
        ? fetchBackendJson('https://evergreen-backend-awv1.onrender.com/api/bosque', payload)
        : fetch('https://evergreen-backend-awv1.onrender.com/api/bosque', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

    request
    .then(function(r) { return r.json(); })
    .then(function(data) {
        btn.innerHTML = '<i class="fas fa-satellite-dish"></i> Calcular';
        btn.disabled = false;

        if (data.error) { alert('Error: ' + data.error); return; }

        // Ocultar empty state
        if (emptyEl) emptyEl.style.display = 'none';

        // Actualizar buffer label
        var bufLabel = document.getElementById('bosque-buffer-label');
        if (bufLabel) bufLabel.textContent = bufferKm + ' km';

        // ── Render Carbon Stock chart ───────────────────────────
        renderChartCarbon(data.carbono, data.baseline_tonC);

        // ── Render Forest Loss chart ────────────────────────────
        renderChartBosque(data.perdida, data.total_ha_perdida);

        // ── Mini panel bottom-right ─────────────────────────────
        if (data.perdida && data.perdida.length > 0) renderMiniPanel(data.perdida);

        // ── Guardar datos reales y actualizar panel Resumen ─────
        _bosqueRealData = data;
        updateDetailBosqueStats(data);

        // ── Registrar capa de pérdida en el panel de capas ──────
        if (data.tiles_perdida) registerLayer('bosque', L.tileLayer(data.tiles_perdida, { pane: 'overlayPane', zIndex: 380, crossOrigin: 'anonymous' }));

        _fitToZone();
    })
    .catch(function() {
        btn.innerHTML = '<i class="fas fa-satellite-dish"></i> Calcular';
        btn.disabled = false;
        if (emptyEl) emptyEl.innerHTML =
            '<p style="font-size:12px; color:#e57373; margin:0;">Error de conexión al servidor.</p>';
    });
}

function renderChartCarbon(serie, baselineTonC) {
    var card = document.getElementById('bosque-card-carbon');
    if (!card) return;
    card.style.display = 'block';

    // Valor headline: total actual (último año)
    var ultimo = serie[serie.length - 1];
    var totalEl = document.getElementById('bosque-carbon-total');
    if (totalEl) totalEl.textContent = (ultimo.tonC / 1000).toFixed(1).replace('.', ',') + ' K TonC';

    var periodEl = document.getElementById('bosque-carbon-period');
    if (periodEl) periodEl.textContent = serie[0].year + ' – ' + ultimo.year;

    var labels = serie.map(function(d) { return d.year; });
    var values = serie.map(function(d) { return d.tonC; });

    var ctx = document.getElementById('chart-carbon').getContext('2d');
    if (_chartCarbon) _chartCarbon.destroy();

    _chartCarbon = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                borderColor: '#66bb6a',
                backgroundColor: 'rgba(102,187,106,0.12)',
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2
            }]
        },
        options: Object.assign({}, CHART_DEFAULTS, {
            scales: Object.assign({}, CHART_DEFAULTS.scales, {
                x: Object.assign({}, CHART_DEFAULTS.scales.x, {
                    ticks: { color: 'rgba(180,220,180,0.55)', font: { size: 9 },
                             maxRotation: 0, callback: function(v, i) {
                                 return i % 4 === 0 ? labels[i] : '';
                             }}
                }),
                y: Object.assign({}, CHART_DEFAULTS.scales.y, {
                    ticks: { color: 'rgba(180,220,180,0.55)', font: { size: 9 },
                             maxTicksLimit: 3,
                             callback: function(v) {
                                 return (v / 1000).toFixed(0) + 'K';
                             }}
                })
            })
        })
    });
}

function renderChartBosque(perdida, totalHa) {
    var card = document.getElementById('bosque-card-perdida');
    if (!card) return;
    card.style.display = 'block';

    var perdidaEl = document.getElementById('bosque-perdida-total');
    if (perdidaEl) perdidaEl.textContent = totalHa.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' Ha';

    var labels     = perdida.map(function(d) { return d.year; });
    var vals_zona  = perdida.map(function(d) { return d.ha_zona; });
    var vals_buf   = perdida.map(function(d) { return d.ha_buffer; });

    var ctx = document.getElementById('chart-bosque').getContext('2d');
    if (_chartBosque) _chartBosque.destroy();

    _chartBosque = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Zona',
                    data: vals_zona,
                    backgroundColor: '#4caf50',
                    borderRadius: 2,
                    borderSkipped: false
                },
                {
                    label: 'Buffer',
                    data: vals_buf,
                    backgroundColor: 'rgba(165,214,167,0.55)',
                    borderRadius: 2,
                    borderSkipped: false
                }
            ]
        },
        options: Object.assign({}, CHART_DEFAULTS, {
            scales: Object.assign({}, CHART_DEFAULTS.scales, {
                x: Object.assign({}, CHART_DEFAULTS.scales.x, {
                    stacked: false,
                    ticks: { color: 'rgba(180,220,180,0.55)', font: { size: 9 },
                             maxRotation: 0, callback: function(v, i) {
                                 return i % 4 === 0 ? labels[i] : '';
                             }}
                }),
                y: Object.assign({}, CHART_DEFAULTS.scales.y, {
                    stacked: false,
                    ticks: { color: 'rgba(180,220,180,0.55)', font: { size: 9 },
                             maxTicksLimit: 4,
                             callback: function(v) { return v + ' Ha'; }}
                })
            })
        })
    });
}

// ---------------------------------------------------------
// dNBR — SEVERIDAD DE QUEMA (Key & Benson / USGS-FIREMON)
// ---------------------------------------------------------
var _dnbrLayer = null;
var _dnbrChart = null;
var _dnbrData  = null;

function requestDnbr() {
    if (!WorkspaceState.zonaGEE) return _noZonaGuard();

    var preIni  = document.getElementById('dnbr-pre-inicio').value;
    var preFin  = document.getElementById('dnbr-pre-fin').value;
    var postIni = document.getElementById('dnbr-post-inicio').value;
    var postFin = document.getElementById('dnbr-post-fin').value;

    var notif = (typeof mostrarNotificacion === 'function') ? mostrarNotificacion : alert;
    if (!preIni || !preFin || !postIni || !postFin) { notif('⚠️ Completa los cuatro campos de fecha.'); return; }
    if (preFin > postIni) { notif('⚠️ El período PRE debe terminar antes de que empiece el POST.'); return; }

    var btn = document.getElementById('btn-dnbr-gen');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
    btn.disabled = true;

    fetchBackendJson('https://evergreen-backend-awv1.onrender.com/api/bosque/dnbr', {
        geojson: WorkspaceState.zonaGEE.geometry,
        pre_inicio: preIni, pre_fin: preFin,
        post_inicio: postIni, post_fin: postFin
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        btn.innerHTML = '<i class="fas fa-fire"></i> Calcular Severidad dNBR';
        btn.disabled = false;
        if (data.error) { notif('❌ ' + data.error); return; }

        _dnbrData = data;

        // Capa en el mapa
        if (_dnbrLayer) map.removeLayer(_dnbrLayer);
        _dnbrLayer = L.tileLayer(data.tiles, { pane: 'overlayPane', zIndex: 400, crossOrigin: 'anonymous' });
        _dnbrLayer.addTo(map);
        registerLayer('dnbr_Severidad', _dnbrLayer);
        if (typeof _fitToZone === 'function') _fitToZone();

        renderDnbr(data);

        // Persistir como medición del dashboard (dNBR es un resultado con capa).
        // `figuras.clases` guarda la composición completa por severidad: es lo
        // que permite redibujar el gráfico aquí tras recargar y compararlo
        // contra otra zona en el Comparador.
        var previewPromise = Promise.resolve(true);
        if (typeof saveResultado === 'function') {
            var ts = saveResultado('dnbr', 'Severidad',
                { mean: data.dnbr_mean, min: 0, max: data.dnbr_max,
                  afectado_ha: data.afectado_ha, severa_ha: data.severa_ha,
                  aoi_ha: data.aoi_ha, coverage_pct: data.coverage_pct,
                  n_pre: data.n_pre, n_post: data.n_post,
                  n_imagenes: (data.n_pre + data.n_post) },
                data.tiles, preIni, postFin,
                { clases: data.clases,
                  periodos: { pre_inicio: preIni, pre_fin: preFin,
                              post_inicio: postIni, post_fin: postFin } });
            if (typeof uploadAnalysisPreviewFromPayload === 'function') {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando capa...';
                btn.disabled = true;
                previewPromise = uploadAnalysisPreviewFromPayload('dnbr_Severidad', ts, data);
            }
        }
        if (typeof showMiniLegend === 'function') {
            try { showMiniLegend('dnbr_Severidad'); } catch(e) {}
        }
        return previewPromise.then(function(saved) {
            if (!saved) console.warn('[dNBR] Resultado guardado sin preview PNG; revisar respuesta de preview.');
            btn.innerHTML = '<i class="fas fa-fire"></i> Calcular Severidad dNBR';
            btn.disabled = false;
        });
    })
    .catch(function() {
        btn.innerHTML = '<i class="fas fa-fire"></i> Calcular Severidad dNBR';
        btn.disabled = false;
        notif('❌ Error de conexión al servidor.');
    });
}

function renderDnbr(d) {
    var empty = document.getElementById('dnbr-empty');
    if (empty) empty.style.display = 'none';

    function _ha(v) {
        if (v === null || v === undefined) return '—';
        var n = parseFloat(v);
        return (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ha';
    }

    var set = function(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; };
    set('dnbr-n-pre',  d.n_pre);
    set('dnbr-n-post', d.n_post);
    set('dnbr-coverage', (d.coverage_pct !== null && d.coverage_pct !== undefined) ? d.coverage_pct.toFixed(0) + '%' : '—');
    set('dnbr-afectado', _ha(d.afectado_ha));
    set('dnbr-severa',   _ha(d.severa_ha));
    set('dnbr-mean',     (d.dnbr_mean !== null && d.dnbr_mean !== undefined) ? d.dnbr_mean.toFixed(3) : '—');

    // Aviso de confiabilidad
    var warn = document.getElementById('dnbr-warning');
    if (warn) {
        var motivos = [];
        if (d.n_pre  < 2) motivos.push('solo ' + d.n_pre  + ' imagen(es) en el período PRE');
        if (d.n_post < 2) motivos.push('solo ' + d.n_post + ' imagen(es) en el período POST');
        if (d.coverage_pct !== undefined && d.coverage_pct < 85) motivos.push('cobertura válida de ' + d.coverage_pct.toFixed(0) + '%');
        if (motivos.length) {
            warn.textContent = '⚠ Resultado poco confiable: ' + motivos.join(' y ') +
                '. Amplía los rangos de fecha (idealmente 1 mes antes y 1 mes después).';
            warn.style.display = 'block';
        } else {
            warn.style.display = 'none';
        }
    }

    // Tabla de clases (mayor severidad primero)
    var cont = document.getElementById('dnbr-table');
    if (cont && d.clases) {
        var html = '<table class="ap-history-table"><thead><tr>' +
            '<th>Clase</th><th class="ht-num">Rango dNBR</th>' +
            '<th class="ht-num">Superficie</th><th class="ht-num">%</th>' +
            '</tr></thead><tbody>';
        d.clases.slice().reverse().forEach(function(c) {
            html += '<tr>' +
                '<td><span class="ap-history-legend-dot" style="background:' + c.color + ';"></span> ' + c.label + '</td>' +
                '<td class="ht-num">' + c.min.toFixed(2) + ' – ' + c.max.toFixed(2) + '</td>' +
                '<td class="ht-num">' + _ha(c.ha) + '</td>' +
                '<td class="ht-num">' + c.pct.toFixed(1) + '%</td>' +
                '</tr>';
        });
        cont.innerHTML = html + '</tbody></table>';
    }

    // Gráfico de barras horizontales por clase
    var canvas = document.getElementById('dnbr-chart');
    if (canvas && d.clases) {
        if (_dnbrChart) { try { _dnbrChart.destroy(); } catch(e) {} }
        var clasesRev = d.clases.slice().reverse();
        _dnbrChart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: clasesRev.map(function(c) { return c.label; }),
                datasets: [{
                    data: clasesRev.map(function(c) { return c.ha; }),
                    backgroundColor: clasesRev.map(function(c) { return c.color; }),
                    borderColor: 'rgba(0,0,0,0.15)', borderWidth: 1,
                    borderRadius: 3, borderSkipped: false
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(10,20,10,0.92)', padding: 8, cornerRadius: 5,
                        callbacks: {
                            label: function(item) {
                                var c = clasesRev[item.dataIndex];
                                return [_ha(c.ha) + ' (' + c.pct.toFixed(1) + '%)',
                                        'dNBR ' + c.min.toFixed(2) + ' a ' + c.max.toFixed(2)];
                            }
                        }
                    }
                },
                scales: {
                    x: { beginAtZero: true, ticks: { font: { size: 9 } },
                         title: { display: true, text: 'ha', font: { size: 9 } },
                         grid: { color: 'rgba(0,0,0,0.05)' } },
                    y: { ticks: { font: { size: 9 } }, grid: { display: false } }
                },
                animation: { duration: 300 }
            }
        });
    }

    var res = document.getElementById('dnbr-resultados');
    if (res) res.style.display = 'block';
}

/**
 * Reconstruye el panel dNBR desde la medición guardada (localStorage o
 * Supabase). Solo necesita `figuras.clases` — el ráster puede haber
 * expirado, pero el análisis sigue siendo legible.
 */
function restoreDnbrUI() {
    var arr = (WorkspaceState.resultados || {})['dnbr_Severidad'];
    if (!arr || !arr.length) return;
    var e = arr[arr.length - 1];
    if (!e || !e.figuras || !e.figuras.clases) return;

    var s = e.stats || {};
    var p = e.figuras.periodos || {};
    renderDnbr({
        clases: e.figuras.clases,
        n_pre: s.n_pre, n_post: s.n_post,
        coverage_pct: s.coverage_pct,
        afectado_ha: s.afectado_ha, severa_ha: s.severa_ha,
        dnbr_mean: s.mean, dnbr_max: s.max, aoi_ha: s.aoi_ha
    });

    // Reflejar los rangos usados en el formulario
    var set = function(id, v) { var el = document.getElementById(id); if (el && v) el.value = v; };
    set('dnbr-pre-inicio', p.pre_inicio);   set('dnbr-pre-fin',  p.pre_fin);
    set('dnbr-post-inicio', p.post_inicio); set('dnbr-post-fin', p.post_fin);
}

// ---------------------------------------------------------
// HISTORIAL DE ANÁLISIS — tabla de mediciones por índice
// (reemplaza los antiguos "history charts": cada medición es una corrida
// con rango/n imágenes distintos, no una serie temporal comparable.
// La serie temporal real será el análisis estacional — Fase B.)
// ---------------------------------------------------------

/**
 * Renderiza la tabla de historial de un índice.
 * Aparece desde la 2.ª medición. Click en fila → activa esa capa en el mapa.
 */
function _renderHistoryTable(key, containerId, wrapId) {
    var arr  = (WorkspaceState.resultados || {})[key];
    var wrap = document.getElementById(wrapId);
    if (!arr || arr.length < 2) { if (wrap) wrap.style.display = 'none'; return; }
    if (wrap) wrap.style.display = 'block';

    var cont = document.getElementById(containerId);
    if (!cont) return;

    function _fmtNum(v) {
        var n = parseFloat(v);
        return isNaN(n) ? '—' : n.toFixed(3);
    }

    var html = '<table class="ap-history-table"><thead><tr>' +
        '<th>Período</th>' +
        '<th class="ht-num">Media</th>' +
        '<th class="ht-num">Mín (p2)</th>' +
        '<th class="ht-num">Máx (p98)</th>' +
        '<th class="ht-num">Imgs</th>' +
        '</tr></thead><tbody>';

    // Más reciente arriba
    for (var i = arr.length - 1; i >= 0; i--) {
        var e = arr[i];
        var s = e.stats || {};
        var periodo = (e.fechaInicio && e.fechaFin)
            ? e.fechaInicio.slice(0, 7) + ' → ' + e.fechaFin.slice(0, 7)
            : new Date(e.ts).toLocaleDateString('es-CL', { month: 'short', year: 'numeric' });
        html += '<tr' + (i === arr.length - 1 ? ' class="latest"' : '') +
            ' onclick="activarIndicador(\'' + key + '\',' + e.ts + ')" title="Ver esta capa en el mapa">' +
            '<td>' + periodo + '</td>' +
            '<td class="ht-num">' + _fmtNum(s.mean) + '</td>' +
            '<td class="ht-num">' + _fmtNum(s.min) + '</td>' +
            '<td class="ht-num">' + _fmtNum(s.max) + '</td>' +
            '<td class="ht-num">' + (s.n_imagenes || '—') + '</td>' +
            '</tr>';
    }
    html += '</tbody></table>';
    cont.innerHTML = html;
}

/** Tabla de historial para índices de vegetación (nombre legacy — antes chart). */
function renderVegHistoryChart(indice) {
    _renderHistoryTable('vegetacion_' + indice, 'veg-history-table', 'veg-historial');
}

/** Tabla de historial para índices de agua (nombre legacy — antes chart). */
function renderAguaHistoryChart(indice) {
    _renderHistoryTable('agua_' + indice, 'agua-history-table', 'agua-historial');
}
