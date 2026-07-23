/* ==========================================================================
   WORKSPACE HIDROMORFOLOGÍA — Delimitación de cuenca + métricas
   Backend: POST /api/hidromorfologia/delinear
   Solo Pro/Enterprise/Admin

   Flujo de 4 pasos:
     1. Configurar umbral de streams
     2. Dibujar rectángulo tentativo en mapa (área de estudio)
     3. Marcar punto outlet dentro del rectángulo
     4. Click "Ejecutar" → POST al backend con rect + outlet + threshold
   ========================================================================== */
(function () {
    'use strict';

    var API_BASE = (typeof API_URL !== 'undefined' && API_URL)
        ? API_URL.replace(/\/$/, '')
        : 'https://evergreen-backend-awv1.onrender.com';

    /* ── Estado interno ────────────────────────────────────── */
    var _lastResult     = null;
    var _streamsLayer   = null;
    var _cauceLayer     = null;
    var _cuencaLayer    = null;
    var _outletMarker   = null;
    var _rectLayer      = null;   // rectángulo tentativo
    var _hipsoChart     = null;
    var _perfilChart    = null;
    var _originalCursor = '';

    // Estado del flujo de 4 pasos
    var _outletLatLng   = null;   // {lat, lng}
    var _rectBounds     = null;   // L.LatLngBounds
    var _waitingRect    = false;
    var _waitingOutlet  = false;
    var _rectStartLL    = null;   // para dibujar arrastrando

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

    function _userPlan() { return window._sbUserPlan || 'free'; }

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

    function _getStreamThreshold() {
        var el = document.getElementById('hidro-stream-thr');
        if (el) return parseInt(el.value, 10) || 50;
        return 50;
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

    function _updateEjecutarBtn() {
        var btn = document.getElementById('hidro-btn-ejecutar');
        if (!btn) return;
        var ready = _rectBounds && _outletLatLng;
        btn.disabled = !ready;
        btn.style.opacity = ready ? '' : '0.4';
        btn.style.cursor = ready ? '' : 'not-allowed';
    }

    /* ── Botón principal: "Delimitar Cuenca" en herramientas ── */

    window.hidroIniciarOutletClick = function () {
        // Gating central: hoy PLAN_GATE.hidromorfologia = 'free' → todos pasan.
        // Para bloquearlo después, cambia esa línea en auth.js y aquí saldrá el modal Pro.
        if (typeof featureDisponible === 'function' && !featureDisponible('hidromorfologia')) {
            if (typeof mostrarModalPro === 'function') mostrarModalPro('La Delimitación de Cuencas');
            else _toast('🔒 Función disponible en plan Pro o superior.');
            return;
        }
        // Cambiar al tab Hidromorfología
        if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('hidromorfologia');
        // Mostrar panel config, ocultar resultado
        var cfg = document.getElementById('hidro-config-panel');
        var body = document.getElementById('hidro-body');
        if (cfg) cfg.style.display = '';
        if (body) body.style.display = 'none';
    };

    /* ── Paso 2: Dibujar rectángulo tentativo ─────────────── */

    window.hidroDibujarRect = function () {
        if (typeof map === 'undefined' || !map) return;
        if (_waitingRect) { _cancelarRect(); return; }
        _waitingRect = true;
        _rectStartLL = null;
        var btn = document.getElementById('hidro-btn-rect');
        if (btn) btn.classList.add('active');
        document.getElementById('map').style.cursor = 'crosshair';
        _toast('Arrastra en el mapa para dibujar el rectángulo del área tentativa.');
        map.dragging.disable();
        map.on('mousedown', _onRectMouseDown);
        document.addEventListener('keydown', _onEscapeRect);
    };

    function _onEscapeRect(e) { if (e.key === 'Escape') _cancelarRect(); }

    function _cancelarRect() {
        _waitingRect = false;
        _rectStartLL = null;
        document.getElementById('map').style.cursor = '';
        var btn = document.getElementById('hidro-btn-rect');
        if (btn) btn.classList.remove('active');
        map.dragging.enable();
        map.off('mousedown', _onRectMouseDown);
        map.off('mousemove', _onRectMouseMove);
        map.off('mouseup', _onRectMouseUp);
        document.removeEventListener('keydown', _onEscapeRect);
    }

    function _onRectMouseDown(e) {
        _rectStartLL = e.latlng;
        if (_rectLayer) { map.removeLayer(_rectLayer); _rectLayer = null; }
        map.on('mousemove', _onRectMouseMove);
        map.on('mouseup', _onRectMouseUp);
    }

    function _onRectMouseMove(e) {
        if (!_rectStartLL) return;
        var bounds = L.latLngBounds(_rectStartLL, e.latlng);
        if (_rectLayer) map.removeLayer(_rectLayer);
        _rectLayer = L.rectangle(bounds, {
            color: '#FF9800', weight: 2, fillOpacity: 0.08, dashArray: '6 4'
        }).addTo(map);
    }

    function _onRectMouseUp(e) {
        if (!_rectStartLL) return;
        _rectBounds = L.latLngBounds(_rectStartLL, e.latlng);
        // Asegurar rectángulo mínimo (~500m)
        var sw = _rectBounds.getSouthWest();
        var ne = _rectBounds.getNorthEast();
        var dlat = Math.abs(ne.lat - sw.lat);
        var dlng = Math.abs(ne.lng - sw.lng);
        if (dlat < 0.005 || dlng < 0.005) {
            _toast('Rectángulo muy pequeño — dibuja un área más grande.');
            _rectBounds = null;
            if (_rectLayer) { map.removeLayer(_rectLayer); _rectLayer = null; }
            _cancelarRect();
            _updateEjecutarBtn();
            return;
        }
        // Dibujar rectángulo final
        if (_rectLayer) map.removeLayer(_rectLayer);
        _rectLayer = L.rectangle(_rectBounds, {
            color: '#FF9800', weight: 2, fillOpacity: 0.06, dashArray: '6 4'
        }).addTo(map);
        // Mostrar info
        var info = document.getElementById('hidro-rect-info');
        var coords = document.getElementById('hidro-rect-coords');
        if (info) info.style.display = 'flex';
        if (coords) {
            var w = (dlng * 111.32 * Math.cos(sw.lat * Math.PI / 180)).toFixed(1);
            var h = (dlat * 111.32).toFixed(1);
            coords.textContent = w + ' × ' + h + ' km';
        }
        _cancelarRect();
        _updateEjecutarBtn();
    }

    window.hidroLimpiarRect = function () {
        _rectBounds = null;
        if (_rectLayer) { map.removeLayer(_rectLayer); _rectLayer = null; }
        var info = document.getElementById('hidro-rect-info');
        if (info) info.style.display = 'none';
        _updateEjecutarBtn();
    };

    /* ── Paso 3: Marcar outlet ────────────────────────────── */

    window.hidroMarcarOutlet = function () {
        if (typeof map === 'undefined' || !map) return;
        if (_waitingOutlet) { _cancelarOutlet(); return; }
        _waitingOutlet = true;
        var btn = document.getElementById('hidro-btn-outlet');
        if (btn) btn.classList.add('active');
        document.getElementById('map').style.cursor = 'crosshair';
        _toast('Click en el mapa sobre un curso de agua para marcar el outlet.');
        map.once('click', _onOutletClick);
        document.addEventListener('keydown', _onEscapeOutlet);
    };

    function _onEscapeOutlet(e) { if (e.key === 'Escape') _cancelarOutlet(); }

    function _cancelarOutlet() {
        _waitingOutlet = false;
        document.getElementById('map').style.cursor = '';
        var btn = document.getElementById('hidro-btn-outlet');
        if (btn) btn.classList.remove('active');
        try { map.off('click', _onOutletClick); } catch (e) {}
        document.removeEventListener('keydown', _onEscapeOutlet);
    }

    // Ícono de triángulo azul para el punto outlet
    function _outletTriIcon() {
        return L.divIcon({
            className: 'hidro-outlet-tri',
            html: '<svg width="18" height="16" viewBox="0 0 18 16" xmlns="http://www.w3.org/2000/svg">' +
                  '<polygon points="9,1.5 16.5,14.5 1.5,14.5" fill="#1565C0" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>',
            iconSize: [18, 16],
            iconAnchor: [9, 10]
        });
    }

    function _onOutletClick(e) {
        _outletLatLng = { lat: e.latlng.lat, lng: e.latlng.lng };
        // Dibujar marker (triángulo azul)
        if (_outletMarker) map.removeLayer(_outletMarker);
        _outletMarker = L.marker([e.latlng.lat, e.latlng.lng], {
            icon: _outletTriIcon()
        }).addTo(map).bindTooltip('Outlet', { permanent: false });
        // Mostrar info
        var info = document.getElementById('hidro-outlet-info');
        var coords = document.getElementById('hidro-outlet-coords');
        if (info) info.style.display = 'flex';
        if (coords) coords.textContent = e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);
        _cancelarOutlet();
        _updateEjecutarBtn();
    }

    window.hidroLimpiarOutlet = function () {
        _outletLatLng = null;
        if (_outletMarker) { map.removeLayer(_outletMarker); _outletMarker = null; }
        var info = document.getElementById('hidro-outlet-info');
        if (info) info.style.display = 'none';
        _updateEjecutarBtn();
    };

    /* ── Paso 4: Ejecutar análisis ────────────────────────── */

    window.hidroEjecutar = function () {
        if (!_rectBounds || !_outletLatLng) {
            _toast('Dibuja el rectángulo y marca el outlet primero.');
            return;
        }
        _delinear(_outletLatLng.lat, _outletLatLng.lng);
    };

    /* ── Llamada al backend + renderizado ──────────────────── */

    function _delinear(lat, lng) {
        _clearResultLayers();

        var cfg     = document.getElementById('hidro-config-panel');
        var header  = document.getElementById('hidro-header');
        var body    = document.getElementById('hidro-body');
        var loading = document.getElementById('hidro-loading');
        var msg     = document.getElementById('hidro-loading-msg');

        if (cfg)     cfg.style.display = 'none';
        if (header)  header.innerHTML = '<i class="fas fa-spinner fa-spin" style="color:var(--accent);margin-right:6px;"></i> <span style="color:var(--text);">Delimitando cuenca…</span>';
        if (body)    body.style.display = 'none';
        if (loading) loading.style.display = 'flex';
        if (msg)     msg.textContent = 'Descargando DEM…';

        // Construir bbox desde el rectángulo dibujado
        var sw = _rectBounds.getSouthWest();
        var ne = _rectBounds.getNorthEast();
        var bbox = [sw.lng, sw.lat, ne.lng, ne.lat]; // [W, S, E, N]

        // AbortController con timeout de 90s
        var controller = new AbortController();
        var timeoutId = setTimeout(function () { controller.abort(); }, 90000);

        // Mensajes progresivos
        var msgTimers = [];
        msgTimers.push(setTimeout(function () { if (msg) msg.textContent = 'Procesando hidrología D8…'; }, 5000));
        msgTimers.push(setTimeout(function () { if (msg) msg.textContent = 'Calculando red hídrica…'; }, 15000));
        msgTimers.push(setTimeout(function () { if (msg) msg.textContent = 'Extrayendo métricas…'; }, 25000));

        fetch(API_BASE + '/api/hidromorfologia/delinear', {
            method: 'POST',
            headers: _authHeaders(),
            body: JSON.stringify({
                lat: lat,
                lng: lng,
                stream_threshold: _getStreamThreshold(),
                bbox: bbox
            }),
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
            // Quitar rectángulo tentativo
            if (_rectLayer) { map.removeLayer(_rectLayer); _rectLayer = null; }
            if (data.tiempo_proceso_s) console.log('[Hidro] Backend procesó en ' + data.tiempo_proceso_s + 's');
        })
        .catch(function (err) {
            if (loading) loading.style.display = 'none';
            if (cfg) cfg.style.display = '';
            var errMsg = err.name === 'AbortError'
                ? 'Timeout — el servidor tardó demasiado. Dibuja un rectángulo más pequeño.'
                : err.message;
            if (header) header.innerHTML = '<span class="hidro-no-zone"><i class="fas fa-times-circle" style="margin-right:5px;color:#e57373;"></i>Error: ' + errMsg + '</span>';
            _toast('❌ ' + errMsg);
        })
        .finally(function () {
            clearTimeout(timeoutId);
            msgTimers.forEach(function (t) { clearTimeout(t); });
        });
    }

    /* ── Render del resultado ──────────────────────────────── */

    function _renderResultado(data) {
        var m = data.metricas || {};
        var header = document.getElementById('hidro-header');
        if (header) {
            header.innerHTML =
                '<i class="fas fa-water" style="color:var(--accent);font-size:12px;margin-right:6px;"></i>' +
                '<span class="hidro-comuna-name">Cuenca delimitada · ' + _fmtInt(m.area_ha) + ' ha</span>';
        }

        // Meta: resolución + Tc
        var demEl = document.getElementById('hidro-meta-dem');
        var tcEl = document.getElementById('hidro-meta-tc');
        if (demEl) demEl.textContent = 'DEM: Copernicus GLO-30 · ' + (data.resolucion_m || 30) + ' m';
        if (tcEl) tcEl.textContent = m.tc_kirpich_segundos ? 'Tc: ' + _fmtTime(m.tc_kirpich_segundos) : '';

        var body = document.getElementById('hidro-body');
        if (body) body.style.display = '';

        // Tabla compacta de métricas
        _renderTabla(m);

        // Gráficos
        _renderHipsometrica(data.hipsometrica || []);
        _renderPerfilCauce(data.perfil_cauce || []);

        // Warning
        var warnEl = document.getElementById('hidro-limit-warn');
        var btnUsar = document.getElementById('hidro-btn-usar');
        if (warnEl && btnUsar) {
            if (data.excede_limite) {
                warnEl.style.display = 'flex';
                btnUsar.disabled = true; btnUsar.style.opacity = '0.4';
            } else {
                warnEl.style.display = 'none';
                btnUsar.disabled = false; btnUsar.style.opacity = '';
            }
        }
    }

    function _renderTabla(m) {
        var tbody = document.querySelector('#hidro-table tbody');
        if (!tbody) return;
        var rows = '';
        function section(title) {
            rows += '<tr class="hidro-table-sep"><td colspan="3" style="height:4px;"></td></tr>';
            rows += '<tr><th colspan="3">' + title + '</th></tr>';
        }
        function row(label, val, unit) {
            rows += '<tr><td>' + label + '</td><td>' + val + '</td><td>' + (unit || '') + '</td></tr>';
        }

        section('Forma');
        row('Área', _fmtInt(m.area_ha), 'ha');
        row('Perímetro', _fmt(m.perimetro_km, 2), 'km');
        row('Kc Gravelius', _fmt(m.compacidad_kc, 2), '');
        row('Kf Horton', _fmt(m.forma_kf, 2), '');
        row('Circularidad', _fmt(m.circularidad, 2), '');
        row('Elongación', _fmt(m.elongacion, 2), '');

        section('Relieve');
        row('Cota mínima', _fmtInt(m.elev_min_m), 'm');
        row('Cota media', _fmtInt(m.elev_media_m), 'm');
        row('Cota máxima', _fmtInt(m.elev_max_m), 'm');

        section('Drenaje');
        row('Cauce principal', _fmt(m.longitud_cauce_km, 2), 'km');
        row('Pendiente cauce', _fmt(m.pendiente_cauce_pct, 2), '%');
        row('Densidad drenaje', _fmt(m.densidad_drenaje_km_km2, 2), 'km/km²');
        row('Total streams', _fmt(m.longitud_total_streams_km, 1), 'km');

        section('Tiempo de concentración');
        row('Tc Kirpich', _fmtInt(m.tc_kirpich_segundos), 's');
        row('Tc Kirpich', _fmt(m.tc_kirpich_minutos, 1), 'min');
        row('Tc Kirpich', _fmt(m.tc_kirpich_horas, 2), 'h');

        tbody.innerHTML = rows;
    }

    function _renderHipsometrica(pts) {
        var canvas = document.getElementById('hidro-chart-hipso');
        if (!canvas || typeof Chart === 'undefined' || !pts.length) return;
        if (_hipsoChart) _hipsoChart.destroy();
        _hipsoChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: pts.map(function (p) { return p.area_pct.toFixed(0); }),
                datasets: [{
                    data: pts.map(function (p) { return { x: p.area_pct, y: p.elev_m }; }),
                    borderColor: '#4d8a1f', backgroundColor: 'rgba(106,170,53,0.18)',
                    borderWidth: 2, pointRadius: 0, tension: 0.2, fill: true,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { type: 'linear', min: 0, max: 100,
                         title: { display: true, text: '% Área acumulada', color: '#6b7280', font: { size: 10 } },
                         ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
                    y: { title: { display: true, text: 'Cota (m)', color: '#6b7280', font: { size: 10 } },
                         ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
                },
            },
        });
    }

    function _renderPerfilCauce(pts) {
        var canvas = document.getElementById('hidro-chart-perfil');
        if (!canvas || typeof Chart === 'undefined' || !pts.length) return;
        if (_perfilChart) _perfilChart.destroy();
        _perfilChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: pts.map(function (p) { return (p.distance_m / 1000).toFixed(2); }),
                datasets: [{
                    data: pts.map(function (p) { return p.elev_m; }),
                    borderColor: '#2c6fb5', backgroundColor: 'rgba(44,111,181,0.18)',
                    borderWidth: 2, pointRadius: 0, tension: 0.15, fill: true,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { title: { display: true, text: 'Distancia (km)', color: '#6b7280', font: { size: 10 } },
                         ticks: { color: '#9ca3af', font: { size: 9 }, maxTicksLimit: 8 }, grid: { color: 'rgba(0,0,0,0.04)' } },
                    y: { title: { display: true, text: 'Cota (m)', color: '#6b7280', font: { size: 10 } },
                         ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
                },
            },
        });
    }

    /* ── Capas en el mapa ──────────────────────────────────── */

    function _clearResultLayers() {
        try { if (_streamsLayer) map.removeLayer(_streamsLayer); } catch (e) {}
        try { if (_cauceLayer) map.removeLayer(_cauceLayer); } catch (e) {}
        try { if (_cuencaLayer) map.removeLayer(_cuencaLayer); } catch (e) {}
        _streamsLayer = _cauceLayer = _cuencaLayer = null;
    }

    function _clearMapLayers() {
        _clearResultLayers();
        try { if (_outletMarker) map.removeLayer(_outletMarker); } catch (e) {}
        try { if (_rectLayer) map.removeLayer(_rectLayer); } catch (e) {}
        _outletMarker = _rectLayer = null;
    }

    function _dibujarEnMapa(data) {
        if (typeof map === 'undefined' || typeof L === 'undefined') return;

        // Polígono cuenca
        try {
            _cuencaLayer = L.geoJSON(data.cuenca, {
                style: { color: '#E53935', weight: 2.5, fillColor: '#E53935', fillOpacity: 0.06 },
            }).addTo(map);
            map.fitBounds(_cuencaLayer.getBounds(), { padding: [40, 40] });
        } catch (e) { console.warn('[Hidro] cuenca:', e); }

        // Streams
        if (data.streams && data.streams.features && data.streams.features.length) {
            try {
                _streamsLayer = L.geoJSON(data.streams, {
                    style: { color: '#29b6f6', weight: 2.5, opacity: 0.95 },
                }).addTo(map);
            } catch (e) { console.warn('[Hidro] streams:', e); }
        }

        // Cauce principal
        if (data.cauce_principal && data.cauce_principal.coordinates && data.cauce_principal.coordinates.length) {
            try {
                _cauceLayer = L.geoJSON(data.cauce_principal, {
                    style: { color: '#0d47a1', weight: 4, opacity: 1.0 },
                }).addTo(map);
            } catch (e) { console.warn('[Hidro] cauce:', e); }
        }

        // Outlet: mantener marcador donde el usuario clickeó (no moverlo al snap).
        // El snap se usa internamente para el cálculo pero el UX no debe saltar.
        // Solo agregar un punto pequeño gris si el snap se movió significativamente.
        if (data.outlet_snapped && data.outlet_input) {
            try {
                var dlat = Math.abs(data.outlet_snapped.lat - data.outlet_input.lat);
                var dlng = Math.abs(data.outlet_snapped.lng - data.outlet_input.lng);
                if (dlat > 0.0003 || dlng > 0.0003) {
                    // Snap se movió >~30m — mostrar punto gris pequeño
                    L.circleMarker(
                        [data.outlet_snapped.lat, data.outlet_snapped.lng],
                        { radius: 4, color: '#888', fillColor: '#888', fillOpacity: 0.6, weight: 1 }
                    ).addTo(map).bindTooltip('Punto hidrológico (auto-ajustado)', { permanent: false });
                }
            } catch (e) {}
        }
    }

    /* ── Acciones ──────────────────────────────────────────── */

    // Modal de elección (solo pro/enterprise/admin con zona activa): reemplazar vs. nuevo sitio
    function _zonaChoiceModal(opts) {
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px;';
        var card = document.createElement('div');
        card.style.cssText = 'max-width:380px;width:100%;background:#12261a;border:1px solid rgba(106,170,53,.3);border-radius:14px;padding:22px;font-family:Inter,system-ui,sans-serif;color:#f4f7f1;box-shadow:0 20px 50px rgba(0,0,0,.5);';
        card.innerHTML =
            '<div style="font-size:16px;font-weight:600;margin-bottom:8px;">Usar cuenca como zona de estudio</div>' +
            '<div style="font-size:13px;line-height:1.55;color:rgba(244,247,241,.7);margin-bottom:18px;">' + (opts.msg || '') + '</div>';
        function mkBtn(txt, css, cb) {
            var b = document.createElement('button');
            b.textContent = txt; b.style.cssText = css + 'width:100%;font-family:inherit;cursor:pointer;';
            b.onclick = function () { close(); cb && cb(); };
            return b;
        }
        function close() { try { document.body.removeChild(ov); } catch (e) {} }
        card.appendChild(mkBtn('Agregar como nuevo sitio de estudio',
            'padding:11px;border-radius:9px;border:none;background:#6aaa35;color:#0b160c;font-size:13px;font-weight:600;margin-bottom:8px;', opts.onNew));
        card.appendChild(mkBtn('Reemplazar zona actual',
            'padding:11px;border-radius:9px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#f4f7f1;font-size:13px;font-weight:500;margin-bottom:8px;', opts.onReplace));
        card.appendChild(mkBtn('Cancelar',
            'padding:8px;border-radius:9px;border:none;background:transparent;color:rgba(244,247,241,.5);font-size:12px;', null));
        ov.onclick = function (e) { if (e.target === ov) close(); };
        ov.appendChild(card); document.body.appendChild(ov);
    }

    // ¿La cuota de zonas está llena? (muestra modal de límite y devuelve true)
    function _cuotaLlena(plan) {
        if (!window._sbUserId) return false;
        var LIMITS = { free: 1, pro: 3, enterprise: 10, admin: Infinity };
        var maxZones = LIMITS[plan] !== undefined ? LIMITS[plan] : 1;
        if (maxZones === Infinity) return false;
        var zones = (typeof getValidStoredZones === 'function')
            ? getValidStoredZones(window._sbUserZones)
            : (window._sbUserZones || []).filter(function (z) { return z && z.polygon_geojson; });
        if (zones.length >= maxZones) {
            if (typeof mostrarModalLimite === 'function') {
                mostrarModalLimite({ ok: false, reason: 'LIMIT_REACHED', plan: plan, used: zones.length, max: maxZones });
            }
            return true;
        }
        return false;
    }

    /* ── Persistir streams como capa complementaria en Supabase ──────────────
       La cuenca (polígono) se usa como zona de estudio; los streams NO forman
       parte de la zona, pero se guardan ligados al MISMO workspace en la tabla
       `results` con tipo_indice='hidromorfologia_streams'. Así:
         · quedan complementarios (FK ON DELETE CASCADE: al borrar la zona se
           borran los streams);
         · se pueden cargar por separado más tarde en el Comparador.
       No se meten en WorkspaceState.resultados para no ensuciar el mini-panel
       (ver filtro en auth.js/loadCloudWorkspace y workspace-core/renderMonitorPanel). */
    function _guardarStreamsCloud(zoneName) {
        if (!_lastResult) return;
        var fc = _lastResult.streams;
        if (!fc || !fc.features || !fc.features.length) return;          // sin streams → nada que guardar
        if (!window._sbUserId || typeof saveResultsToCloud !== 'function') return;

        var payload = {
            name:            'streams ' + (zoneName || 'Cuenca'),
            ts:              Date.now(),
            streams:         fc,
            cauce_principal: _lastResult.cauce_principal || null,
            threshold:       _getStreamThreshold(),
            resolucion_m:    _lastResult.resolucion_m || 30
        };

        // El workspace puede estar recién insertándose (zonaId se asigna async).
        // Reintentar hasta que exista zonaId. El delay inicial deja asentar el
        // INSERT/UPDATE del workspace y, en el flujo "reemplazar", el borrado
        // previo de results (para que el DELETE no se lleve estos streams).
        // OJO: la tabla `results` tiene CHECK (jsonb_typeof(result_data)='array'),
        // así que se guarda envuelto en un array de un elemento.
        var tries = 0;
        function attempt() {
            if (WorkspaceState && WorkspaceState.zonaId) {
                try { saveResultsToCloud(window._sbUserId, 'hidromorfologia_streams', [payload]); } catch (e) {}
            } else if (tries++ < 25) {
                setTimeout(attempt, 300);
            }
        }
        setTimeout(attempt, 700);
    }

    window.hidroUsarComoZona = function () {
        if (!_lastResult || !_lastResult.cuenca) return;
        if (_lastResult.excede_limite) {
            _toast('La cuenca excede 50.000 ha — no se puede establecer como zona.');
            return;
        }
        var feature = {
            type: 'Feature',
            properties: { source: 'hidromorfologia' },
            geometry: _lastResult.cuenca,
        };
        var ha     = (_lastResult.metricas && _lastResult.metricas.area_ha) || 0;
        var nombre = 'Cuenca delimitada';
        var plan   = window._sbUserPlan || 'free';
        var hasZona = !!(WorkspaceState.zona && WorkspaceState.zonaId);

        // Escribe la cuenca en el estado + mapa. Ya se limpió el estado antes.
        function _setZona() {
            try {
                WorkspaceState.zona       = feature;
                WorkspaceState.zonaHa     = ha;
                WorkspaceState.zonaNombre = nombre;
                WorkspaceState.zonaGEE    = (typeof simplifyZoneForGee === 'function')
                    ? simplifyZoneForGee(feature, ha) : feature;
                try { _clearResultLayers(); } catch (e) {}   // quitar cuenca/streams del módulo hidro
                if (typeof restoreZoneOnMap === 'function') restoreZoneOnMap();
                if (typeof agregarPoligonoDesdeWorkspace === 'function') agregarPoligonoDesdeWorkspace(feature, nombre, ha);
                if (typeof updateZoneUI === 'function') updateZoneUI();
                if (typeof saveWorkspaceState === 'function') saveWorkspaceState();
                _guardarStreamsCloud(nombre);   // guarda los streams como capa complementaria (para el Comparador)
                if (typeof enviarZonaABiodiversidad === 'function') enviarZonaABiodiversidad();
                _toast('✅ Cuenca establecida como zona de estudio.');
                if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('resumen');
            } catch (e) { _toast('❌ Error: ' + e.message); }
        }

        // Reemplazar la zona actual: limpia análisis local + results en Supabase (mismo workspace id)
        function _reemplazar() {
            var replacedId = WorkspaceState.zonaId;
            if (typeof clearAnalysisStateForZoneChange === 'function') {
                var had = clearAnalysisStateForZoneChange();
                if (had && window._sbUserId && replacedId && typeof clearResultsForWorkspace === 'function') {
                    clearResultsForWorkspace(window._sbUserId, replacedId);
                }
            }
            _setZona();   // mantiene zonaId → UPDATE del workspace actual
        }

        // Agregar como NUEVO sitio: conserva la zona anterior (nuevo workspace id → INSERT)
        function _agregarNueva() {
            if (typeof clearAnalysisStateForZoneChange === 'function') clearAnalysisStateForZoneChange();
            WorkspaceState.zonaId = null;   // fuerza INSERT de un workspace nuevo
            _setZona();
        }

        // ── Sin zona activa → primera zona (verificar cuota) ──
        if (!hasZona) {
            if (_cuotaLlena(plan)) return;
            _agregarNueva();
            return;
        }

        // ── Free (máx 1 zona) → obligar a reemplazar la anterior ──
        if (plan === 'free') {
            if (confirm('Ya tienes una zona de estudio activa.\n\nTu plan gratuito permite 1 zona, así que al usar esta cuenca se REEMPLAZARÁ tu zona actual y se borrarán sus análisis.\n\n¿Continuar?')) {
                _reemplazar();
            }
            return;
        }

        // ── Pro/Enterprise/Admin → elegir reemplazar o agregar como nuevo sitio ──
        _zonaChoiceModal({
            msg: 'Ya tienes una zona activa. Puedes <b>agregar</b> esta cuenca como un nuevo sitio de estudio (conservando la actual) o <b>reemplazar</b> tu zona actual.',
            onNew: function () { if (!_cuotaLlena(plan)) _agregarNueva(); },
            onReplace: _reemplazar,
        });
    };

    window.hidroExportCSV = function () {
        if (!_lastResult || !_lastResult.metricas) return;
        var m = _lastResult.metricas;
        var rows = [['metrica', 'valor', 'unidad']];
        var add = function (lbl, val, u) { rows.push([lbl, val == null ? '' : val, u || '']); };
        add('Área', m.area_ha, 'ha');
        add('Perímetro', m.perimetro_km, 'km');
        add('Kc Gravelius', m.compacidad_kc, '');
        add('Kf Horton', m.forma_kf, '');
        add('Circularidad', m.circularidad, '');
        add('Elongación', m.elongacion, '');
        add('Cota mínima', m.elev_min_m, 'm');
        add('Cota media', m.elev_media_m, 'm');
        add('Cota máxima', m.elev_max_m, 'm');
        add('Cauce principal', m.longitud_cauce_km, 'km');
        add('Pendiente cauce', m.pendiente_cauce_pct, '%');
        add('Densidad drenaje', m.densidad_drenaje_km_km2, 'km/km2');
        add('Total streams', m.longitud_total_streams_km, 'km');
        add('Tc Kirpich (s)', m.tc_kirpich_segundos, 's');
        add('Tc Kirpich (min)', m.tc_kirpich_minutos, 'min');
        add('Tc Kirpich (h)', m.tc_kirpich_horas, 'h');
        var csv = rows.map(function (r) {
            return r.map(function (c) {
                var s = String(c);
                return /[,\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'hidromorfologia_metricas.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    /* ── Plan visibility ──────────────────────────────────── */
    // El botón se muestra por defecto (visible en HTML).
    // Solo lo ocultamos cuando SABEMOS que es free (no cuando el plan no se ha cargado).
    function _enforcePlanVisibility() {
        var btn = document.getElementById('btn-outlet-cuenca');
        if (!btn) return;
        var tag = btn.querySelector('.draw-btn-tag');
        // Controlado por la config central (PLAN_GATE.hidromorfologia). Hoy 'free' → visible para todos.
        // El chip "PRO" solo se muestra si el feature está bloqueado; el click abre el modal.
        var disponible = (typeof featureDisponible === 'function') ? featureDisponible('hidromorfologia') : true;
        btn.style.display = '';
        if (tag) tag.style.display = disponible ? 'none' : '';
    }
    // Ejecutar después de que se haya cargado el plan
    window.addEventListener('planChanged', _enforcePlanVisibility);
    // También verificar periódicamente los primeros 5 segundos
    setTimeout(_enforcePlanVisibility, 2000);
    setTimeout(_enforcePlanVisibility, 5000);

})();
