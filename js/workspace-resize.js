/* ==========================================================================
   WORKSPACE RESIZE - Drag handle + botón expandir para el left-panel
   - Drag fino con cursor col-resize, persistencia en localStorage
   - Botón en header: alterna entre ancho default y expandido (70vw)
   - Bajo 900px de viewport: desactivado (panel full screen como hoy)
   - Dispara window resize al soltar para que Chart.js se reajuste
   ========================================================================== */

(function () {
    'use strict';

    var LS_KEY        = 'evergreen_panel_width';
    var MIN_WIDTH     = 420;          // px mínimos para que el contenido no se rompa
    var DEFAULT_WIDTH = 540;          // px default actual del proyecto
    var MOBILE_BREAK  = 900;          // bajo esto, panel ocupa todo el viewport
    var EXPANDED_FRAC = 0.70;         // 70% del viewport en modo "expandido"

    var _panel       = null;
    var _handle      = null;
    var _expandBtn   = null;
    var _dragging    = false;
    var _startX      = 0;
    var _startWidth  = 0;
    var _isExpanded  = false;

    /* ── Helpers ──────────────────────────────────────────── */

    function _maxWidth() {
        return Math.round(window.innerWidth * 0.70);
    }

    function _clamp(w) {
        var max = _maxWidth();
        if (w < MIN_WIDTH) return MIN_WIDTH;
        if (w > max)       return max;
        return Math.round(w);
    }

    function _isMobile() {
        return window.innerWidth < MOBILE_BREAK;
    }

    function _applyWidth(px) {
        document.documentElement.style.setProperty('--panel-w', px + 'px');
        /* Disparar resize para que Chart.js y Leaflet se reajusten */
        window.dispatchEvent(new Event('resize'));
    }

    function _savedWidth() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            var n   = raw ? parseInt(raw, 10) : NaN;
            return isNaN(n) ? null : _clamp(n);
        } catch (e) { return null; }
    }

    function _save(px) {
        try { localStorage.setItem(LS_KEY, String(px)); } catch (e) {}
    }

    /* ── Drag handlers ────────────────────────────────────── */

    function _onMouseDown(e) {
        if (_isMobile()) return;
        if (!_panel) return;
        _dragging   = true;
        _startX     = e.clientX;
        _startWidth = _panel.getBoundingClientRect().width;
        document.body.style.cursor    = 'col-resize';
        document.body.style.userSelect = 'none';
        if (_handle) _handle.classList.add('active');
        e.preventDefault();
    }

    function _onMouseMove(e) {
        if (!_dragging) return;
        var delta    = e.clientX - _startX;
        var newWidth = _clamp(_startWidth + delta);
        _applyWidth(newWidth);
    }

    function _onMouseUp() {
        if (!_dragging) return;
        _dragging = false;
        document.body.style.cursor    = '';
        document.body.style.userSelect = '';
        if (_handle) _handle.classList.remove('active');
        /* Persistir y limpiar estado de expandido */
        if (_panel) {
            var w = Math.round(_panel.getBoundingClientRect().width);
            _save(w);
            _syncExpandedState(w);
        }
    }

    /* ── Botón expandir/contraer ─────────────────────────── */

    function _syncExpandedState(currentWidth) {
        var expandedThreshold = _maxWidth() - 40;
        _isExpanded = currentWidth >= expandedThreshold;
        if (_expandBtn) {
            var icon = _expandBtn.querySelector('i');
            if (icon) {
                icon.className = _isExpanded
                    ? 'fas fa-compress-alt'
                    : 'fas fa-expand-alt';
            }
            _expandBtn.title = _isExpanded ? 'Reducir panel' : 'Expandir panel';
        }
    }

    function _toggleExpand() {
        if (_isMobile()) return;
        var target;
        if (_isExpanded) {
            /* Contraer al ancho guardado o default */
            var saved = _savedWidth();
            target = (saved && saved < _maxWidth() - 40) ? saved : DEFAULT_WIDTH;
        } else {
            target = _maxWidth();
        }
        _applyWidth(target);
        _syncExpandedState(target);
    }

    /* ── Setup ────────────────────────────────────────────── */

    function _injectHandle() {
        if (!_panel || _panel.querySelector('.panel-resize-handle')) return;
        _handle = document.createElement('div');
        _handle.className   = 'panel-resize-handle';
        _handle.title       = 'Arrastra para redimensionar';
        _handle.addEventListener('mousedown', _onMouseDown);
        _panel.appendChild(_handle);
    }

    function _injectExpandButton() {
        var btnsBar = _panel && _panel.querySelector('.panel-header-btns');
        if (!btnsBar) return;
        if (btnsBar.querySelector('.panel-expand-btn')) return;

        _expandBtn = document.createElement('button');
        _expandBtn.className = 'panel-hbtn panel-expand-btn';
        _expandBtn.title     = 'Expandir panel';
        _expandBtn.innerHTML = '<i class="fas fa-expand-alt" style="font-size:11px;"></i>';
        _expandBtn.addEventListener('click', _toggleExpand);
        /* Insertar antes del botón cerrar */
        var closeBtn = btnsBar.querySelector('[onclick*="toggleLeftPanel"]');
        if (closeBtn) {
            btnsBar.insertBefore(_expandBtn, closeBtn);
        } else {
            btnsBar.appendChild(_expandBtn);
        }
    }

    function _restoreWidth() {
        if (_isMobile()) return;
        var saved = _savedWidth();
        if (saved) {
            _applyWidth(saved);
            _syncExpandedState(saved);
        } else {
            _syncExpandedState(DEFAULT_WIDTH);
        }
    }

    function _onWindowResize() {
        if (_isMobile()) {
            /* En mobile, devolver control al CSS responsive (no forzar ancho) */
            document.documentElement.style.removeProperty('--panel-w');
            return;
        }
        /* Re-aplicar el ancho clamped (max puede cambiar si el viewport cambia) */
        var current = _panel ? _panel.getBoundingClientRect().width : DEFAULT_WIDTH;
        var clamped = _clamp(current);
        if (Math.abs(clamped - current) > 2) {
            _applyWidth(clamped);
        }
        _syncExpandedState(clamped);
    }

    function _init() {
        _panel = document.getElementById('ws-left-panel');
        if (!_panel) return;

        _injectHandle();
        _injectExpandButton();
        _restoreWidth();

        document.addEventListener('mousemove', _onMouseMove);
        document.addEventListener('mouseup',   _onMouseUp);

        /* Re-evaluar al cambiar tamaño de ventana (debounced) */
        var rTimer;
        window.addEventListener('resize', function () {
            if (_dragging) return;  /* el drag dispara resize artificialmente */
            clearTimeout(rTimer);
            rTimer = setTimeout(_onWindowResize, 150);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

}());
