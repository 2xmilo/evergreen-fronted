/* ==========================================================================
   AUTH.JS — Autenticación y sincronización cloud
   Monitor Pro · Evergreen
   ========================================================================== */

window._sbUserId    = null;
window._sbUserEmail = null;
window._sbUserPlan  = 'free';
window._sbUserZones = [];

var PLAN_LIMITS = { 'free': 1, 'pro': 3, 'admin': Infinity };

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

        var zones = wsResult.data || [];
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
                try {
                    WorkspaceState.zonaGEE = (typeof turf !== 'undefined')
                        ? turf.simplify(activeZone.polygon_geojson, { tolerance: 0.001, highQuality: true })
                        : activeZone.polygon_geojson;
                } catch(e) {
                    WorkspaceState.zonaGEE = activeZone.polygon_geojson;
                }
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
async function saveWorkspaceToCloud(userId, state) {
    if (!_sb || !userId) return;
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
            await _sb.from('workspaces')
                .update(data)
                .eq('id', state.zonaId)
                .eq('user_id', userId);

            // Actualizar nombre en lista local
            var idx = (window._sbUserZones || []).findIndex(function(z) { return z.id === state.zonaId; });
            if (idx >= 0) window._sbUserZones[idx].zone_name = state.zonaNombre;
            if (typeof renderZoneSelector === 'function') renderZoneSelector(window._sbUserZones);

        } else {
            // Crear nuevo workspace
            data.is_active = true;
            var r = await _sb.from('workspaces').insert(data).select().single();
            if (r.data) {
                WorkspaceState.zonaId = r.data.id;
                // Marcar el resto como inactivas
                await _sb.from('workspaces')
                    .update({ is_active: false })
                    .eq('user_id', userId)
                    .neq('id', r.data.id);
                // Agregar a lista local
                window._sbUserZones = [r.data].concat(window._sbUserZones || []);
                if (typeof renderZoneSelector === 'function') renderZoneSelector(window._sbUserZones);
                localStorage.setItem('evergreen_workspace', JSON.stringify(WorkspaceState));
            }
        }
    } catch (e) {
        console.warn('[Auth] saveWorkspaceToCloud:', e);
    }
}

/* ── Guardar resultados de análisis en cloud ──────────────────────────── */
async function saveResultsToCloud(userId, tipoIndice, arr) {
    if (!_sb || !userId) return;
    var workspaceId = WorkspaceState && WorkspaceState.zonaId;
    if (!workspaceId) return;
    try {
        await _sb.from('results').upsert({
            workspace_id: workspaceId,
            user_id:      userId,
            tipo_indice:  tipoIndice,
            result_data:  arr,
            updated_at:   new Date().toISOString()
        }, { onConflict: 'workspace_id,tipo_indice' });
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
            .eq('user_id', userId);
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
        // results se borran por CASCADE
        window._sbUserZones = (window._sbUserZones || []).filter(function(z) { return z.id !== wid; });
    } catch (e) {
        console.warn('[Auth] clearCloudData:', e);
    }
}

/* ── Cambiar zona activa en cloud y cargar sus datos ─────────────────── */
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
        WorkspaceState.zonaGEE    = zone.polygon_geojson || null;
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
