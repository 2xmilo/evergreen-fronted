/* ==========================================================================
   WORKSPACE DMC - Estaciones meteorologicas cercanas
   Modulo aislado: no modifica el flujo GEE de Clima.
   ========================================================================== */

(function() {
    var state = {
        stations: [],
        selectedCode: null
    };

    var _markerLayer = null;

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

    function postDmcJson(path, body) {
        var headersPromise = (typeof getBackendAuthHeaders === 'function')
            ? getBackendAuthHeaders({ 'Content-Type': 'application/json' })
            : Promise.resolve({ 'Content-Type': 'application/json' });
        return headersPromise.then(function(headers) {
            return fetch(backendUrl(path), {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body)
            });
        }).then(function(response) {
            return response.json().then(function(data) {
                if (!response.ok) {
                    throw new Error(data.error || data.detalle || 'Error AI');
                }
                return data;
            });
        });
    }

    /* ── Marcadores en el mapa ── */

    function _clearMarkers() {
        if (_markerLayer && typeof map !== 'undefined') {
            try { map.removeLayer(_markerLayer); } catch(e) {}
        }
        _markerLayer = null;
    }

    function _renderStationMarkers(stations) {
        _clearMarkers();
        if (!stations || !stations.length) return;
        if (typeof map === 'undefined' || typeof L === 'undefined') return;

        var markers = [];
        stations.forEach(function(st) {
            var lat = Number(st.latitud);
            var lon = Number(st.longitud);
            if (!lat || !lon) return;

            var dist = st.distance_km != null
                ? Number(st.distance_km).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' km'
                : '';
            var altura = st.altura != null ? Math.round(st.altura) + ' msnm' : '';
            var code = st.codigoNacional;

            var m = L.circleMarker([lat, lon], {
                radius: 5,
                color: '#4fc3f7',
                fillColor: '#4fc3f7',
                fillOpacity: 0.9,
                weight: 2
            });

            m.bindTooltip(escapeHtml(st.nombreEstacion), {
                permanent: true,
                direction: 'top',
                offset: [0, -8],
                className: 'dmc-map-label',
                opacity: 1
            });

            var fichaUrl = 'https://climatologia.meteochile.gob.cl/application/informacion/fichaDeEstacion/' + code;
            m.bindPopup(
                '<div class="dmc-map-popup">' +
                  '<div class="dmc-popup-header">' +
                    '<span class="dmc-popup-name">' + escapeHtml(st.nombreEstacion) + '</span>' +
                    '<a class="dmc-popup-code" href="' + fichaUrl + '" target="_blank" title="Ver ficha DMC">' +
                      '<i class="fas fa-external-link-alt"></i> ' + escapeHtml(String(code)) +
                    '</a>' +
                  '</div>' +
                  '<div class="dmc-popup-meta">' +
                    [escapeHtml(st.region || ''), dist, altura, escapeHtml(st.zonaGeografica || '')].filter(Boolean).join(' &middot; ') +
                  '</div>' +
                  '<div class="dmc-popup-divider"></div>' +
                  '<div class="dmc-popup-actions">' +
                    '<button class="dmc-popup-btn" onclick="dmcDownloadCsv(\'' + code + '\')"><i class="fas fa-clock"></i> 12h</button>' +
                    '<button class="dmc-popup-btn" onclick="dmcDownloadHistorico(\'' + code + '\',\'24h\')"><i class="fas fa-history"></i> 24h</button>' +
                    '<button class="dmc-popup-btn" onclick="dmcDownloadHistorico(\'' + code + '\',\'7dias\')"><i class="fas fa-calendar-week"></i> 7 días</button>' +
                    '<button class="dmc-popup-btn" onclick="dmcDownloadHistorico(\'' + code + '\',\'mensual\')"><i class="fas fa-calendar-alt"></i> Mes</button>' +
                    '<button class="dmc-popup-btn dmc-popup-btn--wide" onclick="dmcLoadSummary(\'' + code + '\')"><i class="fas fa-chart-bar"></i> Ver en panel</button>' +
                  '</div>' +
                '</div>',
                { className: 'dmc-station-popup', maxWidth: 260 }
            );

            markers.push(m);
        });

        if (markers.length) {
            _markerLayer = L.layerGroup(markers).addTo(map);
        }
    }

    /* ── Lista de estaciones en el panel ── */

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
            var region = escapeHtml(station.region || '');
            var altura = station.altura != null ? Math.round(station.altura) + ' m' : '';
            var zona = escapeHtml(station.zonaGeografica || '');
            var meta = [dist + ' km', region, altura, zona].filter(Boolean).join(' · ');

            return '' +
                '<div class="dmc-card" data-code="' + code + '">' +
                    '<div class="dmc-card-main">' +
                        '<div class="dmc-name">' + name + '</div>' +
                        '<div class="dmc-meta">' + meta + '</div>' +
                    '</div>' +
                    '<button type="button" class="dmc-small-btn dmc-small-btn--go" data-action="summary" data-code="' + code + '" title="Ver detalle">' +
                        '<i class="fas fa-chevron-right"></i>' +
                    '</button>' +
                '</div>';
        }).join('');
    }

    /* ── Variables disponibles + dispara análisis IA ── */

    function _loadVariablesInto(containerId, code, stationName) {
        fetchDmcJson('/api/dmc/estacion/' + encodeURIComponent(code) + '/variables')
            .then(function(data) {
                var el = $(containerId);
                if (!el) return;
                var vars = data.variables || [];
                if (!vars.length) {
                    el.innerHTML = '<span class="dmc-var-chip dmc-var-chip--none">Sin info</span>';
                    return;
                }
                el.innerHTML = vars.map(function(v) {
                    return '<span class="dmc-var-chip" title="' + escapeHtml(v.unidad || '') + '">' +
                        escapeHtml(v.nombreCorto || v.nombre) + '</span>';
                }).join('');

                // Disparar análisis IA con las variables detectadas
                var varNames = vars.map(function(v) { return v.nombreCorto || v.nombre; });
                _loadCalcSugerencias(code, stationName || code, varNames);
            })
            .catch(function() {
                var el = $(containerId);
                if (el) el.innerHTML = '<span class="dmc-var-chip dmc-var-chip--none">No disponible</span>';
            });
    }

    /* ── Análisis IA: sugerencias de cálculos ── */

    var _CALCULO_IDS = {
        'priestley_taylor': 'priestley',
        'penman_monteith':  'penman',
        'vpd':              'vpd',
        'evap_penman':      'penman',   // pendiente
        'gdd':              null        // pendiente
    };

    function _loadCalcSugerencias(code, nombre, varNames) {
        var container = $('dmc-calc-' + code);
        if (!container) return;
        container.innerHTML = '<div class="dmc-ai-loading"><i class="fas fa-spinner fa-spin"></i> Analizando variables...</div>';

        postDmcJson('/api/ai/analizar-estacion', {
            codigo: code,
            nombre: nombre,
            variables: varNames
        }).then(function(data) {
            _renderCalcSugerencias(container, data.sugerencias || [], code, varNames, nombre);
        }).catch(function(err) {
            console.warn('[DMC AI]', err);
            container.innerHTML = '<span class="dmc-ai-error">No se pudo cargar el análisis.</span>';
        });
    }

    function _renderCalcSugerencias(container, sugerencias, code, varNames, nombre) {
        var disponibles = sugerencias.filter(function(s) { return s.disponible; });
        if (!disponibles.length) {
            container.innerHTML = '<span class="dmc-ai-error">Sin cálculos disponibles para esta estación.</span>';
            return;
        }

        var html = '';
        disponibles.forEach(function(s) {
            var calcId = _CALCULO_IDS[s.id] || null;
            var isPremium = (s.id === 'evap_penman' || s.id === 'gdd');
            var btnHtml = '';
            if (isPremium) {
                btnHtml = '<span class="dmc-calc-premium">Premium</span>';
            } else if (calcId) {
                btnHtml = '<button class="dmc-calc-dl-btn" onclick="dmcDownloadCalculo(\'' + code + '\',\'' + calcId + '\')">' +
                          '<i class="fas fa-download"></i> Mes completo con ET calculada</button>';
            }
            html += '<div class="dmc-calc-card' + (s.recomendado ? ' dmc-calc-card--rec' : '') + '">' +
                '<div class="dmc-calc-head">' +
                    '<span class="dmc-calc-name">' + escapeHtml(s.nombre) + '</span>' +
                    (s.recomendado ? '<span class="dmc-calc-badge-rec">Recomendado</span>' : '') +
                '</div>' +
                '<div class="dmc-calc-razon">' + escapeHtml(s.razon || '') + '</div>' +
                btnHtml +
            '</div>';
        });

        // Chat input
        html += '<div class="dmc-ai-chat">' +
            '<input class="dmc-ai-input" id="dmc-chat-input-' + code + '" type="text" ' +
            'placeholder="Pregunta sobre esta estación..." ' +
            'onkeydown="if(event.key===\'Enter\')dmcChatPregunta(\'' + code + '\',\'' + escapeHtml(nombre) + '\')" />' +
            '<button class="dmc-ai-send" onclick="dmcChatPregunta(\'' + code + '\',\'' + escapeHtml(nombre) + '\')">' +
            '<i class="fas fa-paper-plane"></i></button>' +
        '</div>' +
        '<div class="dmc-ai-chat-resp" id="dmc-chat-resp-' + code + '"></div>';

        container.innerHTML = html;
        // Guardar variables para el chat
        container._varNames = varNames;
        container._nombre   = nombre;
    }

    /* ── Buscar estaciones ── */

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
                _renderStationMarkers(state.stations);
                var cacheLabel = data.cache && data.cache.hit ? 'cache local' : 'DMC';
                setStatus('Se encontraron ' + state.stations.length + ' estaciones cercanas (' + cacheLabel + ').', 'ok');
            })
            .catch(function(error) {
                console.warn('[DMC] estaciones:', error);
                renderStations([]);
                _clearMarkers();
                setStatus(error.message || 'No se pudo consultar DMC.', 'error');
            })
            .finally(function() {
                setLoading(false);
            });
    }

    /* ── Formato de valores ── */

    function fmt(value, suffix) {
        if (value == null || value === '') return '-';
        return Number(value).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + (suffix || '');
    }

    /* ── Detalle de estación con downloads + variables ── */

    function renderSummary(data) {
        var detail = $('dmc-detail');
        if (!detail) return;

        var st = data.station || {};
        var latest = data.latest || {};
        var status = data.status || {};
        var isOld = status.desactualizada || status.fueraDeServicio;
        var code = st.codigoNacional || state.selectedCode || '';
        var varsId = 'dmc-vars-' + code;
        var fichaUrl = 'https://climatologia.meteochile.gob.cl/application/informacion/fichaDeEstacion/' + escapeHtml(String(code));

        detail.style.display = 'block';
        detail.innerHTML =
            /* Header */
            '<div class="dmc-detail-head">' +
                '<div style="min-width:0;">' +
                    '<div class="dmc-detail-title">' + escapeHtml(st.nombreEstacion || 'Estacion DMC') + '</div>' +
                    '<div class="dmc-detail-sub">' + escapeHtml(latest.momento || data.fechaCreacion || '') + '</div>' +
                '</div>' +
                '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">' +
                    '<span class="dmc-pill ' + (isOld ? 'dmc-pill--warn' : 'dmc-pill--ok') + '">' +
                        (isOld ? 'revisar' : 'activa') +
                    '</span>' +
                    '<a href="' + fichaUrl + '" target="_blank" class="dmc-ficha-link" title="Ver ficha DMC">' +
                        '<i class="fas fa-external-link-alt"></i> ' + escapeHtml(String(code)) +
                    '</a>' +
                '</div>' +
            '</div>' +

            /* Métricas recientes */
            '<div class="dmc-metrics">' +
                '<div><strong>' + fmt(latest.temperatura_c, '°') + '</strong><span>Temp.</span></div>' +
                '<div><strong>' + fmt(latest.humedad_relativa_pct, '%') + '</strong><span>HR</span></div>' +
                '<div><strong>' + fmt(latest.precipitacion_24h_mm, 'mm') + '</strong><span>PP 24h</span></div>' +
                '<div><strong>' + fmt(latest.viento_kt, 'kt') + '</strong><span>Viento</span></div>' +
            '</div>' +

            /* Variables disponibles */
            '<div class="dmc-section-row">' +
                '<span class="dmc-section-label">Variables</span>' +
                '<div class="dmc-vars-row" id="' + varsId + '">' +
                    '<span class="dmc-var-chip dmc-var-chip--none"><i class="fas fa-spinner fa-spin"></i></span>' +
                '</div>' +
            '</div>' +

            /* Descargas */
            '<div class="dmc-section-label" style="padding:8px 12px 4px;">Descargar</div>' +
            '<div class="dmc-dl-grid">' +
                '<button class="dmc-dl-btn" onclick="dmcDownloadCsv(\'' + code + '\')">' +
                    '<i class="fas fa-clock"></i>' +
                    '<span>12 horas</span>' +
                    '<small>EMA reciente</small>' +
                '</button>' +
                '<button class="dmc-dl-btn" onclick="dmcDownloadHistorico(\'' + code + '\',\'24h\')">' +
                    '<i class="fas fa-history"></i>' +
                    '<span>24 horas</span>' +
                    '<small>15 min · mes actual</small>' +
                '</button>' +
                '<button class="dmc-dl-btn" onclick="dmcDownloadHistorico(\'' + code + '\',\'7dias\')">' +
                    '<i class="fas fa-calendar-week"></i>' +
                    '<span>7 días</span>' +
                    '<small>15 min · mes actual</small>' +
                '</button>' +
                '<button class="dmc-dl-btn" onclick="dmcDownloadHistorico(\'' + code + '\',\'mensual\')">' +
                    '<i class="fas fa-calendar-alt"></i>' +
                    '<span>Mes completo</span>' +
                    '<small>15 min · ~2800 filas</small>' +
                '</button>' +
            '</div>' +

            /* Sección IA — se rellena async tras cargar variables */
            '<div class="dmc-ai-section">' +
                '<div class="dmc-ai-header">' +
                    '<i class="fas fa-wand-magic-sparkles"></i> Cálculos disponibles' +
                '</div>' +
                '<div class="dmc-ai-body" id="dmc-calc-' + code + '">' +
                    '<div class="dmc-ai-loading"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>' +
                '</div>' +
            '</div>';

        /* Cargar variables de forma asíncrona → dispara análisis IA */
        _loadVariablesInto(varsId, code, st.nombreEstacion || code);
    }

    /* ── Cargar resumen de estación ── */

    function loadSummary(code) {
        state.selectedCode = code;
        setStatus('Consultando resumen de estacion ' + code + '...', 'loading');
        fetchDmcJson('/api/dmc/estacion/' + encodeURIComponent(code) + '/resumen')
            .then(function(data) {
                renderSummary(data);
                setStatus('Estacion ' + code + ' cargada.', 'ok');
            })
            .catch(function(error) {
                console.warn('[DMC] resumen:', error);
                setStatus(error.message || 'No se pudo cargar el resumen DMC.', 'error');
            });
    }

    /* ── Descargas CSV ── */

    function _downloadBlob(url, defaultFilename) {
        var headersPromise = (typeof getBackendAuthHeaders === 'function')
            ? getBackendAuthHeaders({})
            : Promise.resolve({});

        return headersPromise.then(function(headers) {
            return fetch(backendUrl(url), { headers: headers });
        }).then(function(response) {
            if (!response.ok) {
                return response.json().then(function(data) {
                    throw new Error(data.error || data.detalle || 'Error al generar CSV');
                });
            }
            return response.blob().then(function(blob) {
                var filename = defaultFilename;
                var disposition = response.headers.get('Content-Disposition') || '';
                var match = disposition.match(/filename="?([^"]+)"?/i);
                if (match) filename = match[1];
                var url2 = URL.createObjectURL(blob);
                var link = document.createElement('a');
                link.href = url2;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url2);
            });
        });
    }

    function downloadCsv(code) {
        setStatus('Generando CSV 12h...', 'loading');
        _downloadBlob(
            '/api/dmc/estacion/' + encodeURIComponent(code) + '/recientes.csv',
            'dmc_' + code + '_12h.csv'
        ).then(function() {
            setStatus('CSV 12h descargado para estacion ' + code + '.', 'ok');
        }).catch(function(error) {
            console.warn('[DMC] csv 12h:', error);
            setStatus(error.message || 'No se pudo descargar CSV.', 'error');
        });
    }

    function downloadHistorico(code, periodo) {
        var labels = { '24h': '24 horas', '7dias': '7 dias', 'mensual': 'mes completo' };
        var label = labels[periodo] || periodo;
        setStatus('Generando CSV ' + label + '...', 'loading');
        _downloadBlob(
            '/api/dmc/estacion/' + encodeURIComponent(code) + '/historico.csv?periodo=' + periodo,
            'dmc_' + code + '_' + periodo + '.csv'
        ).then(function() {
            setStatus('CSV ' + label + ' descargado para estacion ' + code + '.', 'ok');
        }).catch(function(error) {
            console.warn('[DMC] historico csv (' + periodo + '):', error);
            setStatus(error.message || 'No se pudo descargar CSV.', 'error');
        });
    }

    /* ── Descarga con cálculo derivado ── */

    function downloadCalculo(code, calculo) {
        var labels = { priestley: 'ET Priestley-Taylor', penman: 'ET Penman-Monteith', vpd: 'VPD' };
        var label = labels[calculo] || calculo;
        setStatus('Generando CSV con ' + label + '...', 'loading');
        _downloadBlob(
            '/api/dmc/estacion/' + encodeURIComponent(code) + '/historico.csv?periodo=mensual&calculo=' + calculo,
            'dmc_' + code + '_mensual_' + calculo + '.csv'
        ).then(function() {
            setStatus('CSV con ' + label + ' descargado para estación ' + code + '.', 'ok');
        }).catch(function(error) {
            console.warn('[DMC calc]', error);
            setStatus(error.message || 'No se pudo descargar.', 'error');
        });
    }

    /* ── Chat IA ── */

    function chatPregunta(code, nombre) {
        var input = $('dmc-chat-input-' + code);
        var resp  = $('dmc-chat-resp-' + code);
        if (!input || !resp) return;
        var pregunta = input.value.trim();
        if (!pregunta) return;

        var container = $('dmc-calc-' + code);
        var varNames  = (container && container._varNames) || [];

        input.disabled = true;
        resp.innerHTML = '<span class="dmc-chat-thinking"><i class="fas fa-spinner fa-spin"></i> Pensando...</span>';

        postDmcJson('/api/ai/chat-estacion', {
            codigo: code,
            nombre: nombre,
            variables: varNames,
            pregunta: pregunta
        }).then(function(data) {
            resp.innerHTML = '<span class="dmc-chat-answer">' + escapeHtml(data.respuesta || '') + '</span>';
            input.value = '';
        }).catch(function() {
            resp.innerHTML = '<span class="dmc-ai-error">Error al consultar el asistente.</span>';
        }).finally(function() {
            input.disabled = false;
            input.focus();
        });
    }

    /* ── Event listeners ── */

    function onListClick(event) {
        var button = event.target.closest('button[data-action]');
        if (!button) return;
        var code = button.getAttribute('data-code');
        var action = button.getAttribute('data-action');
        if (action === 'summary') loadSummary(code);
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

    window.searchDmcNearbyStations  = searchNearbyStations;
    window.dmcLoadSummary           = loadSummary;
    window.dmcDownloadCsv           = downloadCsv;
    window.dmcDownloadHistorico     = downloadHistorico;
    window.dmcDownloadCalculo       = downloadCalculo;
    window.dmcChatPregunta          = chatPregunta;
    window.dmcClearMarkers          = _clearMarkers;
})();
