// ============================================
// EVERGREEN - MAIN JAVASCRIPT
// ============================================

document.addEventListener('DOMContentLoaded', function () {

    // ============================================
    // LOADING SCREEN FUNCTIONALITY
    // ============================================
    const loadingScreen = document.getElementById('loading-screen');
    const mainSite = document.getElementById('main-site');
    const enterBtn = document.getElementById('enter-btn');
    const progressBar = document.querySelector('.progress-bar');

    let autoAdvanceTimer;

    // Progress bar animation (10 seconds)
    function startProgressBar() {
        setTimeout(() => {
            progressBar.style.transition = 'width 10s linear';
            progressBar.style.width = '100%';
        }, 100);
    }

    // Function to transition to main site
    function transitionToMainSite() {
        clearTimeout(autoAdvanceTimer);
        loadingScreen.style.transition = 'opacity 1s ease';
        loadingScreen.style.opacity = '0';

        setTimeout(() => {
            loadingScreen.classList.remove('active');
            loadingScreen.style.display = 'none';
            mainSite.classList.add('active');

            // Start services auto-slide after transition
            setTimeout(() => {
                if (typeof startAutoSlide === 'function') {
                    startAutoSlide();
                }
            }, 1000);
        }, 1000);
    }

    // Auto-advance after 5 seconds
    autoAdvanceTimer = setTimeout(transitionToMainSite, 5000);

    // Start progress bar
    startProgressBar();

    // Manual button click
    if (enterBtn) {
        enterBtn.addEventListener('click', transitionToMainSite);
    }

    // ============================================
    // SERVICES SWIPER (Vertical Cards Carousel)
    // ============================================
    const servicesSwiperElement = document.querySelector('.servicesSwiper');

    if (servicesSwiperElement && typeof Swiper !== 'undefined') {
        const servicesSwiper = new Swiper('.servicesSwiper', {
            slidesPerView: 1,
            spaceBetween: 20,
            loop: true,
            autoplay: {
                delay: 4000,
                disableOnInteraction: false,
                pauseOnMouseEnter: true
            },
            pagination: {
                el: '.swiper-pagination',
                clickable: true,
            },
            navigation: {
                nextEl: '.services-nav-next',
                prevEl: '.services-nav-prev',
            },
            breakpoints: {
                // Móviles grandes
                576: {
                    slidesPerView: 2,
                    spaceBetween: 20,
                },
                // Tablets
                768: {
                    slidesPerView: 3,
                    spaceBetween: 30,
                },
                // Escritorio
                1024: {
                    slidesPerView: 3, /* Bajado a 3 para evitar espacios vacíos gigantes */
                    spaceBetween: 40, /* Un poco más de aire central pero con tarjetas más grandes */
                }
            }
        });
    }

    // ============================================
    // PROJECTS SWIPER
    // ============================================
    const swiperProElement = document.querySelector('.projectsSwiperPro');

    if (swiperProElement && typeof Swiper !== 'undefined') {
        const swiperPro = new Swiper('.projectsSwiperPro', {
            slidesPerView: 1,
            spaceBetween: 0,
            loop: true,
            pagination: {
                el: '.swiper-pagination-pro',
                clickable: true,
            },
            navigation: {
                nextEl: '.swiper-button-next-pro',
                prevEl: '.swiper-button-prev-pro',
            },
            autoplay: {
                delay: 6000,
                disableOnInteraction: false,
            },
            speed: 800,
            effect: 'fade',
            fadeEffect: {
                crossFade: true
            }
        });
    }

    // ============================================
    // SMOOTH SCROLL FOR NAVIGATION
    // ============================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // ============================================
    // SCROLL INDICATOR HIDE ON SCROLL
    // ============================================
    const scrollIndicator = document.querySelector('.scroll-indicator');

    if (scrollIndicator) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 100) {
                scrollIndicator.style.opacity = '0';
                scrollIndicator.style.pointerEvents = 'none';
            } else {
                scrollIndicator.style.opacity = '0.8';
                scrollIndicator.style.pointerEvents = 'auto';
            }
        });
    }

    // ============================================
    // HEADER SCROLL EFFECT
    // ============================================
    const header = document.querySelector('.main-header');

    if (header) {
        let lastScroll = 0;
        window.addEventListener('scroll', () => {
            const currentScroll = window.scrollY;

            if (currentScroll > 100) {
                header.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.15)';
            } else {
                header.style.boxShadow = '0 4px 20px rgba(45, 80, 22, 0.12)';
            }

            lastScroll = currentScroll;
        });
    }

    // ============================================
    // INTERSECTION OBSERVER FOR ANIMATIONS
    // ============================================
    // INTERSECTION OBSERVER FOR ANIMATIONS - SMOOTH CONTINUOUS
    // INTERSECTION OBSERVER FOR ANIMATIONS - TITLES & SUBTITLES
    const observerOptions = {
        threshold: 0.2,
        rootMargin: '0px 0px -50px 0px'
    };

    const fadeInObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            } else {
                entry.target.style.opacity = '0';
                entry.target.style.transform = 'translateY(30px)';
            }
        });
    }, observerOptions);

    // Aplicar a títulos y subtítulos
    const animatedElements = document.querySelectorAll(
        '.section-title-light, .section-subtitle-light, ' +
        '.team-section h2, .team-section > p, ' +
        '.contact-content-wrap h2, .contact-content-wrap .subtitle, ' +
        '.page-title, .page-subtitle'
    );

    animatedElements.forEach(element => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(30px)';
        element.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
        fadeInObserver.observe(element);
    });

    // ============================================
    // KEYBOARD NAVIGATION
    // ============================================
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' && nextBtn) {
            nextBtn.click();
        } else if (e.key === 'ArrowLeft' && prevBtn) {
            prevBtn.click();
        }
    });

});

// ============================================
// UTILITY FUNCTIONS
// ============================================

// ============================================
// SOLUCIÓN PARA SERVICIOS EVERGREEN
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    const serviceColumns = document.querySelectorAll('.service-column');
    const servicesSection = document.querySelector('.services-fullscreen-section');

    // 1. Crear el overlay de fondo si no existe
    let bgOverlay = servicesSection.querySelector('.services-bg-overlay');
    if (!bgOverlay) {
        bgOverlay = document.createElement('div');
        bgOverlay.className = 'services-bg-overlay';
        servicesSection.insertBefore(bgOverlay, servicesSection.firstChild);
    }

    // 2. Guardar las imágenes originales y limpiar conflictos
    serviceColumns.forEach(col => {
        // Guardamos la URL de la imagen en un atributo data para no perderla
        const bgUrl = col.style.backgroundImage;
        if (bgUrl && bgUrl !== 'none') {
            col.setAttribute('data-bg', bgUrl);
        }
    });

    // 3. Gestión de eventos (Hover)
    serviceColumns.forEach(column => {
        column.addEventListener('mouseenter', function () {
            const imageToDisplay = this.getAttribute('data-bg');

            // A. Cambiamos el fondo de la SECCIÓN completa
            bgOverlay.style.backgroundImage = imageToDisplay;
            bgOverlay.style.opacity = '1';

            // B. Quitamos la imagen de la TARJETA actual para que no se repita
            // Esto la hace "transparente" y deja ver el fondo de la sección
            this.style.backgroundImage = 'none';

            // C. Opacidad de las demás tarjetas para dar foco
            serviceColumns.forEach(col => {
                if (col !== column) {
                    col.style.opacity = '0.3';
                }
            });
        });

        column.addEventListener('mouseleave', function () {
            // A. Apagamos el fondo de la sección
            bgOverlay.style.opacity = '0';

            // B. Devolvemos la imagen a la tarjeta
            this.style.backgroundImage = this.getAttribute('data-bg');

            // C. Restauramos opacidad de todas
            serviceColumns.forEach(col => {
                col.style.opacity = '1';
            });
        });
    });
});

// ============================================
// CONTACT FORM - FORMSPREE AJAX HANDLER
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('contact-form');
    const successDiv = document.getElementById('form-success');
    const submitBtn = document.getElementById('submit-btn');

    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoading = submitBtn.querySelector('.btn-loading');
        btnText.style.display = 'none';
        btnLoading.style.display = 'flex';
        submitBtn.disabled = true;

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { 'Accept': 'application/json' }
            });

            if (response.ok) {
                form.style.display = 'none';
                successDiv.style.display = 'block';
            } else {
                throw new Error('Error en el envío');
            }
        } catch (err) {
            btnText.style.display = 'flex';
            btnLoading.style.display = 'none';
            submitBtn.disabled = false;
            alert('Hubo un problema al enviar. Por favor intenta nuevamente o contáctanos a contacto@evergreenclima.com');
        }
    });
});
