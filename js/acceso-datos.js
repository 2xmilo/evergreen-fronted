// ================================
// ACCESO A DATOS METEOROLÓGICOS
// Mapa interactivo + Descarga
// ================================

// Configuración
// CAMBIO CRÍTICO: Conexión directa al backend en Render
const API_URL = 'https://evergreen-backend-awv1.onrender.com'; 

// Estado de la aplicación
let map;
let drawControl;
let drawnItems;
let puntos = [];
let poligonos = [];
let markerIdCounter = 1;
let poligonoIdCounter = 1;

// ================================
// INICIALIZACIÓN DEL MAPA
// ================================
function initMap() {
    // Crear mapa centrado en Chile central
    map = L.map('map', {
        center: [-39.8142, -73.2459],  // Valdivia
        zoom: 8,
        zoomControl: true
    });

    // Agregar capa base de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(map);

    // Capa para elementos dibujados
    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // Configurar herramientas de dibujo
    drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: {
                allowIntersection: false,
                shapeOptions: {
                    color: '#007bff',
                    weight: 2
                }
            },
            rectangle: {
                shapeOptions: {
                    color: '#007bff',
                    weight: 2
                }
            },
            polyline: false,
            circle: false,
            marker: false,
            circlemarker: false
        },
        edit: {
            featureGroup: drawnItems,
            remove: true
        }
    });
    map.addControl(drawControl);

    // Eventos del mapa
    setupMapEvents();
    
    console.log('✅ Mapa inicializado');
}

// ================================
// EVENTOS DEL MAPA
// ================================
function setupMapEvents() {
    // Click en el mapa para agregar puntos
    map.on('click', function(e) {
        if (puntos.length >= 10) {
            alert('⚠️ Máximo 10 puntos permitidos');
            return;
        }
        
        agregarPunto(e.latlng.lat, e.latlng.lng);
    });

    // Cuando se dibuja un polígono
    map.on(L.Draw.Event.CREATED, function(e) {
        const layer = e.layer;
        
        if (poligonos.length >= 3) {
            alert('⚠️ Máximo 3 polígonos permitidos');
            return;
        }
        
        drawnItems.addLayer(layer);
        
        // Obtener coordenadas del polígono
        const coords = layer.getLatLngs()[0];
        const coordsArray = coords.map(c => [c.lng, c.lat]);
        
        // Cerrar el polígono (primera coord = última coord)
        coordsArray.push(coordsArray[0]);
        
        // Calcular área aproximada
        const area = L.GeometryUtil.geodesicArea(coords);
        const areaKm2 = (area / 1000000).toFixed(2);
        
        agregarPoligono(coordsArray, areaKm2, layer);
    });

    // Cuando se elimina un elemento dibujado
    map.on(L.Draw.Event.DELETED, function(e) {
        const layers = e.layers;
        layers.eachLayer(function(layer) {
            // Buscar y eliminar polígono correspondiente
            const idx = poligonos.findIndex(p => p.layer === layer);
            if (idx !== -1) {
                poligonos.splice(idx, 1);
                actualizarListaPoligonos();
            }
        });
    });
}

// ================================
// AGREGAR PUNTO
// ================================
function agregarPunto(lat, lon) {
    const id = markerIdCounter++;
    const nombre = `Punto ${id}`;
    
    // Crear marcador con icono oficial de Leaflet (evita rutas rotas)
    const marker = L.marker([lat, lon], {
        title: nombre,
        icon: L.icon({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
            shadowSize: [41, 41]
        })
    });
    
    // Popup del marcador
    marker.bindPopup(`
        <strong>${nombre}</strong><br>
        Lat: ${lat.toFixed(4)}<br>
        Lon: ${lon.toFixed(4)}
    `);
    
    marker.addTo(map);
    
    // Guardar punto
    puntos.push({
        id: id,
        nombre: nombre,
        lat: lat,
        lon: lon,
        marker: marker
    });
    
    actualizarListaPuntos();
    actualizarEstimacion();
    
    console.log(`✅ Punto agregado: ${nombre}`);
}

// ================================
// AGREGAR POLÍGONO
// ================================
function agregarPoligono(coordinates, areaKm2, layer) {
    const id = poligonoIdCounter++;
    const nombre = `Polígono ${id}`;
    
    // Popup del polígono
    layer.bindPopup(`
        <strong>${nombre}</strong><br>
        Área: ${areaKm2} km²
    `);
    
    // Guardar polígono
    poligonos.push({
        id: id,
        nombre: nombre,
        coordinates: coordinates,
        area_km2: parseFloat(areaKm2),
        layer: layer
    });
    
    actualizarListaPoligonos();
    actualizarEstimacion();
    
    console.log(`✅ Polígono agregado: ${nombre} (${areaKm2} km²)`);
}

// ================================
// ELIMINAR PUNTO
// ================================
function eliminarPunto(id) {
    const idx = puntos.findIndex(p => p.id === id);
    if (idx !== -1) {
        map.removeLayer(puntos[idx].marker);
        puntos.splice(idx, 1);
        actualizarListaPuntos();
        actualizarEstimacion();
    }
}

// ================================
// ELIMINAR POLÍGONO
// ================================
function eliminarPoligono(id) {
    const idx = poligonos.findIndex(p => p.id === id);
    if (idx !== -1) {
        drawnItems.removeLayer(poligonos[idx].layer);
        poligonos.splice(idx, 1);
        actualizarListaPoligonos();
        actualizarEstimacion();
    }
}

// ================================
// ACTUALIZAR LISTAS EN PANEL
// ================================
function actualizarListaPuntos() {
    const container = document.getElementById('puntos-lista');
    const count = document.getElementById('puntos-count');
    count.textContent = puntos.length;
    
    if (puntos.length === 0) {
        container.innerHTML = '<p class="hint">No hay puntos agregados</p>';
        return;
    }
    
    container.innerHTML = puntos.map(p => `
        <div class="location-item">
            <div>
                <strong>${p.nombre}</strong>
                <small>Lat: ${p.lat.toFixed(4)}, Lon: ${p.lon.toFixed(4)}</small>
            </div>
            <button onclick="eliminarPunto(${p.id})">Eliminar</button>
        </div>
    `).join('');
}

function actualizarListaPoligonos() {
    const container = document.getElementById('poligonos-lista');
    const count = document.getElementById('poligonos-count');
    count.textContent = poligonos.length;
    
    if (poligonos.length === 0) {
        container.innerHTML = '<p class="hint">No hay polígonos dibujados</p>';
        return;
    }
    
    container.innerHTML = poligonos.map(p => `
        <div class="location-item poligono">
            <div>
                <strong>${p.nombre}</strong>
                <small>Área: ${p.area_km2} km²</small>
            </div>
            <button onclick="eliminarPoligono(${p.id})">Eliminar</button>
        </div>
    `).join('');
}

// ================================
// LIMPIAR TODO
// ================================
function limpiarTodo() {
    if (puntos.length === 0 && poligonos.length === 0) return;
    if (!confirm('¿Eliminar todos los puntos y polígonos?')) return;
    
    puntos.forEach(p => map.removeLayer(p.marker));
    puntos = [];
    drawnItems.clearLayers();
    poligonos = [];
    
    actualizarListaPuntos();
    actualizarListaPoligonos();
    actualizarEstimacion();
}

// ================================
// ESTIMACIÓN DE DESCARGA
// ================================
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
    const dias = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
    const registros = (puntos.length + poligonos.length) * productosSeleccionados.length * dias;
    
    let tiempoEstimado = registros < 1000 ? '30 seg - 1 min' : registros < 5000 ? '1-2 min' : '2-5 min';
    
    textEl.innerHTML = `<strong>${registros.toLocaleString()}</strong> registros<br><small>Tiempo: ${tiempoEstimado}</small>`;
}

function obtenerProductosSeleccionados() {
    return Array.from(document.querySelectorAll('#productos-grupo input[type="checkbox"]:checked')).map(cb => cb.value);
}

// ================================
// VALIDAR Y DESCARGAR DATOS
// ================================
function validarFormulario() {
    if (puntos.length === 0 && poligonos.length === 0) { alert('⚠️ Agrega ubicación'); return false; }
    if (obtenerProductosSeleccionados().length === 0) { alert('⚠️ Selecciona producto'); return false; }
    const inicio = new Date(document.getElementById('fecha-inicio').value);
    const fin = new Date(document.getElementById('fecha-fin').value);
    if (fin < inicio) { alert('⚠️ Fecha final inválida'); return false; }
    if ((fin - inicio) / (1000 * 60 * 60 * 24 * 365) > 10) { alert('⚠️ Máximo 10 años'); return false; }
    return true;
}

async function descargar() {
    if (!validarFormulario()) return;

    const data = {
        puntos: puntos.map(p => ({ nombre: p.nombre, lat: p.lat, lon: p.lon })),
        poligonos: poligonos.map(p => ({ nombre: p.nombre, coordinates: p.coordinates })),
        productos: obtenerProductosSeleccionados(),
        fecha_inicio: document.getElementById('fecha-inicio').value,
        fecha_fin: document.getElementById('fecha-fin').value
    };

    mostrarLoading();
    const btnDescargar = document.getElementById('btn-descargar');
    btnDescargar.disabled = true;
    btnDescargar.textContent = 'Procesando...';
    
    try {
        // FETCH A LA API DE RENDER
        const response = await fetch(`${API_URL}/api/descargar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `precipitacion_evergreen_${new Date().getTime()}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            mostrarExito();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Error desconocido');
        }
    } catch (error) {
        alert(`❌ Error al descargar: ${error.message}`);
    } finally {
        ocultarLoading();
        btnDescargar.disabled = false;
        btnDescargar.textContent = '⬇️ Descargar Datos';
    }
}

// ================================
// UI HELPERS
// ================================
function mostrarLoading() {
    const loading = document.getElementById('loading');
    const message = document.getElementById('loading-message');
    loading.style.display = 'flex';
    const mensajes = ['Conectando con GEE...', 'Procesando satélite...', 'Generando CSV...'];
    let i = 0;
    const interval = setInterval(() => {
        if (loading.style.display === 'none') { clearInterval(interval); return; }
        message.textContent = mensajes[i % mensajes.length];
        i++;
    }, 3000);
}

function ocultarLoading() { document.getElementById('loading').style.display = 'none'; }

function mostrarExito() { alert(`✅ ¡Descarga completada!\n\nRevisa tu carpeta de descargas.`); }

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    document.querySelectorAll('#productos-grupo input, #fecha-inicio, #fecha-fin').forEach(el => {
        el.addEventListener('change', actualizarEstimacion);
    });
});