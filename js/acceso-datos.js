// ========================================
// EVERGREEN - ACCESO A DATOS JS (CON CUENCAS DGA)
// ========================================

const API_URL = 'https://evergreen-backend-awv1.onrender.com';


// Constantes y Límites
const LIMITES = {
    max_puntos: 3,
    max_poligonos: 1,
    max_registros: 50000
};

const MENSAJES_PROCESAMIENTO = [
    { texto: "⏳ Iniciando servidor (cold-start puede tardar 30-50s)...", duracion: 5000, tipo: 'warning' },
    { texto: "🛰️ Conectando con Google Earth Engine...", duracion: 4000, tipo: 'info' },
    { texto: "🔄 Extrayendo series temporales...", duracion: 5000, tipo: 'info' },
    { texto: "📊 Procesando reducciones espaciales...", duracion: 5000, tipo: 'info' },
    { texto: "💼 Sabías que... Evergreen ofrece validación profesional de datos satelitales?", duracion: 7000, tipo: 'premium' },
    { texto: "📦 Generando archivo CSV final...", duracion: 4000, tipo: 'info' }
];

// Estado de la aplicación
let map;
let drawnItems;
let drawControl;
let mapaCalles, satelite, topografico, mapaClaro;
let cuencasLayer = null;
let cuencaSeleccionada = null;
let puntos = [];
let poligonos = [];
let markerIdCounter = 1;
let poligonoIdCounter = 1;

// ================================
// 1. INICIALIZACIÓN DEL MAPA
// ================================
function initMap() {
    mapaCalles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    });

    satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri'
    });

    topografico = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri'
    });

    mapaClaro = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    });

    map = L.map('map', {
        center: [-39.8142, -73.2459],
        zoom: 8,
        layers: [satelite]
    });

    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    document.addEventListener('click', function (event) {
        if (!event.target.closest('#map-basemap-control')) toggleMapBaseMenu(false);
    });

    // Cuencas BNA: lazy-load — se descargan SOLO cuando el usuario activa el toggle
    // (evita bajar 3MB al inicio si nunca se usa la capa)

    drawControl = new L.Control.Draw({
        draw: {
            polygon: {
                allowIntersection: false,
                shapeOptions: { color: '#C8A882', weight: 3 }
            },
            rectangle: {
                shapeOptions: { color: '#C8A882', weight: 3 }
            },
            polyline: false, circle: false, marker: false, circlemarker: false
        },
        edit: {
            featureGroup: drawnItems,
            remove: true
        }
    });
    // No se agrega al mapa — los botones están en el panel lateral

    setupMapEvents();
    console.log('✅ Sistema Evergreen inicializado');
}

// ================================
// HERRAMIENTAS DE DIBUJO (panel)
// ================================
let activeDrawHandler = null;

function clearDrawButtonState() {
    document.querySelectorAll('.draw-btn').forEach(btn => btn.classList.remove('active'));
}

function activarDibujo(tipo) {
    if (activeDrawHandler) {
        activeDrawHandler.disable();
        activeDrawHandler = null;
        clearDrawButtonState();
        return;
    }

    // Reemplazar polígono anterior en lugar de bloquear (un solo AOI o polígono a la vez)
    poligonos = [];
    drawnItems.clearLayers();

    const opts = tipo === 'polygon'
        ? drawControl.options.draw.polygon
        : drawControl.options.draw.rectangle;
    const Handler = tipo === 'polygon' ? L.Draw.Polygon : L.Draw.Rectangle;

    activeDrawHandler = new Handler(map, opts);
    activeDrawHandler.enable();

    clearDrawButtonState();
    if (tipo === 'polygon') {
        document.getElementById('btn-draw-polygon')?.classList.add('active');
    }
}

// ================================
// CONTROL DE CAPAS (panel propio)
// ================================
function cambiarCapaBase(tipo) {
    const bases = { calles: mapaCalles, satelite, topo: topografico, claro: mapaClaro };
    Object.values(bases).forEach(layer => {
        if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    });

    const baseSeleccionada = bases[tipo] || satelite;
    map.addLayer(baseSeleccionada);

    document.querySelectorAll('[data-map-base]').forEach(button => {
        button.classList.toggle('active', button.dataset.mapBase === (bases[tipo] ? tipo : 'satelite'));
    });
    const current = document.getElementById('map-basemap-current');
    if (current) current.textContent = baseSeleccionada === mapaClaro
        ? 'Claro analitico'
        : baseSeleccionada === mapaCalles
            ? 'Calles'
            : baseSeleccionada === topografico
                ? 'Topografico'
                : 'Satelite';
    toggleMapBaseMenu(false);
}

function toggleMapBaseMenu(force) {
    const control = document.getElementById('map-basemap-control');
    const trigger = document.getElementById('map-basemap-trigger');
    const menu = document.getElementById('map-basemap-menu');
    if (!control || !trigger || !menu) return;
    const open = typeof force === 'boolean' ? force : !control.classList.contains('open');
    control.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
}

function toggleOverlay(nombre, visible) {
    if (nombre === 'cuencas' && cuencasLayer) {
        if (visible) cuencasLayer.addTo(map);
        else map.removeLayer(cuencasLayer);
    }
}

function activarModo(tipo) {
    // Cancela cualquier draw activo
    if (activeDrawHandler) {
        activeDrawHandler.disable();
        activeDrawHandler = null;
    }
    clearDrawButtonState();

    // El modo punto es el default: los clicks del mapa agregan puntos
    if (tipo === 'punto') {
        document.getElementById('btn-draw-point')?.classList.add('active');
    }
}

function activarEdicion() {
    if (activeDrawHandler) {
        activeDrawHandler.disable();
        activeDrawHandler = null;
    }
    clearDrawButtonState();
    document.getElementById('btn-edit')?.classList.add('active');
    
    // Activar modo de edición: permite mover y eliminar vértices de polígonos
    if (drawControl && drawControl._toolbars && drawControl._toolbars.edit) {
        drawControl._toolbars.edit._modes.edit.handler.enable();
    }
}

function limpiarTodo() {
    if (!confirm('¿Limpiar todo?')) return;

    // Limpiar puntos
    puntos.forEach(p => map.removeLayer(p.marker));
    puntos = [];
    actualizarListaPuntos();
    
    // Limpiar polígonos
    drawnItems.clearLayers();
    poligonos = [];
    actualizarListaPoligonos();
    actualizarEstimacion();
    
    // Desactivar cualquier handler activo
    if (activeDrawHandler) {
        activeDrawHandler.disable();
        activeDrawHandler = null;
    }
    clearDrawButtonState();
}

// ========================================
// 2. CARGA DE SUB-SUBCUENCAS BNA (LAZY-LOAD)
// ========================================
// El GeoJSON pesa ~3 MB. Se descarga la PRIMERA vez que el usuario
// activa el toggle, y queda en memoria. Si nunca se activa, no se baja.
let _cuencasLoadPromise = null;  // singleton para evitar requests duplicados

async function cargarCuencasDGA() {
    // Si ya hay una carga en curso, devolver esa promesa (singleton)
    if (_cuencasLoadPromise) return _cuencasLoadPromise;
    if (cuencasLayer) return cuencasLayer;

    _cuencasLoadPromise = (async () => {
        try {
            console.log('🗺️ Cargando sub-subcuencas BNA (lazy)...');
            const LIMITE_HA = 50000;  // límite del backend para zona de estudio

            const response = await fetch('./data/sub_subcuencas_bna.geojson');
            if (!response.ok) throw new Error('No se pudo cargar sub-subcuencas');

            const geojson = await response.json();
            console.log(`✅ ${geojson.features.length} sub-subcuencas BNA cargadas`);

            cuencasLayer = L.geoJSON(geojson, {
                style: (feature) => {
                    const supera = (feature.properties.area_ha || 0) > LIMITE_HA;
                    return {
                        color: supera ? '#888' : '#0080FF',
                        weight: 1.2,
                        fillColor: supera ? '#888' : '#0080FF',
                        fillOpacity: supera ? 0.02 : 0.05,
                    };
                },
                onEachFeature: (feature, layer) => {
                    const p = feature.properties;
                    const ha = p.area_ha || 0;
                    const supera = ha > LIMITE_HA;
                    const haFmt = ha.toLocaleString('es-CL');

                    // Popup con info real + advertencia si supera límite
                    const haRow = supera
                        ? `<p class="cuenca-popup-warn"><strong>${haFmt} ha</strong> · supera el límite de ${LIMITE_HA.toLocaleString('es-CL')} ha</p>`
                        : `<p><strong>Área:</strong> ${haFmt} ha</p>`;
                    const btn = supera
                        ? `<button class="cuenca-popup-btn cuenca-popup-btn--disabled" disabled title="Demasiado grande para análisis (máx ${LIMITE_HA.toLocaleString('es-CL')} ha)">⚠️ Excede límite</button>`
                        : `<button class="cuenca-popup-btn" onclick="if(typeof usarCuencaEnWorkspace==='function'){usarCuencaEnWorkspace();map.closePopup();}">📍 Usar esta cuenca</button>`;

                    const popupContent = `
                        <div class="cuenca-popup">
                            <h4>${p.nombre || 'Sub-subcuenca'}</h4>
                            ${haRow}
                            <p><strong>Código:</strong> ${p.cod_ssubcuenca || 'N/A'}</p>
                            <p><strong>Región:</strong> ${p.region || 'N/A'}</p>
                            ${btn}
                        </div>
                    `;
                    layer.bindPopup(popupContent);

                    // Hover
                    layer.on('mouseover', function () {
                        if (this === cuencaSeleccionada) return;
                        this.setStyle({ fillOpacity: supera ? 0.10 : 0.20, weight: 2 });
                    });
                    layer.on('mouseout', function () {
                        if (this === cuencaSeleccionada) return;
                        this.setStyle({
                            fillOpacity: supera ? 0.02 : 0.05,
                            weight: 1.2,
                            color: supera ? '#888' : '#0080FF',
                        });
                    });

                    // Click (solo selecciona si NO supera el límite)
                    layer.on('click', function () {
                        if (supera) {
                            // permitir abrir popup pero no marcar como seleccionada
                            return;
                        }
                        if (cuencaSeleccionada && cuencaSeleccionada !== this) {
                            cuencaSeleccionada.setStyle({
                                fillOpacity: 0.05, weight: 1.2, color: '#0080FF',
                            });
                        }
                        this.setStyle({ fillOpacity: 0.3, weight: 3, color: '#FF6B35' });
                        cuencaSeleccionada = this;
                    });
                }
            });

            console.log('✅ Capa de sub-subcuencas BNA lista');
            return cuencasLayer;
        } catch (error) {
            console.error('❌ Error cargando cuencas:', error);
            _cuencasLoadPromise = null;  // permite reintentar
            if (typeof mostrarNotificacion === 'function') {
                mostrarNotificacion('❌ No se pudieron cargar las sub-subcuencas. Reintenta más tarde.');
            }
            throw error;
        }
    })();

    return _cuencasLoadPromise;
}

// ========================================
// 3. USAR CUENCA COMO POLÍGONO
// ========================================
function usarCuencaComoPoligono() {
    if (!cuencaSeleccionada) {
        alert('⚠️ Selecciona una cuenca primero (haz click en ella)');
        return;
    }

    // Reemplazar en lugar de bloquear (workspace maneja un polígono a la vez)
    poligonos = [];

    // Obtener geometría de la cuenca
    const feature = cuencaSeleccionada.feature;
    const geometry = feature.geometry;
    const props = feature.properties;

    // Convertir a formato de coordenadas para el backend
    let coordinates;
    if (geometry.type === 'Polygon') {
        coordinates = geometry.coordinates[0];
    } else if (geometry.type === 'MultiPolygon') {
        // Usar el polígono más grande
        coordinates = geometry.coordinates
            .reduce((max, current) =>
                current[0].length > max[0].length ? current : max
            )[0];
    } else {
        alert('⚠️ Tipo de geometría no soportado');
        return;
    }

    // Calcular área aproximada
    const latLngs = coordinates.map(c => L.latLng(c[1], c[0]));
    const area_m2 = L.GeometryUtil.geodesicArea(latLngs);
    const area_km2 = (area_m2 / 1000000).toFixed(2);

    // Agregar como polígono
    const id = poligonoIdCounter++;

    poligonos.push({
        id: id,
        nombre: `Cuenca: ${props.nombre || 'Sub-subcuenca'}`,
        codigo: props.cod_ssubcuenca || props.cod_subcuenca || 'N/A',
        coordinates: coordinates,
        area_km2: parseFloat(area_km2),
        esCuenca: true,
        layer: cuencaSeleccionada
    });

    // Actualizar UI
    actualizarListaPoligonos();
    actualizarEstimacion();

    // Cerrar popup
    cuencaSeleccionada.closePopup();

    // Notificación
    mostrarNotificacion(`✅ Cuenca "${props.nombre}" agregada para descarga`);

    console.log(`✅ Cuenca agregada: ${props.nombre}`);
}

// ========================================
// 4. NOTIFICACIONES
// ========================================
function mostrarNotificacion(mensaje) {
    const notif = document.createElement('div');
    notif.textContent = mensaje;
    notif.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 10000;
        font-size: 0.9rem;
        animation: slideIn 0.3s;
    `;

    document.body.appendChild(notif);

    setTimeout(() => {
        notif.style.animation = 'slideOut 0.3s';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

// ================================
// 5. EVENTOS DEL MAPA
// ================================
function setupMapEvents() {
    map.on('click', function (e) {
        if (activeDrawHandler) return; // ignorar clicks durante dibujo de polígono (modo clima)
        // Ignorar también cuando el workspace está dibujando su propio polígono
        if (typeof globalDrawControl !== 'undefined' && globalDrawControl && globalDrawControl._enabled) return;
        // Los puntos solo tienen sentido en el tab Clima (descarga de grillados punto/polígono).
        // En Hidromorfología, Riesgos, etc. los clicks son para sus propios flujos (outlet, rectángulo)
        // y NO deben crear puntos sueltos.
        var climaTab = document.getElementById('tab-clima-content');
        if (!climaTab || !climaTab.classList.contains('active')) return;
        // Además, solo cuando el usuario eligió explícitamente el modo "Puntos en el mapa".
        if (_climaModo !== 'puntos') return;
        if (puntos.length >= LIMITES.max_puntos) { mostrarNotificacion(`⚠️ Máximo ${LIMITES.max_puntos} puntos.`); return; }
        agregarPunto(e.latlng.lat, e.latlng.lng);
    });

    map.on(L.Draw.Event.CREATED, function (e) {
        activeDrawHandler = null;
        document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));

        const layer = e.layer;
        if (poligonos.length >= LIMITES.max_poligonos) { alert(`⚠️ Máximo ${LIMITES.max_poligonos} polígonos`); return; }
        drawnItems.addLayer(layer);

        const coords = layer.getLatLngs()[0];
        const coordsArray = coords.map(c => [c.lng, c.lat]);
        coordsArray.push(coordsArray[0]);

        const area = L.GeometryUtil.geodesicArea(coords);
        agregarPoligono(coordsArray, (area / 1000000).toFixed(2), layer);
    });

    map.on(L.Draw.Event.DELETED, function (e) {
        e.layers.eachLayer(function (layer) {
            const idx = poligonos.findIndex(p => p.layer === layer);
            if (idx !== -1) {
                poligonos.splice(idx, 1);
                actualizarListaPoligonos();
                actualizarEstimacion();
            }
        });
    });
}

// ================================
// 6. LÓGICA DE DATOS Y PANEL
// ================================
function agregarPuntoManual() {
    const latInput = document.getElementById('manual-lat');
    const lonInput = document.getElementById('manual-lon');
    const lat = parseFloat(latInput.value);
    const lon = parseFloat(lonInput.value);

    if (isNaN(lat) || isNaN(lon)) {
        alert('⚠️ Ingresa valores numéricos válidos para latitud y longitud.');
        return;
    }
    if (lat < -90 || lat > 90) {
        alert('⚠️ La latitud debe estar entre -90 y 90.');
        return;
    }
    if (lon < -180 || lon > 180) {
        alert('⚠️ La longitud debe estar entre -180 y 180.');
        return;
    }
    if (puntos.length >= LIMITES.max_puntos) {
        alert(`⚠️ Máximo ${LIMITES.max_puntos} puntos`);
        return;
    }

    agregarPunto(lat, lon);
    map.setView([lat, lon], 10);
    latInput.value = '';
    lonInput.value = '';
}

// ================================
// MODO DE DESCARGA DE GRILLADOS (CLIMA): 'zona' | 'puntos' | null
// ================================
let _climaModo = null;

function _setClimaModo(modo) {
    _climaModo = modo;
    const bZona = document.getElementById('clima-mode-zona');
    const bPtos = document.getElementById('clima-mode-puntos');
    if (bZona) bZona.classList.toggle('active', modo === 'zona');
    if (bPtos) bPtos.classList.toggle('active', modo === 'puntos');
    const hint = document.getElementById('clima-mode-hint');
    if (hint) {
        if (modo === 'puntos')      hint.innerHTML = '<b>Modo puntos:</b> haz click en el mapa (hasta 3 puntos).';
        else if (modo === 'zona')   hint.innerHTML = 'Se usará tu <b>zona de estudio</b> como área de descarga.';
        else                        hint.innerHTML = 'Máximo <b>1 zona</b> · o hasta <b>3 puntos</b> en el mapa.';
    }
}

// Botón "Usar zona de estudio": toma la zona activa del workspace como polígono de descarga.
function climaModoZona() {
    if (!(typeof WorkspaceState !== 'undefined' && WorkspaceState && WorkspaceState.zona)) {
        mostrarNotificacion('Primero define una zona de estudio (botón "Dibujar zona").');
        return;
    }
    // Limpiar puntos existentes (zona y puntos son excluyentes en esta guía)
    puntos.forEach(p => p.marker && map.removeLayer(p.marker));
    puntos = [];
    actualizarListaPuntos();
    // Usar la zona como polígono de descarga
    if (typeof agregarPoligonoDesdeWorkspace === 'function') {
        agregarPoligonoDesdeWorkspace(WorkspaceState.zona, WorkspaceState.zonaNombre, WorkspaceState.zonaHa);
    }
    _setClimaModo('zona');
    actualizarEstimacion();
}

// Botón "Puntos en el mapa": activa el modo punto (clicks agregan puntos, máx 3).
function climaModoPuntos() {
    // Quitar el polígono/zona del set de descarga (la zona sigue dibujada en el mapa).
    poligonos = [];
    if (typeof actualizarListaPoligonos === 'function') actualizarListaPoligonos();
    _setClimaModo('puntos');
    actualizarEstimacion();
}

function agregarPunto(lat, lon) {
    const id = markerIdCounter++;
    const nombre = `Punto ${id}`;

    const marker = L.marker([lat, lon], {
        icon: L.icon({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
            shadowSize: [41, 41]
        })
    }).addTo(map);

    marker.bindPopup(
        `<div style="text-align:center; min-width:90px; font-family:inherit;">` +
        `<strong style="font-size:12px;">${nombre}</strong>` +
        `<br><span style="font-size:10px; color:#888;">${lat.toFixed(4)}, ${lon.toFixed(4)}</span>` +
        `<br><button onclick="quitarPunto(${id})" ` +
        `style="margin-top:6px; padding:3px 10px; background:#e57373; color:#fff; ` +
        `border:none; border-radius:4px; cursor:pointer; font-size:11px; width:100%;">` +
        `✕ Eliminar</button></div>`
    ).openPopup();

    puntos.push({ id, nombre, lat, lon, marker });
    actualizarListaPuntos();
    actualizarEstimacion();
}

/** Elimina un punto por su id único (seguro aunque cambien los índices del array). */
function quitarPunto(uid) {
    const idx = puntos.findIndex(p => p.id === uid);
    if (idx !== -1) eliminarPunto(idx);
}

function agregarPoligono(coordinates, areaKm2, layer) {
    const id = poligonoIdCounter++;
    const nombre = `Polígono ${id}`;

    const areaHaPoly = Math.round(parseFloat(areaKm2) * 100);
    layer.bindPopup(`<strong>${nombre}</strong><br>Área: ${areaHaPoly.toLocaleString('es-CL')} ha`);

    poligonos.push({ id, nombre, coordinates, area_km2: parseFloat(areaKm2), layer });
    actualizarListaPoligonos();
    actualizarEstimacion();
}

function eliminarPunto(id) {
    const idx = puntos.findIndex(p => p.id === id);
    if (idx !== -1) {
        map.removeLayer(puntos[idx].marker);
        puntos.splice(idx, 1);
        actualizarListaPuntos();
        actualizarEstimacion();
    }
}

function eliminarPoligono(id) {
    const idx = poligonos.findIndex(p => p.id === id);
    if (idx !== -1) {
        // Si es una cuenca, resetear el estilo
        if (poligonos[idx].esCuenca) {
            const layer = poligonos[idx].layer;
            if (layer) {
                layer.setStyle({
                    fillOpacity: 0.05,
                    weight: 1.5,
                    color: '#0080FF'
                });
                if (cuencaSeleccionada === layer) {
                    cuencaSeleccionada = null;
                }
            }
        } else {
            // Si es un polígono dibujado, eliminarlo del mapa
            drawnItems.removeLayer(poligonos[idx].layer);
        }

        poligonos.splice(idx, 1);
        actualizarListaPoligonos();
        actualizarEstimacion();
    }
}

// ================================
// 7. ACTUALIZACIÓN VISUAL DEL PANEL
// ================================
function actualizarListaPuntos() {
    const container = document.getElementById('puntos-lista');
    if (!container) return;

    if (puntos.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:12px; color:rgba(244,247,241,0.6); margin:8px 0;">No hay puntos marcados</p>';
        return;
    }

    container.innerHTML = puntos.map((p, index) => `
        <div class="location-item">
            <div class="location-info">
                <div class="location-name">Punto ${index + 1}</div>
                <div class="location-coords">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
            </div>
            <div class="location-actions">
                <button class="btn-small danger" onclick="eliminarPunto(${index})" title="Eliminar punto">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>`).join('');
}

function eliminarPunto(index) {
    if (puntos[index]) {
        map.removeLayer(puntos[index].marker);
        puntos.splice(index, 1);
        actualizarListaPuntos();
        actualizarEstimacion();
    }
}

function actualizarListaPoligonos() {
    const container = document.getElementById('poligonos-lista');
    if (!container) return; // Si no existe en este tab

    if (poligonos.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:12px; color:rgba(244,247,241,0.6); margin:8px 0;">No hay zonas dibujadas</p>';
        return;
    }

    container.innerHTML = poligonos.map(p => `
        <div class="location-item">
            <div class="location-info">
                <div class="location-name">${p.nombre}</div>
                <div class="location-coords">Área: ${p.ha} ha</div>
            </div>
            <div class="location-actions">
                <button class="btn-small danger" onclick="eliminarPoligono(${p.id})" title="Eliminar zona">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>`).join('');
}

function actualizarListaPuntos() {
    const container = document.getElementById('puntos-lista');
    if (!container) return;

    if (puntos.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:12px; color:rgba(244,247,241,0.6); margin:8px 0;">No hay puntos marcados</p>';
        return;
    }

    container.innerHTML = puntos.map((p, index) => `
        <div class="location-item">
            <div class="location-info">
                <div class="location-name">Punto ${index + 1}</div>
                <div class="location-coords">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
            </div>
            <div class="location-actions">
                <button class="btn-small danger" onclick="eliminarPunto(${index})" title="Eliminar punto">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>`).join('');
}

function eliminarPunto(index) {
    if (puntos[index]) {
        map.removeLayer(puntos[index].marker);
        puntos.splice(index, 1);
        actualizarListaPuntos();
        actualizarEstimacion();
    }
}

function limpiarTodo() {
    if (!confirm('¿Limpiar todo?')) return;

    // Limpiar puntos
    puntos.forEach(p => map.removeLayer(p.marker));
    puntos = [];

    // Limpiar polígonos
    poligonos.forEach(p => {
        if (p.esCuenca && p.layer) {
            // Resetear estilo de cuencas
            p.layer.setStyle({
                fillOpacity: 0.05,
                weight: 1.5,
                color: '#0080FF'
            });
        }
    });
    drawnItems.clearLayers();
    poligonos = [];
    cuencaSeleccionada = null;

    actualizarListaPuntos();
    actualizarListaPoligonos();
    actualizarEstimacion();

    if (typeof clearZoneState === 'function') {
        clearZoneState();
    }
}

// ========================================
// 8. LÓGICA DE ESTIMACIÓN Y PRODUCTOS
// ========================================
function obtenerProductosSeleccionados() {
    return Array.from(document.querySelectorAll('#productos-grupo input[type="checkbox"]:checked'))
        .map(cb => cb.value);
}

function actualizarEstimacion() {
    const textEl = document.getElementById('estimation-text');
    const productosSeleccionados = obtenerProductosSeleccionados();
    const fechaInicio = document.getElementById('fecha-inicio').value;
    const fechaFin = document.getElementById('fecha-fin').value;

    if (puntos.length === 0 && poligonos.length === 0) {
        textEl.innerHTML = 'Agrega ubicaciones para calcular';
        return;
    }
    if (productosSeleccionados.length === 0) {
        textEl.innerHTML = 'Selecciona al menos un producto';
        return;
    }
    if (!fechaInicio || !fechaFin) {
        textEl.innerHTML = 'Define el período temporal';
        return;
    }

    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    const milisegundosPorDia = 1000 * 60 * 60 * 24;
    const dias = Math.ceil((fin - inicio) / milisegundosPorDia) + 1;

    if (dias <= 0) {
        textEl.innerHTML = '<span style="color: #dc3545;">Fecha de fin debe ser posterior</span>';
        return;
    }

    const totalRegistros = (puntos.length + poligonos.length) * productosSeleccionados.length * dias;

    if (totalRegistros > LIMITES.max_registros) {
        textEl.innerHTML = `
            <strong style="color: #dc3545;">⚠️ ${totalRegistros.toLocaleString()} registros</strong><br>
            <small>Excede el límite de sistema (${LIMITES.max_registros.toLocaleString()}).</small>
        `;
    } else {
        // --- Cálculo de tiempo basado en Chunks (Lógica Backend) ---
        // Definición de grupos (IDs de colección en app.py)
        const PRODUCT_MAP = {
            'CHIRPS': 'CHIRPS',
            'GPM': 'GPM',
            'CMORPH': 'CMORPH',
            'ERA5': 'ERA5_LAND',
            'PERSIANN': 'PERSIANN',
            'T_MAX': 'ERA5_LAND',
            'T_MIN': 'ERA5_LAND',
            'T_MEAN': 'ERA5_LAND'
        };

        // Identificar grupos únicos seleccionados
        const gruposUnicos = new Set();
        let tieneGPM = false;
        productosSeleccionados.forEach(p => {
            if (PRODUCT_MAP[p]) gruposUnicos.add(PRODUCT_MAP[p]);
            if (p === 'GPM') tieneGPM = true;
        });

        const numGrupos = gruposUnicos.size;
        let segundosTotales = 45; // Base / Cold Start

        // Procesamiento de Puntos
        if (puntos.length > 0) {
            const numPuntos = puntos.length;
            // Backend: dias_por_chunk = max(1, 2000 // num_puntos)
            const diasPorChunk = Math.max(1, Math.floor(2000 / numPuntos));
            const numChunksPuntos = Math.ceil(dias / diasPorChunk);
            // Cada chunk de puntos (2000 registros) ~0.5s por grupo
            segundosTotales += numChunksPuntos * numGrupos * 0.5;
        }

        // Procesamiento de Polígonos
        if (poligonos.length > 0) {
            // Backend: _CHUNK_POLIGONOS = 90 días
            const numChunksPol = Math.ceil(dias / 90);
            // Cada chunk de polígono (90 días) ~1.1s por grupo (según performance real)
            segundosTotales += numChunksPol * numGrupos * 1.1;
        }

        // Factor Extra para GPM (Agregaciones diarias son lentas en GEE)
        if (tieneGPM) segundosTotales *= 1.2;

        // Formatear tiempo
        let tiempoTexto = "";
        if (segundosTotales < 60) {
            tiempoTexto = "45-60 s";
        } else {
            const mins = Math.floor(segundosTotales / 60);
            const secs = Math.round(segundosTotales % 60);
            // No mostrar segundos si son muchos minutos
            tiempoTexto = mins > 5 ? `${mins} min` : (secs > 0 ? `${mins} min ${secs} s` : `${mins} min`);
        }

        textEl.innerHTML = `
            <strong>${totalRegistros.toLocaleString()}</strong> registros detectados.<br>
            <small>Tiempo estimado: ~${tiempoTexto}</small>
        `;
    }
}

// ========================================
// 9. ENVÍO DE DATOS AL BACKEND (RENDER)
// ========================================
let rotacionMensajesInterval = null;

function mostrarModalDescarga() {
    document.getElementById('modal-descarga').style.display = 'flex';
}

function cerrarModalDescarga() {
    document.getElementById('modal-descarga').style.display = 'none';
}

async function descargar() {
    const prods = obtenerProductosSeleccionados();
    const fInicio = document.getElementById('fecha-inicio').value;
    const fFin = document.getElementById('fecha-fin').value;

    const dias = Math.ceil((new Date(fFin) - new Date(fInicio)) / (1000 * 60 * 60 * 24)) + 1;
    const totalRegistros = (puntos.length + poligonos.length) * prods.length * dias;

    if (totalRegistros > LIMITES.max_registros) {
        alert(`⚠️ La solicitud actual (${totalRegistros.toLocaleString()} registros) supera el límite de ${LIMITES.max_registros.toLocaleString()}.`);
        return;
    }

    if (puntos.length === 0 && poligonos.length === 0) {
        alert('⚠️ Debes agregar al menos una ubicación.');
        return;
    }
    if (prods.length === 0) {
        alert('⚠️ Selecciona al menos un producto.');
        return;
    }

    const payload = {
        puntos: puntos.map(p => ({ nombre: p.nombre, lat: p.lat, lon: p.lon })),
        poligonos: poligonos.map(p => ({ nombre: p.nombre, coordinates: p.coordinates })),
        productos: prods,
        fecha_inicio: fInicio,
        fecha_fin: fFin
    };

    const btn = document.getElementById('btn-descargar');
    btn.disabled = true;

    // Iniciar rotativo
    let mensajeIndex = 0;
    btn.innerHTML = `<span class="btn-text" style="transition: opacity 0.3s">${MENSAJES_PROCESAMIENTO[0].texto}</span>`;
    btn.style.background = '#eab308';
    btn.style.color = '#fff';

    rotacionMensajesInterval = setInterval(() => {
        mensajeIndex = (mensajeIndex + 1) % MENSAJES_PROCESAMIENTO.length;
        const msg = MENSAJES_PROCESAMIENTO[mensajeIndex];

        const textoEl = btn.querySelector('.btn-text');
        if (textoEl) {
            textoEl.style.opacity = 0;
            setTimeout(() => {
                textoEl.textContent = msg.texto;
                if (msg.tipo === 'premium') {
                    btn.style.background = 'var(--accent, #6aaa35)';
                } else if (msg.tipo === 'warning') {
                    btn.style.background = '#eab308';
                } else {
                    btn.style.background = '#3b82f6';
                }
                textoEl.style.opacity = 1;
            }, 300);
        }
    }, MENSAJES_PROCESAMIENTO[0].duracion);

    try {
        const headers = (typeof getBackendAuthHeaders === 'function')
            ? await getBackendAuthHeaders({ 'Content-Type': 'application/json' })
            : { 'Content-Type': 'application/json' };

        const response = await fetch(`${API_URL}/api/descargar`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error en el procesamiento de datos.');
        }

        // ── Streaming: leer en chunks para no esperar toda la respuesta ──
        const reader = response.body.getReader();
        const chunks = [];
        let totalBytes = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalBytes += value.length;
        }

        if (totalBytes === 0) {
            throw new Error('El servidor devolvió un archivo vacío. Revisa los parámetros.');
        }

        const blob = new Blob(chunks, { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `evergreen_data_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        mostrarNotificacion('✅ ¡Descarga exitosa!');
        setTimeout(mostrarModalDescarga, 800);

    } catch (error) {
        alert(`❌ Error: ${error.message}`);
    } finally {
        clearInterval(rotacionMensajesInterval);
        btn.disabled = false;
        btn.style.background = '';
        btn.innerHTML = '⬇️ Descargar Datos';
    }
}

// ========================================
// 10. INICIALIZACIÓN
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    document.querySelectorAll('#productos-grupo input, #fecha-inicio, #fecha-fin').forEach(el => {
        el.addEventListener('change', actualizarEstimacion);
    });
});

// ========================================
// 11. TAB SWITCHER (Descarga / DEM)
// ========================================
function switchTool(tool) {
    // Update tab button states
    document.querySelectorAll('.tool-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${tool}`).classList.add('active');

    // Hide all panels, show the selected one
    document.querySelectorAll('.tool-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`${tool}-app`).classList.add('active');

    // Lazy-load the DEM iframe on first open
    if (tool === 'dem') {
        const iframe = document.getElementById('dem-iframe');
        if (!iframe.src || iframe.src === window.location.href) {
            iframe.src = iframe.dataset.src;
            iframe.addEventListener('load', () => {
                const overlay = document.getElementById('dem-loading');
                if (overlay) overlay.classList.add('hidden');
            }, { once: true });
        }
    }

    // Lazy-load del iframe de Biodiversidad en primer acceso
    if (tool === 'biodiversidad') {
        const iframe = document.getElementById('bio-iframe');
        if (!iframe.src || iframe.src === window.location.href) {
            iframe.src = iframe.dataset.src;
            iframe.addEventListener('load', () => {
                const overlay = document.getElementById('bio-loading');
                if (overlay) overlay.classList.add('hidden');
            }, { once: true });
        }
    }

    // Fix Leaflet map size if switching back to datos tab
    if (tool === 'datos' && typeof map !== 'undefined') {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

// Abrir tab por parámetro URL (?tab=dem, ?tab=biodiversidad)
document.addEventListener('DOMContentLoaded', () => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab) switchTool(tab);
});
