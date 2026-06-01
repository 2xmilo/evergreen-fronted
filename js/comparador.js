/* ==========================================================================
   COMPARADOR.JS — Evergreen Atlas · Comparador de Zonas
   ========================================================================== */
'use strict';

/* ── State ─────────────────────────────────────────────────────────────────── */
var _session    = null;
var _workspaces = [];
var _results    = { a: null, b: null };   // { ws, rows[] }
var _mod        = 'vegetacion';
var _mapA       = null;
var _mapB       = null;
var _overlayA   = null;
var _overlayB   = null;
var _polyA      = null;
var _polyB      = null;
var _syncing    = false;

/* ── Module config ─────────────────────────────────────────────────────────── */
var MODULES = {
    vegetacion: {
        prefix: 'vegetacion_',
        metrics: [
            { key: 'mean',   label: 'NDVI Medio',  fmt: function(v){ return v.toFixed(3); } },
            { key: 'max',    label: 'NDVI Máximo', fmt: function(v){ return v.toFixed(3); } },
            { key: 'min',    label: 'NDVI Mínimo', fmt: function(v){ return v.toFixed(3); } },
            { key: 'stdDev', label: 'Desv. Est.',  fmt: function(v){ return v.toFixed(3); } }
        ]
    },
    agua: {
        prefix: 'agua_',
        metrics: [
            { key: 'mean', label: 'NDWI Medio',  fmt: function(v){ return v.toFixed(3); } },
            { key: 'max',  label: 'NDWI Máximo', fmt: function(v){ return v.toFixed(3); } },
            { key: 'min',  label: 'NDWI Mínimo', fmt: function(v){ return v.toFixed(3); } }
        ]
    },
    elevacion: {
        prefix: 'dem_',
        metrics: [
            { key: 'mean', label: 'Elev. Media',  fmt: function(v){ return Math.round(v) + ' m'; } },
            { key: 'max',  label: 'Elev. Máxima', fmt: function(v){ return Math.round(v) + ' m'; } },
            { key: 'min',  label: 'Elev. Mínima', fmt: function(v){ return Math.round(v) + ' m'; } }
        ]
    },
    bosque: {
        prefix: 'bosque_',
        metrics: [
            { key: 'mean', label: 'Cobertura Media', fmt: function(v){ return (v * 100).toFixed(1) + '%'; } },
            { key: 'max',  label: 'Cobertura Máx.',  fmt: function(v){ return (v * 100).toFixed(1) + '%'; } },
            { key: 'min',  label: 'Cobertura Mín.',  fmt: function(v){ return (v * 100).toFixed(1) + '%'; } }
        ]
    },
    biodiversidad: {
        prefix: 'biodiversidad_',
        metrics: []    // handled by renderBioComparison
    }
};

/* ── Init ───────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', initComparador);

async function initComparador() {
    // Auth
    var sessionRes = await supabase.auth.getSession();
    var session    = sessionRes.data && sessionRes.data.session;
    if (!session) { window.location.href = 'login.html'; return; }
    _session = session;

    // Show email
    var emailEl = document.getElementById('cmp-email');
    if (emailEl) emailEl.textContent = session.user.email;

    // Plan check
    var quotaRes = await supabase
        .from('user_quotas')
        .select('plan, is_active')
        .eq('user_id', session.user.id)
        .single();
    var plan = (quotaRes.data && quotaRes.data.plan) || 'free';

    var badgeEl = document.getElementById('cmp-plan');
    if (badgeEl) badgeEl.textContent = plan;

    if (plan === 'free') {
        document.getElementById('cmp-upgrade').style.display = 'flex';
        document.body.style.visibility = 'visible';
        return;
    }

    // Load workspaces
    await loadWorkspaces();

    // Init maps
    initMaps();

    document.body.style.visibility = 'visible';
}

/* ── Workspaces ─────────────────────────────────────────────────────────────── */

async function loadWorkspaces() {
    // FIX: cargar TODAS las zonas del usuario con polígono, no solo la activa.
    // El constraint UNIQUE idx_workspaces_one_active_per_user permite solo
    // 1 zona is_active=true por user_id; filtrar por is_active hacía que el
    // comparador nunca pudiera ver más de 1 zona.
    var res = await supabase
        .from('workspaces')
        .select('id, zone_name, zona_ha, created_at, polygon_geojson, is_active')
        .eq('user_id', _session.user.id)
        .not('polygon_geojson', 'is', null)
        .order('created_at', { ascending: false });

    _workspaces = res.data || [];

    var selA = document.getElementById('zone-select-a');
    var selB = document.getElementById('zone-select-b');

    _workspaces.forEach(function(ws) {
        var ha  = ws.zona_ha
            ? parseFloat(ws.zona_ha).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' ha'
            : '';
        var lbl = ws.zone_name + (ha ? '  ·  ' + ha : '');
        selA.appendChild(new Option(lbl, ws.id));
        selB.appendChild(new Option(lbl, ws.id));
    });
}

/* ── Maps ───────────────────────────────────────────────────────────────────── */

function initMaps() {
    var tileUrl  = 'https://{s}.basemaps.cartocdn.com/dark_matter_no_labels/{z}/{x}/{y}{r}.png';
    var tileOpts = { attribution: '', opacity: 0.6, maxZoom: 18 };
    var startView = [-37.5, -72.0];
    var startZoom = 7;

    _mapA = L.map('map-a', { zoomControl: true, attributionControl: false })
              .setView(startView, startZoom);
    _mapB = L.map('map-b', { zoomControl: true, attributionControl: false })
              .setView(startView, startZoom);

    L.tileLayer(tileUrl, tileOpts).addTo(_mapA);
    L.tileLayer(tileUrl, tileOpts).addTo(_mapB);

    // Sync zoom/pan
    _mapA.on('moveend', function() {
        if (_syncing) return;
        _syncing = true;
        _mapB.setView(_mapA.getCenter(), _mapA.getZoom(), { animate: false });
        _syncing = false;
    });
    _mapB.on('moveend', function() {
        if (_syncing) return;
        _syncing = true;
        _mapA.setView(_mapB.getCenter(), _mapB.getZoom(), { animate: false });
        _syncing = false;
    });
}

/* ── Zone change ────────────────────────────────────────────────────────────── */

async function onZoneChange(side) {
    var wsId = document.getElementById('zone-select-' + side).value;

    if (!wsId) { clearPanel(side); renderMetrics(); return; }

    var ws = _workspaces.find(function(w){ return w.id === wsId; });

    var res = await supabase
        .from('results')
        .select('tipo_indice, result_data, updated_at')
        .eq('workspace_id', wsId);

    _results[side] = { ws: ws, rows: res.data || [] };

    updateMeta(side, ws, res.data || []);
    await renderMap(side);
    renderMetrics();
}

/* ── Render map ─────────────────────────────────────────────────────────────── */

async function renderMap(side) {
    var map     = side === 'a' ? _mapA : _mapB;
    var emptyEl = document.getElementById('map-' + side + '-empty');
    var data    = _results[side];

    // Clear previous layers
    _clearLayers(side);

    if (!data) { emptyEl.style.display = 'flex'; return; }
    emptyEl.style.display = 'none';

    // Draw polygon
    var geo = data.ws.polygon_geojson;
    if (geo) {
        var polyLayer = L.geoJSON(geo, {
            style: {
                color: side === 'a' ? '#6aaa35' : '#5eb0e5',
                weight: 2,
                fillColor: side === 'a' ? '#6aaa35' : '#5eb0e5',
                fillOpacity: 0.06
            }
        });
        polyLayer.addTo(map);
        if (side === 'a') _polyA = polyLayer; else _polyB = polyLayer;
        map.fitBounds(polyLayer.getBounds(), { padding: [24, 24] });
    }

    // Biodiversidad: no raster layer
    if (_mod === 'biodiversidad') return;

    // Find result row for current module
    var prefix = MODULES[_mod].prefix;
    var row    = (data.rows || []).find(function(r){ return r.tipo_indice.indexOf(prefix) === 0; });
    if (!row || !row.result_data || !row.result_data.length) return;

    // Most recent item
    var item = row.result_data.reduce(function(a, b){ return ((a.ts || 0) > (b.ts || 0)) ? a : b; });
    if (!item.previewPath || !item.previewBounds) return;

    // Signed URL (bucket is private)
    var urlRes = await supabase.storage
        .from('result-previews')
        .createSignedUrl(item.previewPath, 3600);

    if (!urlRes.data || !urlRes.data.signedUrl) return;

    var overlay = L.imageOverlay(urlRes.data.signedUrl, item.previewBounds, { opacity: 0.88 });
    overlay.addTo(map);
    if (side === 'a') _overlayA = overlay; else _overlayB = overlay;

    map.fitBounds(item.previewBounds, { padding: [16, 16] });
}

function _clearLayers(side) {
    if (side === 'a') {
        if (_overlayA) { try { _mapA.removeLayer(_overlayA); } catch(e){} _overlayA = null; }
        if (_polyA)    { try { _mapA.removeLayer(_polyA);    } catch(e){} _polyA    = null; }
    } else {
        if (_overlayB) { try { _mapB.removeLayer(_overlayB); } catch(e){} _overlayB = null; }
        if (_polyB)    { try { _mapB.removeLayer(_polyB);    } catch(e){} _polyB    = null; }
    }
}

/* ── Module switch ──────────────────────────────────────────────────────────── */

async function switchMod(mod) {
    _mod = mod;
    document.querySelectorAll('.cmp-mod-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.mod === mod);
    });
    await Promise.all([renderMap('a'), renderMap('b')]);
    renderMetrics();
}

/* ── Meta strip ─────────────────────────────────────────────────────────────── */

function updateMeta(side, ws, rows) {
    var metaEl = document.getElementById('meta-' + side);
    var dateEl = document.getElementById('meta-' + side + '-date');
    var areaEl = document.getElementById('meta-' + side + '-area');

    var dates = (rows || []).map(function(r){ return new Date(r.updated_at); });
    var last  = dates.length ? new Date(Math.max.apply(null, dates)) : null;

    dateEl.textContent = last
        ? 'Analizado ' + last.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
        : '';
    areaEl.textContent = ws.zona_ha
        ? parseFloat(ws.zona_ha).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' ha'
        : '';
    metaEl.style.display = 'flex';
}

/* ── Clear panel ────────────────────────────────────────────────────────────── */

function clearPanel(side) {
    _results[side] = null;
    _clearLayers(side);
    document.getElementById('map-' + side + '-empty').style.display = 'flex';
    document.getElementById('meta-' + side).style.display = 'none';
}

/* ── Metrics ────────────────────────────────────────────────────────────────── */

function renderMetrics() {
    var secMetrics = document.getElementById('cmp-metrics');
    var secBio     = document.getElementById('cmp-bio');
    var dataA      = _results['a'];
    var dataB      = _results['b'];

    if (!dataA && !dataB) {
        secMetrics.style.display = 'none';
        secBio.style.display     = 'none';
        return;
    }

    if (_mod === 'biodiversidad') {
        secMetrics.style.display = 'none';
        secBio.style.display     = 'block';
        renderBioComparison(dataA, dataB);
        return;
    }

    secBio.style.display     = 'none';
    secMetrics.style.display = 'block';

    var cfg    = MODULES[_mod];
    var prefix = cfg.prefix;

    function getStats(data) {
        if (!data) return null;
        var row = (data.rows || []).find(function(r){ return r.tipo_indice.indexOf(prefix) === 0; });
        if (!row || !row.result_data || !row.result_data.length) return null;
        var item = row.result_data.reduce(function(a, b){ return ((a.ts||0) > (b.ts||0)) ? a : b; });
        return item.stats || null;
    }

    var sA   = getStats(dataA);
    var sB   = getStats(dataB);
    var html = '';

    if (!sA && !sB) {
        document.getElementById('cmp-metrics-cards').innerHTML =
            '<div class="cmp-no-data"><i class="fas fa-chart-bar"></i>No hay datos para este módulo en las zonas seleccionadas.</div>';
        return;
    }

    cfg.metrics.forEach(function(m) {
        var vA = (sA && sA[m.key] != null) ? sA[m.key] : null;
        var vB = (sB && sB[m.key] != null) ? sB[m.key] : null;

        var fA = vA != null ? m.fmt(vA) : null;
        var fB = vB != null ? m.fmt(vB) : null;

        var deltaHtml = '';
        if (vA != null && vB != null) {
            var delta = vB - vA;
            var cls   = delta > 0.0005 ? 'pos' : delta < -0.0005 ? 'neg' : 'neu';
            var arrow = delta > 0.0005 ? '▲' : delta < -0.0005 ? '▼' : '—';
            var pct   = vA !== 0 ? ((delta / Math.abs(vA)) * 100).toFixed(1) : null;
            var dFmt  = m.fmt(Math.abs(delta));
            deltaHtml = '<div class="cmp-metric-delta ' + cls + '">'
                + arrow + ' ' + dFmt
                + (pct ? ' <span class="cmp-metric-pct">(' + (delta >= 0 ? '+' : '') + pct + '%)</span>' : '')
                + '</div>';
        }

        html += '<div class="cmp-metric-card">'
            + '<div class="cmp-metric-label">' + m.label + '</div>'
            + '<div class="cmp-metric-row">'
            +   '<span class="cmp-metric-side-a">A</span>'
            +   '<span class="cmp-metric-val' + (fA ? '' : ' na') + '">' + (fA || '—') + '</span>'
            + '</div>'
            + '<div class="cmp-metric-row">'
            +   '<span class="cmp-metric-side-b">B</span>'
            +   '<span class="cmp-metric-val' + (fB ? '' : ' na') + '">' + (fB || '—') + '</span>'
            + '</div>'
            + deltaHtml
            + '</div>';
    });

    document.getElementById('cmp-metrics-cards').innerHTML = html;
}

/* ── Biodiversidad ──────────────────────────────────────────────────────────── */

function renderBioComparison(dataA, dataB) {
    function getBio(data) {
        if (!data) return null;
        var row = (data.rows || []).find(function(r){ return r.tipo_indice === 'biodiversidad_Biodiversidad'; });
        if (!row || !row.result_data || !row.result_data.length) return null;
        return row.result_data.reduce(function(a, b){ return ((a.ts||0) > (b.ts||0)) ? a : b; });
    }

    var itemA = getBio(dataA);
    var itemB = getBio(dataB);
    var sA    = itemA ? itemA.stats : null;
    var sB    = itemB ? itemB.stats : null;
    var wsA   = dataA ? dataA.ws : null;
    var wsB   = dataB ? dataB.ws : null;

    function colHtml(stats, ws, side) {
        var sideCls = side.toLowerCase();
        if (!stats) {
            return '<div class="cmp-bio-col">'
                + '<div class="cmp-bio-header ' + sideCls + '">Zona ' + side + '</div>'
                + '<div class="cmp-no-data"><i class="fas fa-paw"></i>Sin datos de biodiversidad</div>'
                + '</div>';
        }

        var name = ws ? ws.zone_name : 'Zona ' + side;
        var rows = [
            { lbl: 'N° de especies',      val: stats.n_especies || 0,  cls: 'ok' },
            { lbl: 'En Peligro Crítico',  val: stats.n_cr || 0,        cls: stats.n_cr  ? 'danger'  : 'neutral' },
            { lbl: 'En Peligro',          val: stats.n_en || 0,        cls: stats.n_en  ? 'warn'    : 'neutral' },
            { lbl: 'Vulnerables',         val: stats.n_vu || 0,        cls: stats.n_vu  ? 'warn'    : 'neutral' },
            { lbl: 'Catálogo RCE Chile',  val: stats.n_rce || 0,       cls: 'neutral' },
            { lbl: 'Dentro de SNASPE',    val: stats.snaspe_int ? '✓ Sí' : '✗ No', cls: stats.snaspe_int ? 'ok' : 'neutral' }
        ];

        var rowsHtml = rows.map(function(r){
            return '<div class="cmp-bio-row">'
                + '<span class="cmp-bio-key">' + r.lbl + '</span>'
                + '<span class="cmp-bio-val ' + r.cls + '">' + r.val + '</span>'
                + '</div>';
        }).join('');

        var pisoHtml = stats.piso
            ? '<div class="cmp-bio-piso">' + stats.piso + '</div>'
            : '';

        return '<div class="cmp-bio-col">'
            + '<div class="cmp-bio-header ' + sideCls + '">Zona ' + side + ' — ' + name + '</div>'
            + rowsHtml
            + pisoHtml
            + '</div>';
    }

    document.getElementById('cmp-bio-grid').innerHTML =
        colHtml(sA, wsA, 'A') + colHtml(sB, wsB, 'B');
}
