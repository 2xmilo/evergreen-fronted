/* ==========================================================================
   WORKSPACE ZONES - Selector multi-zona e inicializacion
   Split mechanically from workspace.js; keep global function names stable.
   ========================================================================== */

// ==========================================================================
//  ZONE SELECTOR — Multi-zona (pro/admin)
// ==========================================================================

/**
 * Renderiza el dropdown de zonas guardadas.
 * Para free con 1 zona: oculta el botón selector.
 * Para pro/admin con ≥1 zona: muestra el chevron.
 */
function renderZoneSelector(zones) {
    var btn      = document.getElementById('zone-selector-btn');
    var dropdown = document.getElementById('zone-selector-dropdown');
    if (!btn || !dropdown) return;

    zones = (typeof getValidStoredZones === 'function')
        ? getValidStoredZones(zones)
        : (zones || []).filter(function(z) { return z && z.polygon_geojson; });

    var plan     = window._sbUserPlan || 'free';
    var maxZones = (typeof PLAN_LIMITS !== 'undefined' && PLAN_LIMITS[plan] !== undefined)
        ? PLAN_LIMITS[plan] : 1;

    // Mostrar el botón solo si el plan permite más de 1 zona
    var showSelector = maxZones > 1 || (zones && zones.length > 1);
    btn.style.display = showSelector ? 'flex' : 'none';

    if (!zones || zones.length === 0) return;

    var activeId = WorkspaceState.zonaId;
    var used     = zones.length;
    var max      = maxZones === Infinity ? '∞' : maxZones;

    var html = '';
    zones.forEach(function(z) {
        var isActive = z.id === activeId;
        var ha       = z.zona_ha ? z.zona_ha.toLocaleString('es-CL') + ' ha' : 'Sin área';
        html += '<div class="zone-selector-item' + (isActive ? ' active' : '') + '"' +
            ' onclick="switchToZone(\'' + z.id + '\')">' +
            '<span class="zone-sel-dot"></span>' +
            '<span class="zone-sel-name">' + (z.zone_name || 'Sin nombre') + '</span>' +
            '<span class="zone-sel-ha">' + ha + '</span>' +
            '</div>';
    });

    // Botón "Nueva zona" (solo si está bajo el límite)
    if (maxZones === Infinity || used < maxZones) {
        html += '<div class="zone-selector-add" onclick="startNewZone()">' +
            '<i class="fas fa-plus" style="font-size:10px;"></i>' +
            '<span>Nueva zona</span>' +
            '<span style="margin-left:auto;font-size:10px;opacity:0.5;">' + used + '/' + max + '</span>' +
            '</div>';
    }

    dropdown.innerHTML = html;

    // CTA "Módulo Comparativo": pro+ navega (si hay ≥2 zonas); free lo ve con candado.
    var cta = document.getElementById('rs-compare-cta');
    if (cta) {
        var puedeComparar = (typeof featureDisponible === 'function')
            ? featureDisponible('comparador')
            : (maxZones === Infinity || maxZones >= 2);
        var arrow = cta.querySelector('.rs-compare-arrow');
        if (!puedeComparar) {
            // Free: mostrar como teaser con candado → click abre el modal Pro
            cta.style.display = 'flex';
            cta.classList.add('rs-compare-cta--locked');
            if (arrow) arrow.className = 'fas fa-lock rs-compare-arrow';
        } else {
            // Pro+: mostrar solo si hay ≥2 zonas para comparar
            cta.style.display = (used >= 2) ? 'flex' : 'none';
            cta.classList.remove('rs-compare-cta--locked');
            if (arrow) arrow.className = 'fas fa-arrow-right rs-compare-arrow';
        }
    }
}

// Intercepta el click del CTA Comparativo: free → modal Pro; pro+ → navega.
function comparadorGate(e) {
    if (typeof featureDisponible === 'function' && !featureDisponible('comparador')) {
        if (e && e.preventDefault) e.preventDefault();
        if (typeof mostrarModalPro === 'function') mostrarModalPro('El Módulo Comparativo');
        return false;
    }
    return true;
}
window.comparadorGate = comparadorGate;

function goToComparador() {
    if (typeof featureDisponible === 'function' && !featureDisponible('comparador')) {
        if (typeof mostrarModalPro === 'function') mostrarModalPro('El Módulo Comparativo');
        return;
    }
    window.location.href = 'comparador.html';
}

function toggleZoneSelector() {
    var dropdown = document.getElementById('zone-selector-dropdown');
    var chev     = document.getElementById('zone-selector-chev');
    if (!dropdown) return;
    var open = dropdown.style.display === 'block';
    dropdown.style.display = open ? 'none' : 'block';
    if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
}

function closeZoneSelector() {
    var dropdown = document.getElementById('zone-selector-dropdown');
    var chev     = document.getElementById('zone-selector-chev');
    if (dropdown) dropdown.style.display = 'none';
    if (chev) chev.style.transform = '';
}

/**
 * Cambia la zona activa y recarga todos los datos de esa zona.
 */
function switchToZone(zoneId) {
    closeZoneSelector();
    if (zoneId === WorkspaceState.zonaId) return;
    if (!window._sbUserId) return;

    // Limpiar capas de análisis del mapa
    if (typeof vegLayer !== 'undefined' && vegLayer)        { try { map.removeLayer(vegLayer); }       catch(e){} vegLayer = null; }
    if (typeof aguaLayer !== 'undefined' && aguaLayer)      { try { map.removeLayer(aguaLayer); }      catch(e){} aguaLayer = null; }
    if (typeof _demLayerActual !== 'undefined' && _demLayerActual) { try { map.removeLayer(_demLayerActual); } catch(e){} _demLayerActual = null; }
    if (typeof _indicadorLayer !== 'undefined' && _indicadorLayer) { try { map.removeLayer(_indicadorLayer); } catch(e){} _indicadorLayer = null; }
    if (globalDrawnItems) globalDrawnItems.clearLayers();

    switchZoneCloud(window._sbUserId, zoneId).then(function(zone) {
        if (!zone) { mostrarNotificacion('❌ Error cargando la zona'); return; }

        updateZoneUI();
        renderIndicadorCards();
        if (typeof refreshIndRows === 'function') refreshIndRows();

        if (WorkspaceState.zona) {
            try { restoreZoneOnMap(); } catch(e) {}
        }

        // Restaurar tiles y última capa activa
        _restoreTilesCache();
        setTimeout(restoreLastActiveLayer, 400);

        // Actualizar lista local con nuevo is_active
        (window._sbUserZones || []).forEach(function(z) { z.is_active = z.id === zoneId; });
        renderZoneSelector(window._sbUserZones);

        mostrarNotificacion('📍 Zona "' + zone.zone_name + '" cargada');
    });
}

// ==========================================================================
//  MODAL LÍMITE DE PLAN
// ==========================================================================

function mostrarModalLimite(result) {
    var overlay = document.getElementById('modal-limite-overlay');
    if (!overlay) return;

    var plan    = result && result.plan ? result.plan : 'free';
    var used    = result && result.used !== undefined ? result.used : '?';
    var max     = result && result.max  !== undefined ? result.max  : 1;

    var planLabel = plan === 'free' ? 'Free' : plan === 'pro' ? 'Pro' : plan;

    var msgEl = document.getElementById('modal-limite-msg');
    if (msgEl) {
        msgEl.innerHTML =
            'Tu plan <strong>' + planLabel + '</strong> permite ' + max +
            (max === 1 ? ' zona almacenada.' : ' zonas almacenadas.') +
            '<br>Elimina una zona existente o contacta a Evergreen para ampliar tu acceso.';
    }

    overlay.classList.add('open');
}

function cerrarModalLimite() {
    var overlay = document.getElementById('modal-limite-overlay');
    if (overlay) overlay.classList.remove('open');
}

// Cerrar selector al clickear fuera
document.addEventListener('click', function(e) {
    var btn      = document.getElementById('zone-selector-btn');
    var dropdown = document.getElementById('zone-selector-dropdown');
    if (!dropdown || dropdown.style.display === 'none') return;
    if (btn && btn.contains(e.target)) return;
    if (dropdown.contains(e.target)) return;
    closeZoneSelector();
});

// ==========================================================================

document.addEventListener('DOMContentLoaded', function() {
    // Bind zone name input
    var nameInput = document.getElementById('ws-zone-name');
    if (nameInput) nameInput.addEventListener('change', onZoneNameChange);

    // Bind buttons
    var btnDibujar = document.getElementById('btn-dibujar-zona');
    if (btnDibujar) btnDibujar.addEventListener('click', startDrawingZone);
    var btnExport = document.getElementById('btn-export-geojson');
    if (btnExport) btnExport.addEventListener('click', exportarGeoJSON);
    var btnLimpiar = document.getElementById('btn-limpiar-zona');
    if (btnLimpiar) btnLimpiar.addEventListener('click', clearZone);

    // Estado inicial (renderiza indicadores si hay resultados guardados)
    loadWorkspaceState();
    renderIndicadorCards();
    refreshIndRows();

    // Texto descriptivo del índice de agua
    actualizarInfoAgua();

    // Mini-panel: NO se muestra al cargar. Aparece solo cuando hay contenido real
    // — al ejecutar el análisis de Bosque, o al activar una capa con leyenda.
    // (Arranca con clase "hidden" en el HTML.)

    // Cargar iframe de biodiversidad en background al inicio
    (function() {
        var bioIframe = document.getElementById('iframe-biodiversidad');
        if (bioIframe && (!bioIframe.src || bioIframe.src === window.location.href)) {
            bioIframe.src = 'inaturalist/';
        }
    })();
});
