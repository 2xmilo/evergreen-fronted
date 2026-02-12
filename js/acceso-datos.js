// ========================================
// EVERGREEN - ACCESO A DATOS JS (VERSIÓN FINAL INTEGRADA)
// ========================================

const API_URL = 'https://evergreen-backend-awv1.onrender.com'; 

// Estado de la aplicación
let map;
let controlCapas; 
let drawnItems;
let puntos = [];
let poligonos = [];
let markerIdCounter = 1;
let poligonoIdCounter = 1;

// ================================
// 1. INICIALIZACIÓN DEL MAPA
// ================================
function initMap() {
    const mapaCalles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    });

    const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    });

    const topografico = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    });

    map = L.map('map', {
        center: [-39.8142, -73.2459], // Valdivia
        zoom: 10,
        layers: [mapaCalles]
    });

    const baseMaps = {
        "🗺️ Mapa de Calles": mapaCalles,
        "🛰️ Satélite Híbrido": satelite,
        "⛰️ Topográfico": topografico
    };

    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const overlayMaps = {
        "✍️ Mis Dibujos": drawnItems
    };

    controlCapas = L.control.layers(baseMaps, overlayMaps, {
        collapsed: false,
        position: 'topright'
    }).addTo(map);

    cargarCuencas();

    drawControl = new L.Control.Draw({
        position: 'topright',
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
    map.addControl(drawControl);

    setupMapEvents();
    console.log('✅ Sistema Evergreen inicializado');
}

// ========================================
// 2. CARGA DE CUENCAS (GEE)
// ========================================
function cargarCuencas() {
    fetch(`${API_URL}/api/capa-cuencas`)
        .then(response => response.json())
        .then(data => {
            if (data.url) {
                const capaCuencas = L.tileLayer(data.url, {
                    attribution: 'GEE | HydroSHEDS',
                    opacity: 0.8
                });
                controlCapas.addOverlay(capaCuencas, "🌊 Cuencas Hidrográficas");
            }
        })
        .catch(err => console.error("❌ Error al cargar cuencas:", err));
}

// ================================
// 3. EVENTOS DEL MAPA
// ================================
function setupMapEvents() {
    map.on('click', function(e) {
        if (puntos.length >= 10) { alert('⚠️ Máximo 10 puntos'); return; }
        agregarPunto(e.latlng.lat, e.latlng.lng);
    });

    map.on(L.Draw.Event.CREATED, function(e) {
        const layer = e.layer;
        if (poligonos.length >= 3) { alert('⚠️ Máximo 3 polígonos'); return; }
        drawnItems.addLayer(layer);
        
        const coords = layer.getLatLngs()[0];
        const coordsArray = coords.map(c => [c.lng, c.lat]);
        coordsArray.push(coordsArray[0]); 
        
        const area = L.GeometryUtil.geodesicArea(coords);
        agregarPoligono(coordsArray, (area / 1000000).toFixed(2), layer);
    });

    map.on(L.Draw.Event.DELETED, function(e) {
        e.layers.eachLayer(function(layer) {
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
// 4. LÓGICA DE DATOS Y PANEL
// ================================
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
        drawnItems.removeLayer(poligonos[idx].layer);
        poligonos.splice(idx, 1);
        actualizarListaPoligonos();
        actualizarEstimacion();
    }
}

// ================================
// 5. ACTUALIZACIÓN VISUAL DEL PANEL
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
            <div><strong>${p.nombre}</strong><br><small>Área: ${p.area_km2} km²</small></div>
            <button onclick="eliminarPoligono(${p.id})">Eliminar</button>
        </div>`).join('');
}

function limpiarTodo() {
    if (!confirm('¿Limpiar todo?')) return;
    puntos.forEach(p => map.removeLayer(p.marker));
    puntos = [];
    drawnItems.clearLayers();
    poligonos = [];
    actualizarListaPuntos();
    actualizarListaPoligonos();
    actualizarEstimacion();
}

// ========================================
// 6. LÓGICA DE ESTIMACIÓN Y PRODUCTOS
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
    
    if (totalRegistros > 50000) {
        textEl.innerHTML = `
            <strong style="color: #dc3545;">⚠️ ${totalRegistros.toLocaleString()} registros</strong><br>
            <small>Excede el límite de seguridad (50k).</small>
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
// 7. ENVÍO DE DATOS AL BACKEND (RENDER)
// ========================================
async function descargar() {
    const prods = obtenerProductosSeleccionados();
    const fInicio = document.getElementById('fecha-inicio').value;
    const fFin = document.getElementById('fecha-fin').value;

    const dias = Math.ceil((new Date(fFin) - new Date(fInicio)) / (1000 * 60 * 60 * 24)) + 1;
    const totalRegistros = (puntos.length + poligonos.length) * prods.length * dias;

    if (totalRegistros > 50000) {
        alert(`⚠️ La solicitud actual (${totalRegistros.toLocaleString()} registros) supera el límite de 50.000.`);
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
    const loading = document.getElementById('loading');
    btn.disabled = true;
    btn.textContent = '🛰️ Procesando en GEE...';
    if (loading) loading.style.display = 'flex';

    try {
        const response = await fetch(`${API_URL}/api/descargar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Error en el procesamiento de datos.');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `evergreen_data_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        alert('✅ ¡Descarga exitosa!');
    } catch (error) {
        alert(`Error: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = '⬇️ Descargar Datos';
        if (loading) loading.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    document.querySelectorAll('#productos-grupo input, #fecha-inicio, #fecha-fin').forEach(el => {
        el.addEventListener('change', actualizarEstimacion);
    });
});