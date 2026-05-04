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

    fetch('https://evergreen-backend-awv1.onrender.com/api/bosque', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            geojson:   WorkspaceState.zonaGEE.geometry,
            buffer_km: bufferKm
        })
    })
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
// HISTORY CHARTS — comparación temporal de índices
// ---------------------------------------------------------
var _vegHistoryChart  = null;
var _aguaHistoryChart = null;

/**
 * Dibuja/actualiza el gráfico de barras temporal para un índice de vegetación.
 * Aparece automáticamente desde la 2.ª medición del mismo índice.
 */
function renderVegHistoryChart(indice) {
    var key = 'vegetacion_' + indice;
    var arr = (WorkspaceState.resultados || {})[key];
    var wrap = document.getElementById('veg-historial');
    if (!arr || arr.length < 2) { if (wrap) wrap.style.display = 'none'; return; }
    if (wrap) wrap.style.display = 'block';

    var canvas = document.getElementById('veg-history-chart');
    if (!canvas) return;
    if (_vegHistoryChart) { try { _vegHistoryChart.destroy(); } catch(e){} }

    var labels = arr.map(function(e) {
        if (e.fechaInicio && e.fechaFin)
            return e.fechaInicio.slice(0,7) + '→' + e.fechaFin.slice(0,7);
        return new Date(e.ts).toLocaleDateString('es-CL', {month:'short', year:'2-digit'});
    });
    var values = arr.map(function(e) {
        return (e.stats && e.stats.mean != null) ? parseFloat(e.stats.mean.toFixed(3)) : null;
    });
    var colors = values.map(function(_, i) {
        return i === values.length - 1 ? '#6aaa35' : 'rgba(106,170,53,0.45)';
    });

    _vegHistoryChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ data: values, backgroundColor: colors, borderRadius: 3, borderSkipped: false }]
        },
        options: _histChartOptions('rgba(100,140,100,0.6)')
    });
}

/**
 * Ídem para índices de agua (NDWI, MNDWI, NDMI).
 */
function renderAguaHistoryChart(indice) {
    var key = 'agua_' + indice;
    var arr = (WorkspaceState.resultados || {})[key];
    var wrap = document.getElementById('agua-historial');
    if (!arr || arr.length < 2) { if (wrap) wrap.style.display = 'none'; return; }
    if (wrap) wrap.style.display = 'block';

    var canvas = document.getElementById('agua-history-chart');
    if (!canvas) return;
    if (_aguaHistoryChart) { try { _aguaHistoryChart.destroy(); } catch(e){} }

    var labels = arr.map(function(e) {
        if (e.fechaInicio && e.fechaFin)
            return e.fechaInicio.slice(0,7) + '→' + e.fechaFin.slice(0,7);
        return new Date(e.ts).toLocaleDateString('es-CL', {month:'short', year:'2-digit'});
    });
    var values = arr.map(function(e) {
        return (e.stats && e.stats.mean != null) ? parseFloat(e.stats.mean.toFixed(3)) : null;
    });
    var colors = values.map(function(_, i) {
        return i === values.length - 1 ? '#1e6ea0' : 'rgba(30,110,160,0.4)';
    });

    _aguaHistoryChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ data: values, backgroundColor: colors, borderRadius: 3, borderSkipped: false }]
        },
        options: _histChartOptions('rgba(80,130,180,0.6)')
    });
}

/** Opciones base compartidas para history charts */
function _histChartOptions(tickColor) {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(10,20,10,0.9)',
                titleColor: '#c8e6c9', bodyColor: '#fff',
                padding: 5, cornerRadius: 4,
                callbacks: {
                    title: function(items) { return items[0].label; },
                    label: function(item) { return '  Media: ' + item.parsed.y; }
                }
            }
        },
        scales: {
            x: {
                ticks: { color: tickColor, font: { size: 8 }, maxRotation: 25, maxTicksLimit: 8 },
                grid: { display: false }
            },
            y: {
                ticks: { color: tickColor, font: { size: 8 }, maxTicksLimit: 4 },
                grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false }
            }
        },
        animation: { duration: 350 }
    };
}

