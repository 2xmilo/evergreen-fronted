/* ==========================================================================
   WORKSPACE DMC - Estaciones meteorologicas cercanas
   Modulo aislado: no modifica el flujo GEE de Clima.
   ========================================================================== */

(function() {
    var state = {
        stations: [],
        selectedCode: null
    };

    function $(id) { return document.getElementById(id); }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    }

    function setStatus(message, type) {
        var el = $('dmc-status');
        if (!el) return;
        el.textContent = message;
        el.className = 'dmc-status' + (type ? ' dmc-status--' + type : '');
    }

    function setLoading(isLoading) {
        var btn = $('btn-dmc-search');
        if (!btn) return;
        btn.disabled = isLoading;
        btn.innerHTML = isLoading
            ? '<i class="fas fa-spinner fa-spin"></i> Buscando...'
            : '<i class="fas fa-location-crosshairs"></i> Buscar cerca de mi zona';
    }

    function getZoneCenter() {
        if (!window.WorkspaceState && typeof WorkspaceState === 'undefined') return null;
        var ws = window.WorkspaceState || WorkspaceState;
        var zone = ws && (ws.zonaGEE || ws.zona);
        if (!zone || !zone.geometry) return null;

        try {
            if (typeof turf !== 'undefined' && turf.centroid) {
                var c = turf.centroid(zone).geometry.coordinates;
                return { lon: c[0], lat: c[1] };
            }

            var geom = zone.geometry;
            var ring = geom.type === 'Polygon'
                ? geom.coordinates[0]
                : geom.coordinates[0][0];
            var sum = ring.reduce(function(acc, coord) {
                acc.lon += Number(coord[0]);
                acc.lat += Number(coord[1]);
                return acc;
            }, { lat: 0, lon: 0 });
            return { lat: sum.lat / ring.length, lon: sum.lon / ring.length };
        } catch(e) {
            console.warn('[DMC] centroide:', e);
            return null;
        }
    }

    function backendUrl(path) {
        var base = (typeof API_URL !== 'undefined') ? API_URL : 'https://evergreen-backend-awv1.onrender.com';
        return base.replace(/\/$/, '') + path;
    }

    function fetchDmcJson(path) {
        var headersPromise = (typeof getBackendAuthHeaders === 'function')
            ? getBackendAuthHeaders({ 'Content-Type': 'application/json' })
            : Promise.resolve({ 'Content-Type': 'application/json' });
        return headersPromise.then(function(headers) {
            return fetch(backendUrl(path), { headers: headers });
        }).then(function(response) {
            return response.json().then(function(data) {
                if (!response.ok) {
                    throw new Error(data.error || data.detalle || 'Error consultando DMC');
                }
                return data;
            });
        });
    }

    function renderStations(stations) {
        var list = $('dmc-stations-list');
        var detail = $('dmc-detail');
        if (!list) return;
        if (detail) {
            detail.style.display = 'none';
            detail.innerHTML = '';
        }

        if (!stations || stations.length === 0) {
            list.innerHTML = '';
            setStatus('No se encontraron estaciones cercanas.', 'warn');
            return;
        }

        list.innerHTML = stations.map(function(station) {
            var code = escapeHtml(station.codigoNacional);
            var name = escapeHtml(station.nombreEstacion);
            var dist = Number(station.distance_km || 0).toLocaleString('es-CL', { maximumFractionDigits: 1 });
            var region = escapeHtml(station.region || 'Sin region');
            var altura = station.altura != null ? Math.round(station.altura) + ' m' : 's/i';
            var zona = escapeHtml(station.zonaGeografica || '');
            return '' +
                '<div class="dmc-card" data-code="' + code + '">' +
                    '<div class="dmc-card-main">' +
                        '<div class="dmc-name">' + name + '</div>' +
                        '<div class="dmc-meta">' + dist + ' km - ' + region + ' - ' + altura + (zona ? ' - ' + zona : '') + '</div>' +
                        '<div class="dmc-code">Codigo DMC ' + code + '</div>' +
                    '</div>' +
                    '<div class="dmc-card-actions">' +
                        '<button type="button" class="dmc-small-btn" data-action="summary" data-code="' + code + '">Resumen</button>' +
                        '<button type="button" class="dmc-small-btn" data-action="csv" data-code="' + code + '">CSV 12h</button>' +
                    '</div>' +
                '</div>';
        }).join('');
    }

    function searchNearbyStations() {
        var center = getZoneCenter();
        if (!center) {
            setStatus('Primero define una zona de estudio en el mapa.', 'warn');
            return;
        }

        setLoading(true);
        setStatus('Consultando estaciones DMC cercanas...', 'loading');

        var path = '/api/dmc/estaciones-cercanas?lat=' + encodeURIComponent(center.lat.toFixed(6)) +
            '&lon=' + encodeURIComponent(center.lon.toFixed(6)) + '&limit=5';

        fetchDmcJson(path)
            .then(function(data) {
                state.stations = data.stations || [];
                renderStations(state.stations);
                var cacheLabel = data.cache && data.cache.hit ? 'cache local' : 'DMC';
                setStatus('Se encontraron ' + state.stations.length + ' estaciones cercanas (' + cacheLabel + ').', 'ok');
            })
            .catch(function(error) {
                console.warn('[DMC] estaciones:', error);
                renderStations([]);
                setStatus(error.message || 'No se pudo consultar DMC.', 'error');
            })
            .finally(function() {
                setLoading(false);
            });
    }

    function fmt(value, suffix) {
        if (value == null || value === '') return '-';
        return Number(value).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + (suffix || '');
    }

    function renderSummary(data) {
        var detail = $('dmc-detail');
        if (!detail) return;

        var st = data.station || {};
        var latest = data.latest || {};
        var status = data.status || {};
        var isOld = status.desactualizada || status.fueraDeServicio;

        detail.style.display = 'block';
        detail.innerHTML = '' +
            '<div class="dmc-detail-head">' +
                '<div>' +
                    '<div class="dmc-detail-title">' + escapeHtml(st.nombreEstacion || 'Estacion DMC') + '</div>' +
                    '<div class="dmc-detail-sub">' + escapeHtml(latest.momento || data.fechaCreacion || '') + '</div>' +
                '</div>' +
                '<span class="dmc-pill ' + (isOld ? 'dmc-pill--warn' : 'dmc-pill--ok') + '">' + (isOld ? 'revisar estado' : 'actualizada') + '</span>' +
            '</div>' +
            '<div class="dmc-metrics">' +
                '<div><strong>' + fmt(latest.temperatura_c, ' C') + '</strong><span>Temp.</span></div>' +
                '<div><strong>' + fmt(latest.humedad_relativa_pct, ' %') + '</strong><span>HR</span></div>' +
                '<div><strong>' + fmt(latest.precipitacion_24h_mm, ' mm') + '</strong><span>PP 24h</span></div>' +
                '<div><strong>' + fmt(latest.viento_kt, ' kt') + '</strong><span>Viento</span></div>' +
            '</div>' +
            '<div class="dmc-detail-note">Datos recientes normalizados desde DMC. La descarga CSV usa las ultimas 12 horas disponibles.</div>';
    }

    function loadSummary(code) {
        state.selectedCode = code;
        setStatus('Consultando resumen diario de estacion ' + code + '...', 'loading');
        fetchDmcJson('/api/dmc/estacion/' + encodeURIComponent(code) + '/resumen')
            .then(function(data) {
                renderSummary(data);
                setStatus('Resumen DMC cargado para estacion ' + code + '.', 'ok');
            })
            .catch(function(error) {
                console.warn('[DMC] resumen:', error);
                setStatus(error.message || 'No se pudo cargar el resumen DMC.', 'error');
            });
    }

    function downloadCsv(code) {
        setStatus('Generando CSV DMC de ultimas 12 horas...', 'loading');
        var headersPromise = (typeof getBackendAuthHeaders === 'function')
            ? getBackendAuthHeaders({})
            : Promise.resolve({});

        headersPromise.then(function(headers) {
            return fetch(backendUrl('/api/dmc/estacion/' + encodeURIComponent(code) + '/recientes.csv'), { headers: headers });
        }).then(function(response) {
            if (!response.ok) {
                return response.json().then(function(data) {
                    throw new Error(data.error || data.detalle || 'No se pudo generar CSV DMC');
                });
            }
            return response.blob().then(function(blob) {
                var filename = 'dmc_' + code + '_ultimas_12h.csv';
                var disposition = response.headers.get('Content-Disposition') || '';
                var match = disposition.match(/filename="?([^"]+)"?/i);
                if (match) filename = match[1];
                var url = URL.createObjectURL(blob);
                var link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
                setStatus('CSV DMC descargado para estacion ' + code + '.', 'ok');
            });
        }).catch(function(error) {
            console.warn('[DMC] csv:', error);
            setStatus(error.message || 'No se pudo descargar CSV DMC.', 'error');
        });
    }

    function onListClick(event) {
        var button = event.target.closest('button[data-action]');
        if (!button) return;
        var code = button.getAttribute('data-code');
        var action = button.getAttribute('data-action');
        if (action === 'summary') loadSummary(code);
        if (action === 'csv') downloadCsv(code);
    }

    function init() {
        var btn = $('btn-dmc-search');
        var list = $('dmc-stations-list');
        if (btn) btn.addEventListener('click', searchNearbyStations);
        if (list) list.addEventListener('click', onListClick);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.searchDmcNearbyStations = searchNearbyStations;
})();
