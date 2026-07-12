/* ==========================================================================
   WORKSPACE — Rediseño del panel de Capas (iteración 1)
   Capa de mejora NO invasiva sobre #map-layers-body:
     · Buscador de capas
     · Contador de activas + "Ocultar todas"
     · Swatch de color por capa
     · Opacidad on-demand (slider oculto hasta abrir su botón)
     · Secciones colapsables (Zona / Análisis GEE)

   SIN MutationObserver (para evitar cualquier bucle de re-entrada).
   Las filas estáticas se enriquecen una vez al cargar. Las filas GEE, que
   workspace-summary.js regenera con innerHTML, se re-enriquecen envolviendo
   la función global _refreshGeeLayersPanel. Todo idempotente y guardado.
   ========================================================================== */
(function () {
    'use strict';

    var COLORS = { 'layer-aoi': '#7ec242', 'layer-cuencas': '#3b8ede' };

    function accent() {
        var c = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        return c || '#6aaa35';
    }

    function swatchColor(row) {
        if (COLORS[row.id]) return COLORS[row.id];
        var badge = row.querySelector('.map-gee-badge');
        if (badge) {
            var c = getComputedStyle(badge).color;
            if (c && c !== 'rgba(0, 0, 0, 0)') return c;
        }
        var lbl = ((row.querySelector('.map-layer-label') || {}).textContent || '').toLowerCase();
        if (/ndwi|agua|humedal/.test(lbl)) return '#3b8ede';
        if (/ndvi|veget|bosque|restaur/.test(lbl)) return '#7ec242';
        return accent();
    }

    function isHeader(el) {
        return el.classList.contains('layers-section-hdr') ||
               el.classList.contains('gee-layers-header') ||
               el.classList.contains('gee-layers-sep') ||
               el.id === 'gee-layers-dynamic';
    }

    function enhanceRow(row) {
        if (row.dataset.enh) return;
        row.dataset.enh = '1';

        var check = row.querySelector('.map-layer-check');
        var sw = document.createElement('span');
        sw.className = 'map-layer-swatch';
        sw.style.background = swatchColor(row);
        if (check) check.after(sw);
        else row.insertBefore(sw, row.firstChild);

        var op = row.nextElementSibling;
        if (op && op.classList.contains('map-layer-opacity')) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'map-layer-opbtn';
            btn.setAttribute('aria-label', 'Ajustar opacidad');
            btn.innerHTML = '<i class="fas fa-sliders-h"></i>';
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var shown = op.classList.toggle('op-show');
                btn.classList.toggle('active', shown);
            });
            row.appendChild(btn);
        }
    }

    function makeCollapsible(hdr) {
        if (hdr.dataset.coll) return;
        hdr.dataset.coll = '1';
        var chev = document.createElement('i');
        chev.className = 'fas fa-chevron-down sec-chev';
        hdr.insertBefore(chev, hdr.firstChild);
        hdr.style.cursor = 'pointer';
        hdr.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('.simbio-buffer-sel')) return;
            var collapsed = hdr.classList.toggle('sec-collapsed');
            chev.style.transform = collapsed ? 'rotate(-90deg)' : '';
            var el = hdr.nextElementSibling;
            while (el && !isHeader(el)) {
                el.classList.toggle('sec-hidden', collapsed);
                el = el.nextElementSibling;
            }
        });
    }

    function updateCount() {
        var body = document.getElementById('map-layers-body');
        if (!body) return;
        var n = body.querySelectorAll('.map-layer-row.on').length;
        var el = document.getElementById('map-layers-count');
        if (el) el.textContent = n + (n === 1 ? ' activa' : ' activas');
    }

    function filterRows(q) {
        var body = document.getElementById('map-layers-body');
        if (!body) return;
        q = (q || '').trim().toLowerCase();
        body.querySelectorAll('.map-layer-row').forEach(function (row) {
            var lbl = ((row.querySelector('.map-layer-label') || {}).textContent || '').toLowerCase();
            var match = !q || lbl.indexOf(q) !== -1;
            row.classList.toggle('filtered-out', !match);
            var op = row.nextElementSibling;
            if (op && op.classList.contains('map-layer-opacity')) op.classList.toggle('filtered-out', !match);
        });
        body.querySelectorAll('.layers-section-hdr, .gee-layers-header').forEach(function (hdr) {
            var visible = 0, el = hdr.nextElementSibling;
            while (el && !isHeader(el)) {
                if (el.classList.contains('map-layer-row') && !el.classList.contains('filtered-out')) visible++;
                el = el.nextElementSibling;
            }
            var empty = !!q && visible === 0;
            hdr.classList.toggle('sec-empty', empty);
            var prev = hdr.previousElementSibling;
            if (prev && prev.classList.contains('gee-layers-sep')) prev.classList.toggle('sec-empty', empty);
        });
    }

    function hideAll() {
        var body = document.getElementById('map-layers-body');
        if (!body) return;
        body.querySelectorAll('.map-layer-row.on').forEach(function (row) { row.click(); });
        updateCount();
    }

    function wireHeaderControls() {
        var s = document.getElementById('map-layers-search-input');
        if (s && !s.dataset.wired) {
            s.dataset.wired = '1';
            s.addEventListener('input', function () { filterRows(s.value); });
        }
        var h = document.getElementById('map-layers-hideall');
        if (h && !h.dataset.wired) {
            h.dataset.wired = '1';
            h.addEventListener('click', hideAll);
        }
    }

    function enhance() {
        var body = document.getElementById('map-layers-body');
        if (!body) return;
        try {
            wireHeaderControls();
            body.querySelectorAll('.map-layer-row').forEach(enhanceRow);
            body.querySelectorAll('.layers-section-hdr:not(.layers-section-hdr--clickable)').forEach(makeCollapsible);
            body.querySelectorAll('.gee-layers-header').forEach(makeCollapsible);
            var s = document.getElementById('map-layers-search-input');
            if (s && s.value) filterRows(s.value);
            updateCount();
        } catch (err) {
            if (window.console) console.warn('[layers-ui]', err);
        }
    }

    /* Recalcular contador cuando se togglea cualquier fila */
    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('#map-layers-body .map-layer-row')) {
            setTimeout(updateCount, 0);
        }
    });

    /* Envolver el rebuild dinámico de capas GEE para re-enriquecer sus filas.
       Se reintenta hasta que la función global exista (se define en
       workspace-summary.js, que carga antes que este archivo). */
    function wrapGeeRefresh() {
        if (typeof window._refreshGeeLayersPanel !== 'function') return false;
        if (window._refreshGeeLayersPanel.__wrapped) return true;
        var orig = window._refreshGeeLayersPanel;
        var wrapped = function () {
            var r = orig.apply(this, arguments);
            enhance();
            return r;
        };
        wrapped.__wrapped = true;
        window._refreshGeeLayersPanel = wrapped;
        return true;
    }

    function boot() {
        enhance();
        wrapGeeRefresh();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
    setTimeout(boot, 1200);
    setTimeout(boot, 3000);
})();
