/* ==========================================================================
   AUTH.JS — Autenticación y sincronización cloud
   Monitor Pro · Evergreen
   ========================================================================== */

window._sbUserId    = null;
window._sbUserEmail = null;
window._sbUserPlan  = 'free';
window._sbUserZones = [];

var PLAN_LIMITS = { 'free': 1, 'pro': 3, 'enterprise': Infinity, 'admin': Infinity };

async function getBackendAuthHeaders(baseHeaders) {
    var headers = Object.assign({}, baseHeaders || {});
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (!_sb) return headers;
    try {
        var result = await _sb.auth.getSession();
        var session = result.data && result.data.session;
        if (session && session.access_token) {
            headers.Authorization = 'Bearer ' + session.access_token;
        }
    } catch(e) {
        console.warn('[Auth] getBackendAuthHeaders:', e);
    }
    return headers;
}

function isValidStoredZone(z) {
    return !!(z && z.id && z.polygon_geojson);
}

function getValidStoredZones(zones) {
    return (zones || []).filter(isValidStoredZone);
}

function notifyCloudSaveError(error) {
    var msg = (error && (error.message || error.details || error.hint)) || '';
    if (msg.indexOf('Zone quota exceeded') >= 0) {
        var plan = window._sbUserPlan || 'free';
        var maxZones = PLAN_LIMITS[plan] !== undefined ? PLAN_LIMITS[plan] : 1;
        if (typeof mostrarModalLimite === 'function') {
            mostrarModalLimite({ ok: false, reason: 'LIMIT_REACHED', plan: plan, used: maxZones, max: maxZones });
            return;
        }
    }
    if (typeof mostrarNotificacion === 'function') {
        mostrarNotificacion('No se pudo sincronizar con Supabase. Revisa tu conexion o vuelve a intentar.');
    }
}

/* ── Verificar sesión activa ───────────────────────────────────────────── */
async function initAuth() {
    if (!_sb) {
        document.body.style.visibility = 'visible';
        return false;
    }
    try {
        var result  = await _sb.auth.getSession();
        var session = result.data && result.data.session;

        if (!session) {
            window.location.href = 'login.html';
            return false;
        }

        window._sbUserId    = session.user.id;
        window._sbUserEmail = session.user.email;

        var emailEl = document.getElementById('user-email-display');
        if (emailEl) emailEl.textContent = session.user.email;

        document.body.style.visibility = 'visible';

        setTimeout(function () {
            loadCloudWorkspace(session.user.id);
        }, 800);

        return true;
    } catch (e) {
        console.warn('[Auth] initAuth:', e);
        document.body.style.visibility = 'visible';
        return false;
    }
}

/* ── Cargar workspace + zonas desde Supabase ──────────────────────────── */
async function loadCloudWorkspace(userId) {
    if (!_sb || !userId) return;
    try {
        // Cargar plan del usuario
        await loadQuotas(userId);

        // Cargar todas las zonas del usuario
        var wsResult = await _sb
            .from('workspaces')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        var zones = getValidStoredZones(wsResult.data || []);
        window._sbUserZones = zones;

        // Zona activa: marcada is_active=true, o la más reciente
        var activeZone = zones.find(function(z) { return z.is_active; }) || zones[0];

        var changed = false;

        if (activeZone) {
            if (activeZone.zone_name)       { WorkspaceState.zonaNombre = activeZone.zone_name;       changed = true; }
            if (activeZone.zona_ha)         { WorkspaceState.zonaHa     = activeZone.zona_ha;         changed = true; }
            if (activeZone.polygon_geojson) {
                WorkspaceState.zona    = activeZone.polygon_geojson;
                // zonaGEE = versión simplificada para GEE (si turf disponible, si no usa zona directa)
                WorkspaceState.zonaGEE = (typeof simplifyZoneForGee === 'function')
                    ? simplifyZoneForGee(activeZone.polygon_geojson, activeZone.zona_ha)
                    : activeZone.polygon_geojson;
                changed = true;
            }
            WorkspaceState.zonaId = activeZone.id;

            // Cargar resultados de esta zona
            var resResult = await _sb.from('results').select('*').eq('workspace_id', activeZone.id);
            var res = resResult.data || [];
            if (res.length > 0) {
                if (!WorkspaceState.resultados) WorkspaceState.resultados = {};
                res.forEach(function(row) {
                    WorkspaceState.resultados[row.tipo_indice] = row.result_data;
                });
                changed = true;
            }
        }

        if (changed) {
            localStorage.setItem('evergreen_workspace', JSON.stringify(WorkspaceState));
            if (typeof updateZoneUI         === 'function') updateZoneUI();
            if (typeof renderIndicadorCards === 'function') renderIndicadorCards();
            if (typeof refreshIndRows       === 'function') refreshIndRows();
            if (WorkspaceState.zona && typeof restoreZoneOnMap === 'function') {
                try { restoreZoneOnMap(); } catch(e) {}
            }
            // Restaurar URLs de tiles guardadas y reactivar última capa
            if (typeof _restoreTilesCache     === 'function') _restoreTilesCache();
            if (typeof restoreLastActiveLayer  === 'function') {
                setTimeout(restoreLastActiveLayer, 700);
            }
        }

        // Renderizar selector de zonas (siempre, incluso sin zona)
        if (typeof renderZoneSelector === 'function') renderZoneSelector(zones);

    } catch (e) {
        console.warn('[Auth] loadCloudWorkspace:', e);
    }
}

/* ── Guardar workspace en cloud ───────────────────────────────────────── */
// Mutex para evitar INSERTs concurrentes cuando zonaId aún no fue asignado (race condition async)
var _workspaceInsertPending = false;

async function saveWorkspaceToCloud(userId, state) {
    if (!_sb || !userId) return;
    if (!state || (!state.zona && !state.zonaId)) return;
    try {
        var data = {
            user_id:         userId,
            zone_name:       state.zonaNombre,
            polygon_geojson: state.zona   || null,
            zona_ha:         state.zonaHa || 0,
            updated_at:      new Date().toISOString()
        };

        if (state.zonaId) {
            // Actualizar workspace existente
            var updateRes = await _sb.from('workspaces')
                .update(data)
                .eq('id', state.zonaId)
                .eq('user_id', userId);
            if (updateRes.error) throw updateRes.error;

            // Actualizar nombre en lista local
            var idx = (window._sbUserZones || []).findIndex(function(z) { return z.id === state.zonaId; });
            if (idx >= 0) window._sbUserZones[idx].zone_name = state.zonaNombre;
            if (typeof renderZoneSelector === 'function') renderZoneSelector(window._sbUserZones);

        } else {
            // Crear nuevo workspace — prevenir doble INSERT si ya hay uno en curso
            if (_workspaceInsertPending) {
                console.warn('[Auth] saveWorkspaceToCloud: INSERT ya en curso, ignorando llamada concurrente');
                return;
            }
            _workspaceInsertPending = true;
            try {
                // ── FIX: el índice UNIQUE parcial idx_workspaces_one_active_per_user
                //         permite solo UNA fila con is_active=true por user_id.
                //         Si insertamos con is_active=true cuando ya existe otra,
                //         Postgres tira "duplicate key" y se rompe la sincronización.
                //         Solución: desactivar TODAS las existentes ANTES del INSERT.
                var deactivateRes = await _sb.from('workspaces')
                    .update({ is_active: false })
                    .eq('user_id', userId)
                    .eq('is_active', true);
                if (deactivateRes.error) throw deactivateRes.error;

                data.is_active = true;
                var r = await _sb.from('workspaces').insert(data).select().single();
                if (r.error) throw r.error;
                if (r.data) {
                    WorkspaceState.zonaId = r.data.id;
                    // Sincronizar estado is_active en la lista local
                    (window._sbUserZones || []).forEach(function(z) { z.is_active = false; });
                    // Agregar a lista local solo si no está ya
                    var alreadyIn = (window._sbUserZones || []).some(function(z) { return z.id === r.data.id; });
                    if (!alreadyIn) {
                        window._sbUserZones = [r.data].concat(window._sbUserZones || []);
                    }
                    if (typeof renderZoneSelector === 'function') renderZoneSelector(window._sbUserZones);
                    localStorage.setItem('evergreen_workspace', JSON.stringify(WorkspaceState));
                }
            } finally {
                _workspaceInsertPending = false;
            }
        }
    } catch (e) {
        _workspaceInsertPending = false;
        console.warn('[Auth] saveWorkspaceToCloud:', e);
        notifyCloudSaveError(e);
    }
}

/* ── Guardar resultados de análisis en cloud ──────────────────────────── */
async function saveResultsToCloud(userId, tipoIndice, arr) {
    if (!_sb || !userId) return;
    var workspaceId = WorkspaceState && WorkspaceState.zonaId;
    if (!workspaceId) return;
    try {
        var res = await _sb.from('results').upsert({
            workspace_id: workspaceId,
            user_id:      userId,
            tipo_indice:  tipoIndice,
            result_data:  arr,
            updated_at:   new Date().toISOString()
        }, { onConflict: 'workspace_id,tipo_indice' });
        if (res.error) throw res.error;
    } catch (e) {
        console.warn('[Auth] saveResultsToCloud:', e);
    }
}

/* ── Cuotas por plan ──────────────────────────────────────────────────── */
async function loadQuotas(userId) {
    if (!_sb || !userId) return { plan: 'free' };
    try {
        var r = await _sb.from('user_quotas').select('*').eq('user_id', userId).maybeSingle();
        var data = r.data;

        // Si no existe fila, crearla con plan free
        if (!data) {
            await _sb.from('user_quotas').insert({ user_id: userId, plan: 'free' });
            data = { plan: 'free' };
        }

        window._sbUserPlan = data.plan || 'free';
        return data;
    } catch (e) {
        window._sbUserPlan = 'free';
        return { plan: 'free' };
    }
}

async function checkZoneQuota(userId) {
    await loadQuotas(userId);
    var plan     = window._sbUserPlan || 'free';
    var maxZones = PLAN_LIMITS[plan] !== undefined ? PLAN_LIMITS[plan] : 1;

    if (maxZones === Infinity) return { ok: true, plan: plan, used: 0, max: Infinity };

    try {
        var r = await _sb
            .from('workspaces')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .not('polygon_geojson', 'is', null);
        var count = r.count || 0;
        if (count >= maxZones) {
            return { ok: false, reason: 'LIMIT_REACHED', plan: plan, used: count, max: maxZones };
        }
        return { ok: true, plan: plan, used: count, max: maxZones };
    } catch (e) {
        return { ok: true, plan: plan, used: 0, max: maxZones };
    }
}

/* ── Borrar zona específica del cloud ────────────────────────────────── */
async function clearCloudData(userId, workspaceId) {
    if (!_sb || !userId) return;
    var wid = workspaceId || (WorkspaceState && WorkspaceState.zonaId);
    if (!wid) return;
    try {
        // Eliminar imágenes de preview del Storage antes de borrar el workspace
        if (typeof deletePreviewsFromStorage === 'function') {
            await deletePreviewsFromStorage(userId, wid);
        }
        await _sb.from('workspaces').delete().eq('id', wid).eq('user_id', userId);

        // Re-sincronizar _sbUserZones con Supabase para garantizar consistencia
        // (evita que doble-INSERTs o zonas fantasma bloqueen la cuota)
        var freshRes = await _sb.from('workspaces')
            .select('id, zone_name, zona_ha, polygon_geojson, is_active, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (!freshRes.error && freshRes.data) {
            window._sbUserZones = getValidStoredZones(freshRes.data);
            if (typeof renderZoneSelector === 'function') renderZoneSelector(window._sbUserZones);
        } else {
            // Fallback: filtro local
            window._sbUserZones = (window._sbUserZones || []).filter(function(z) { return z.id !== wid; });
        }
    } catch (e) {
        console.warn('[Auth] clearCloudData:', e);
        // Fallback local si hay error de red
        window._sbUserZones = (window._sbUserZones || []).filter(function(z) { return z.id !== wid; });
    }
}

/* ── Cambiar zona activa en cloud y cargar sus datos ─────────────────── */
async function clearResultsForWorkspace(userId, workspaceId) {
    if (!_sb || !userId || !workspaceId) return;
    try {
        if (typeof deletePreviewsFromStorage === 'function') {
            await deletePreviewsFromStorage(userId, workspaceId);
        }
        var res = await _sb.from('results')
            .delete()
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId);
        if (res.error) throw res.error;
    } catch (e) {
        console.warn('[Auth] clearResultsForWorkspace:', e);
    }
}

async function switchZoneCloud(userId, zoneId) {
    if (!_sb || !userId || !zoneId) return null;
    try {
        await _sb.from('workspaces').update({ is_active: false }).eq('user_id', userId);
        await _sb.from('workspaces').update({ is_active: true  }).eq('id', zoneId);

        var wsRes  = await _sb.from('workspaces').select('*').eq('id', zoneId).single();
        var resRes = await _sb.from('results').select('*').eq('workspace_id', zoneId);
        var zone   = wsRes.data;
        var res    = resRes.data || [];

        if (!zone) return null;

        WorkspaceState.zonaId     = zone.id;
        WorkspaceState.zonaNombre = zone.zone_name       || 'Mi zona de estudio';
        WorkspaceState.zonaHa     = zone.zona_ha         || 0;
        WorkspaceState.zona       = zone.polygon_geojson || null;
        WorkspaceState.zonaGEE    = (typeof simplifyZoneForGee === 'function' && zone.polygon_geojson)
            ? simplifyZoneForGee(zone.polygon_geojson, zone.zona_ha)
            : (zone.polygon_geojson || null);
        WorkspaceState.resultados = {};

        res.forEach(function(row) {
            WorkspaceState.resultados[row.tipo_indice] = row.result_data;
        });

        localStorage.setItem('evergreen_workspace', JSON.stringify(WorkspaceState));
        // Restaurar tiles de la zona cargada
        if (typeof _restoreTilesCache === 'function') _restoreTilesCache();
        return zone;
    } catch (e) {
        console.warn('[Auth] switchZoneCloud:', e);
        return null;
    }
}

/* ── Cerrar sesión ─────────────────────────────────────────────────────── */
async function logoutUser() {
    if (_sb) await _sb.auth.signOut();
    localStorage.removeItem('evergreen_workspace');
    window._sbUserId    = null;
    window._sbUserEmail = null;
    window._sbUserPlan  = 'free';
    window._sbUserZones = [];
    window.location.href = 'login.html';
}

/* ── User Menu ─────────────────────────────────────────────────────────── */

var PLAN_FEATURES = {
    free: {
        label: 'Free',
        features: [
            '1 zona de estudio',
            'Vegetación, Agua y Elevación',
            'Descarga de series climáticas',
            'Biodiversidad GBIF',
        ]
    },
    pro: {
        label: 'Pro',
        features: [
            '3 zonas de estudio',
            'Acceso total a todos los módulos',
            'Capas SIMBIO y Riesgos ARClim',
            'Estaciones DMC cercanas',
            'Historial de mediciones ilimitado',
        ]
    },
    enterprise: {
        label: 'Enterprise',
        features: [
            'Zonas ilimitadas',
            'Acceso total a todos los módulos',
            'Soporte prioritario',
            'Exportación avanzada de datos',
            'Acceso API',
        ]
    },
    admin: {
        label: 'Admin',
        features: [
            'Zonas ilimitadas',
            'Acceso total a todos los módulos',
            'Panel de administración',
            'Gestión de usuarios y planes',
        ]
    }
};

var _umOpen = false;
var _umLoaded = false;

async function toggleUserMenu() {
    var dropdown = document.getElementById('user-menu-dropdown');
    var trigger  = document.getElementById('user-menu-trigger');
    if (!dropdown || !trigger) return;

    _umOpen = !_umOpen;

    if (_umOpen) {
        // Calcular posición relativa al viewport (position:fixed)
        var rect = trigger.getBoundingClientRect();
        dropdown.style.top   = (rect.bottom + 6) + 'px';
        dropdown.style.right = (window.innerWidth - rect.right) + 'px';
        dropdown.style.left  = 'auto';
    }

    dropdown.style.display = _umOpen ? 'block' : 'none';
    trigger.classList.toggle('open', _umOpen);

    if (_umOpen && !_umLoaded) {
        await _renderUserMenu();
        _umLoaded = true;
    }
}

function closeUserMenu() {
    var dropdown = document.getElementById('user-menu-dropdown');
    var trigger  = document.getElementById('user-menu-trigger');
    if (!_umOpen) return;
    _umOpen = false;
    if (dropdown) dropdown.style.display = 'none';
    if (trigger)  trigger.classList.remove('open');
}

async function _renderUserMenu() {
    var plan  = window._sbUserPlan  || 'free';
    var email = window._sbUserEmail || '';

    // Header
    var emailEl = document.getElementById('um-header-email');
    var badgeEl = document.getElementById('um-plan-badge');
    if (emailEl) emailEl.textContent = email;
    if (badgeEl) {
        badgeEl.textContent = (PLAN_FEATURES[plan] || {}).label || plan;
        badgeEl.className   = 'um-plan-badge ' + plan;
    }

    // Stats — zonas y ha desde globals ya cargados
    var zones = (window._sbUserZones || []).length;
    var ha    = (typeof WorkspaceState !== 'undefined' && WorkspaceState.zonaHa)
        ? Number(WorkspaceState.zonaHa).toLocaleString('es-CL')
        : '—';

    var zonesEl = document.getElementById('um-stat-zones');
    var haEl    = document.getElementById('um-stat-ha');
    if (zonesEl) zonesEl.textContent = zones || '—';
    if (haEl)    haEl.textContent    = ha;

    // Análisis — consulta rápida a Supabase
    var analysesEl = document.getElementById('um-stat-analyses');
    if (analysesEl && _sb && window._sbUserId) {
        try {
            var r = await _sb.from('analysis_usage').select('id', { count: 'exact', head: true }).eq('user_id', window._sbUserId);
            analysesEl.textContent = (r.count != null) ? r.count : '—';
        } catch(e) { analysesEl.textContent = '—'; }
    }

    // Features del plan
    var featEl = document.getElementById('um-features');
    if (featEl) {
        var feats = (PLAN_FEATURES[plan] || {}).features || [];
        featEl.innerHTML = feats.map(function(f) {
            return '<li>' + f + '</li>';
        }).join('');
    }

    // Comparador link — para planes con ≥2 zonas (pro / enterprise / admin)
    var compareLink = document.getElementById('um-compare-link');
    if (compareLink) {
        var canCompare = (plan === 'pro' || plan === 'enterprise' || plan === 'admin');
        compareLink.style.display = canCompare ? 'flex' : 'none';
    }

    // Admin link — solo si es admin
    var adminLink = document.getElementById('um-admin-link');
    if (adminLink) adminLink.style.display = (plan === 'admin') ? 'flex' : 'none';
}

// Cerrar al hacer click fuera
document.addEventListener('click', function(e) {
    if (!_umOpen) return;
    var trigger  = document.getElementById('user-menu-trigger');
    var dropdown = document.getElementById('user-menu-dropdown');
    if (!trigger || !dropdown) return;
    if (trigger.contains(e.target) || dropdown.contains(e.target)) return;
    closeUserMenu();
});
