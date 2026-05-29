/* ==========================================================================
   WORKSPACE SIMBIO - Capas externas SIMBIO/MMA en mapa principal
   Módulo aislado. No modifica el iframe de biodiversidad.
   ========================================================================== */

(function () {
    'use strict';

    var SIMBIO_BASE = 'https://arcgis.mma.gob.cl/server/rest/services/SIMBIO';

    var CAPAS_SIMBIO = [
        { key: 'ap_areas',      grupo: 'Protección',   label: 'Áreas Protegidas',          service: 'SIMBIO_AP',             idx: 0, color: '#00a600', labelField: 'NombreOriginal', tipo: 'polygon' },
        { key: 'ap_otras',      grupo: 'Protección',   label: 'Otras Designaciones',        service: 'SIMBIO_AP',             idx: 1, color: '#c48a5a', labelField: 'NombreOriginal', tipo: 'polygon' },
        { key: 'ap_sitios',     grupo: 'Protección',   label: 'Sitios Prioritarios',        service: 'SIMBIO_AP',             idx: 2, color: '#ed7332', labelField: 'NombreOriginal', tipo: 'polygon' },
        { key: 'ap_privada',    grupo: 'Protección',   label: 'Conservación Privada',       service: 'SIMBIO_AP',             idx: 3, color: '#9e5e49', labelField: 'NombreOriginal', tipo: 'polygon' },
        { key: 'eco_terr',      grupo: 'Ecosistemas',  label: 'Ecorregiones Terrestres',    service: 'SIMBIO_ECORREGIONES',   idx: 0, color: '#73ac00', labelField: 'ECO_NAME',       tipo: 'polygon' },
        { key: 'eco_mar',       grupo: 'Ecosistemas',  label: 'Ecorregiones Marinas',       service: 'SIMBIO_ECORREGIONES',   idx: 1, color: '#0070ff', labelField: 'ECO_NAME',       tipo: 'polygon' },
        { key: 'hum_inv',       grupo: 'Humedales',    label: 'Inventario Humedales',       service: 'SIMBIO_HUMEDALES',      idx: 0, color: '#00bcd4', labelField: 'NOM_HUMDET',     tipo: 'polygon' },
        { key: 'hum_urbanos',   grupo: 'Humedales',    label: 'Humedales Urbanos Decl.',    service: 'SIMBIO_HUMEDALES',      idx: 1, color: '#00c875', labelField: 'NOMBRE',         tipo: 'polygon' },
        { key: 'rest_inic',     grupo: 'Restauración', label: 'Iniciativas Restauración',   service: 'SIMBIO_INICIATIVAS_RE', idx: 0, color: '#08a300', labelField: 'nombre',         tipo: 'point'   },
        { key: 'rest_pais',     grupo: 'Restauración', label: 'Paisajes Restauración',      service: 'SIMBIO_INICIATIVAS_RE', idx: 1, color: '#b5e08a', labelField: 'NombrePaisaje',  tipo: 'polygon' },
        { key: 'planes_recoge', grupo: 'Planes',       label: 'Planes Recoge',              service: 'SIMBIO_PLANES_RECOGE',  idx: 2, color: '#cd853f', labelField: 'nombre',         tipo: 'polygon' },
    ];

    var _layers  = {};   // key → Leaflet layer activa en el mapa
    var _cfgByKey = {};  // key → config (acceso rápido)
    var _bufferKm = 0;   // buffer activo en km

    CAPAS_SIMBIO.forEach(function (cfg) { _cfgByKey[cfg.key] = cfg; });

    // ── Calcular bbox de la zona activa + buffer ──────────────────────────
    function _getBbox() {
        var ws   = window.WorkspaceState;
        var zona = ws && (ws.zonaGEE || ws.zona);
        if (!zona) return null;
        try {
            var geom = (_bufferKm > 0 && typeof turf !== 'undefined')
                ? turf.buffer(zona, _bufferKm, { units: 'kilometers' })
                : zona;
            var bb = turf.bbox(geom);
            return bb[0] + ',' + bb[1] + ',' + bb[2] + ',' + bb[3];
        } catch (e) {
            return null;
        }
    }

    // ── Mostrar estado en el panel ────────────────────────────────────────
    function _setStatus(msg, type) {
        var el = document.getElementById('simbio-status');
        if (!el) return;
        el.textContent = msg;
        el.className = 'simbio-status' + (type ? ' simbio-status--' + type : '');
        el.style.display = msg ? 'block' : 'none';
    }

    // ── Cargar una capa en el mapa principal ──────────────────────────────
    function _loadLayer(cfg) {
        var ws   = window.WorkspaceState;
        var zona = ws && (ws.zonaGEE || ws.zona);
        if (!zona) {
            _setStatus('Define una zona de estudio primero.', 'warn');
            console.warn('[SIMBIO] Define una zona primero para cargar "' + cfg.label + '".');
            return;
        }

        _setStatus('Cargando ' + cfg.label + '...', 'loading');

        var bbox = _getBbox() || '-80,-56,-60,-17';
        var url  = SIMBIO_BASE + '/' + cfg.service + '/FeatureServer/' + cfg.idx + '/query';
        var params = [
            'where=1%3D1',
            'geometry=' + encodeURIComponent(bbox),
            'geometryType=esriGeometryEnvelope',
            'inSR=4326',
            'outSR=4326',
            'spatialRel=esriSpatialRelIntersects',
            'outFields=*',
            'f=geojson',
            'resultRecordCount=2000'
        ].join('&');

        _removeLayer(cfg.key);  // limpiar capa anterior del mismo key

        fetch(url + '?' + params)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (!data.features || !data.features.length) {
                    console.log('[SIMBIO] ' + cfg.label + ': 0 features en la zona.');
                    return;
                }
                if (typeof map === 'undefined' || typeof L === 'undefined') return;
                var leafletMap = map;

                var layer;
                if (cfg.tipo === 'point') {
                    layer = L.geoJSON(data, {
                        pointToLayer: function (f, latlng) {
                            return L.circleMarker(latlng, {
                                radius: 5, color: cfg.color,
                                fillColor: cfg.color, fillOpacity: 0.75, weight: 1.5
                            });
                        },
                        onEachFeature: function (f, l) {
                            var n = (f.properties && f.properties[cfg.labelField]) || cfg.label;
                            l.bindTooltip('<strong>' + cfg.label + '</strong><br>' + n, { sticky: true, opacity: 0.9 });
                        }
                    });
                } else {
                    layer = L.geoJSON(data, {
                        style: { color: cfg.color, weight: 1.5, fillOpacity: 0.18, dashArray: '4 3' },
                        onEachFeature: function (f, l) {
                            var n = (f.properties && f.properties[cfg.labelField]) || cfg.label;
                            l.bindTooltip('<strong>' + cfg.label + '</strong><br>' + n, { sticky: true, opacity: 0.9 });
                            l.on({
                                mouseover: function (e) { e.target.setStyle({ weight: 2.5, fillOpacity: 0.38 }); },
                                mouseout:  function (e) { layer.resetStyle(e.target); }
                            });
                        }
                    });
                }

                layer.addTo(leafletMap);
                _layers[cfg.key] = layer;

                // Aplicar opacidad del slider si ya tiene un valor personalizado
                var slider = document.querySelector('.simbio-op-slider[data-key="' + cfg.key + '"]');
                if (slider && Number(slider.value) !== 25) {
                    _setOpacity(cfg.key, slider.value / 100);
                }

                _setStatus(cfg.label + ': ' + data.features.length + ' features.', 'ok');
                console.log('[SIMBIO] ' + cfg.label + ': ' + data.features.length + ' features cargados.');
            })
            .catch(function (err) {
                _setStatus('Error al cargar ' + cfg.label + ': ' + err.message, 'error');
                console.warn('[SIMBIO] Error cargando "' + cfg.label + '":', err.message);
            });
    }

    // ── Remover una capa del mapa ─────────────────────────────────────────
    function _removeLayer(key) {
        if (_layers[key] && typeof map !== 'undefined') {
            try { map.removeLayer(_layers[key]); } catch (e) {}
        }
        delete _layers[key];
    }

    // ── Cambiar opacidad sin recargar ─────────────────────────────────────
    function _setOpacity(key, opacity) {
        var layer = _layers[key];
        if (!layer) return;
        var cfg = _cfgByKey[key];
        if (!cfg) return;
        if (cfg.tipo === 'point') {
            layer.eachLayer(function (l) {
                if (l.setStyle) l.setStyle({ fillOpacity: Number(opacity) * 0.75 });
            });
        } else {
            layer.setStyle({ fillOpacity: Number(opacity) });
        }
    }

    // ── Recargar todas las capas activas (al cambiar zona o buffer) ───────
    function _reloadActiveLayers() {
        var ws   = window.WorkspaceState;
        var zona = ws && (ws.zonaGEE || ws.zona);
        CAPAS_SIMBIO.forEach(function (cfg) {
            var row = document.getElementById('simbio-row-' + cfg.key);
            if (!row || !row.classList.contains('on')) return;
            if (zona) {
                _loadLayer(cfg);
            } else {
                // Zona eliminada: quitar capa pero dejar checkbox activo
                _removeLayer(cfg.key);
            }
        });
    }

    // ── Toggle sección colapsable del panel ───────────────────────────────
    function _toggleSection() {
        var body = document.getElementById('simbio-section-body');
        var chev = document.getElementById('simbio-section-chev');
        if (!body) return;
        var collapsed = body.classList.toggle('simbio-collapsed');
        if (chev) chev.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    }

    // ── API pública ───────────────────────────────────────────────────────
    window.toggleSimbioLayer = function (key, isOn) {
        var cfg = _cfgByKey[key];
        if (!cfg) return;
        if (isOn) { _loadLayer(cfg); } else { _removeLayer(key); }
    };

    window.setSimbioBuffer = function (km) {
        _bufferKm = Number(km) || 0;
        _reloadActiveLayers();
    };

    window.setSimbioOpacity = function (key, val) {
        _setOpacity(key, Number(val));
        var label = document.getElementById('simbio-oval-' + key);
        if (label) label.textContent = Math.round(Number(val) * 100) + '%';
    };

    window.toggleSimbioSection = _toggleSection;

    // ── Enganche al cambio de zona (igual que workspace-biodiversidad.js) ─
    // Espera a que updateZoneUI esté definida y la envuelve.
    var _hookAttempts = 0;
    var _hookTimer = setInterval(function () {
        if (typeof updateZoneUI === 'function') {
            var _orig = updateZoneUI;
            updateZoneUI = function () {
                _orig.apply(this, arguments);
                _reloadActiveLayers();
            };
            clearInterval(_hookTimer);
        }
        if (++_hookAttempts > 100) clearInterval(_hookTimer);
    }, 100);

}());
