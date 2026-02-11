// ================================
// ACCESO A DATOS METEOROLÓGICOS
// Mapa interactivo + Descarga
// ================================

// Configuración
const API_URL = 'http://localhost:5000';  // Backend API (cambiar en producción)

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
    
    // Crear marcador
    const marker = L.marker([lat, lon], {
        title: nombre,
        icon: L.icon({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34]
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
        // Eliminar marcador del mapa
        map.removeLayer(puntos[idx].marker);
        
        // Eliminar del array
        puntos.splice(idx, 1);
        
        actualizarListaPuntos();
        actualizarEstimacion();
        
        console.log(`🗑️ Punto eliminado: ${id}`);
    }
}

// ================================
// ELIMINAR POLÍGONO
// ================================
function eliminarPoligono(id) {
    const idx = poligonos.findIndex(p => p.id === id);
    if (idx !== -1) {
        // Eliminar layer del mapa
        drawnItems.removeLayer(poligonos[idx].layer);
        
        // Eliminar del array
        poligonos.splice(idx, 1);
        
        actualizarListaPoligonos();
        actualizarEstimacion();
        
        console.log(`🗑️ Polígono eliminado: ${id}`);
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
    if (puntos.length === 0 && poligonos.length === 0) {
        return;
    }
    
    if (!confirm('¿Eliminar todos los puntos y polígonos?')) {
        return;
    }
    
    // Eliminar todos los puntos
    puntos.forEach(p => map.removeLayer(p.marker));
    puntos = [];
    
    // Eliminar todos los polígonos
    drawnItems.clearLayers();
    poligonos = [];
    
    actualizarListaPuntos();
    actualizarListaPoligonos();
    actualizarEstimacion();
    
    console.log('🗑️ Todo limpiado');
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
    
    // Calcular días
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    const dias = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
    
    // Calcular registros
    const numUbicaciones = puntos.length + poligonos.length;
    const registros = numUbicaciones * productosSeleccionados.length * dias;
    
    // Estimar tiempo
    let tiempoEstimado;
    if (registros < 1000) {
        tiempoEstimado = '30 segundos - 1 minuto';
    } else if (registros < 5000) {
        tiempoEstimado = '1-2 minutos';
    } else if (registros < 20000) {
        tiempoEstimado = '2-4 minutos';
    } else {
        tiempoEstimado = '4-6 minutos';
    }
    
    textEl.innerHTML = `
        <strong>${registros.toLocaleString()}</strong> registros estimados<br>
        <small>Tiempo: ${tiempoEstimado}</small>
    `;
}

// ================================
// OBTENER PRODUCTOS SELECCIONADOS
// ================================
function obtenerProductosSeleccionados() {
    const checkboxes = document.querySelectorAll('#productos-grupo input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// ================================
// VALIDAR FORMULARIO
// ================================
function validarFormulario() {
    // Validar ubicaciones
    if (puntos.length === 0 && poligonos.length === 0) {
        alert('⚠️ Agrega al menos un punto o polígono');
        return false;
    }
    
    // Validar productos
    const productos = obtenerProductosSeleccionados();
    if (productos.length === 0) {
        alert('⚠️ Selecciona al menos un producto satelital');
        return false;
    }
    
    // Validar fechas
    const fechaInicio = document.getElementById('fecha-inicio').value;
    const fechaFin = document.getElementById('fecha-fin').value;
    
    if (!fechaInicio || !fechaFin) {
        alert('⚠️ Define el período temporal');
        return false;
    }
    
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    
    if (fin < inicio) {
        alert('⚠️ La fecha final debe ser posterior a la fecha inicial');
        return false;
    }
    
    // Validar máximo 10 años
    const diffAnios = (fin - inicio) / (1000 * 60 * 60 * 24 * 365);
    if (diffAnios > 10) {
        alert('⚠️ El período máximo es de 10 años');
        return false;
    }
    
    return true;
}

// ================================
// DESCARGAR DATOS
// ================================
async function descargar() {
    console.log('🚀 Iniciando descarga...');
    
    // Validar
    if (!validarFormulario()) {
        return;
    }
    
    // Preparar datos
    const data = {
        puntos: puntos.map(p => ({
            nombre: p.nombre,
            lat: p.lat,
            lon: p.lon
        })),
        poligonos: poligonos.map(p => ({
            nombre: p.nombre,
            coordinates: p.coordinates
        })),
        productos: obtenerProductosSeleccionados(),
        fecha_inicio: document.getElementById('fecha-inicio').value,
        fecha_fin: document.getElementById('fecha-fin').value
    };
    
    console.log('📦 Datos a enviar:', data);
    
    // Mostrar loading
    mostrarLoading();
    
    // Deshabilitar botón
    const btnDescargar = document.getElementById('btn-descargar');
    btnDescargar.disabled = true;
    btnDescargar.textContent = 'Procesando...';
    
    try {
        const response = await fetch("https://evergreen-backend-awv1.onrender.com/api/descargar", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            // Descargar archivo
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `precipitacion_${new Date().getTime()}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            console.log('✅ Descarga completada');
            
            // Mostrar mensaje de éxito
            mostrarExito();
            
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Error desconocido');
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
        alert(`❌ Error al descargar: ${error.message}`);
        
    } finally {
        ocultarLoading();
        btnDescargar.disabled = false;
        btnDescargar.textContent = '⬇️ Descargar Datos';
    }
}

// ================================
// LOADING OVERLAY
// ================================
function mostrarLoading() {
    const loading = document.getElementById('loading');
    const message = document.getElementById('loading-message');
    
    loading.style.display = 'flex';
    
    // Mensajes dinámicos
    const mensajes = [
        'Conectando con Google Earth Engine...',
        'Procesando imágenes satelitales...',
        'Extrayendo datos de precipitación...',
        'Generando archivo CSV...'
    ];
    
    let i = 0;
    const interval = setInterval(() => {
        if (loading.style.display === 'none') {
            clearInterval(interval);
            return;
        }
        message.textContent = mensajes[i % mensajes.length];
        i++;
    }, 3000);
}

function ocultarLoading() {
    document.getElementById('loading').style.display = 'none';
}

function mostrarExito() {
    alert(`✅ ¡Descarga completada!

📊 Tu archivo CSV ha sido descargado exitosamente.

💡 Estos datos son satelitales sin corrección local.
Para proyectos que requieren alta precisión, considera nuestros servicios de corrección y validación profesional.

¿Necesitas ayuda? Contáctanos.`);
}

// ================================
// EVENT LISTENERS
// ================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🌍 Inicializando aplicación...');
    
    // Inicializar mapa
    initMap();
    
    // Listeners para checkboxes de productos
    document.querySelectorAll('#productos-grupo input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', actualizarEstimacion);
    });
    
    // Listeners para fechas
    document.getElementById('fecha-inicio').addEventListener('change', actualizarEstimacion);
    document.getElementById('fecha-fin').addEventListener('change', actualizarEstimacion);
    
    console.log('✅ Aplicación lista');
});