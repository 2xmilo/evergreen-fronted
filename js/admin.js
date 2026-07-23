/* ==========================================================================
   ADMIN.JS — Panel de Administración · Evergreen
   ========================================================================== */

var API_BASE = 'https://evergreen-backend-awv1.onrender.com';
var _adminToken = null;
var _users = [];

/* ── Inicialización ──────────────────────────────────────────────────────── */
async function initAdmin() {
    if (!_sb) { redirect('login.html'); return; }

    var res = await _sb.auth.getSession();
    var session = res.data && res.data.session;
    if (!session) { redirect('login.html'); return; }

    // Verificar plan = admin
    var { data: quota, error } = await _sb
        .from('user_quotas')
        .select('plan, is_active')
        .eq('user_id', session.user.id)
        .single();

    if (error || !quota || quota.plan !== 'admin') {
        redirect('acceso-datos.html');
        return;
    }

    _adminToken = session.access_token;

    var emailEl = document.getElementById('adm-email');
    if (emailEl) emailEl.textContent = session.user.email;

    document.body.style.visibility = 'visible';
    await fetchUsers();
}

function redirect(url) {
    window.location.href = url;
}

/* ── Fetch usuarios desde backend ────────────────────────────────────────── */
async function fetchUsers() {
    showLoading(true);
    try {
        var resp = await fetch(API_BASE + '/api/admin/users', {
            headers: { 'Authorization': 'Bearer ' + _adminToken }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        _users = data.users || [];
        renderStats(_users);
        renderTable(_users);
    } catch (e) {
        console.error('[Admin] fetchUsers:', e);
        showError('No se pudo cargar la lista de usuarios.');
    } finally {
        showLoading(false);
    }
}

/* ── Stats cards ─────────────────────────────────────────────────────────── */
function renderStats(users) {
    var now = Date.now();
    var weekMs = 7 * 24 * 60 * 60 * 1000;

    var total      = users.length;
    var activeWeek = users.filter(function(u) {
        return u.last_sign_in && (now - new Date(u.last_sign_in).getTime()) < weekMs;
    }).length;
    var nFree       = users.filter(function(u) { return u.plan === 'free'; }).length;
    var nPro        = users.filter(function(u) { return u.plan === 'pro'; }).length;
    var nEnterprise = users.filter(function(u) { return u.plan === 'enterprise'; }).length;
    var analyses24h = users.reduce(function(s, u) { return s + (u.n_analyses_24h || 0); }, 0);

    setText('stat-total',      total);
    setText('stat-active',     activeWeek);
    setText('stat-free',       nFree);
    setText('stat-pro',        nPro);
    setText('stat-enterprise', nEnterprise);
    setText('stat-analyses',   analyses24h);
}

/* ── Tabla de usuarios ───────────────────────────────────────────────────── */
function renderTable(users) {
    var tbody = document.getElementById('adm-tbody');
    if (!tbody) return;

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af;">Sin usuarios</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(function(u) {
        var suspended = !u.is_active;
        var rowClass  = suspended ? ' class="suspended"' : '';

        var planBadge = '<span class="plan-badge ' + u.plan + '">' + planLabel(u.plan) + '</span>';

        var statusBadge = suspended
            ? '<span class="status-dot suspended">Suspendido</span>'
            : '<span class="status-dot active">Activo</span>';

        var lastLogin = u.last_sign_in
            ? formatDate(u.last_sign_in)
            : '<span style="color:#d1d5db;">Nunca</span>';

        var planSelect = buildPlanSelect(u.id, u.plan, suspended);

        var statusBtn = suspended
            ? '<button class="adm-status-btn reactivate" onclick="toggleStatus(\'' + u.id + '\', true)">Reactivar</button>'
            : '<button class="adm-status-btn suspend"    onclick="toggleStatus(\'' + u.id + '\', false)">Suspender</button>';

        return '<tr' + rowClass + ' id="row-' + u.id + '">' +
            '<td>' +
                '<div class="adm-email">' + escHtml(u.email) + '</div>' +
                '<div class="adm-email-sub">Miembro desde ' + formatDate(u.created_at) + '</div>' +
            '</td>' +
            '<td>' + planBadge + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td class="adm-date">' + lastLogin + '</td>' +
            '<td class="adm-num">' + (u.n_workspaces || 0) + '</td>' +
            '<td class="adm-num" title="Análisis: 24h · 7 días · total">' +
                '<b style="' + ((u.n_analyses_24h||0)>=10?'color:#e05252;font-weight:700;':((u.n_analyses_24h||0)>=7?'color:#e0952f;font-weight:700;':'')) + '">' + (u.n_analyses_24h||0) + '</b>' +
                ' · ' + (u.n_analyses_7d||0) + ' · <span style="opacity:.55;">' + (u.n_analyses||0) + '</span>' +
            '</td>' +
            '<td>' +
                '<div class="adm-actions">' +
                    planSelect +
                    statusBtn +
                '</div>' +
            '</td>' +
            '</tr>';
    }).join('');
}

function buildPlanSelect(userId, currentPlan, disabled) {
    var plans = ['free', 'pro', 'enterprise', 'admin'];
    var opts = plans.map(function(p) {
        var sel = p === currentPlan ? ' selected' : '';
        return '<option value="' + p + '"' + sel + '>' + planLabel(p) + '</option>';
    }).join('');
    var dis = disabled ? ' disabled' : '';
    return '<select class="adm-plan-select"' + dis +
        ' onchange="changePlan(\'' + userId + '\', this.value, this)">' +
        opts + '</select>';
}

function planLabel(plan) {
    var labels = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise', admin: 'Admin' };
    return labels[plan] || plan;
}

/* ── Cambiar plan ────────────────────────────────────────────────────────── */
async function changePlan(userId, newPlan, selectEl) {
    var user = _users.find(function(u) { return u.id === userId; });
    var oldPlan = user ? user.plan : '';
    if (newPlan === oldPlan) return;

    selectEl.disabled = true;

    try {
        var resp = await fetch(API_BASE + '/api/admin/user/' + userId + '/plan', {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + _adminToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ plan: newPlan })
        });
        var data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || 'Error');

        // Actualizar cache local
        if (user) user.plan = newPlan;
        renderStats(_users);
        updateRowPlanBadge(userId, newPlan);
        toast('Plan actualizado → ' + planLabel(newPlan));
    } catch (e) {
        console.error('[Admin] changePlan:', e);
        // Revertir select
        if (selectEl) selectEl.value = oldPlan;
        toast('Error al cambiar plan', true);
    } finally {
        selectEl.disabled = false;
    }
}

/* ── Suspender / Reactivar ───────────────────────────────────────────────── */
async function toggleStatus(userId, newActive) {
    var user = _users.find(function(u) { return u.id === userId; });
    var row  = document.getElementById('row-' + userId);
    if (row) row.style.opacity = '0.5';

    try {
        var resp = await fetch(API_BASE + '/api/admin/user/' + userId + '/status', {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + _adminToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ is_active: newActive })
        });
        var data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || 'Error');

        if (user) user.is_active = newActive;
        // Re-render solo esa fila
        renderTable(_users);
        toast(newActive ? 'Usuario reactivado' : 'Usuario suspendido');
    } catch (e) {
        console.error('[Admin] toggleStatus:', e);
        if (row) row.style.opacity = '';
        toast('Error al cambiar estado', true);
    }
}

/* ── Helpers de UI ───────────────────────────────────────────────────────── */
function updateRowPlanBadge(userId, newPlan) {
    var row = document.getElementById('row-' + userId);
    if (!row) return;
    var badge = row.querySelector('.plan-badge');
    if (badge) {
        badge.className = 'plan-badge ' + newPlan;
        badge.textContent = planLabel(newPlan);
    }
}

function showLoading(on) {
    var loading = document.getElementById('adm-loading');
    var table   = document.getElementById('adm-table-wrap');
    if (loading) loading.style.display = on ? 'flex' : 'none';
    if (table)   table.style.display   = on ? 'none'  : 'block';
}

function showError(msg) {
    var tbody = document.getElementById('adm-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#dc2626;">' +
            '<i class="fas fa-exclamation-triangle"></i> ' + escHtml(msg) + '</td></tr>';
    }
    showLoading(false);
}

function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
}

function formatDate(iso) {
    if (!iso) return '—';
    try {
        var d = new Date(iso);
        return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch(e) { return iso.slice(0, 10); }
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

var _toastTimer = null;
function toast(msg, isError) {
    var el = document.getElementById('adm-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'show' + (isError ? ' error' : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function() {
        el.className = '';
    }, 3000);
}

/* ── Arrancar ────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', initAdmin);
