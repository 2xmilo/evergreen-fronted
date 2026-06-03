/* ==========================================================================
   WORKSPACE HIDROMORFOLOGÍA - Delineación de cuenca desde outlet + métricas
   - Backend: POST /api/hidromorfologia/delinear
   - Solo Pro/Enterprise/Admin (gateado en el handler de click)
   - Flujo:
     1. Usuario click "Cuenca desde outlet" → cursor crosshair + toast guía
     2. Usuario hace click en el mapa → POST al backend
     3. Renderiza tabla de métricas + gráficos + capa de stream network
   ========================================================================== */
(function () {
    'use strict';

    var API_BASE = (typeof API_URL !== 'undefined' && API_URL)
        ? API_URL.replace(/\/$/, '')
        : 'https://evergreen-backend-awv1.onrender.com';

    /* ── Estado interno ────────────────────────────────────── */
    var _waitingOutletClick = false;
    var _lastResult         = null;
    var _streamsLayer       = null;
    var _cauceLayer         = null;
    var _cuencaLayer        = null;
    var _outletMarker       = null;
    var _hipsoChart         = null;
    var _perfilChart        = null;
    var _originalCursor     = '';

    /* ── Helpers ───────────────────────────────────────────── */

    function _authHeaders() {
        var token = (window._supabaseSession && window._supabaseSession.access_token) || '';
        var h = { 'Content-Type': 'application/json' };
        if (token) h['Authorization'] = 'Bearer ' + token;
        return h;
    }

    function _toast(msg) {
        if (typeof mostrarNotificacion === 'function') return mostrarNotificacion(msg);
        console.log('[Hidro]', msg);
    }

    function _userPlan() {
        return window._sbUserPlan || 'free';
    }

    function _isProPlus() {
        var p = _userPlan();
        return p === 'pro' || p === 'enterprise' || p === 'admin';
    }

    function _fmt(n, dec) {
        if (n == null || isNaN(n)) return '—';
        if (dec === undefined) dec = 2;
        return Number(n).toLocaleString('es-CL', { maximumFractionDigits: dec, minimumFractionDigits: dec });
    }

    function _fmtInt(n) {
        if (n == null || isNaN(n)) return '—';
        return Math.round(n).toLocaleString('es-CL');
    }

    function _fmtTime(s) {
        if (s == null || isNaN(s)) return '—';
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = Math.round(s % 60);
        if (h > 0) return h + 'h ' + m + 'm';
        if (m > 0) return m + 'm ' + sec + 's';
        return sec + 's';
    }

    /* ── Inicio del flujo: usuario click "Cuenca desde outlet" ── */

    window.hidroIniciarOutletClick = function () {
        if (!_isProPlus()) {
            _toast('🔒 Función disponible en plan Pro o superior.');
            return;
        }
        if (typeof map === 'undefined' || !map) {
            _toast('Mapa no inicializado.');
            return;
        }
        if (_waitingOutletClick) {
            _cancelarOutletClick();
            return;
        }
        _waitingOutletClick = true;
        _originalCursor = document.getElementById('map').style.cursor;
        document.getElementById('map').style.cursor = 'crosshair';

        var btn = document.getElementById('btn-outlet-cuenca');
        if (btn) btn.classList.add('active');

        _toast('📍 Click en el mapa sobre un curso de agua para marcar el outlet.');
        map.once('click', _onMapClickOutlet);
        // Esc para cancelar
        document.addEventListener('keydown', _onEscape);
    };

    function _onEscape(e) {
        if (e.key === 'Escape' && _waitingOutletClick) _cancelarOutletClick();
    }

    function _cancelarOutletClick() {
        _waitingOutletClick = false;
        document.getElementById('map').style.cursor = _originalCursor || '';
        try { map.off('click', _onMapClickOutlet); } catch (e) {}
        document.removeEventListener('keydown', _onEscape);
        var btn = document.getElementById('btn-outlet-cuenca');
        if (btn) btn.classList.remove('active');
    }

    function _onMapClickOutlet(e) {
        _waitingOutletClick = false;
        document.getElementById('map').style.cursor = _originalCursor || '';
        document.removeEventListener('keydown', _onEscape);
        var btn = document.getElementById('btn-outlet-cuenca');
        if (btn) btn.classList.remove('active');

        var lat = e.latlng.lat;
        var lng = e.latlng.lng;
        _delinear(lat, lng);
    }

    /* ── Llamada al backend + renderizado ──────────────────── */

    function _delinear(lat, lng) {
        // Switch al tab Hidromorfología si no está activo
        if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('hidromorfologia');

        // Limpiar resultado anterior
        _clearMapLayers();

        var header = document.getElementById('hidro-header');
        var body   = document.getElementById('hidro-body');
        var meta   = document.getElementById('hidro-meta-row');
        var loading= document.getElementById('hidro-loading');
        var msg    = document.getElementById('hidro-loading-msg');

        if (header) header.innerHTML = '<i class="fas fa-spinner fa-spin" style="color:var(--accent);margin-right:6px;"></i> Delineando cuenca desde outlet…';
        if (body) body.style.display = 'none';
        if (meta) meta.style.display = 'none';
        if (loading) loading.style.display = 'flex';
        if (msg) msg.textContent = 'Descargando DEM + corriendo PySheds (puede tardar 15-30s)…';

        // Pin temporal en el click
        try {
            if (_outletMarker) map.removeLayer(_outletMarker);
            _outletMarker = L.circleMarker([lat, lng], {
                radius: 6, color: '#FFB300', fillColor: '#FFB300', fillOpacity: 0.8, weight: 2,
            }).addTo(map);
        } catch (e) {}

        // AbortController con timeout de 28s (Render proxy ~30s)
        var controller = new AbortController();
        var timeoutId = setTimeout(function () { controller.abort(); }, 28000);

        // Mensajes progresivos
        var msgTimers = [];
        msgTimers.push(setTimeout(function () { if (msg) msg.textContent = 'Consultando GEE y descargando DEM…'; }, 3000));
        msgTimers.push(setTimeout(function () { if (msg) msg.textContent = 'Calculando red hídrica y cuenca (casi listo)…'; }, 10000));
        msgTimers.push(setTimeout(function () { if (msg) msg.textContent = 'Finalizando métricas morfométricas…'; }, 18000));

        fetch(API_BASE + '/api/hidromorfologia/delinear', {
            method: 'POST',
            headers: _authHeaders(),
            body: JSON.stringify({ lat: lat, lng: lng }),
            signal: controller.signal,
        })
        .then(function (r) {
            return r.json().then(function (j) {
                if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
                return j;
            });
        })
        .then(function (data) {
            _lastResult = data;
            if (loading) loading.style.display = 'none';
            _renderResultado(data);
            _dibujarEnMapa(data);
            if (data.tiempo_proceso_s) console.log('[Hidro] Backend procesó en ' + data.tiempo_proceso_s + 's');
        })
        .catch(function (err) {
            if (loading) loading.style.display = 'none';
            var errMsg = err.name === 'AbortError'
                ? 'Timeout (28s). El servidor tardó demasiado — reintenta.'
                : err.message;
            if (header) header.innerHTML = '<span class="hidro-no-zone"><i class="fas fa-times-circle" style="margin-right:5px;color:#e57373;"></i>Error: ' + errMsg + '</span>';
            console.warn('[Hidro] delinear:', err);
            _toast('❌ ' + errMsg);
            try { if (_outletMarker) map.removeLayer(_outletMarker); } catch (e) {}
        })
        .finally(function () {
            clearTimeout(timeoutId);
            msgTimers.forEach(function (t) { clearTimeout(t); });
        });
    }

    /* ── Render del resultado en el panel ──────────────────── */

    function _renderResultado(data) {
        var m = data.metricas || {};
        var header = document.getElementById('hidro-header');
        if (header) {
            header.innerHTML =
                '<i class="fas fa-bullseye" style="color:var(--accent);font-size:11px;margin-right:6px;"></i>' +
                '<span class="hidro-comuna-name">Cuenca delineada · ' + _fmtInt(m.area_ha) + ' ha</span>';
        }
        var meta = document.getElementById('hidro-meta-row');
        if (meta) {
            meta.style.display = '';
            var tcEl = document.getElementById('hidro-meta-tc');
            if (tcEl && m.tc_kirpich_segundos) {
                tcEl.textContent = 'Tc Kirpich: ' + _fmtTime(m.tc_kirpich_segundos);
            }
        }
        var body = document.getElementById('hidro-body');
        if (body) body.style.display = '';

        // Grupos de métricas
        _renderGrupo('hidro-forma', [
            { label: 'Área',                  val: _fmtInt(m.area_ha),                unit: 'ha' },
            { label: 'Perímetro',             val: _fmt(m.perimetro_km, 2),           unit: 'km' },
            { label: 'Compacidad (Kc Gravelius)', val: _fmt(m.compacidad_kc, 2),     unit: '',  hint: '1 = círculo · >1 = más alargada → respuesta hidrológica más lenta' },
            { label: 'Forma (Kf Horton)',     val: _fmt(m.forma_kf, 2),               unit: '',  hint: 'A/L² · valores bajos = cuenca alargada' },
            { label: 'Circularidad',          val: _fmt(m.circularidad, 2),           unit: '',  hint: '4πA/P² · 1 = círculo' },
            { label: 'Elongación (Schumm)',   val: _fmt(m.elongacion, 2),             unit: '' },
            { label: 'Longitud axial',        val: _fmt(m.longitud_axial_km, 2),      unit: 'km' },
        ]);
        _renderGrupo('hidro-relieve', [
            { label: 'Cota mínima',  val: _fmtInt(m.elev_min_m),   unit: 'm' },
            { label: 'Cota media',   val: _fmtInt(m.elev_media_m), unit: 'm' },
            { label: 'Cota máxima',  val: _fmtInt(m.elev_max_m),   unit: 'm' },
            { label: 'Pendiente media de cuenca', val: _fmt(m.pendiente_media_pct, 2), unit: '%' },
        ]);
        _renderGrupo('hidro-drenaje', [
            { label: 'Longitud cauce principal', val: _fmt(m.longitud_cauce_km, 2),  unit: 'km' },
            { label: 'Pendiente del cauce',      val: _fmt(m.pendiente_cauce_pct, 2), unit: '%' },
            { label: 'Densidad de drenaje',      val: _fmt(m.densidad_drenaje_km_km2, 2), unit: 'km/km²', hint: 'Σ longitud streams / área' },
            { label: 'Long. total streams',      val: _fmt(m.longitud_total_streams_km, 1), unit: 'km' },
        ]);
        _renderGrupo('hidro-tiempos', [
            { label: 'Tc (segundos)', val: _fmtInt(m.tc_kirpich_segundos), unit: 's' },
            { label: 'Tc (minutos)',  val: _fmt(m.tc_kirpich_minutos, 1),   unit: 'min' },
            { label: 'Tc (horas)',    val: _fmt(m.tc_kirpich_horas, 2),     unit: 'h' },
        ]);

        // Gráficos
        _renderHipsometrica(data.hipsometrica || []);
        _renderPerfilCauce(data.perfil_cauce || []);

        // Warning si excede límite
        var warnEl = document.getElementById('hidro-limit-warn');
        var btnUsar = document.getElementById('hidro-btn-usar');
        if (warnEl && btnUsar) {
            if (data.excede_limite) {
                warnEl.style.display = 'flex';
                btnUsar.disabled = true;
                btnUsar.style.opacity = '0.4';
                btnUsar.style.cursor = 'not-allowed';
            } else {
                warnEl.style.display = 'none';
                btnUsar.disabled = false;
                btnUsar.style.opacity = '';
                btnUsar.style.cursor = '';
            }
        }
    }

    function _renderGrupo(containerId, rows) {
        var el = document.getElementById(containerId);
        if (!el) return;
        var html = '';
        rows.forEach(function (r) {
            html += '<div class="hidro-metric" title="' + (r.hint || '') + '">';
            html += '  <div class="hidro-metric-lbl">' + r.label + '</div>';
            html += '  <div class="hidro-metric-val">' + r.val + (r.unit ? ' <span class="hidro-metric-unit">' + r.unit + '</span>' : '') + '</div>';
            html += '</div>';
        });
        el.innerHTML = html;
    }

    function _renderHipsometrica(pts) {
        var canvas = document.getElementById('hidro-chart-hipso');
        if (!canvas || typeof Chart === 'undefined' || !pts.length) return;
        if (_hipsoChart) { _hipsoChart.destroy(); }
        _hipsoChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: pts.map(function (p) { return p.area_pct.toFixed(0); }),
                datasets: [{
                    label: 'Curva hipsométrica',
                    data: pts.map(function (p) { return { x: p.area_pct, y: p.elev_m }; }),
                    borderColor: '#4d8a1f',
                    backgroundColor: 'rgba(106,170,53,0.18)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.2,
                    fill: true,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        type: 'linear', min: 0, max: 100,
                        title: { display: true, text: '% Área acumulada sobre la cota', color: '#6b7280', font: { size: 10 } },
                        ticks: { color: '#9ca3af', font: { size: 10 } },
                        grid: { color: 'rgba(0,0,0,0.04)' },
                    },
                    y: {
                        title: { display: true, text: 'Cota (m)', color: '#6b7280', font: { size: 10 } },
                        ticks: { color: '#9ca3af', font: { size: 10 } },
                        grid: { color: 'rgba(0,0,0,0.04)' },
                    },
                },
            },
        });
    }

    function _renderPerfilCauce(pts) {
        var canvas = document.getElementById('hidro-chart-perfil');
        if (!canvas || typeof Chart === 'undefined' || !pts.length) return;
        if (_perfilChart) { _perfilChart.destroy(); }
        _perfilChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: pts.map(function (p) { return (p.distance_m / 1000).toFixed(2); }),
                datasets: [{
                    label: 'Perfil cauce',
                    data: pts.map(function (p) { return p.elev_m; }),
                    borderColor: '#2c6fb5',
                    backgroundColor: 'rgba(44,111,181,0.18)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.15,
                    fill: true,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        title: { display: true, text: 'Distancia desde nacimiento (km)', color: '#6b7280', font: { size: 10 } },
                        ticks: { color: '#9ca3af', font: { size: 10 }, maxTicksLimit: 8 },
                        grid: { color: 'rgba(0,0,0,0.04)' },
                    },
                    y: {
                        title: { display: true, text: 'Cota (m)', color: '#6b7280', font: { size: 10 } },
                        ticks: { color: '#9ca3af', font: { size: 10 } },
                        grid: { color: 'rgba(0,0,0,0.04)' },
                    },
                },
            },
        });
    }

    /* ── Capas en el mapa ──────────────────────────────────── */

    function _clearMapLayers() {
        try { if (_streamsLayer) map.removeLayer(_streamsLayer); } catch (e) {}
        try { if (_cauceLayer) map.removeLayer(_cauceLayer); } catch (e) {}
        try { if (_cuencaLayer) map.removeLayer(_cuencaLayer); } catch (e) {}
        try { if (_outletMarker) map.removeLayer(_outletMarker); } catch (e) {}
        _streamsLayer = _cauceLayer = _cuencaLayer = _outletMarker = null;
    }

    function _dibujarEnMapa(data) {
        if (typeof map === 'undefined' || typeof L === 'undefined') return;

        // Polígono cuenca (translúcido verde)
        try {
            _cuencaLayer = L.geoJSON(data.cuenca, {
                style: { color: '#6AAA35', weight: 2, fillColor: '#6AAA35', fillOpacity: 0.10, dashArray: '4 3' },
            }).addTo(map);
            map.fitBounds(_cuencaLayer.getBounds(), { padding: [40, 40] });
        } catch (e) { console.warn('[Hidro] cuenca:', e); }

        // Stream network (celeste)
        if (data.streams && data.streams.features && data.streams.features.length) {
            try {
                _streamsLayer = L.geoJSON(data.streams, {
                    style: { color: '#4fc3f7', weight: 1.2, opacity: 0.85 },
                }).addTo(map);
            } catch (e) { console.warn('[Hidro] streams:', e); }
        }

        // Cauce principal (azul fuerte)
        if (data.cauce_principal && data.cauce_principal.coordinates && data.cauce_principal.coordinates.length) {
            try {
                _cauceLayer = L.geoJSON(data.cauce_principal, {
                    style: { color: '#1565c0', weight: 3, opacity: 0.95 },
                }).addTo(map);
            } catch (e) { console.warn('[Hidro] cauce:', e); }
        }

        // Pin del outlet snapped (naranja)
        if (data.outlet_snapped) {
            try {
                _outletMarker = L.circleMarker(
                    [data.outlet_snapped.lat, data.outlet_snapped.lng],
                    { radius: 6, color: '#FF6B35', fillColor: '#FF6B35', fillOpacity: 0.9, weight: 2 }
                ).addTo(map).bindTooltip('Outlet (snapped)', { permanent: false });
            } catch (e) {}
        }
    }

    /* ── Acciones ──────────────────────────────────────────── */

    window.hidroUsarComoZona = function () {
        if (!_lastResult || !_lastResult.cuenca) return;
        if (_lastResult.excede_limite) {
            _toast('La cuenca excede 50.000 ha — no se puede establecer como zona.');
            return;
        }
        var feature = {
            type: 'Feature',
            properties: { source: 'hidromorfologia', tc_segundos: _lastResult.metricas.tc_kirpich_segundos },
            geometry: _lastResult.cuenca,
        };
        // Setear como zona activa (mismo patrón que usarCuencaEnWorkspace)
        try {
            WorkspaceState.zona       = feature;
            WorkspaceState.zonaHa     = _lastResult.metricas.area_ha || 0;
            WorkspaceState.zonaNombre = 'Cuenca delineada';
            WorkspaceState.zonaGEE    = (typeof simplifyZoneForGee === 'function')
                ? simplifyZoneForGee(feature, WorkspaceState.zonaHa)
                : feature;
            if (typeof restoreZoneOnMap === 'function') restoreZoneOnMap();
            if (typeof updateZoneUI === 'function') updateZoneUI();
            if (typeof saveWorkspaceState === 'function') saveWorkspaceState();
            _toast('✅ Cuenca delineada establecida como zona de estudio.');
        } catch (e) {
            console.warn('[Hidro] usar como zona:', e);
            _toast('❌ Error al guardar la zona: ' + e.message);
        }
    };

    window.hidroExportCSV = function () {
        if (!_lastResult || !_lastResult.metricas) return;
        var m = _lastResult.metricas;
        var rows = [['metrica', 'valor', 'unidad']];
        var add = function (lbl, val, unit) { rows.push([lbl, val == null ? '' : val, unit || '']); };
        add('Área',                            m.area_ha,              'ha');
        add('Área',                            m.area_km2,             'km2');
        add('Perímetro',                       m.perimetro_km,         'km');
        add('Compacidad Kc Gravelius',         m.compacidad_kc,        '');
        add('Forma Kf Horton',                 m.forma_kf,             '');
        add('Circularidad',                    m.circularidad,         '');
        add('Elongación Schumm',               m.elongacion,           '');
        add('Longitud axial',                  m.longitud_axial_km,    'km');
        add('Cota mínima',                     m.elev_min_m,           'm');
        add('Cota media',                      m.elev_media_m,         'm');
        add('Cota máxima',                     m.elev_max_m,           'm');
        add('Pendiente media de cuenca',       m.pendiente_media_pct,  '%');
        add('Longitud cauce principal',        m.longitud_cauce_km,    'km');
        add('Pendiente del cauce',             m.pendiente_cauce_pct,  '%');
        add('Densidad de drenaje',             m.densidad_drenaje_km_km2, 'km/km2');
        add('Longitud total de streams',       m.longitud_total_streams_km, 'km');
        add('Tc Kirpich',                      m.tc_kirpich_segundos,  's');
        add('Tc Kirpich',                      m.tc_kirpich_minutos,   'min');
        add('Tc Kirpich',                      m.tc_kirpich_horas,     'h');

        var csv = rows.map(function (r) {
            return r.map(function (c) {
                var s = String(c);
                return /[,\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }).join('\n');

        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href = url; a.download = 'hidromorfologia_metricas.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    /* ── Esconder botón outlet si plan no permite ──────────── */
    function _enforcePlanVisibility() {
        var btn = document.getElementById('btn-outlet-cuenca');
        if (!btn) return;
        btn.style.display = _isProPlus() ? '' : 'none';
    }
    // Hook a load del workspace para reflejar el plan cuando lo carga auth.js
    setTimeout(_enforcePlanVisibility, 1500);
    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(_enforcePlanVisibility, 2500);
    });

}());
