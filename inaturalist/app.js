import { SYNONYMS, SPECIAL_CASES, CITES_GENERA, getOfficialName, checkSpecialProtection } from './taxonomia_equivalencias.js';

let rceData = {};
let map;
let drawControl;
let drawnItems;
let currentPolygon = null;

let shapeLayers = {
    snaspe: null,
    sp19300: null,
    sperb: null,
    pisos: null,
    simbioHumedales: null
};

// Charts
let taxaChart;
let regionalChart;
let decadaChart;   // new: temporal coverage histogram
let rceIucnChart;  // new: RCE vs IUCN comparative chart

// In-memory data store
let appState = {
    polygon: null,             // Selected area (original, never simplified)
    speciesAggregated: {},     // Keyed by officialName after RCE match
    threatened: [],            // List of CR, EN, VU species
    finalList: [],             // Final species list shown in table
};

// GBIF accumulator — persists across incremental requests
let especiesAcumuladas = [];

// Active class filter for table
let activeClassFilter = null;

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    initChartPlaceholder();

    // Fetch RCE Data
    try {
        const res = await fetch('rce_data.json');
        if (!res.ok) throw new Error('RCE data fetch failed');
        rceData = await res.json();
        console.log(`RCE Data Loaded: ${Object.keys(rceData).length} species`);
    } catch (err) {
        console.error('Failed to load RCE database.', err);
        alert('Error cargando la base de datos oficial (RCE).');
    }

    // Bind primary analysis button
    document.getElementById('runBtn').addEventListener('click', runGBIFAnalysis);

    // Bind secondary (extended kingdoms) button
    const addBtn = document.getElementById('addBtn');
    if (addBtn) addBtn.addEventListener('click', addGBIFExtended);

    // Map layer toggles
    document.querySelectorAll('.layer-cb').forEach(cb => {
        cb.addEventListener('change', (e) => toggleLayer(e.target.value, e.target.checked));
    });

    // Class filter buttons for the species table
    document.querySelectorAll('.class-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cls = btn.dataset.class;
            if (activeClassFilter === cls) {
                activeClassFilter = null;  // toggle off
                document.querySelectorAll('.class-filter-btn').forEach(b => b.classList.remove('active'));
            } else {
                activeClassFilter = cls;
                document.querySelectorAll('.class-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            renderSpeciesTable(appState.finalList);
        });
    });

    window.exportCSV = exportCSVToFile;
});

function initMap() {
    // ── Leaflet Draw Custom Localization & HTML Injection ──
    if (L.drawLocal) {
        L.drawLocal.draw.handlers.polygon.tooltip.cont = 'Soltar para finalizar';
        L.drawLocal.draw.handlers.polygon.tooltip.end = 'Soltar para finalizar';
    }

    // Override Leaflet Draw area calculation formatting to inject custom HTML wrapper
    if (L.GeometryUtil && L.GeometryUtil.readableArea) {
        L.GeometryUtil.readableArea = function (area, isMetric) {
            let areaStr;
            if (isMetric) {
                if (area >= 10000) {
                    areaStr = (area / 10000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
                } else {
                    areaStr = area.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m&sup2;';
                }
            } else {
                areaStr = (area * 0.000247105).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ac';
            }

            return `
                <div class="area-tooltip">
                    <span class="area-value">${areaStr}</span>
                    <span class="area-hint">Soltar para finalizar</span>
                </div>
            `;
        };
    }

    map = L.map('map').setView([-39.8142, -73.2459], 9); // Centered on Valdivia roughly

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    drawControl = new L.Control.Draw({
        edit: {
            featureGroup: drawnItems
        },
        draw: {
            polygon: true,
            polyline: false,
            rectangle: true,
            circle: false,
            marker: false,
            circlemarker: false
        }
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, function (event) {
        const layer = event.layer;

        // Clear previous drawings
        drawnItems.clearLayers();
        drawnItems.addLayer(layer);

        currentPolygon = layer.toGeoJSON();
        appState.polygon = currentPolygon;

        document.getElementById('areaStatus').innerHTML = '<i class="fa-solid fa-check"></i> Área definida exitosamente';
        validateRunReady();
    });

    map.on(L.Draw.Event.EDITED, function () {
        if (drawnItems.getLayers().length > 0) {
            currentPolygon = drawnItems.getLayers()[0].toGeoJSON();
            appState.polygon = currentPolygon;
        }
    });

    map.on(L.Draw.Event.DELETED, function () {
        if (drawnItems.getLayers().length === 0) {
            currentPolygon = null;
            appState.polygon = null;
            document.getElementById('areaStatus').innerText = 'Área no definida';
            validateRunReady();
        }
    });

    // Load Shapefiles asynchronously
    loadGeoJSON('snaspe.geojson', 'snaspe', '#ff4757');
    loadGeoJSON('sp19300.geojson', 'sp19300', '#ffa502');
    loadGeoJSON('sperb.geojson', 'sperb', '#f1c40f');
    loadGeoJSON('pisos.geojson', 'pisos', '#2ecc71');

    // Load SIMBIO layers from MMA ArcGIS REST
    loadSIMBIOLayer(
        'simbioHumedales',
        'https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_HUMEDALES/FeatureServer/0/query',
        '#00bcd4',
        'Humedales'
    );
}

async function loadGeoJSON(url, key, color) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();

        // Layers that can act as AOI when clicked
        const aoiLayers = ['snaspe', 'sp19300', 'sperb', 'pisos'];

        const leafletLayer = L.geoJSON(data, {
            style: {
                color: color,
                weight: 1,
                fillOpacity: 0.2
            },
            // Add hover highlight only for clickable AOI layers
            onEachFeature: aoiLayers.includes(key) ? (feature, layer) => {
                if (key === 'pisos' && feature.properties.piso) {
                    const nombrePiso = feature.properties.piso;
                    layer.bindTooltip(`
                        <span style="color:rgba(46,204,113,0.7);font-size:9px;letter-spacing:0.12em;text-transform:uppercase;display:block;margin-bottom:3px">PISO VEGETACIONAL</span>${nombrePiso}
                    `, {
                        className: 'piso-tooltip',
                        sticky: true,
                        direction: 'top',
                        offset: [0, -5]
                    });
                }
                layer.on({
                    mouseover: (e) => e.target.setStyle({ weight: 2, fillOpacity: 0.45 }),
                    mouseout: (e) => leafletLayer.resetStyle(e.target),
                    click: (e) => selectAOIFromLayer(e, feature, key)
                });
            } : undefined
        });

        shapeLayers[key] = {
            data: data,
            leafletLayer: leafletLayer
        };
        // leafletLayer.addTo(map); // Removed as per instruction
    } catch (e) {
        console.warn(`Could not load ${url}`);
    }
}

/**
 * Handles AOI selection when the user clicks a protected-area polygon.
 * Shows a warning modal if area > 10,000 ha.
 */
function selectAOIFromLayer(e, feature, layerKey) {
    L.DomEvent.stopPropagation(e);

    const geom = feature.geometry;
    const nombre = feature.properties.nombre
        || feature.properties.NOMBRE
        || feature.properties.Nombre
        || feature.properties.name
        || feature.properties.NAME
        || feature.properties.piso
        || layerKey.toUpperCase();

    const areaTurfHa = turf.area(feature) / 10000;
    const AREA_THRESHOLD_HA = 10000;

    const applyAOI = () => {
        // Clear any hand-drawn polygon
        drawnItems.clearLayers();

        currentPolygon = feature;
        appState.polygon = feature;

        document.getElementById('areaStatus').innerHTML =
            `<i class="fa-solid fa-check"></i> AOI: <strong>${nombre}</strong> (${areaTurfHa.toFixed(0)} ha)`;

        validateRunReady();
    };

    if (areaTurfHa > AREA_THRESHOLD_HA) {
        // Show warning modal
        const modal = document.getElementById('aoi-large-modal');
        document.getElementById('aoi-large-msg').textContent =
            `El área seleccionada (${nombre}) tiene aproximadamente ${areaTurfHa.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ha, ` +
            `lo que superará el umbral de ${AREA_THRESHOLD_HA.toLocaleString()} ha. ` +
            `La consulta a GBIF con un polígono WKT de esta extensión puede demorar más de lo usual y retornar hasta 1.500 registros.`;
        modal.style.display = 'flex';

        const confirmBtn = document.getElementById('aoi-large-confirm');
        const newConfirm = confirmBtn.cloneNode(true); // Remove old listeners
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
        newConfirm.addEventListener('click', () => {
            modal.style.display = 'none';
            applyAOI();
        });
    } else {
        applyAOI();
    }
}

function toggleLayer(layerKey, isVisible) {
    // If it's a shape layer
    if (shapeLayers[layerKey] && shapeLayers[layerKey].leafletLayer) {
        if (isVisible) {
            map.addLayer(shapeLayers[layerKey].leafletLayer);
        } else {
            map.removeLayer(shapeLayers[layerKey].leafletLayer);
        }
    }
}

function initChartPlaceholder() {
    const ctx = document.getElementById('taxaChart').getContext('2d');
    taxaChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Sin Data'],
            datasets: [{
                data: [1],
                backgroundColor: ['#2b3a32'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'right',
                    labels: {
                        color: '#9cbca8',
                        boxWidth: 12,
                        font: { size: 10 }
                    }
                }
            },
            cutout: '65%'
        }
    });

    // Chart placeholder for Regional Gaps
    const ctxReg = document.getElementById('regionalChart').getContext('2d');
    regionalChart = new Chart(ctxReg, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                { label: 'Especies RCE Esperadas en la Región (Gap)', data: [], backgroundColor: '#555' },
                { label: 'Observadas', data: [], backgroundColor: '#2ecc71' }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, beginAtZero: true },
                y: { stacked: true }
            },
            plugins: { legend: { display: false } }
        }
    });

    // Gráfico comparativo RCE vs IUCN
    const ctxRceIucn = document.getElementById('rceIucnChart');
    if (ctxRceIucn) {
        rceIucnChart = new Chart(ctxRceIucn.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Amenazada RCE', 'Amenazada IUCN', 'En Ambas'],
                datasets: [{
                    label: 'Nº Especies',
                    data: [0, 0, 0],
                    backgroundColor: ['#f1c40f', '#e67e22', '#e74c3c'],
                    borderRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#9cbca8', font: { size: 10 } }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { color: '#9cbca8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            }
        });
    }

    // Histograma de cobertura temporal por década (GBIF year field)
    const ctxDec = document.getElementById('decadaChart');
    if (ctxDec) {
        decadaChart = new Chart(ctxDec.getContext('2d'), {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Registros por década',
                    data: [],
                    backgroundColor: '#2ecc71',
                    borderRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#9cbca8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { beginAtZero: true, ticks: { color: '#9cbca8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            }
        });
    }
}

function validateRunReady() {
    const runBtn = document.getElementById('runBtn');
    runBtn.disabled = !appState.polygon;
}

// ═══════════════════════════════════════════════════════════════════════
// GBIF ENGINE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Request 1 (default): Flora + Fungi + Animalia
 * Resets the accumulator — starts a fresh analysis for a new area.
 */
async function runGBIFAnalysis() {
    if (!appState.polygon) return;

    // Reset accumulator
    especiesAcumuladas = [];
    appState.speciesAggregated = {};

    // Disable both buttons while running
    document.getElementById('runBtn').disabled = true;
    const addBtn = document.getElementById('addBtn');
    if (addBtn) addBtn.disabled = true;
    document.getElementById('exportBtn').disabled = true;
    const seiaBtn = document.getElementById('seiaBtn');
    if (seiaBtn) seiaBtn.disabled = true;

    await ejecutarRequestGBIF(['Plantae', 'Fungi', 'Animalia'], 'Flora, Fungi y Fauna');

    // Re-enable add button for incremental request
    if (addBtn) addBtn.disabled = false;
}

/**
 * Request 2 (optional): Chromista + Protozoa
 * ACCUMULATES results, does not reset.
 */
async function addGBIFExtended() {
    if (!appState.polygon) return;
    document.getElementById('addBtn').disabled = true;
    await ejecutarRequestGBIF(['Chromista', 'Protozoa'], 'Grupos adicionales (Chromista, Protozoa)');
}

/**
 * Core accumulator: fetches GBIF, deduplicates, runs full pipeline.
 */
async function ejecutarRequestGBIF(reinos, label) {
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    progressContainer.style.display = 'block';
    if (appState.modoContextoRegional) {
        progressText.innerText = `Analizando piso vegetacional (hasta 5.000 especies)...`;
    } else {
        progressText.innerText = `Consultando GBIF: ${label}...`;
    }
    progressBar.style.width = '10%';

    try {
        // ── 1. Build WKT from polygon (simplified + correct winding for GBIF) ─────
        let polyForGBIF;

        // Cambio 4: Simplificación dinámica si el AOI es un piso vegetacional o estamos en modo contexto regional
        if (appState.modoContextoRegional && appState.global_piso_feature) {
            polyForGBIF = simplificarPisoParaGBIF(appState.global_piso_feature);
        } else if (appState.polygon && appState.polygon.properties && appState.polygon.properties.piso) {
            polyForGBIF = simplificarPisoParaGBIF(appState.polygon);
        } else if (appState.global_piso_feature && appState.polygon === appState.global_piso_feature) {
            polyForGBIF = simplificarPisoParaGBIF(appState.polygon);
        } else {
            polyForGBIF = turf.simplify(
                appState.polygon.type === 'Feature'
                    ? appState.polygon
                    : { type: 'Feature', geometry: appState.polygon, properties: {} },
                { tolerance: 0.001, highQuality: false } // Tolerancia 0.001 para mayor precisión
            );
        }

        // GBIF requires GeoJSON CCW winding order (RFC 7946 / OGC).
        polyForGBIF = turf.rewind(polyForGBIF, { reverse: false });

        const geom = polyForGBIF.geometry || polyForGBIF;
        const wkt = geojsonToWkt(geom);
        console.log('[GBIF] WKT (primeros 200 chars):', wkt.substring(0, 200));

        const progressCallback = (pct) => {
            if (progressBar && progressText) {
                const width = 10 + (pct * 0.8);
                progressBar.style.width = `${width}%`;
                progressText.innerText = width < 90 ? `Procesando taxones GBIF: ${pct}%...` : `Finalizando proceso GBIF...`;
            }
        };

        const facetCounts = await fetchGBIFSpecies(reinos, wkt, progressCallback);
        console.log('Fase 1 - taxonKeys del facet:', facetCounts.length);

        const nuevos = await enrichSpecies(facetCounts, progressCallback);
        console.log('Fase 2 - especies tras enriquecimiento:', nuevos.length);

        // Accumulate + deduplicate by taxonKey
        especiesAcumuladas = deduplicar([...especiesAcumuladas, ...nuevos]);
        console.log('Tras deduplicar:', especiesAcumuladas.length);

        // Filtro de especies domésticas
        const TAXONES_EXCLUIR = new Set([
            5219173,   // Canis lupus (colapsa perros domésticos Canis familiaris)
            2495347,   // Sus scrofa (colapsa cerdos domésticos)
            2436775,   // Bos taurus (colapsa vacas)
            2436986,   // Equus caballus (colapsa caballos domésticos)
            2435240,   // Felis catus (gato doméstico)
            5232437,   // Columba livia (paloma urbana)
        ]);
        especiesAcumuladas = especiesAcumuladas.filter(
            e => !TAXONES_EXCLUIR.has(e.taxonKey)
        );
        console.log('Tras filtro domésticas:', especiesAcumuladas.length);

        progressText.innerText = 'Procesando RCE e intersecciones...';
        progressBar.style.width = '90%';
        await new Promise(r => setTimeout(r, 80));

        processMatches();
        console.log('Tras processMatches:', appState.finalList.length);

        updatePanels();

        progressBar.style.width = '100%';
        progressText.innerText = `¡Listo! ${especiesAcumuladas.length} registros únicos acumulados.`;

    } catch (err) {
        console.error('GBIF fetch failed:', err);
        // Mostrar el error real para facilitar diagnóstico
        const errMsg = err.message || String(err);
        progressText.innerHTML = `❌ Error GBIF: <span style="font-size:0.75rem;color:#ff6b6b">${errMsg}</span><br><span style="font-size:0.72rem;color:var(--text-secondary)">Reintenta en unos segundos o verifica la consola (F12).</span>`;
        progressBar.style.width = '0%';
        progressBar.style.background = 'var(--cr-color)';
        // Re-enable run button so user can retry
        document.getElementById('runBtn').disabled = false;
        return;
    }
    setTimeout(() => {
        progressContainer.style.display = 'none';
        document.getElementById('runBtn').disabled = false;
        document.getElementById('exportBtn').disabled = false;
        const seiaBtn = document.getElementById('seiaBtn');
        if (seiaBtn) seiaBtn.disabled = false;
    }, 2000);
}

/**
 * GBIF Occurrence Search with pagination (max 15 pages × 100).
 * @param {string[]} reinos  - GBIF kingdom names
 * @param {HTMLElement} progressText - for live status updates
 * @param {HTMLElement} progressBar
 * @returns {Array} raw GBIF occurrence records
 */
/**
 * FASE 1: Obtener taxonKeys únicos via faceting
 */
async function fetchGBIFSpecies(reinos, wkt, progressCallback) {
    const currentYear = new Date().getFullYear();
    const facetLimit = appState.modoContextoRegional ? 5000 : 1500;

    const baseParams = [
        `geometry=${encodeURIComponent(wkt)}`,
        `country=CL`,
        `year=2000,${currentYear}`,
        `hasCoordinate=true`,
        `hasGeospatialIssue=false`,
        `taxonRank=SPECIES`,
        `basisOfRecord=HUMAN_OBSERVATION`,
        `basisOfRecord=PRESERVED_SPECIMEN`,
        `basisOfRecord=LITERATURE`,
        ...reinos.map(k => `kingdom=${encodeURIComponent(k)}`),
        `facet=speciesKey`,
        `facetLimit=${facetLimit}`,
        `facetOffset=0`,
        `limit=0`
    ].join('&');

    const url = `https://api.gbif.org/v1/occurrence/search?${baseParams}`;
    const data = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        headers: { 'Accept': 'application/json' }
    }).then(r => r.json());

    // facetCounts = array de { name: "taxonKey", count: N }
    const facetCounts = data.facets?.[0]?.counts || [];
    return facetCounts;
}

/**
 * FASE 2: Enriquecer cada taxonKey con metadata de especie
 */
async function enrichSpecies(facetCounts, progressCallback) {
    const BATCH_SIZE = 20;
    const CONCURRENCY = 5;
    const enriched = [];

    // dividir en batches de 20
    const batches = [];
    for (let i = 0; i < facetCounts.length; i += BATCH_SIZE) {
        batches.push(facetCounts.slice(i, i + BATCH_SIZE));
    }

    // procesar con concurrencia de 5 batches simultáneos
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
        const chunk = batches.slice(i, i + CONCURRENCY);
        const chunkResults = await Promise.all(
            chunk.map(batch =>
                Promise.all(batch.map(f =>
                    Promise.all([
                        fetch(`https://api.gbif.org/v1/species/${f.name}`, {
                            method: 'GET',
                            mode: 'cors',
                            headers: { 'Accept': 'application/json' }
                        }).then(r => r.json()),
                        fetch(`https://api.gbif.org/v1/species/${f.name}/iucnRedListCategory`, {
                            method: 'GET',
                            mode: 'cors',
                            headers: { 'Accept': 'application/json' }
                        })
                            .then(r => r.ok ? r.json() : { code: '' })
                            .catch(() => ({ code: '' }))
                    ])
                        .then(([sp, iucn]) => ({
                            taxonKey: parseInt(f.name),
                            species: (sp.canonicalName || sp.scientificName || '').toLowerCase(),
                            kingdom: sp.kingdom || '',
                            class: sp.class || '',
                            rank: sp.rank || '',
                            nRegistrosAOI: f.count,
                            basisOfRecord: 'HUMAN_OBSERVATION', // valor por defecto
                            year: null,
                            iucnCategory: iucn.code || '',
                        }))
                        .catch(err => {
                            console.warn('enrichSpecies falló para taxonKey:', f.name, err);
                            return null;
                        })
                ))
            )
        );

        enriched.push(...chunkResults.flat().filter(Boolean));

        // Actualizar barra de progreso si existe
        if (progressCallback) {
            const processedCount = Math.min((i + CONCURRENCY) * BATCH_SIZE, facetCounts.length);
            const pct = Math.round((processedCount / facetCounts.length) * 100);
            progressCallback(Math.min(pct, 100));
        }

        // pausa mínima entre ciclos para no saturar GBIF api
        if (i + CONCURRENCY < batches.length) {
            await new Promise(r => setTimeout(r, 100));
        }
    }

    return enriched;
}

/**
 * Convert a GeoJSON geometry (Polygon or MultiPolygon) to WKT string.
 * GBIF expects longitude FIRST: POLYGON((lng lat, lng lat, ...))
 */
function geojsonToWkt(geometry) {
    const ringToWkt = (ring) => ring.map(([lng, lat]) => `${lng} ${lat}`).join(',');

    if (geometry.type === 'Polygon') {
        const rings = geometry.coordinates.map(r => `(${ringToWkt(r)})`).join(',');
        return `POLYGON(${rings})`;
    }
    if (geometry.type === 'MultiPolygon') {
        const polys = geometry.coordinates
            .map(poly => `(${poly.map(r => `(${ringToWkt(r)})`).join(',')})`);
        return `MULTIPOLYGON(${polys.join(',')})`;
    }
    // Feature wrapper
    if (geometry.type === 'Feature') return geojsonToWkt(geometry.geometry);
    throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

/**
 * Map centroid latitude to Chilean GADM GID.
 */
function getGadmGid(lat) {
    if (lat > -18.5) return 'CHL.3_1';   // Arica y Parinacota
    if (lat > -21.4) return 'CHL.15_1';  // Tarapacá
    if (lat > -26.0) return 'CHL.16_1';  // Antofagasta (approx)
    if (lat > -29.2) return 'CHL.5_1';   // Atacama
    if (lat > -32.2) return 'CHL.4_1';   // Coquimbo
    if (lat > -33.0) return 'CHL.13_1';  // Valparaíso
    if (lat > -34.0) return 'CHL.7_1';   // Metropolitana
    if (lat > -34.8) return 'CHL.6_1';   // O'Higgins
    if (lat > -36.2) return 'CHL.11_1';  // Maule
    if (lat > -37.2) return 'CHL.17_1';  // Ñuble
    if (lat > -38.2) return 'CHL.2_1';   // Biobío
    if (lat > -39.6) return 'CHL.9_1';   // La Araucanía
    if (lat > -40.6) return 'CHL.14_1';  // Los Ríos
    if (lat > -44.0) return 'CHL.10_1';  // Los Lagos
    if (lat > -49.0) return 'CHL.1_1';   // Aysén
    return 'CHL.12_1';                    // Magallanes
}

/**
 * Simplifies a very complex vegetative floor polygon for GBIF to stay under the string limit.
 * Uses progressive simplification to ensure WKT < 8000 characters.
 */
function simplificarPisoParaGBIF(feature) {
    const coordsOriginales = turf.coordAll(feature).length;
    let simplificado = feature;
    const tolerancias = [0.1, 0.2, 0.5, 1.0];

    for (const tolerancia of tolerancias) {
        simplificado = turf.simplify(feature, {
            tolerance: tolerancia,
            highQuality: false,
            mutate: false
        });

        // Si es MULTIPOLYGON, quedarse solo con el polígono más grande
        if (simplificado.geometry && simplificado.geometry.type === 'MultiPolygon') {
            const poligonos = simplificado.geometry.coordinates.map((coords, i) => ({
                index: i,
                area: turf.area(turf.polygon(coords))
            }));
            poligonos.sort((a, b) => b.area - a.area);
            simplificado = turf.polygon(
                simplificado.geometry.coordinates[poligonos[0].index]
            );
        }

        const geom = simplificado.geometry || simplificado;
        const wktTest = geojsonToWkt(geom);
        console.log(`[Piso WKT] tolerancia=${tolerancia}, vértices: ${coordsOriginales} → ${turf.coordAll(simplificado).length}, chars: ${wktTest.length}`);

        if (wktTest.length < 8000) break;
    }

    if (simplificado.geometry && simplificado.geometry.type === 'MultiPolygon') {
        console.warn('[Piso] Geometría sigue siendo MultiPolygon tras simplificación');
    }

    // Quedarse solo con el anillo exterior (índice 0)
    // descartando todos los huecos (índices 1, 2, 3...)
    if (simplificado.geometry && simplificado.geometry.type === 'Polygon') {
        simplificado = turf.polygon([
            simplificado.geometry.coordinates[0]
        ]);
    }

    // Intentar convex hull primero (cubre toda el área)
    try {
        const hull = turf.convex(feature);
        if (hull) {
            simplificado = hull;
            console.log('[Piso WKT] convex hull aplicado');
        }
    } catch (e) {
        // fallback: bounding box (siempre funciona)
        const bbox = turf.bbox(feature);
        simplificado = turf.bboxPolygon(bbox);
        console.log('[Piso WKT] fallback a bounding box');
    }

    // Final CCW Winding Order correction (GBIF standard)
    simplificado = turf.rewind(simplificado, {
        reverse: false,
        mutate: true
    });

    if (window._debugPisoLayer) map.removeLayer(window._debugPisoLayer);
    window._debugPisoLayer = L.geoJSON(simplificado, {
        style: {
            color: '#ff6b35',
            weight: 2,
            fillOpacity: 0.15,
            dashArray: '6,4'
        }
    }).addTo(map);

    return simplificado;
}

/**
 * Deduplicate GBIF records by taxonKey.
 */
function deduplicar(lista) {
    const vistos = new Set();
    return lista.filter(r => {
        const key = r.taxonKey || r.species || r.occurrenceID;
        if (!key || vistos.has(key)) return false;
        vistos.add(key);
        return true;
    });
}


function processMatches() {
    appState.threatened = [];

    // ── 1. Compute AOI geo-intersections ONCE (not per species) ───────────────
    // These are properties of the polygon, not the species.
    // appState.polygon is ALWAYS the original, never the simplified one.
    let geoSnaspe = false, geo19300 = false, geoErb = false, geoHumedales = false;
    let pisoPredominante = 'No Determinado';
    let minDistSnaspe = 99999;

    if (appState.polygon) {
        const centroid = turf.centroid(appState.polygon);

        if (shapeLayers.snaspe && shapeLayers.snaspe.data) {
            turf.featureEach(shapeLayers.snaspe.data, (feat) => {
                try {
                    if (turf.booleanIntersects(appState.polygon, feat)) geoSnaspe = true;
                    const d = turf.distance(centroid, turf.centroid(feat), { units: 'kilometers' });
                    if (d < minDistSnaspe) minDistSnaspe = d;
                } catch (_) { }
            });
        }
        if (shapeLayers.sp19300 && shapeLayers.sp19300.data) {
            turf.featureEach(shapeLayers.sp19300.data, (feat) => {
                try { if (turf.booleanIntersects(appState.polygon, feat)) geo19300 = true; } catch (_) { }
            });
        }
        if (shapeLayers.sperb && shapeLayers.sperb.data) {
            turf.featureEach(shapeLayers.sperb.data, (feat) => {
                try { if (turf.booleanIntersects(appState.polygon, feat)) geoErb = true; } catch (_) { }
            });
        }
        if (shapeLayers.pisos && shapeLayers.pisos.data) {
            turf.featureEach(shapeLayers.pisos.data, (feat) => {
                try {
                    if (turf.booleanIntersects(appState.polygon, feat)) {
                        pisoPredominante = feat.properties.piso || 'No Determinado';
                        appState.global_piso_feature = feat;
                        return false; // detener iteración
                    }
                } catch (_) { }
            });
        }
        if (shapeLayers.simbioHumedales && shapeLayers.simbioHumedales.data) {
            turf.featureEach(shapeLayers.simbioHumedales.data, (feat) => {
                try { if (turf.booleanIntersects(appState.polygon, feat)) geoHumedales = true; } catch (_) { }
            });
        }
    }

    // Store geo globals for SEIA paragraph + panel alerts
    appState.global_snaspe_int = geoSnaspe;
    appState.global_snaspe_dist = minDistSnaspe < 99999 ? minDistSnaspe : null;
    appState.global_19300_int = geo19300;
    appState.global_erb_int = geoErb;
    appState.global_piso_vegetacional = pisoPredominante;
    appState.global_humedales_int = geoHumedales;

    // ── 2. Map GBIF records → unified species entries ──────────────────────────
    const finalSpecies = especiesAcumuladas.map(rec => {
        const rawName = (rec.species || '').trim().toLowerCase();
        const officialName = getOfficialName(rawName);

        // RCE lookup
        const rceInfo = rceData[officialName];
        const rceCategory = rceInfo ? rceInfo.categoria : null;

        // Common name: prefer rce_data, fallback to GBIF vernacularName
        const commonName = (rceInfo && rceInfo.nombre_comun)
            ? rceInfo.nombre_comun
            : (rec.vernacularName || '');

        // Special protection (CITES / Ley Bosques)
        const specialProtection = checkSpecialProtection(rawName);

        const entry = {
            scientificName: rawName,
            officialName: officialName,
            commonName: commonName,
            group: rec.kingdom || 'Otro',   // for doughnut
            clase: rec.class || '',        // for table filter
            count: rec.nRegistrosAOI || rec.individualCount || 1, // Shannon proxy
            basisOfRecord: rec.basisOfRecord || '',
            year: rec.year || null,
            taxonKey: rec.taxonKey,
            rceCategory: rceCategory,
            iucnCategory: rec.iucnCategory || '',
            specialProtection: specialProtection,
            // Geo fields: same for all species in this AOI run
            intersecta_snaspe: geoSnaspe ? 'Sí' : 'No',
            intersecta_19300: geo19300 ? 'Sí' : 'No',
            intersecta_erb: geoErb ? 'Sí' : 'No',
            piso_vegetacional: pisoPredominante,
            dist_km_snaspe: minDistSnaspe < 99999 ? minDistSnaspe.toFixed(1) : 'N/A',
            nRegistrosAOI: rec.nRegistrosAOI || 1,
        };

        const threatRce = rceCategory && ['CR', 'EN', 'VU'].includes(rceCategory);
        const threatIucn = rec.iucnCategory && !['LC', 'DD', 'NE', ''].includes(rec.iucnCategory);

        if (threatRce || threatIucn) {
            appState.threatened.push(entry);
        }

        return entry;
    }).filter(e => e.officialName); // drop records with no species name

    // Sort by count descending
    finalSpecies.sort((a, b) => b.count - a.count);
    appState.finalList = finalSpecies;
}

function updatePanels() {
    const list = appState.finalList;

    // Panel 1: Stats
    document.getElementById('statTotalSpp').innerText = list.length;
    const rceCount = list.filter(s => s.rceCategory).length;
    document.getElementById('statRceSpp').innerText = rceCount;

    // Doughnut: group by GBIF kingdom (cleaner than iNat iconic_taxa)
    const kingdomCounts = {};
    list.forEach(s => { kingdomCounts[s.group] = (kingdomCounts[s.group] || 0) + 1; });
    taxaChart.data.labels = Object.keys(kingdomCounts);
    taxaChart.data.datasets[0] = {
        data: Object.values(kingdomCounts),
        backgroundColor: ['#2ecc71', '#3498db', '#e74c3c', '#9b59b6', '#f1c40f', '#e67e22', '#1abc9c', '#95a5a6'],
        borderWidth: 0
    };
    taxaChart.update();

    // Panel 1: Intersection alerts
    const alertSnaspe = document.getElementById('alert-snaspe');
    if (appState.global_snaspe_int) {
        alertSnaspe.innerHTML = `<i class="fa-solid fa-shield"></i> SNASPE: <span style="color:var(--cr-color)">Intersección Directa</span>`;
    } else {
        const d = appState.global_snaspe_dist != null ? `${appState.global_snaspe_dist.toFixed(1)} km` : '-';
        alertSnaspe.innerHTML = `<i class="fa-solid fa-shield"></i> SNASPE: <span>A ${d}</span>`;
    }
    document.getElementById('alert-19300').innerHTML =
        `<i class="fa-solid fa-landmark"></i> SP 19.300: <span style="color:${appState.global_19300_int ? 'var(--en-color)' : 'var(--text-secondary)'}">${appState.global_19300_int ? 'Intersección' : 'No intersecta'}</span>`;
    document.getElementById('alert-erb').innerHTML =
        `<i class="fa-solid fa-map"></i> SP ERB: <span style="color:${appState.global_erb_int ? 'var(--vu-color)' : 'var(--text-secondary)'}">${appState.global_erb_int ? 'Intersección' : 'No intersecta'}</span>`;

    // SIMBIO alerts
    const elHumedal = document.getElementById('alert-humedales');
    if (elHumedal) {
        elHumedal.innerHTML = `<i class="fa-solid fa-water"></i> Humedal SIMBIO: <span style="color:${appState.global_humedales_int ? 'var(--en-color)' : 'var(--text-secondary)'}">${appState.global_humedales_int ? 'Intersección' : 'No intersecta'}</span>`;
    }

    // Panel 5: Threatened
    const tlUI = document.getElementById('threatenedList');
    tlUI.innerHTML = '';
    let counts = { CR: 0, EN: 0, VU: 0 };
    appState.threatened.forEach(s => { if (counts[s.rceCategory] !== undefined) counts[s.rceCategory]++; });
    document.getElementById('countCR').innerText = counts.CR;
    document.getElementById('countEN').innerText = counts.EN;
    document.getElementById('countVU').innerText = counts.VU;

    // RCE vs IUCN chart update
    let countRceThreat = 0;
    let countIucnThreat = 0;
    let countBothThreat = 0;

    list.forEach(s => {
        const tRce = s.rceCategory && ['CR', 'EN', 'VU'].includes(s.rceCategory);
        const tIucn = s.iucnCategory && !['LC', 'DD', 'NE', ''].includes(s.iucnCategory);
        if (tRce) countRceThreat++;
        if (tIucn) countIucnThreat++;
        if (tRce && tIucn) countBothThreat++;
    });

    if (rceIucnChart) {
        rceIucnChart.data.datasets[0].data = [countRceThreat, countIucnThreat, countBothThreat];
        rceIucnChart.update();
    }

    if (appState.threatened.length === 0) {
        tlUI.innerHTML = '<li class="empty-state">No se detectaron especies amenazadas para el área seleccionada.</li>';
    } else {
        const order = { CR: 1, EN: 2, VU: 3 };
        const sorted = [...appState.threatened].sort((a, b) => {
            const catA = a.rceCategory || a.iucnCategory || 'VU';
            const catB = b.rceCategory || b.iucnCategory || 'VU';
            return (order[catA] || 4) - (order[catB] || 4) || b.count - a.count;
        });
        sorted.slice(0, 5).forEach(t => {
            const li = document.createElement('li');
            const showBtn = t.taxonKey && (t.rceCategory || t.iucnCategory);

            let badgesHTML = '';
            if (t.rceCategory && ['CR', 'EN', 'VU'].includes(t.rceCategory)) {
                badgesHTML += `<span class="cat-badge cat-${t.rceCategory}">RCE: ${t.rceCategory}</span>`;
            }
            if (t.iucnCategory && !['LC', 'DD', 'NE', ''].includes(t.iucnCategory)) {
                badgesHTML += `<span class="iucn-badge iucn-${t.iucnCategory}" style="margin-left:4px;">IUCN: ${t.iucnCategory}</span>`;
            }

            li.innerHTML = `
                <div class="t-meta"><div>${badgesHTML}</div><span>${t.count} reg.</span>${showBtn ? `<button class="dist-mini-btn" onclick="window.openDistribucionModal(${JSON.stringify(t).replace(/"/g, '&quot;')})" title="Ver distribución GBIF"><i class="fa-solid fa-map"></i></button>` : ''}</div>
                <div class="t-name"><i>${t.officialName.charAt(0).toUpperCase() + t.officialName.slice(1)}</i></div>
                ${t.commonName ? `<div style="font-size:0.75rem;color:#9cbca8">${t.commonName}</div>` : ''}
            `;
            tlUI.appendChild(li);
        });
        if (sorted.length > 5) {
            const li = document.createElement('li');
            li.className = 'empty-state';
            li.style.padding = '0.5rem';
            li.innerText = `+ ${sorted.length - 5} especies adicionales. Ver tabla o CSV.`;
            tlUI.appendChild(li);
        }
    }

    // Panel 1 (bio section): Riqueza S
    const S = list.length;
    document.getElementById('idxS').innerText = S;

    // Chao1 — ONLY on HUMAN_OBSERVATION records (statísticamente válido)
    const soloObs = list.filter(r => r.basisOfRecord === 'HUMAN_OBSERVATION');
    const sObs = soloObs.length;
    const f1 = soloObs.filter(s => s.count === 1).length;
    const f2 = soloObs.filter(s => s.count === 2).length;
    let chao1 = sObs;
    if (f2 > 0) {
        chao1 = sObs + ((f1 * (f1 - 1)) / (2 * (f2 + 1)));
    }
    document.getElementById('idxChao1').innerText = chao1 > sObs ? Math.round(chao1) : sObs;
    document.getElementById('idxCompletitud').innerText = (sObs / (chao1 > 0 ? chao1 : 1) * 100).toFixed(1) + '%';

    // IVC Evergreen
    const pesosIVC = { CR: 5, EN: 4, VU: 3, NT: 2, LC: 1 };
    let sumaIVC = 0;
    let countsIVC = { CR: 0, EN: 0, VU: 0, NT: 0, LC: 0 };
    list.forEach(s => {
        if (s.rceCategory && pesosIVC[s.rceCategory]) {
            sumaIVC += pesosIVC[s.rceCategory];
            countsIVC[s.rceCategory]++;
        }
    });
    const ivc = S > 0 ? parseFloat((sumaIVC / S).toFixed(2)) : 0;
    document.getElementById('ivcScore').innerText = ivc.toFixed(2);
    const ivcScore2El = document.getElementById('ivcScore2');
    if (ivcScore2El) ivcScore2El.innerText = ivc.toFixed(2);
    let ivcText = 'Baja sensibilidad ambiental';
    if (ivc > 1.5) ivcText = '<strong>Alta sensibilidad</strong>, relevante para SEIA';
    else if (ivc > 0.5) ivcText = 'Sensibilidad moderada';
    document.getElementById('ivcInterp').innerHTML =
        `${ivcText} <br><span style="font-size:0.75rem;color:var(--text-secondary)">CR:${countsIVC.CR}×5 | EN:${countsIVC.EN}×4 | VU:${countsIVC.VU}×3 | NT:${countsIVC.NT}×2 | LC:${countsIVC.LC}×1</span>`;

    // Proporciones
    const amenazadas = counts.CR + counts.EN + counts.VU;
    document.getElementById('idxRcePct').innerText = S > 0 ? `${((rceCount / S) * 100).toFixed(1)}%` : '-';
    document.getElementById('idxAmenPct').innerText = S > 0 ? `${((amenazadas / S) * 100).toFixed(1)}%` : '-';

    // Marginales (count≤1 — single-record detections)
    const marginal = list.filter(s => s.count <= 1).length;
    document.getElementById('idxMarginales').innerText = marginal;

    // GAP Regional RCE (unchanged logic, uses getRegionMma)

    // GAP Regional RCE (unchanged logic, uses getRegionMma)
    const centroid = turf.centroid(appState.polygon);
    const regKey = getRegionMma(centroid.geometry.coordinates[1]);
    document.getElementById('regionalName').innerText = regKey.toUpperCase();
    const rceRegional = [];
    for (let key in rceData) {
        if (rceData[key].regiones && rceData[key].regiones[regKey] === 1) {
            rceRegional.push({ nombre: key, categoria: rceData[key].categoria, grupo: rceData[key].grupo || 'S/G', comun: rceData[key].nombre_comun });
        }
    }
    const grps = {};
    rceRegional.forEach(r => {
        const g = r.grupo.split('-')[1] || r.grupo.split('-')[0] || 'Otro';
        if (!grps[g]) grps[g] = { pot: 0, obs: 0, ausentes: [] };
        grps[g].pot++;
        const detectada = list.find(l => l.officialName === r.nombre);
        if (detectada) grps[g].obs++;
        else grps[g].ausentes.push(r);
    });
    const gLabels = Object.keys(grps).slice(0, 8);
    regionalChart.data.labels = gLabels;
    regionalChart.data.datasets[0].data = gLabels.map(l => grps[l].pot - grps[l].obs);
    regionalChart.data.datasets[1].data = gLabels.map(l => grps[l].obs);
    regionalChart.update();

    const cntAusentes = document.getElementById('ausentesContainer');
    let allAusentes = [];
    Object.values(grps).forEach(g => allAusentes.push(...g.ausentes));
    const threatAusentes = allAusentes
        .filter(a => ['CR', 'EN', 'VU'].includes(a.categoria))
        .sort((a, b) => ({ CR: 1, EN: 2, VU: 3 }[a.categoria] - { CR: 1, EN: 2, VU: 3 }[b.categoria]));
    if (threatAusentes.length > 0) {
        let html = `<div style="background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);padding:0.5rem;border-radius:4px">`;
        html += `<strong><i class="fa-solid fa-triangle-exclamation" style="color:var(--cr-color)"></i> Alerta de Vacío:</strong> ${threatAusentes.length} especies amenazadas formales en esta región no aparecen en GBIF.<br><ul style="list-style:none;padding-left:0;margin-top:0.5rem">`;
        threatAusentes.slice(0, 5).forEach(a => { html += `<li><span class="cat-${a.categoria}" style="display:inline-block;width:30px;font-weight:bold">${a.categoria}</span> <i>${a.nombre}</i></li>`; });
        if (threatAusentes.length > 5) html += `<li>...y ${threatAusentes.length - 5} más (Recomendación: Muestreo dirigido).</li>`;
        html += `</ul></div>`;
        cntAusentes.innerHTML = html;
    } else {
        cntAusentes.innerHTML = `<span style="color:var(--brand-green)"><i class="fa-solid fa-check"></i> Cobertura GBIF aparentemente completa para taxa de alta sensibilidad.</span>`;
    }

    // NUEVO: Histograma de cobertura temporal por década
    const porDecada = {};
    list.forEach(r => {
        if (!r.year) return;
        const decada = Math.floor(r.year / 10) * 10;
        porDecada[decada] = (porDecada[decada] || 0) + 1;
    });
    const decadas = Object.keys(porDecada).sort();
    if (decadaChart) {
        decadaChart.data.labels = decadas.map(d => `${d}s`);
        decadaChart.data.datasets[0].data = decadas.map(d => porDecada[d]);
        decadaChart.update();
    }

    // Cambio 3 - Banner ampliación de búsqueda
    const bannerContainer = document.getElementById('piso-banner-container');
    if (bannerContainer && !appState.pisoBannerDismissed) {
        const totalEspecies = list.length;
        const pisoDetectado = appState.global_piso_vegetacional;

        if (totalEspecies < 30 && pisoDetectado && pisoDetectado !== 'No Determinado') {
            document.getElementById('piso-banner-text').innerHTML = `<strong>⚠️ Se detectaron pocas especies (${totalEspecies}).</strong> El AOI se encuentra en: <em>${pisoDetectado}</em>. ¿Deseas ampliar la búsqueda a todo el piso vegetacional?`;
            bannerContainer.style.display = 'flex';
        } else {
            bannerContainer.style.display = 'none';
        }
    }

    // Render species table (respects activeClassFilter)
    renderSpeciesTable(list);

    // Enable export buttons
    document.getElementById('exportBtn').disabled = false;
    const seiaBtn = document.getElementById('seiaBtn');
    if (seiaBtn) seiaBtn.disabled = false;
}

/**
 * Renders the species table, applying the active class filter if set.
 * Called by updatePanels() and by the class-filter button listeners.
 */
function renderSpeciesTable(fullList) {
    const filtered = activeClassFilter
        ? fullList.filter(s => (s.clase || '').toLowerCase() === activeClassFilter.toLowerCase())
        : fullList;

    const tbody = document.querySelector('#speciesTable tbody');
    tbody.innerHTML = '';
    document.getElementById('tableCountBadge').innerText =
        activeClassFilter
            ? `${filtered.length} / ${fullList.length} Registros (filtro: ${activeClassFilter})`
            : `${fullList.length} Registros`;

    filtered.forEach(item => {
        const tr = document.createElement('tr');
        if (item.rceCategory === 'CR' || item.rceCategory === 'EN') tr.classList.add('alert-row');

        const displayName = item.scientificName !== item.officialName
            ? `<i>${item.officialName.charAt(0).toUpperCase() + item.officialName.slice(1)}</i> <span style="font-size:0.7rem;color:var(--text-secondary)">(sin. ${item.scientificName})</span>`
            : `<i>${item.officialName.charAt(0).toUpperCase() + item.officialName.slice(1)}</i>`;

        const special = item.specialProtection
            ? `<span class="badge" style="background:var(--brand-green);color:#121814">${item.specialProtection.status}</span>`
            : '';

        const geoWarnings = [];
        if (item.intersecta_snaspe === 'Sí') geoWarnings.push('<span style="color:var(--cr-color);font-weight:bold" title="Intersecta SNASPE">SNASPE</span>');
        else if (item.dist_km_snaspe !== 'N/A') geoWarnings.push(`<span style="color:var(--text-secondary);font-size:0.75rem">${item.dist_km_snaspe}km SNASPE</span>`);
        if (item.intersecta_19300 === 'Sí') geoWarnings.push('<span style="color:var(--en-color);font-weight:bold">S19.300</span>');
        if (item.intersecta_erb === 'Sí') geoWarnings.push('<span style="color:var(--vu-color);font-weight:bold">S.ERB</span>');

        // IUCN Category Badge
        const iucnCell = item.iucnCategory && !['NE', ''].includes(item.iucnCategory)
            ? `<span class="iucn-badge iucn-${item.iucnCategory}">${item.iucnCategory}</span>`
            : '-';

        // Distribution modal button (only for threatened species with taxonKey)
        const showDistBtn = item.taxonKey && (item.rceCategory || item.iucnCategory) && !['NE', ''].includes(item.rceCategory || '');
        const distCell = showDistBtn
            ? `<button class="dist-mini-btn" onclick="window.openDistribucionModal(${JSON.stringify(item).replace(/"/g, '&quot;')})" title="Ver distribución GBIF"><i class="fa-solid fa-map"></i></button>`
            : '-';

        tr.innerHTML = `
            <td>${displayName}</td>
            <td>${item.commonName || '-'}</td>
            <td>${item.group}${item.clase ? ' / ' + item.clase : ''}</td>
            <td>${item.count}</td>
            <td>${item.rceCategory ? `<strong>${item.rceCategory}</strong>` : '-'}</td>
            <td>${iucnCell}</td>
            <td>${special}</td>
            <td style="font-size:0.75rem">${item.piso_vegetacional}</td>
            <td>${geoWarnings.join(' | ')}</td>
            <td>${distCell}</td>
        `;
        tbody.appendChild(tr);
    });
}

function exportCSVToFile() {
    if (!appState.finalList || appState.finalList.length === 0) return;

    const headers = [
        "nombre_cientifico",
        "nombre_comun",
        "grupo",
        "n_observaciones",
        "categoria_rce",
        "categoria_iucn",
        "nota_especial",
        "piso_vegetacional",
        "intersecta_snaspe",
        "intersecta_19300",
        "intersecta_erb",
        "dist_km_snaspe"
    ];

    let csvContent = headers.join(",") + "\n";

    appState.finalList.forEach(item => {
        // Prepare fields, escaping commas and quotes
        const row = [
            item.officialName,
            item.commonName ? `"${item.commonName.replace(/"/g, '""')}"` : "",
            item.group,
            item.count,
            item.rceCategory || "",
            item.iucnCategory || "",
            item.specialProtection ? `"${item.specialProtection.status}"` : "",
            `"${item.piso_vegetacional}"`,
            item.intersecta_snaspe,
            item.intersecta_19300,
            item.intersecta_erb,
            item.dist_km_snaspe
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "evergreen_biodiversidad_export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Helper para aproximar la Región según latitud del centroide para el GAP RCE
// Esta es una aproximación MVP rápida dado que la app enfoca uso en zona central/sur
function getRegionMma(lat) {
    if (lat > -21.4) return 'XV';
    if (lat > -26.0) return 'I'; // (I + XV) Simplificado
    if (lat > -29.2) return 'III';
    if (lat > -32.2) return 'IV';
    if (lat > -33.8) return 'V';
    // RM y VI casi se traslapan en longitud, asumiremos RM en una franja central estricta
    if (lat > -34.8) return 'RM';
    if (lat > -36.2) return 'VII';
    if (lat > -38.2) return 'VIII';
    if (lat > -39.6) return 'IX';
    if (lat > -40.6) return 'XIV';
    if (lat > -44.0) return 'X';
    if (lat > -49.0) return 'XI';
    return 'XII';
}

// ═══════════════════════════════════════════════════════════════════════
// IMPORTADOR DE ARCHIVO GeoJSON / KML COMO AOI
// ═══════════════════════════════════════════════════════════════════════

function importAOIFile(input) {
    const file = input.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            let geojson;

            if (ext === 'kml') {
                // Convert KML to GeoJSON using @tmcw/togeojson
                if (typeof toGeoJSON === 'undefined') {
                    alert('La librería de conversión KML no está cargada. Por favor recarga la página.');
                    return;
                }
                const parser = new DOMParser();
                const kmlDoc = parser.parseFromString(e.target.result, 'text/xml');
                geojson = toGeoJSON.kml(kmlDoc);
            } else {
                // GeoJSON / JSON
                geojson = JSON.parse(e.target.result);
            }

            // Normalise: accept FeatureCollection, Feature, or bare geometry
            let targetFeature = null;
            if (geojson.type === 'FeatureCollection') {
                // Take the first polygon/multipolygon feature
                targetFeature = geojson.features.find(f =>
                    f.geometry &&
                    (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
                );
            } else if (geojson.type === 'Feature') {
                if (geojson.geometry &&
                    (geojson.geometry.type === 'Polygon' || geojson.geometry.type === 'MultiPolygon')) {
                    targetFeature = geojson;
                }
            } else if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
                // Bare geometry — wrap in Feature
                targetFeature = { type: 'Feature', geometry: geojson, properties: {} };
            }

            if (!targetFeature) {
                alert('No se encontró ningún polígono válido en el archivo. Asegúrate de que contenga al menos un Polygon o MultiPolygon.');
                input.value = '';
                return;
            }

            // Compute area
            const areaHa = (turf.area(targetFeature) / 10000).toFixed(0);
            const nombre = targetFeature.properties?.nombre
                || targetFeature.properties?.NOMBRE
                || targetFeature.properties?.name
                || targetFeature.properties?.NAME
                || file.name.replace(/\.[^.]+$/, '');

            // Clear previous drawings and apply
            drawnItems.clearLayers();

            // Draw on map with a distinct blue highlight
            const importedLayer = L.geoJSON(targetFeature, {
                style: { color: '#3498db', weight: 2, fillOpacity: 0.15, dashArray: '5 4' }
            }).addTo(map);

            map.fitBounds(importedLayer.getBounds(), { padding: [20, 20] });

            currentPolygon = targetFeature;
            appState.polygon = targetFeature;

            document.getElementById('areaStatus').innerHTML =
                `<i class="fa-solid fa-file-import"></i> AOI importado: <strong>${nombre}</strong> (~${parseInt(areaHa).toLocaleString('es-CL')} ha)`;

            validateRunReady();

            // Warn if very large
            if (parseInt(areaHa) > 10000) {
                const modal = document.getElementById('aoi-large-modal');
                document.getElementById('aoi-large-msg').textContent =
                    `El archivo importado (${nombre}) cubre aproximadamente ${parseInt(areaHa).toLocaleString('es-CL')} ha, ` +
                    `lo que supera el umbral de 10.000 ha. La consulta a iNaturalist puede tardar más de lo habitual.`;
                modal.style.display = 'flex';
                const confirmBtn = document.getElementById('aoi-large-confirm');
                const newConfirm = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
                newConfirm.addEventListener('click', () => { modal.style.display = 'none'; });
            }

        } catch (err) {
            console.error('Error al importar archivo:', err);
            alert(`Error al leer el archivo: ${err.message}`);
        } finally {
            input.value = ''; // Reset so same file can be re-imported
        }
    };

    reader.readAsText(file);
}

window.importAOIFile = importAOIFile;

// ═══════════════════════════════════════════════════════════════════════
// GENERADOR DE PÁRRAFO LÍNEA BASE SEIA
// ═══════════════════════════════════════════════════════════════════════

function generateSEIAParagraph() {
    const list = appState.finalList;
    const poly = appState.polygon;
    if (!list || list.length === 0 || !poly) return;

    // ── 1. Datos geográficos básicos ─────────────────────────────────
    const centroid = turf.centroid(poly);
    const [lon, lat] = centroid.geometry.coordinates;
    const areaHa = (turf.area(poly) / 10000).toFixed(1);
    const regKey = getRegionMma(lat);

    const regionNombres = {
        'XV': 'Región de Arica y Parinacota', 'I': 'Región de Tarapacá',
        'II': 'Región de Antofagasta', 'III': 'Región de Atacama',
        'IV': 'Región de Coquimbo', 'V': 'Región de Valparaíso',
        'RM': 'Región Metropolitana de Santiago', 'VI': 'Región del Libertador Gral. Bdo. OHiggins',
        'VII': 'Región del Maule', 'VIII': 'Región del Biobío',
        'IX': 'Región de La Araucanía', 'XIV': 'Región de Los Ríos',
        'X': 'Región de Los Lagos', 'XI': 'Región de Aysén',
        'XII': 'Región de Magallanes y la Antártica Chilena'
    };
    const regionNombre = regionNombres[regKey] || `Región ${regKey}`;

    // Nombre del AOI (si vino de un shapefile click)
    const aoiText = document.getElementById('areaStatus').textContent.trim();
    const aoiNombre = aoiText.includes('AOI:') ? aoiText.replace('AOI:', '').replace(/\(.*\)/, '').trim() : 'el área de estudio';

    // ── 2. Estadísticas de biodiversidad ─────────────────────────────────
    const S = list.length;
    const rceList = list.filter(s => s.rceCategory);
    const crList = list.filter(s => s.rceCategory === 'CR');
    const enList = list.filter(s => s.rceCategory === 'EN');
    const vuList = list.filter(s => s.rceCategory === 'VU');
    const ntList = list.filter(s => s.rceCategory === 'NT');

    // Chao1
    const f1 = list.filter(s => s.count === 1).length;
    const f2 = list.filter(s => s.count === 2).length;
    let chao1 = S;
    if (f2 > 0) chao1 = Math.round(S + (f1 * f1) / (2 * f2));
    const completitud = S > 0 ? ((S / chao1) * 100).toFixed(0) : 0;

    // IVC
    const pesosIVC = { CR: 5, EN: 4, VU: 3, NT: 2, LC: 1 };
    let sumaIVC = 0;
    list.forEach(s => { if (s.rceCategory && pesosIVC[s.rceCategory]) sumaIVC += pesosIVC[s.rceCategory]; });
    const ivc = S > 0 ? (sumaIVC / S).toFixed(2) : 0;
    const ivcLabel = ivc > 1.5 ? 'alta' : ivc > 0.5 ? 'moderada' : 'baja';

    // ── 3. Grupos taxonómicos con RCE ─────────────────────────────────
    const groupMap = {};
    rceList.forEach(s => {
        groupMap[s.group] = (groupMap[s.group] || 0) + 1;
    });
    const gruposStr = Object.entries(groupMap)
        .sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `${n} ${g.toLowerCase()}`)
        .join(', ');

    // ── 4. Geoespacial ─────────────────────────────────────────────────
    const intersectSnaspe = list.some(s => s.intersecta_snaspe === 'Sí');
    const intersect19300 = list.some(s => s.intersecta_19300 === 'Sí');
    const intersectErb = list.some(s => s.intersecta_erb === 'Sí');

    let geoFrase = '';
    const geoAreas = [];
    if (intersectSnaspe) geoAreas.push('el Sistema Nacional de Áreas Silvestres Protegidas del Estado (SNASPE)');
    if (intersect19300) geoAreas.push('sitios prioritarios de la Estrategia Regional de Biodiversidad (Ley 19.300)');
    if (intersectErb) geoAreas.push('la Estrategia Regional de Biodiversidad');

    if (geoAreas.length > 0) {
        geoFrase = `El área de estudio presenta intersecciones o estrecha proximidad con ${geoAreas.join(' y ')}, lo que implica restricciones adicionales de acuerdo a la legislación ambiental vigente.`;
    } else {
        geoFrase = `El área de estudio no registró intersecciones directas con unidades del SNASPE, sitios prioritarios de la Ley 19.300 ni áreas de la Estrategia Regional de Biodiversidad, aunque se recomienda verificar con límites oficiales actualizados.`;
    }

    // ── 5. Especies clave a mencionar ─────────────────────────────────
    const topCR = crList.slice(0, 3).map(s => `\u2022 ${s.officialName}${s.commonName ? ' (' + s.commonName + ')' : ''} [CR]`).join('\n');
    const topEN = enList.slice(0, 2).map(s => `\u2022 ${s.officialName}${s.commonName ? ' (' + s.commonName + ')' : ''} [EN]`).join('\n');
    const especiesDestacadas = [topCR, topEN].filter(Boolean).join('\n');

    // ── 6. Construir el párrafo ────────────────────────────────────────
    const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long' });

    // Piso vegetacional
    const pisoPred = appState.global_piso_vegetacional && appState.global_piso_vegetacional !== 'No Determinado'
        ? ` El piso vegetacional predominante en el área corresponde a ${appState.global_piso_vegetacional}.`
        : '';

    // SIMBIO frases
    let simbioFrase = '';
    if (appState.global_humedales_int) {
        simbioFrase += ' El área intersecta con el Inventario Nacional de Humedales (SIMBIO-MMA), lo que exige una evaluación específica de los ecosistemas acuáticos presentes según la Ley 21.202.';
    }

    let parrafo = `COMPONENTE FLORA Y FAUNA – LÍNEA BASE BIODIVERSIDAD\n`;
    parrafo += `Fecha de generación: ${fecha}. Fuente: GBIF (Global Biodiversity Information Facility) + RCE MMA (19° Proceso).\n\n`;

    parrafo += `El área de influencia del proyecto, ubicada en la ${regionNombre} en torno a ${aoiNombre} (coordenadas aproximadas: ${lat.toFixed(4)}°S, ${Math.abs(lon).toFixed(4)}°O; superficie estimada: ${parseFloat(areaHa).toLocaleString('es-CL')} ha), fue caracterizada mediante la revisión de registros de ocurrencia de la plataforma GBIF (Global Biodiversity Information Facility) y su posterior cruce con el Reglamento de Clasificación de Especies según Estado de Conservación (RCE) del Ministerio del Medio Ambiente de Chile (19° Proceso).${pisoPred}\n\n`;

    parrafo += `Se identificaron un total de ${S} especies de flora y fauna con presencia documentada en el área de estudio o en su entorno inmediato${chao1 > S ? `, estimando mediante el índice Chao1 una riqueza potencial de hasta ${chao1} especies (completitud del muestreo: ${completitud}%)` : ''}.`;

    if (rceList.length > 0) {
        parrafo += ` De estas, ${rceList.length} (${((rceList.length / S) * 100).toFixed(1)}% del total) cuentan con clasificación oficial en el RCE, distribuidas de la siguiente manera: ${crList.length} especie${crList.length !== 1 ? 's' : ''} en categoría En Peligro Crítico (CR), ${enList.length} En Peligro (EN), ${vuList.length} Vulnerable (VU)${ntList.length > 0 ? ` y ${ntList.length} Casi Amenazada (NT)` : ''}.`;
    } else {
        parrafo += ` Ninguna de las especies registradas presenta clasificación en el RCE vigente para esta región.`;
    }

    if (gruposStr) {
        parrafo += ` Las especies RCE corresponden principalmente a: ${gruposStr}.`;
    }
    parrafo += `\n\n`;

    parrafo += `El Índice de Valor de Conservación (IVC) Evergreen calculado para el área es de ${ivc}, lo que refleja una sensibilidad ambiental ${ivcLabel} en términos de biodiversidad de interés para el Sistema de Evaluación de Impacto Ambiental (SEIA).\n\n`;

    parrafo += geoFrase + `\n\n`;

    if (simbioFrase) {
        parrafo += simbioFrase.trim() + `\n\n`;
    }

    if (especiesDestacadas) {
        parrafo += `Entre las especies de mayor relevancia para la evaluación ambiental se destacan:\n${especiesDestacadas}\n\n`;
    }

    parrafo += `Dado lo anterior, se recomienda que el proponente profundice la caracterización mediante muestreos de terreno dirigidos, especialmente para los taxa amenazados identificados, y que incorpore las medidas de mitigación, compensación y seguimiento correspondientes en el instrumento de evaluación ambiental según lo dispuesto en el artículo 11 de la Ley 19.300 y su Reglamento.`;

    // ── 7. Mostrar modal ────────────────────────────────────────────────
    document.getElementById('seia-text').value = parrafo;
    document.getElementById('seia-modal').style.display = 'flex';
}

function copySEIAText() {
    const ta = document.getElementById('seia-text');
    ta.select();
    navigator.clipboard.writeText(ta.value).then(() => {
        const btn = document.querySelector('#seia-modal button:last-child');
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Copiado!';
        btn.style.background = 'var(--brand-dark-green, #27ae60)';
        setTimeout(() => { btn.innerHTML = original; btn.style.background = ''; }, 2000);
    }).catch(() => {
        // Fallback para navegadores sin permisos
        document.execCommand('copy');
    });
}

// Exponer al scope global para que funcionen los onclick del HTML (ES module)
window.generateSEIAParagraph = generateSEIAParagraph;
window.copySEIAText = copySEIAText;
window.exportCSV = exportCSVToFile;

// ═══════════════════════════════════════════════════════════════════════
// MODAL DE DISTRIBUCIÓN POR ESPECIE (GBIF Occurrence Density Map)
// ═══════════════════════════════════════════════════════════════════════

let distribucionMap = null; // Leaflet map instance for the modal

/**
 * Opens the species distribution modal with a GBIF tile layer.
 * Receives a species entry from appState.finalList.
 */
function openDistribucionModal(especie) {
    const modal = document.getElementById('distribucion-modal');
    if (!modal) return;

    // Fill header info
    document.getElementById('dist-species-name').textContent =
        especie.officialName.charAt(0).toUpperCase() + especie.officialName.slice(1);
    const catEl = document.getElementById('dist-rce-cat');
    catEl.textContent = especie.rceCategory || '';
    catEl.className = `cat-badge cat-${especie.rceCategory}`;
    document.getElementById('dist-records').textContent = especie.count;
    const gbifLink = document.getElementById('dist-gbif-link');
    gbifLink.href = `https://www.gbif.org/species/${especie.taxonKey}`;

    modal.style.display = 'flex';

    // Small delay to allow display:flex to settle before initializing Leaflet
    setTimeout(() => {
        const container = document.getElementById('dist-map');
        if (!container) return;

        // Destroy previous map instance if any
        if (distribucionMap) {
            distribucionMap.remove();
            distribucionMap = null;
        }

        // Center on AOI or default to Valdivia
        let center = [-39.8142, -73.2459];
        let zoom = 10;
        if (appState.polygon) {
            try {
                const c = turf.centroid(appState.polygon);
                center = [c.geometry.coordinates[1], c.geometry.coordinates[0]];
                zoom = 10;
            } catch (_) { }
        }

        distribucionMap = L.map(container).setView(center, zoom);

        // Base layer
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© CartoDB',
            subdomains: 'abcd',
            maxZoom: 18
        }).addTo(distribucionMap);

        // GBIF occurrence density — hex bins (visible, scaled to record density)
        // bin=hex + hexPerTile=15 crea hexágonos grandes; style=greenHeat da rampas verdes
        L.tileLayer(
            `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@2x.png?taxonKey=${especie.taxonKey}&style=scaled.circles`,
            { opacity: 0.9, maxZoom: 18 }
        ).addTo(distribucionMap);

        // Overlay AOI polygon
        if (appState.polygon) {
            try {
                L.geoJSON(appState.polygon, {
                    style: { color: '#52B788', weight: 2, fillOpacity: 0.1 }
                }).addTo(distribucionMap);
            } catch (_) { }
        }

        distribucionMap.invalidateSize();
    }, 120);
}

function closeDistribucionModal() {
    const modal = document.getElementById('distribucion-modal');
    if (modal) modal.style.display = 'none';
    if (distribucionMap) {
        distribucionMap.remove();
        distribucionMap = null;
    }
}

async function copyDistSpeciesName() {
    const name = document.getElementById('dist-species-name').textContent;
    try {
        await navigator.clipboard.writeText(name);
    } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = name;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
    const btn = document.getElementById('dist-copy-btn');
    if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Copiado!';
        btn.style.background = 'var(--brand-dark-green, #27ae60)';
        setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 2000);
    }
}

window.openDistribucionModal = openDistribucionModal;
window.closeDistribucionModal = closeDistribucionModal;
window.copyDistSpeciesName = copyDistSpeciesName;

// ═══════════════════════════════════════════════════════════════════════
// SIMBIO — Carga de capas ArcGIS REST en bounding-box dinámico
// ═══════════════════════════════════════════════════════════════════════

/**
 * Loads a SIMBIO FeatureServer layer via bounding-box + GeoJSON.
 * Uses WGS84 envelope (EPSG:4326), transforming to 32719 on server side
 * via inSR=4326 parameter so we can pass lng/lat directly.
 *
 * @param {string} key        – shapeLayers key
 * @param {string} baseUrl    – FeatureServer layer query URL
 * @param {string} color      – stroke color for the Leaflet layer
 * @param {string} label      – human-readable name (for tooltips)
 */
async function loadSIMBIOLayer(key, baseUrl, color, label) {
    try {
        // Use a very large Chile-wide bounding box so we load all features once.
        // In production you could filter by the AOI bbox on demand;
        // for an MVP with small-to-medium datasets this is acceptable.
        const params = [
            'where=1%3D1',
            'geometry=-80%2C-56%2C-60%2C-17',   // Chile bounding box (lng_min,lat_min,lng_max,lat_max)
            'geometryType=esriGeometryEnvelope',
            'inSR=4326',
            'spatialRel=esriSpatialRelIntersects',
            'outFields=*',
            'f=geojson',
            'resultRecordCount=2000'
        ].join('&');

        const res = await fetch(`${baseUrl}?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!data.features || data.features.length === 0) {
            console.warn(`[SIMBIO] ${label}: 0 features returned.`);
            return;
        }

        // Convert from EPSG:32719 (UTM) — the server returns 4326 when f=geojson
        const leafletLayer = L.geoJSON(data, {
            style: { color, weight: 1.5, fillOpacity: 0.18, dashArray: '4 3' },
            onEachFeature: (feature, layer) => {
                const nombre = feature.properties?.NOM_HUMDET
                    || feature.properties?.NOMBRE
                    || feature.properties?.nombre
                    || feature.properties?.NOM_PLAN
                    || label;
                layer.on({
                    mouseover: (e) => e.target.setStyle({ weight: 3, fillOpacity: 0.4 }),
                    mouseout: (e) => leafletLayer.resetStyle(e.target),
                    click: (e) => selectAOIFromLayer(e, feature, key)
                });
                layer.bindTooltip(`<strong>${label}</strong><br>${nombre}`, { sticky: true });
            }
        });

        shapeLayers[key] = { data, leafletLayer };
        // leafletLayer.addTo(map);  <-- Ya no se carga de inmediato
        console.log(`[SIMBIO] ${label}: ${data.features.length} features cargados (por defecto oculto).`);

        // Update toggle checkbox label dynamically (shows feature count)
        const cb = document.querySelector(`.layer-cb[value="${key}"]`);
        if (cb && cb.parentElement) {
            cb.parentElement.title = `${label} — ${data.features.length} entidades`;
        }
    } catch (err) {
        console.warn(`[SIMBIO] ${label} no disponible:`, err.message);
        const aviso = document.getElementById('simbio-aviso');
        if (aviso) {
            aviso.textContent = `⚠ Capa ${label} (SIMBIO/MMA) no disponible. El análisis continúa sin ella.`;
            aviso.style.display = 'block';
            setTimeout(() => { aviso.style.display = 'none'; }, 6000);
        }
    }
}
