// ========================================
// EVERGREEN - ACCESO A DATOS JS (CON CUENCAS DGA)
// ========================================

const API_URL = 'http://127.0.0.1:10000'; // Puerto que configuraste recién


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
let mapaCalles, satelite, topografico;
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

    map = L.map('map', {
        center: [-39.8142, -73.2459],
        zoom: 8,
        layers: [satelite]
    });

    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // Cargar cuencas DGA
    cargarCuencasDGA();

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

function activarDibujo(tipo) {
    if (activeDrawHandler) {
        activeDrawHandler.disable();
        activeDrawHandler = null;
        document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
        return;
    }

    if (poligonos.length >= LIMITES.max_poligonos) {
        alert(`⚠️ Máximo ${LIMITES.max_poligonos} polígonos permitidos`);
        return;
    }

    const opts = tipo === 'polygon'
        ? drawControl.options.draw.polygon
        : drawControl.options.draw.rectangle;
    const Handler = tipo === 'polygon' ? L.Draw.Polygon : L.Draw.Rectangle;

    activeDrawHandler = new Handler(map, opts);
    activeDrawHandler.enable();

    document.getElementById('btn-draw-polygon').classList.add('active');
}

// ================================
// CONTROL DE CAPAS (panel propio)
// ================================
function cambiarCapaBase(tipo) {
    map.removeLayer(mapaCalles);
    map.removeLayer(satelite);
    map.removeLayer(topografico);
    if (tipo === 'calles') map.addLayer(mapaCalles);
    else if (tipo === 'satelite') map.addLayer(satelite);
    else if (tipo === 'topo') map.addLayer(topografico);
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
    document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
    // El modo punto es el default: los clicks del mapa agregan puntos
    if (tipo === 'punto') {
        document.getElementById('btn-draw-point').classList.add('active');
        // Se desactiva solo al activar polígono
    }
}

// ========================================
// 2. CARGA DE CUENCAS DGA (DESDE VERCEL)
// ========================================
async function cargarCuencasDGA() {
    try {
        console.log('🗺️ Cargando cuencas DGA desde Vercel...');

        // Cargar desde el mismo dominio (Vercel)
        const response = await fetch('./data/cuencas_chile_simplificado.geojson');

        if (!response.ok) {
            throw new Error('No se pudo cargar cuencas');
        }

        const geojson = await response.json();

        console.log(`✅ ${geojson.features.length} subcuencas BNA cargadas`);

        // Crear capa con estilo e interactividad
        cuencasLayer = L.geoJSON(geojson, {
            style: {
                color: '#0080FF',
                weight: 1.5,
                fillColor: '#0080FF',
                fillOpacity: 0.05
            },
            onEachFeature: (feature, layer) => {
                const props = feature.properties;

                // Popup con información
                const popupContent = `
                    <div class="cuenca-popup" style="min-width: 200px;">
                        <h4 style="margin: 0 0 10px 0; color: #0080FF; font-size: 1rem;">
                            ${props.nombre || 'Subcuenca'}
                        </h4>
                        <p style="margin: 5px 0; font-size: 0.85rem;">
                            <strong>Código Subcuenca:</strong> ${props.cod_subcuenca || 'N/A'}
                        </p>
                        <p style="margin: 5px 0; font-size: 0.85rem;">
                            <strong>Región:</strong> ${props.region || 'N/A'}
                        </p>
                        <button 
                            onclick="usarCuencaComoPoligono()" 
                            style="
                                width: 100%;
                                margin-top: 10px;
                                padding: 8px 12px;
                                background: #28a745;
                                color: white;
                                border: none;
                                border-radius: 5px;
                                cursor: pointer;
                                font-size: 0.85rem;
                                font-weight: bold;
                            "
                            onmouseover="this.style.background='#218838'"
                            onmouseout="this.style.background='#28a745'"
                        >
                            📍 Usar esta cuenca
                        </button>
                    </div>
                `;

                layer.bindPopup(popupContent);

                // Hover effect
                layer.on('mouseover', function () {
                    this.setStyle({
                        fillOpacity: 0.2,
                        weight: 2
                    });
                });

                layer.on('mouseout', function () {
                    if (this !== cuencaSeleccionada) {
                        this.setStyle({
                            fillOpacity: 0.05,
                            weight: 1.5
                        });
                    }
                });

                // Click
                layer.on('click', function () {
                    if (cuencaSeleccionada && cuencaSeleccionada !== this) {
                        cuencaSeleccionada.setStyle({
                            fillOpacity: 0.05,
                            weight: 1.5,
                            color: '#0080FF'
                        });
                    }

                    this.setStyle({
                        fillOpacity: 0.3,
                        weight: 3,
                        color: '#FF6B35'
                    });

                    cuencaSeleccionada = this;
                });
            }
        });

        // Agregar al mapa por defecto
        cuencasLayer.addTo(map);

        console.log('✅ Capa de cuencas DGA renderizada');

    } catch (error) {
        console.error('❌ Error cargando cuencas:', error);
        alert('No se pudieron cargar las cuencas. Intenta recargar la página.');
    }
}

// ========================================
// 3. USAR CUENCA COMO POLÍGONO
// ========================================
function usarCuencaComoPoligono() {
    if (!cuencaSeleccionada) {
        alert('⚠️ Selecciona una cuenca primero (haz click en ella)');
        return;
    }

    if (poligonos.length >= LIMITES.max_poligonos) {
        alert(`⚠️ Máximo ${LIMITES.max_poligonos} polígonos permitidos`);
        return;
    }

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
        nombre: `Cuenca: ${props.nombre || 'Subcuenca'}`,
        codigo: props.cod_subcuenca || 'N/A',
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
        if (activeDrawHandler) return; // ignorar clicks durante dibujo de polígono
        if (puntos.length >= LIMITES.max_puntos) { alert(`⚠️ Máximo ${LIMITES.max_puntos} puntos`); return; }
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

    marker.bindPopup(`<strong>${nombre}</strong>`).openPopup();

    puntos.push({ id, nombre, lat, lon, marker });
    actualizarListaPuntos();
    actualizarEstimacion();
}

function agregarPoligono(coordinates, areaKm2, layer) {
    const id = poligonoIdCounter++;
    const nombre = `Polígono ${id}`;

    layer.bindPopup(`<strong>${nombre}</strong><br>Área: ${areaKm2} km²`);

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
    document.getElementById('puntos-count').textContent = puntos.length;

    if (puntos.length === 0) {
        container.innerHTML = '<p class="hint">No hay puntos agregados</p>';
        return;
    }

    container.innerHTML = puntos.map(p => `
        <div class="location-item">
            <div><strong>${p.nombre}</strong><br><small>${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</small></div>
            <button onclick="eliminarPunto(${p.id})">Eliminar</button>
        </div>`).join('');
}

function actualizarListaPoligonos() {
    const container = document.getElementById('poligonos-lista');
    document.getElementById('poligonos-count').textContent = poligonos.length;

    if (poligonos.length === 0) {
        container.innerHTML = '<p class="hint">No hay polígonos dibujados</p>';
        return;
    }

    container.innerHTML = poligonos.map(p => `
        <div class="location-item poligono">
            <div>
                <strong>${p.nombre}</strong><br>
                <small>Área: ${p.area_km2} km²</small>
                ${p.codigo ? `<br><small>Código: ${p.codigo}</small>` : ''}
            </div>
            <button onclick="eliminarPoligono(${p.id})">Eliminar</button>
        </div>`).join('');
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
        let tiempoEstimado = totalRegistros > 5000 ? '2-4 min' : '1 min';
        textEl.innerHTML = `
            <strong>${totalRegistros.toLocaleString()}</strong> registros detectados.<br>
            <small>Tiempo estimado: ${tiempoEstimado}</small>
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
                    btn.style.background = 'var(--color-primary)';
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
        const response = await fetch(`${API_URL}/api/descargar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error en el procesamiento de datos.');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `evergreen_data_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();

        mostrarNotificacion('✅ ¡Descarga exitosa!');
        setTimeout(mostrarModalDescarga, 800);

    } catch (error) {
        alert(`❌ Error: ${error.message}`);
    } finally {
        clearInterval(rotacionMensajesInterval);
        btn.disabled = false;
        btn.style.background = ''; // reset to default
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