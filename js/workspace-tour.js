/* ==========================================================================
   WORKSPACE TOUR — Onboarding con resaltado pulsante (sutil, sin overlay)
   Guía al usuario en el primer paso: Resumen (definir zona → módulo) e
   Hidromorfología (flujo de 4 pasos). Autolanza una vez; luego replay manual.
   ========================================================================== */
(function () {
    'use strict';

    var TOURS = {
        resumen: {
            flag: 'eg_tour_resumen_v1',
            steps: [
                {
                    getEl: function () { return document.getElementById('draw-toggle-btn'); },
                    step: 'Paso 1 de 2',
                    text: 'Empieza aquí: abre <b>Herramientas de dibujo</b> y dibuja tu <b>zona de estudio</b> sobre el mapa.',
                    until: function () { return !!(window.WorkspaceState && WorkspaceState.zona); }
                },
                {
                    // Resalta la barra de módulos (padre de las pestañas)
                    getEl: function () {
                        var b = document.getElementById('tab-btn-vegetacion');
                        return b ? b.parentElement : null;
                    },
                    step: 'Paso 2 de 2',
                    text: '¡Zona lista! Ahora elige un <b>módulo</b> (Vegetación, Agua, Bosque…) y presiona <b>Ejecutar análisis</b> para ver los datos.'
                }
            ]
        },
        hidro: {
            flag: 'eg_tour_hidro_v1',
            steps: [
                {
                    getEl: function () { return document.getElementById('hidro-config-panel'); },
                    step: 'Paso 1 de 4',
                    text: 'Ajusta la <b>sensibilidad</b> de la red hídrica con el umbral de streams.'
                },
                {
                    getEl: function () { return document.getElementById('hidro-btn-rect'); },
                    step: 'Paso 2 de 4',
                    text: 'Dibuja un <b>rectángulo</b> sobre el área aproximada donde está la cuenca.'
                },
                {
                    getEl: function () { return document.getElementById('hidro-btn-outlet'); },
                    step: 'Paso 3 de 4',
                    text: 'Marca el <b>punto de salida</b> (outlet) de la cuenca haciendo click en el mapa.'
                },
                {
                    getEl: function () { return document.getElementById('hidro-btn-ejecutar'); },
                    step: 'Paso 4 de 4',
                    text: 'Presiona para <b>delimitar la cuenca</b>. ¡Eso es todo!'
                }
            ]
        }
    };

    var _ring = null, _tip = null, _raf = null;
    var _tour = null, _idx = 0;

    function _ensureNodes() {
        if (_ring) return;
        _ring = document.createElement('div');
        _ring.className = 'eg-tour-ring';
        _tip = document.createElement('div');
        _tip.className = 'eg-tour-tip';
        _tip.innerHTML =
            '<div class="eg-tour-tip__step"></div>' +
            '<div class="eg-tour-tip__text"></div>' +
            '<div class="eg-tour-tip__actions">' +
              '<button type="button" class="eg-tour-skip">Saltar guía</button>' +
              '<button type="button" class="eg-tour-next">Siguiente</button>' +
            '</div>';
        document.body.appendChild(_ring);
        document.body.appendChild(_tip);
        _tip.querySelector('.eg-tour-skip').addEventListener('click', function () { _end(false); });
        _tip.querySelector('.eg-tour-next').addEventListener('click', _advance);
    }

    function _curEl() {
        if (!_tour) return null;
        var s = _tour.steps[_idx];
        return s && s.getEl ? s.getEl() : null;
    }

    function _position() {
        var target = _curEl();
        if (!target) { _ring.style.opacity = '0'; return; }
        var r = target.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) { _ring.style.opacity = '0'; return; }
        _ring.style.opacity = '1';
        var pad = 6;
        _ring.style.left   = (r.left - pad) + 'px';
        _ring.style.top    = (r.top - pad) + 'px';
        _ring.style.width  = (r.width + pad * 2) + 'px';
        _ring.style.height = (r.height + pad * 2) + 'px';

        // Tooltip: debajo del target si hay espacio, si no arriba
        var tw = _tip.offsetWidth, th = _tip.offsetHeight;
        var left = Math.max(12, Math.min(r.left, window.innerWidth - tw - 12));
        var top;
        if (r.bottom + 14 + th < window.innerHeight) top = r.bottom + 14;
        else top = Math.max(12, r.top - th - 14);
        _tip.style.left = left + 'px';
        _tip.style.top  = top + 'px';
    }

    function _loop() {
        if (!_tour) return;                 // el tour terminó → detener loop
        _position();
        var s = _tour.steps[_idx];
        if (s && typeof s.until === 'function') {
            try { if (s.until()) { _advance(); } } catch (e) {}
        }
        if (_tour) _raf = requestAnimationFrame(_loop);   // reagendar si sigue activo
    }

    function _showStep(i) {
        _idx = i;
        var s = _tour.steps[i];
        if (!s) { _end(true); return; }
        _tip.querySelector('.eg-tour-tip__step').textContent = s.step || '';
        _tip.querySelector('.eg-tour-tip__text').innerHTML   = s.text || '';
        var nextBtn = _tip.querySelector('.eg-tour-next');
        nextBtn.textContent = (i === _tour.steps.length - 1) ? 'Entendido' : 'Siguiente';
        // Traer el elemento a la vista si está fuera de pantalla
        var el = _curEl();
        if (el && typeof el.scrollIntoView === 'function') {
            try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
        }
    }

    function _advance() {
        if (!_tour) return;
        if (_idx + 1 >= _tour.steps.length) { _end(true); return; }
        _showStep(_idx + 1);
    }

    function _end(completed) {
        if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
        if (_ring) _ring.style.display = 'none';
        if (_tip)  _tip.style.display  = 'none';
        if (_tour && _tour.flag) {
            try { localStorage.setItem(_tour.flag, completed ? 'done' : 'skipped'); } catch (e) {}
        }
        _tour = null;
    }

    function _start(name) {
        var t = TOURS[name];
        if (!t) return;
        _ensureNodes();
        _tour = t; _idx = 0;
        _ring.style.display = 'block';
        _tip.style.display  = 'block';
        _showStep(0);
        if (_raf) cancelAnimationFrame(_raf);
        _loop();
    }

    function _seen(name) {
        try { return !!localStorage.getItem(TOURS[name].flag); } catch (e) { return false; }
    }

    // ── API pública ──
    window.egTour = {
        startResumen: function () { _start('resumen'); },
        startHidro:   function () { _start('hidro'); },
        reset: function () {
            try {
                localStorage.removeItem(TOURS.resumen.flag);
                localStorage.removeItem(TOURS.hidro.flag);
            } catch (e) {}
        }
    };

    // ── Autolanzado ──
    // Resumen: primera visita, si estamos en el tab resumen y aún no hay zona.
    window.addEventListener('load', function () {
        setTimeout(function () {
            if (_seen('resumen')) return;
            if (!document.getElementById('draw-toggle-btn')) return;
            _start('resumen');
        }, 1800);
    });

    // Hidro: al entrar por primera vez al tab de Hidromorfología.
    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('#tab-btn-hidromorfologia, #btn-outlet-cuenca') : null;
        if (!btn) return;
        if (_seen('hidro')) return;
        setTimeout(function () {
            if (document.getElementById('hidro-config-panel')) _start('hidro');
        }, 700);
    }, true);

})();
