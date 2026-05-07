/* ==========================================================================
   WORKSPACE BIODIVERSIDAD - Puente GBIF/RCE
   Split mechanically from workspace.js; keep global function names stable.
   ========================================================================== */

/* ══════════════════════════════════════════════════════════════════════
   PANEL BIODIVERSIDAD — UI y puente postMessage con iframe GBIF
   ══════════════════════════════════════════════════════════════════════ */

// Charts del panel bio (inicializados al activar el tab)
var _biodonutChart = null, _bioRegionalChart = null, _bioDecadaChart = null, _bioRceIucnChart = null;
var _bioTableFilter = null;
var _bioFinalList = [];  // cache de la lista de especies
var _bioEvidencePoints = [];
var _bioEvidenceLayer = null;
var _bioEvidenceLegend = null;
var _bioEvidenceColors = {
    Plantae: '#6aaa35',
    Animalia: '#3b82f6',
    Fungi: '#a855f7',
    Chromista: '#f59e0b',
    Protozoa: '#ef4444'
};

// ── Actualizar zona en el badge del panel bio ────────────────────────
function updateBioZoneBadge() {
    var nombre = document.getElementById('bio-zona-nombre');
    var status = document.getElementById('bio-zona-status');
    if (nombre) nombre.textContent = WorkspaceState.zonaNombre || 'Sin zona definida';
    if (status) status.textContent = WorkspaceState.zonaHa > 0
        ? WorkspaceState.zonaHa.toLocaleString('es-CL') + ' ha · AOI sincronizado'
        : 'AOI no definido';
}

// ── Delegados al iframe (vía postMessage — no depende del estado del botón) ──
function runBioAnalysis() {
    var iframe = document.getElementById('iframe-biodiversidad');
    if (!iframe) return;

    // Validar zona
    if (!WorkspaceState.zona) {
        if (typeof mostrarNotificacion === 'function') {
            mostrarNotificacion('⚠️ Dibuja una zona en el mapa primero.');
        }
        return;
    }

    // Asegurar carga del iframe
    if (!iframe.src || iframe.src === window.location.href) {
        iframe.src = 'inaturalist/index.html';
    }

    // Mostrar barra de progreso
    var progress    = document.getElementById('bio-progress');
    var progressText = document.getElementById('bio-progress-text');
    var progressFill = document.getElementById('bio-progress-fill');
    if (progress) progress.classList.add('show');
    if (progressText) progressText.textContent = 'Enviando zona...';
    if (progressFill) progressFill.style.width = '15%';

    function _dispatchAnalysis() {
        var ifrWin = iframe.contentWindow;
        if (!ifrWin) return;

        // 1) Enviar zona
        ifrWin.postMessage({ tipo: 'zona_activa', geojson: WorkspaceState.zona }, '*');

        // 2) Esperar brevemente (zona_activa es síncrono en el listener, pero postMessage
        //    es siempre asíncrono — 200ms garantiza que el iframe ya procesó la zona)
        setTimeout(function() {
            if (progressText) progressText.textContent = 'Consultando GBIF...';
            if (progressFill) progressFill.style.width = '35%';
            // 3) Disparar análisis directamente desde el closure del módulo
            ifrWin.postMessage({ tipo: 'ejecutar_analisis' }, '*');
        }, 200);
    }

    // Si el iframe ya cargó, ejecutar de inmediato
    try {
        var doc = iframe.contentDocument;
        if (doc && doc.readyState === 'complete') {
            _dispatchAnalysis();
        } else {
            iframe.addEventListener('load', _dispatchAnalysis, { once: true });
        }
    } catch(e) {
        // cross-origin guard — en teoría no aplica (same origin)
        _dispatchAnalysis();
    }
}

function addBioExtended() {
    var iframe = document.getElementById('iframe-biodiversidad');
    if (!iframe) return;
    try {
        iframe.contentWindow.postMessage({ tipo: 'agregar_extendido' }, '*');
    } catch(e) { console.warn('addBioExtended:', e); }
}

function runBioEvidence() {
    var iframe = document.getElementById('iframe-biodiversidad');
    if (!iframe || !_bioFinalList.length) {
        if (typeof mostrarNotificacion === 'function') {
            mostrarNotificacion('Ejecuta primero el analisis GBIF base.');
        }
        return;
    }

    _setBioEl('bio-evidence-status', 'Consultando facets temporales y muestra georreferenciada...');
    _setBioEl('bio-evidence-budget', 'estimando');
    _setBioEl('bio-ev-total', '-');
    _setBioEl('bio-ev-year', '-');
    _setBioEl('bio-ev-recent', '-');
    _setBioEl('bio-ev-sample', '-');
    _setBioEl('bio-evidence-mini', '');
    var exportBtn = document.getElementById('bio-export-evidence-btn');
    if (exportBtn) exportBtn.disabled = true;
    var mapBtn = document.getElementById('bio-toggle-evidence-map-btn');
    if (mapBtn) mapBtn.disabled = true;
    clearBioEvidencePoints();

    var btn = document.getElementById('bio-evidence-btn');
    if (btn) btn.disabled = true;

    try {
        iframe.contentWindow.postMessage({ tipo: 'analizar_evidencia', modo: 'balanceado' }, '*');
    } catch(e) {
        console.warn('runBioEvidence:', e);
        if (btn) btn.disabled = false;
    }
}

// ── Escuchar resultados del iframe de biodiversidad ──────────────────
window.addEventListener('message', function(event) {
    if (!event.data) return;

    if (event.data.tipo === 'biodiversidad_evidencia_estado') {
        _handleBioEvidenceState(event.data.data || {});
        return;
    }

    if (event.data.tipo === 'biodiversidad_evidencia_resultado') {
        _handleBioEvidenceResult(event.data.data || {});
        return;
    }

    if (event.data.tipo !== 'biodiversidad_resultado') return;
    var d = event.data.data;
    clearBioEvidencePoints();
    _bioEvidencePoints = [];
    var staleMapBtn = document.getElementById('bio-toggle-evidence-map-btn');
    if (staleMapBtn) staleMapBtn.disabled = true;
    var staleExportBtn = document.getElementById('bio-export-evidence-btn');
    if (staleExportBtn) staleExportBtn.disabled = true;

    // Ocultar barra de progreso
    var progress = document.getElementById('bio-progress');
    if (progress) progress.classList.remove('show');

    // Mostrar panel de resultados
    var panel = document.getElementById('bio-resultados-panel');
    if (panel) panel.style.display = 'block';

    // Stats principales
    _setBioEl('bio-stat-spp', d.n_especies);
    _setBioEl('bio-stat-rce', d.n_rce);
    _setBioEl('bio-stat-cr',  d.n_cr);
    _setBioEl('bio-stat-en',  d.n_en);
    _setBioEl('bio-stat-vu',  d.n_vu);

    // Áreas protegidas
    _setBioAlert('bio-alert-snaspe', d.snaspe_int, d.snaspe_dist);
    _setBioAlert('bio-alert-19300',  d.int_19300,  null);
    _setBioAlert('bio-alert-erb',    d.int_erb,    null);
    _setBioAlert('bio-alert-humedal',d.int_humedal,null);
    _setBioEl('bio-piso', d.piso || '—');

    // Métricas
    _setBioEl('bio-m-s',       d.n_especies);
    _setBioEl('bio-m-chao',    d.chao1 ? Math.round(d.chao1) : '—');
    _setBioEl('bio-m-comp',    d.completitud ? d.completitud.toFixed(1) + '%' : '—');
    _setBioEl('bio-m-rce-pct', d.pct_rce ? d.pct_rce.toFixed(1) + '%' : '—');
    _setBioEl('bio-m-amen',    d.pct_amenazadas ? d.pct_amenazadas.toFixed(1) + '%' : '—');
    _setBioEl('bio-m-marg',    d.marginales != null ? d.marginales : '—');

    // Top amenazadas
    if (d.top_amenazadas && d.top_amenazadas.length > 0) {
        _renderBioThreatenedList(d.top_amenazadas);
    }

    // Doughnut por reino
    if (d.kingdom_counts) _updateBioDonut(d.kingdom_counts);

    // Charts bioestadística
    if (d.regional_data) _updateBioRegional(d.regional_data, d.region_name);
    if (d.decada_data)   _updateBioDecada(d.decada_data);
    if (d.rce_iucn_data) _updateBioRceIucn(d.rce_iucn_data);

    // Cache lista de especies para tabla
    if (d.final_list) {
        _bioFinalList = d.final_list;
        _setBioEl('bio-table-subtitle', (WorkspaceState.zonaNombre || '') + ' · ' + d.n_especies + ' registros únicos');
        var csvBtn = document.getElementById('bio-export-csv-btn');
        if (csvBtn) csvBtn.disabled = false;
        var evidenceBtn = document.getElementById('bio-evidence-btn');
        if (evidenceBtn) evidenceBtn.disabled = false;
    }

    // Guardar en dashboard Resumen
    saveResultado('biodiversidad', 'Biodiversidad', {
        n_especies: d.n_especies, n_rce: d.n_rce,
        n_cr: d.n_cr, n_en: d.n_en, n_vu: d.n_vu,
        mean: d.n_especies,
        piso: d.piso, snaspe_int: d.snaspe_int,
        top_amenazadas: d.top_amenazadas
    }, null, null, null);

    if (typeof mostrarNotificacion === 'function') {
        mostrarNotificacion('🌿 Análisis GBIF completo: ' + d.n_especies + ' especies.');
    }
});

function _handleBioEvidenceState(data) {
    if (data.status) _setBioEl('bio-evidence-status', data.status);
    if (data.calls != null) _setBioEl('bio-evidence-budget', data.calls + ' llamadas');
}

function _handleBioEvidenceResult(data) {
    var btn = document.getElementById('bio-evidence-btn');
    if (btn) btn.disabled = false;

    if (data.error) {
        _setBioEl('bio-evidence-status', 'No se pudo completar evidencia GBIF: ' + data.error);
        return;
    }

    _setBioEl('bio-evidence-status', 'Evidencia temporal actualizada sin alterar la riqueza base.');
    _setBioEl('bio-evidence-budget', (data.calls || 0) + ' llamadas');
    _setBioEl('bio-ev-total', _formatBioNumber(data.total_records));
    _setBioEl('bio-ev-year', _formatBioNumber(data.with_year));
    _setBioEl('bio-ev-recent', data.recent_pct != null ? data.recent_pct.toFixed(1) + '%' : '-');
    _setBioEl('bio-ev-sample', _formatBioNumber(data.sample_size));
    var exportBtn = document.getElementById('bio-export-evidence-btn');
    if (exportBtn) exportBtn.disabled = !(data.sample_size > 0);
    _bioEvidencePoints = data.map_points || [];
    var mapBtn = document.getElementById('bio-toggle-evidence-map-btn');
    if (mapBtn) {
        mapBtn.disabled = !_bioEvidencePoints.length;
        mapBtn.innerHTML = '<i class="fas fa-location-dot"></i> Mostrar puntos en mapa';
    }

    if (data.decada_data) {
        _updateBioDecada(data.decada_data);
        _setBioEl('bio-decada-sub', 'Basado en facet=year de GBIF; no cambia la lista de especies base.');
    }

    var basis = data.basis_counts || {};
    var topBasis = Object.keys(basis)
        .sort(function(a, b) { return basis[b] - basis[a]; })
        .slice(0, 3)
        .map(function(k) { return k + ': ' + _formatBioNumber(basis[k]); })
        .join(' | ');
    var sampleNote = data.sample_size
        ? 'Muestra acotada de ' + _formatBioNumber(data.sample_size) + ' registros con coordenadas para auditoria.'
        : 'Solo se usaron facets agregados; no se descargo muestra de ocurrencias.';
    _setBioEl('bio-evidence-mini', [topBasis, sampleNote].filter(Boolean).join(' - '));
}

function _formatBioNumber(n) {
    if (n == null || n === '') return '-';
    return Number(n).toLocaleString('es-CL');
}

function _setBioEl(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val != null ? val : '—';
}

function _setBioAlert(id, intersecta, distKm) {
    var el = document.getElementById(id);
    if (!el) return;
    if (intersecta) {
        el.textContent = 'Intersecta';
        el.className = 'bio-alert-val intersect';
    } else if (distKm != null) {
        el.textContent = 'A ' + distKm.toFixed(1) + ' km';
        el.className = 'bio-alert-val';
    } else {
        el.textContent = 'No intersecta';
        el.className = 'bio-alert-val ok';
    }
}

function _renderBioThreatenedList(list) {
    var el = document.getElementById('bio-threatened-list');
    if (!el) return;
    var catColors = { CR:'#e74c3c', EN:'#e67e22', VU:'#f1c40f' };
    el.innerHTML = list.map(function(t) {
        return '<div class="bio-threat-item ' + (t.cat||'').toLowerCase() + '">' +
            '<div class="bio-threat-meta">' +
            '<span class="bio-cat-badge ' + (t.cat||'').toLowerCase() + '">RCE: ' + (t.cat||'') + '</span>' +
            (t.iucn ? '<span class="bio-iucn-badge" style="color:' + (catColors[t.iucn]||'#9ca3af') + ';">IUCN: ' + t.iucn + '</span>' : '') +
            '<span class="bio-threat-obs">' + (t.obs||'') + ' reg.</span>' +
            '</div>' +
            '<div class="bio-threat-name">' + (t.nombre||'') + '</div>' +
            (t.comun ? '<div class="bio-threat-common">' + t.comun + '</div>' : '') +
            '</div>';
    }).join('') + (list.length >= 5 ? '<p style="font-size:10.5px;color:#9ca3af;margin-top:6px;">+ más · Ver tabla completa</p>' : '');
}

// ── Charts ───────────────────────────────────────────────────────────
function initBioCharts() {
    if (typeof Chart === 'undefined') return;
    var baseOpts = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
            tooltip: { backgroundColor: 'rgba(10,20,10,0.88)', bodyColor: '#fff', padding: 5, cornerRadius: 4 } },
        scales: {
            x: { ticks: { color: '#9ca3af', font: { size: 9 }, maxRotation: 0, maxTicksLimit: 6 },
                 grid: { display: false }, border: { display: false } },
            y: { ticks: { color: '#9ca3af', font: { size: 9 }, maxTicksLimit: 4 },
                 grid: { color: 'rgba(0,0,0,0.05)' }, border: { display: false } }
        },
        animation: { duration: 400 }
    };

    var dCtx = document.getElementById('bio-donut-chart');
    if (dCtx && !_biodonutChart) {
        _biodonutChart = new Chart(dCtx.getContext('2d'), {
            type: 'doughnut',
            data: { labels: [], datasets: [{ data: [],
                backgroundColor: ['#6aaa35','#3b82f6','#a855f7','#f59e0b','#ef4444','#14b8a6','#f97316','#6b7280'],
                borderWidth: 2, borderColor: '#fff' }] },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: { color: '#6b7280', font: { size: 8 }, boxWidth: 9, padding: 5, usePointStyle: true, pointStyle: 'circle' }
                    },
                    tooltip: { backgroundColor: 'rgba(10,20,10,0.88)', bodyColor: '#fff', padding: 5, cornerRadius: 4,
                        callbacks: { label: function(ctx) { return ' ' + ctx.label + ': ' + ctx.raw; } } }
                }
            }
        });
    }

    var rCtx = document.getElementById('bio-regional-chart');
    if (rCtx && !_bioRegionalChart) {
        _bioRegionalChart = new Chart(rCtx.getContext('2d'), {
            type: 'bar',
            data: { labels: [], datasets: [
                { label: 'Gap', data: [], backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 2 },
                { label: 'Observadas', data: [], backgroundColor: '#6aaa35', borderRadius: 2 }
            ]},
            options: Object.assign({}, baseOpts, { indexAxis: 'y',
                scales: {
                    x: Object.assign({}, baseOpts.scales.x, { stacked: true }),
                    y: Object.assign({}, baseOpts.scales.y, { stacked: true })
                }
            })
        });
    }

    var decCtx = document.getElementById('bio-decada-chart');
    if (decCtx && !_bioDecadaChart) {
        _bioDecadaChart = new Chart(decCtx.getContext('2d'), {
            type: 'bar',
            data: { labels: [], datasets: [{ label: 'Registros', data: [], backgroundColor: '#6aaa35', borderRadius: 2 }] },
            options: baseOpts
        });
    }

    var riCtx = document.getElementById('bio-rce-iucn-chart');
    if (riCtx && !_bioRceIucnChart) {
        _bioRceIucnChart = new Chart(riCtx.getContext('2d'), {
            type: 'bar',
            data: { labels: ['Amenazada RCE','Amenazada IUCN','En Ambas'],
                datasets: [{ data: [0,0,0], backgroundColor: ['#f1c40f','#e67e22','#e74c3c'], borderRadius: 3 }] },
            options: baseOpts
        });
    }
}

function _updateBioDonut(kingdomCounts) {
    if (!_biodonutChart) return;
    _biodonutChart.data.labels   = Object.keys(kingdomCounts);
    _biodonutChart.data.datasets[0].data = Object.values(kingdomCounts);
    _biodonutChart.update();
}

function _updateBioRegional(data, regionName) {
    if (!_bioRegionalChart) return;
    if (regionName) _setBioEl('bio-region-name', regionName.toUpperCase());
    _bioRegionalChart.data.labels = data.labels;
    _bioRegionalChart.data.datasets[0].data = data.gap;
    _bioRegionalChart.data.datasets[1].data = data.observadas;
    _bioRegionalChart.update();
}

function _updateBioDecada(data) {
    if (!_bioDecadaChart) return;
    _bioDecadaChart.data.labels = data.labels;
    _bioDecadaChart.data.datasets[0].data = data.values;
    _bioDecadaChart.update();
}

function _updateBioRceIucn(data) {
    if (!_bioRceIucnChart) return;
    _bioRceIucnChart.data.datasets[0].data = [data.rce, data.iucn, data.ambas];
    _bioRceIucnChart.update();
}

// ── Tabla de especies ────────────────────────────────────────────────
function openBioTable() {
    var overlay = document.getElementById('bio-table-overlay');
    if (overlay) overlay.classList.add('show');
    _renderBioTable(_bioTableFilter);
}
function closeBioTable() {
    var overlay = document.getElementById('bio-table-overlay');
    if (overlay) overlay.classList.remove('show');
}

function filterBioTable(cls, btn) {
    _bioTableFilter = _bioTableFilter === cls ? null : cls;
    document.querySelectorAll('.bio-filter-pill').forEach(function(p) { p.classList.remove('active'); });
    if (_bioTableFilter && btn) btn.classList.add('active');
    _renderBioTable(_bioTableFilter);
}

function _renderBioTable(filter) {
    var tbody = document.getElementById('bio-table-body');
    if (!tbody) return;
    var data = filter
        ? _bioFinalList.filter(function(s) { return (s.clase || s.group || '') === filter; })
        : _bioFinalList;
    _setBioEl('bio-table-count', data.length + ' registros' + (filter ? ' · ' + filter : ''));
    var catColor = { CR:'#e74c3c', EN:'#e67e22', VU:'#f1c40f', NT:'#7bed9f', LC:'#4a7c2e' };
    tbody.innerHTML = data.map(function(s) {
        var threat = ['CR','EN','VU'].indexOf(s.rceCategory) >= 0;
        var rce   = s.rceCategory
            ? '<span class="bio-rce-badge ' + s.rceCategory + '">' + s.rceCategory + '</span>'
            : '—';
        var iucn  = s.iucnCategory
            ? '<span class="bio-rce-badge iucn" style="border-color:' + (catColor[s.iucnCategory]||'#9ca3af') + ';color:' + (catColor[s.iucnCategory]||'#9ca3af') + ';">' + s.iucnCategory + '</span>'
            : '—';
        var spe = s.specialProtection
            ? '<span class="bio-special-tag">' + (typeof s.specialProtection === 'object' ? (s.specialProtection.status||'Sí') : s.specialProtection) + '</span>'
            : '—';
        var rie = s.riesgo
            ? '<span style="font-size:10px;color:#e74c3c;">' + s.riesgo + '</span>'
            : '<span style="color:#9ca3af;font-size:10px;">—</span>';
        return '<tr class="' + (threat ? 'threat' : '') + '">' +
            '<td><div class="bio-spp-name">' + (s.officialName||s.scientificName||'') + '</div></td>' +
            '<td><div class="bio-spp-common">' + (s.commonName||'') + '</div></td>' +
            '<td style="font-size:10.5px;color:#6b7280;">' + (s.group||s.clase||'') + '</td>' +
            '<td style="text-align:center;">' + (s.nRegistrosAOI||s.count||'—') + '</td>' +
            '<td>' + rce + '</td><td>' + iucn + '</td><td>' + spe + '</td>' +
            '<td style="font-size:10px;color:#6b7280;">' + (s.piso_vegetacional||'—') + '</td>' +
            '<td>' + rie + '</td>' +
            '<td><button class="bio-dist-btn" onclick="openBioDistModal(this)"><i class="fas fa-map" style="font-size:9px;"></i></button></td>' +
            '</tr>';
    }).join('');
}

function openBioDistModal(btn) {
    // Delegar al iframe si está disponible
    try {
        var iframe = document.getElementById('iframe-biodiversidad');
        if (iframe && iframe.contentWindow && typeof iframe.contentWindow.openDistribucionModal === 'function') {
            // Encontrar la fila y obtener el nombre
            var row = btn.closest('tr');
            var nombre = row ? row.querySelector('.bio-spp-name') : null;
            if (nombre) {
                var spp = _bioFinalList.find(function(s) {
                    return (s.officialName||s.scientificName||'') === nombre.textContent.trim();
                });
                if (spp) iframe.contentWindow.openDistribucionModal(spp);
            }
        }
    } catch(e) { console.warn('openBioDistModal:', e); }
}

function exportBioCSV() {
    try {
        var iframe = document.getElementById('iframe-biodiversidad');
        if (iframe && iframe.contentWindow && typeof iframe.contentWindow.exportCSVToFile === 'function') {
            iframe.contentWindow.exportCSVToFile();
        } else if (iframe && iframe.contentWindow && typeof iframe.contentWindow.exportCSV === 'function') {
            iframe.contentWindow.exportCSV();
        }
    } catch(e) { console.warn('exportBioCSV:', e); }
}

// ── Inicializar charts cuando se activa el tab biodiversidad ─────────
function exportBioEvidenceCSV() {
    try {
        var iframe = document.getElementById('iframe-biodiversidad');
        if (iframe && iframe.contentWindow && typeof iframe.contentWindow.exportEvidenceCSVToFile === 'function') {
            iframe.contentWindow.exportEvidenceCSVToFile();
        }
    } catch(e) { console.warn('exportBioEvidenceCSV:', e); }
}

function toggleBioEvidencePoints() {
    if (typeof map === 'undefined' || typeof L === 'undefined') return;
    if (_bioEvidenceLayer && map.hasLayer(_bioEvidenceLayer)) {
        clearBioEvidencePoints();
        var offBtn = document.getElementById('bio-toggle-evidence-map-btn');
        if (offBtn) offBtn.innerHTML = '<i class="fas fa-location-dot"></i> Mostrar puntos en mapa';
        return;
    }
    renderBioEvidencePoints();
}

function clearBioEvidencePoints() {
    if (typeof map !== 'undefined' && _bioEvidenceLayer) {
        try { map.removeLayer(_bioEvidenceLayer); } catch(e) {}
    }
    _bioEvidenceLayer = null;
    if (_bioEvidenceLegend && _bioEvidenceLegend.parentNode) {
        _bioEvidenceLegend.parentNode.removeChild(_bioEvidenceLegend);
    }
    _bioEvidenceLegend = null;
}

function renderBioEvidencePoints() {
    if (!_bioEvidencePoints.length || typeof map === 'undefined' || typeof L === 'undefined') return;

    var renderer = L.canvas ? L.canvas({ padding: 0.35 }) : null;
    var group = L.layerGroup();

    _bioEvidencePoints.forEach(function(p) {
        if (p.lat == null || p.lon == null) return;
        var color = _bioEvidenceColors[p.kingdom] || '#14b8a6';
        var marker = L.circleMarker([p.lat, p.lon], {
            radius: 4,
            renderer: renderer,
            color: color,
            weight: 1,
            fillColor: color,
            fillOpacity: 0.55,
            opacity: 0.9
        });
        var year = p.year || 'sin anio';
        var uncertainty = p.uncertainty ? '<br>Incertidumbre: ' + Number(p.uncertainty).toLocaleString('es-CL') + ' m' : '';
        var speciesName = p.species || 'Especie sin nombre';
        marker.bindTooltip(_escapeBioHtml(speciesName), {
            direction: 'top',
            sticky: true,
            opacity: 0.92
        });
        marker.bindPopup(
            '<strong><i>' + _escapeBioHtml(speciesName) + '</i></strong>' +
            '<br>Reino: ' + _escapeBioHtml(p.kingdom || '-') +
            '<br>Anio: ' + _escapeBioHtml(year) +
            '<br>Registro: ' + _escapeBioHtml(p.basisOfRecord || '-') +
            uncertainty
        );
        group.addLayer(marker);
    });

    _bioEvidenceLayer = group.addTo(map);
    addBioEvidenceLegend(_bioEvidencePoints);
    var onBtn = document.getElementById('bio-toggle-evidence-map-btn');
    if (onBtn) onBtn.innerHTML = '<i class="fas fa-eye-slash"></i> Ocultar puntos del mapa';
}

function addBioEvidenceLegend(points) {
    var mapContainer = document.getElementById('map');
    if (!mapContainer) return;
    var counts = {};
    (points || []).forEach(function(p) {
        var k = p.kingdom || 'Otro';
        counts[k] = (counts[k] || 0) + 1;
    });
    var rows = Object.keys(counts)
        .sort(function(a, b) { return counts[b] - counts[a]; })
        .map(function(k) {
            var color = _bioEvidenceColors[k] || '#14b8a6';
            return '<div class="bio-map-legend-row">' +
                '<span class="bio-map-legend-dot" style="background:' + color + ';"></span>' +
                '<span>' + _escapeBioHtml(k) + '</span>' +
                '<b>' + Number(counts[k]).toLocaleString('es-CL') + '</b>' +
            '</div>';
        }).join('');
    var legend = document.createElement('div');
    legend.className = 'bio-map-point-legend';
    legend.innerHTML =
        '<strong>Registros GBIF</strong>' +
        '<div class="bio-map-legend-total">' + Number((points || []).length).toLocaleString('es-CL') + ' puntos muestreados</div>' +
        rows;
    mapContainer.appendChild(legend);
    _bioEvidenceLegend = legend;
}

function _escapeBioHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

var _origSwitchTab = switchWorkspaceTab;
switchWorkspaceTab = function(tabId) {
    _origSwitchTab(tabId);
    if (tabId === 'biodiversidad') {
        updateBioZoneBadge();
        setTimeout(initBioCharts, 80);
    }
};
