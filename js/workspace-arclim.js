/* ==========================================================================
   WORKSPACE ARCLIM - Riesgos Climáticos Proyectados
   Fuente: ARClim · MMA / CR2 · UC  (arclim.mma.gob.cl)
   Módulo aislado. No modifica otros tabs ni el iframe de biodiversidad.
   ========================================================================== */

(function () {
    'use strict';

    /* Proxy Flask — evita CORS y el GeoJSON inestable de ARClim */
    var API_BASE = (typeof BACKEND_URL !== 'undefined' && BACKEND_URL)
        ? BACKEND_URL.replace(/\/$/, '')
        : 'https://precipitacion-backend.onrender.com';

    /* ── Catálogo de indicadores ────────────────────────────────────── */
    var INDICADORES = [
        { id: 'hot_days',             tipo: 'calor',  icono: 'fa-sun',              label: 'Días calurosos',             unit: 'días/año',    desc: 'Días cuya temperatura máxima supera el umbral histórico de calor' },
        { id: 'summer_days',          tipo: 'calor',  icono: 'fa-thermometer-full', label: 'Días de verano',             unit: 'días/año',    desc: 'Días con temperatura máxima sobre 25 °C' },
        { id: 'tropical_nights',      tipo: 'calor',  icono: 'fa-moon',             label: 'Noches tropicales',          unit: 'noches/año',  desc: 'Noches con temperatura mínima sobre 20 °C' },
        { id: 'warm_days',            tipo: 'calor',  icono: 'fa-circle',           label: 'Días cálidos',               unit: 'días/año',    desc: 'Días con Tmax sobre el percentil 75 del período de referencia' },
        { id: 'warm_nights',          tipo: 'calor',  icono: 'fa-adjust',           label: 'Noches cálidas',             unit: 'noches/año',  desc: 'Noches con Tmin sobre el percentil 75 del período de referencia' },
        { id: 'frost_days',           tipo: 'frio',   icono: 'fa-snowflake',        label: 'Días de helada',             unit: 'días/año',    desc: 'Días con temperatura mínima bajo 0 °C' },
        { id: 'cool_days',            tipo: 'frio',   icono: 'fa-wind',             label: 'Días frescos',               unit: 'días/año',    desc: 'Días con Tmax bajo el percentil 25 del período de referencia' },
        { id: 'cool_nights',          tipo: 'frio',   icono: 'fa-icicles',          label: 'Noches frescas',             unit: 'noches/año',  desc: 'Noches con Tmin bajo el percentil 25 del período de referencia' },
        { id: 'consecutive_dry_days', tipo: 'sequia', icono: 'fa-tint-slash',       label: 'Días secos consecutivos',    unit: 'días',        desc: 'Número máximo de días consecutivos sin precipitación' },
        { id: 'consecutive_wet_days', tipo: 'lluvia', icono: 'fa-cloud-rain',       label: 'Días húmedos consecutivos',  unit: 'días',        desc: 'Número máximo de días consecutivos con precipitación' },
    ];

    var GRUPOS = {
        calor:  'Temperatura — Calor',
        frio:   'Temperatura — Frío',
        sequia: 'Precipitación — Sequía',
        lluvia: 'Precipitación — Lluvia',
    };

    /* Paletas 5-color por tipo (cuantiles) */
    var PALETAS = {
        calor:  ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'],
        frio:   ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
        sequia: ['#ffffd4', '#fed98e', '#fe8d25', '#cc4c02', '#8c2d04'],
        lluvia: ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'],
    };

    /* ── Cache ──────────────────────────────────────────────────────── */
    var _geoCache        = {};    // indId+'_'+scenario → FeatureCollection (con geometrías)
    var _tabCache        = {};    // 'tab_'+indId+'_'+scenario → {arclim_id → valor}
    var _comunasListCache = null; // [{arclim_id, nombre}]

    /* ── Estado del mapa ────────────────────────────────────────────── */
    var _choroplethLayer = null;
    var _activeIndId     = null;

    /* ================================================================
       FETCH HELPERS
       ================================================================ */

    /**
     * GeoJSON con polígonos de comunas + valor del indicador.
     * Se usa para: (1) detección de comuna, (2) choropleth en mapa.
     * Pesado (~1.2 MB). Se cachea después del primer fetch.
     */
    function _fetchGeoJSON(indId, scenario) {
        var key = indId + '_' + scenario;
        if (_geoCache[key]) return Promise.resolve(_geoCache[key]);

        var url = API_BASE + '/api/arclim/geojson?id=' + indId + '&scenario=' + scenario;

        return fetch(url, { headers: _authHeaders() })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (json) {
                /* El proxy retorna el FeatureCollection dentro de json.data */
                var fc = json.data || json;
                _geoCache[key] = fc;
                return fc;
            });
    }

    /**
     * JSON tabular (sin geometrías). Mucho más liviano (~15 KB).
     * Se usa para los valores del panel de indicadores.
     * Devuelve {arclim_id → valor_numérico}.
     */
    function _fetchTabular(indId, scenario) {
        var key = 'tab_' + indId + '_' + scenario;
        if (_tabCache[key]) return Promise.resolve(_tabCache[key]);

        var url = API_BASE + '/api/arclim/indicador?id=' + indId + '&scenario=' + scenario;

        return fetch(url, { headers: _authHeaders() })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (json) {
                /* El proxy retorna {ok, data: {arclim_id: valor}} */
                var result = json.data || {};
                _tabCache[key] = result;
                return result;
            });
    }

    /* Helper: headers de autenticación Supabase (igual que workspace-dmc.js) */
    function _authHeaders() {
        var token = (window._supabaseSession && window._supabaseSession.access_token) || '';
        return token ? { 'Authorization': 'Bearer ' + token } : {};
    }

    /**
     * Carga present + future para todos los indicadores de UNA comuna.
     * 20 requests paralelos, cada uno ~15 KB.
     */
    function _fetchAllForComuna(arclimId) {
        var id      = String(arclimId);
        var results = {};

        var promises = INDICADORES.map(function (ind) {
            return Promise.all([
                _fetchTabular(ind.id, 'present'),
                _fetchTabular(ind.id, 'future')
            ]).then(function (data) {
                results[ind.id + '_present'] = data[0][id] !== undefined ? data[0][id] : null;
                results[ind.id + '_future']  = data[1][id] !== undefined ? data[1][id] : null;
            }).catch(function () {
                results[ind.id + '_present'] = null;
                results[ind.id + '_future']  = null;
            });
        });

        return Promise.all(promises).then(function () { return results; });
    }

    /* ================================================================
       DETECCIÓN DE COMUNA
       Estrategia: Nominatim (OpenStreetMap) → nombre de comuna
       Luego empareja contra lista de comunas ARClim via Flask proxy.
       Sin dependencia del GeoJSON de ARClim (que es inestable).
       ================================================================ */

    /* Normaliza texto: mayúsculas, sin tildes, sin caracteres extra */
    function _normalizar(str) {
        return String(str || '')
            .toUpperCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^A-Z0-9 ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /* Reverse geocoding con Nominatim (CORS-libre, sin auth) */
    function _nominatimComuna(lat, lon) {
        var url = 'https://nominatim.openstreetmap.org/reverse?lat=' + lat +
                  '&lon=' + lon + '&format=json&accept-language=es&zoom=8';
        return fetch(url, { headers: { 'User-Agent': 'Evergreen/1.0' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var addr = data.address || {};
                /* Nominatim usa campos distintos según el nivel admin */
                return addr.city || addr.town || addr.village ||
                       addr.county || addr.municipality || '';
            });
    }

    /* Lista de comunas ARClim via proxy Flask */
    function _fetchComunasList() {
        if (_comunasListCache) return Promise.resolve(_comunasListCache);
        var url = API_BASE + '/api/arclim/comunas';
        return fetch(url, { headers: _authHeaders() })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (json) {
                _comunasListCache = json.comunas || [];
                return _comunasListCache;
            });
    }

    function _detectComuna() {
        var ws   = window.WorkspaceState;
        var zona = ws && (ws.zonaGEE || ws.zona);
        if (!zona || typeof turf === 'undefined') return Promise.resolve(null);

        var centroid;
        try { centroid = turf.centroid(zona); }
        catch (e) { return Promise.resolve(null); }

        var lon = centroid.geometry.coordinates[0];
        var lat = centroid.geometry.coordinates[1];

        return Promise.all([
            _nominatimComuna(lat, lon),
            _fetchComunasList()
        ]).then(function (results) {
            var nombreNom  = _normalizar(results[0]);
            var listaComunas = results[1];

            if (!nombreNom || !listaComunas.length) return null;

            /* Búsqueda exacta primero */
            var match = listaComunas.find(function (c) {
                return _normalizar(c.nombre) === nombreNom;
            });

            /* Fallback: la lista contiene el nombre buscado o viceversa */
            if (!match) {
                match = listaComunas.find(function (c) {
                    var norm = _normalizar(c.nombre);
                    return norm.indexOf(nombreNom) !== -1 || nombreNom.indexOf(norm) !== -1;
                });
            }

            return match || null;
        });
    }

    /* ================================================================
       CHOROPLETH EN MAPA
       ================================================================ */

    function _quantileBreaks(fc, prop, n) {
        var vals = fc.features
            .map(function (f) { return f.properties[prop]; })
            .filter(function (v) { return v !== null && !isNaN(v); })
            .sort(function (a, b) { return a - b; });
        if (!vals.length) return [];
        var breaks = [];
        for (var i = 0; i <= n; i++) {
            breaks.push(vals[Math.floor(i * (vals.length - 1) / n)]);
        }
        return breaks;
    }

    function _getColor(val, breaks, palette) {
        if (val === null || isNaN(val)) return 'rgba(120,120,120,0.2)';
        for (var i = breaks.length - 2; i >= 0; i--) {
            if (val >= breaks[i]) return palette[Math.min(i, palette.length - 1)];
        }
        return palette[0];
    }

    function _removeChoropleth() {
        if (_choroplethLayer && typeof map !== 'undefined') {
            try { map.removeLayer(_choroplethLayer); } catch (e) {}
        }
        _choroplethLayer = null;
        _activeIndId     = null;
        document.querySelectorAll('.arclim-ind-card').forEach(function (c) {
            c.classList.remove('arclim-card-active');
        });
        var leg = document.getElementById('arclim-legend');
        if (leg) leg.style.display = 'none';
    }

    function _loadChoropleth(indId) {
        var cfg = INDICADORES.find(function (i) { return i.id === indId; });
        if (!cfg) return;

        _removeChoropleth();

        var prop    = '$CLIMA$' + indId + '$annual$present';
        var palette = PALETAS[cfg.tipo] || PALETAS.calor;

        /* Mostrar spinner en el botón */
        var btn = document.querySelector('#arclim-card-' + indId + ' .arclim-map-btn');
        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        _fetchGeoJSON(indId, 'present').then(function (fc) {
            var breaks = _quantileBreaks(fc, prop, palette.length);

            _choroplethLayer = L.geoJSON(fc, {
                style: function (feature) {
                    return {
                        fillColor: _getColor(feature.properties[prop], breaks, palette),
                        weight:       0.5,
                        color:        'rgba(255,255,255,0.2)',
                        fillOpacity:  0.72,
                    };
                },
                onEachFeature: function (feature, layer) {
                    var val = feature.properties[prop];
                    var nom = (feature.properties['NOM_COMUNA'] || '');
                    var nomFmt = nom.charAt(0) + nom.slice(1).toLowerCase();
                    layer.bindTooltip(
                        '<div style="font-family:Inter,sans-serif;font-size:11px;">' +
                        '<strong>' + nomFmt + '</strong><br>' +
                        cfg.label + ': <b>' +
                        (val !== null ? Number(val).toFixed(1) + ' ' + cfg.unit : 'Sin datos') +
                        '</b></div>',
                        { sticky: true, opacity: 0.95 }
                    );
                    layer.on({
                        mouseover: function (e) { e.target.setStyle({ weight: 1.5, fillOpacity: 0.9 }); },
                        mouseout:  function (e) { if (_choroplethLayer) _choroplethLayer.resetStyle(e.target); },
                    });
                }
            });

            if (typeof map !== 'undefined') {
                _choroplethLayer.addTo(map);
                _choroplethLayer.bringToBack();
            }

            _activeIndId = indId;

            /* Highlight card */
            document.querySelectorAll('.arclim-ind-card').forEach(function (c) {
                c.classList.remove('arclim-card-active');
            });
            var card = document.getElementById('arclim-card-' + indId);
            if (card) card.classList.add('arclim-card-active');

            /* Restaurar ícono del botón */
            if (btn) btn.innerHTML = '<i class="fas fa-map"></i>';

            _renderLegend(cfg, breaks, palette);

        }).catch(function (e) {
            console.warn('[ARClim] Error cargando choropleth:', e);
            if (btn) btn.innerHTML = '<i class="fas fa-map"></i>';
        });
    }

    function _renderLegend(cfg, breaks, palette) {
        var el = document.getElementById('arclim-legend');
        if (!el) return;
        var html = '<button class="arclim-legend-close" onclick="arclimRemoveChoropleth()" title="Cerrar capa"><i class="fas fa-times"></i></button>';
        html += '<div class="arclim-legend-title">' + cfg.label + '</div>';
        html += '<div class="arclim-legend-period">Presente (1980 – 2010)</div>';
        html += '<div class="arclim-legend-items">';
        for (var i = 0; i < palette.length; i++) {
            var from = breaks[i]   !== undefined ? Number(breaks[i]).toFixed(0)   : '';
            var to   = breaks[i+1] !== undefined ? Number(breaks[i+1]).toFixed(0) : '';
            html += '<div class="arclim-legend-item">';
            html += '<span class="arclim-legend-swatch" style="background:' + palette[i] + ';"></span>';
            html += '<span class="arclim-legend-label">' + from + ' – ' + to + ' ' + cfg.unit + '</span>';
            html += '</div>';
        }
        html += '</div>';
        el.innerHTML = html;
        el.style.display = 'block';
    }

    /* ================================================================
       PANEL — RENDER
       ================================================================ */

    function _renderPanel(arclimId, indData) {
        var body = document.getElementById('arclim-indicators-body');
        if (!body) return;

        var html      = '';
        var lastTipo  = null;

        INDICADORES.forEach(function (ind) {
            /* Encabezado de grupo */
            if (ind.tipo !== lastTipo) {
                html += '<div class="arclim-group-label">' + GRUPOS[ind.tipo] + '</div>';
                lastTipo = ind.tipo;
            }

            var vP = indData[ind.id + '_present'];
            var vF = indData[ind.id + '_future'];

            var delta      = null;
            var arrowClass = 'neutral';
            var arrow      = '→';

            if (vP !== null && vP !== 0 && vF !== null) {
                delta = (vF - vP) / Math.abs(vP) * 100;
                if (Math.abs(delta) > 3) {
                    arrowClass = delta > 0 ? 'up' : 'down';
                    arrow      = delta > 0 ? '↑' : '↓';
                }
            }

            html += '<div class="arclim-ind-card" id="arclim-card-' + ind.id + '">';
            html += '  <div class="arclim-ind-head">';
            html += '    <i class="fas ' + ind.icono + ' arclim-ind-icon"></i>';
            html += '    <span class="arclim-ind-label">' + ind.label + '</span>';
            html += '    <button class="arclim-map-btn" onclick="event.stopPropagation(); arclimShowOnMap(\'' + ind.id + '\')" title="Ver distribución en mapa">';
            html += '      <i class="fas fa-map"></i>';
            html += '    </button>';
            html += '  </div>';
            html += '  <div class="arclim-ind-desc">' + ind.desc + '</div>';
            html += '  <div class="arclim-ind-values">';
            html += '    <div class="arclim-val-block">';
            html += '      <span class="arclim-val-num">' + (vP !== null ? Number(vP).toFixed(1) : '—') + '</span>';
            html += '      <span class="arclim-val-lbl">Presente</span>';
            html += '    </div>';
            html += '    <div class="arclim-arrow ' + arrowClass + '">' + arrow + '</div>';
            html += '    <div class="arclim-val-block arclim-val-block--future">';
            html += '      <span class="arclim-val-num">' + (vF !== null ? Number(vF).toFixed(1) : '—') + '</span>';
            html += '      <span class="arclim-val-lbl">~2050</span>';
            html += '    </div>';
            if (delta !== null) {
                html += '    <div class="arclim-delta ' + arrowClass + '">' + (delta > 0 ? '+' : '') + delta.toFixed(0) + '%</div>';
            }
            html += '  </div>';
            html += '  <div class="arclim-ind-unit">' + ind.unit + '</div>';
            html += '</div>';
        });

        body.innerHTML = html;
    }

    /* ================================================================
       CARGA DEL TAB
       ================================================================ */

    function _setHeader(html) {
        var el = document.getElementById('arclim-comuna-header');
        if (el) el.innerHTML = html;
    }

    function _setLoading(on) {
        var el = document.getElementById('arclim-loading');
        if (el) el.style.display = on ? 'flex' : 'none';
    }

    function _loadTab() {
        var ws   = window.WorkspaceState;
        var zona = ws && (ws.zonaGEE || ws.zona);
        var body = document.getElementById('arclim-indicators-body');

        if (!zona) {
            _setHeader('<span class="arclim-no-zone"><i class="fas fa-draw-polygon" style="margin-right:5px;opacity:.45;"></i>Define una zona de estudio primero.</span>');
            if (body) body.innerHTML = '';
            return;
        }

        _setLoading(true);
        if (body) body.innerHTML = '';
        _setHeader('<i class="fas fa-spinner fa-spin" style="color:var(--accent);margin-right:6px;font-size:10px;"></i><span style="color:var(--muted2);font-size:11px;">Detectando comuna…</span>');

        _detectComuna()
            .then(function (comuna) {
                if (!comuna) {
                    _setHeader('<span class="arclim-no-zone"><i class="fas fa-exclamation-triangle" style="margin-right:5px;color:#f5a623;"></i>Zona fuera de cobertura ARClim (solo Chile).</span>');
                    _setLoading(false);
                    return;
                }

                /* _detectComuna retorna {arclim_id, nombre} */
                var nom      = String(comuna.nombre || '');
                var nomFmt   = nom.charAt(0) + nom.slice(1).toLowerCase();
                var arclimId = String(comuna.arclim_id);

                _setHeader(
                    '<i class="fas fa-map-marker-alt" style="color:var(--accent);font-size:11px;"></i>' +
                    '<span class="arclim-comuna-name">' + nomFmt + '</span>' +
                    '<a href="https://arclim.mma.gob.cl" target="_blank" class="arclim-source-badge">MMA · ARClim</a>'
                );

                return _fetchAllForComuna(arclimId).then(function (indData) {
                    _renderPanel(arclimId, indData);
                });
            })
            .catch(function (e) {
                _setHeader('<span class="arclim-no-zone"><i class="fas fa-times-circle" style="margin-right:5px;color:#e57373;"></i>Error al cargar datos ARClim.</span>');
                console.warn('[ARClim]', e);
            })
            .then(function () {
                _setLoading(false);
            });
    }

    /* ================================================================
       API PÚBLICA
       ================================================================ */

    window.arclimLoadTab = _loadTab;

    window.arclimShowOnMap = function (indId) {
        if (_activeIndId === indId) {
            /* Toggle: si ya está activa, la quitamos */
            _removeChoropleth();
        } else {
            _loadChoropleth(indId);
        }
    };

    window.arclimRemoveChoropleth = function () {
        _removeChoropleth();
    };

    /* ================================================================
       ENGANCHE AL CAMBIO DE ZONA
       ================================================================ */

    var _hookAttempts = 0;
    var _hookTimer    = setInterval(function () {
        if (typeof updateZoneUI === 'function') {
            var _orig = updateZoneUI;
            updateZoneUI = function () {
                _orig.apply(this, arguments);
                /* Limpiar choropleth al cambiar zona */
                _removeChoropleth();
                /* Recargar panel si el tab está activo */
                var tabContent = document.getElementById('tab-riesgos-content');
                if (tabContent && tabContent.classList.contains('active')) {
                    _loadTab();
                }
            };
            clearInterval(_hookTimer);
        }
        if (++_hookAttempts > 100) clearInterval(_hookTimer);
    }, 100);

}());
