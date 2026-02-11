// ============================================
// EVERGREEN - MAIN JAVASCRIPT
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    
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
    
    // Auto-advance after 10 seconds
    autoAdvanceTimer = setTimeout(transitionToMainSite, 10000);
    
    // Start progress bar
    startProgressBar();
    
    // Manual button click
    if (enterBtn) {
        enterBtn.addEventListener('click', transitionToMainSite);
    }
    
    // ============================================
    // SERVICES SLIDER FUNCTIONALITY
    // ============================================
    const servicesWrapper = document.querySelector('.services-slider-wrapper');
    const serviceColumns = document.querySelectorAll('.service-column');
    const prevBtn = document.querySelector('.services-prev');
    const nextBtn = document.querySelector('.services-next');
    
    if (servicesWrapper && serviceColumns.length > 0) {
        let currentIndex = 0;
        const totalServices = serviceColumns.length;
        let visibleColumns = 4;
        let autoSlideInterval;
        
        // Adjust visible columns based on screen size
        function updateVisibleColumns() {
            const width = window.innerWidth;
            if (width <= 480) {
                visibleColumns = 1;
            } else if (width <= 768) {
                visibleColumns = 2;
            } else if (width <= 1024) {
                visibleColumns = 3;
            } else {
                visibleColumns = 4;
            }
        }
        
        // Function to update slider position
        function updateSlider() {
            updateVisibleColumns();
            const offset = currentIndex * (100 / visibleColumns);
            servicesWrapper.style.transform = `translateX(-${offset}%)`;
            
            // Update button states
            if (prevBtn && nextBtn) {
                prevBtn.style.opacity = currentIndex === 0 ? '0.5' : '1';
                prevBtn.style.pointerEvents = currentIndex === 0 ? 'none' : 'auto';
                
                nextBtn.style.opacity = currentIndex >= totalServices - visibleColumns ? '0.5' : '1';
                nextBtn.style.pointerEvents = currentIndex >= totalServices - visibleColumns ? 'none' : 'auto';
            }
        }
        
        // Next slide
        function nextSlide() {
            if (currentIndex < totalServices - visibleColumns) {
                currentIndex++;
                updateSlider();
            }
        }
        
        // Previous slide
        function prevSlide() {
            if (currentIndex > 0) {
                currentIndex--;
                updateSlider();
            }
        }
        
        // Auto-slide every 8 seconds
        window.startAutoSlide = function() {
            autoSlideInterval = setInterval(() => {
                if (currentIndex < totalServices - visibleColumns) {
                    nextSlide();
                } else {
                    currentIndex = 0;
                    updateSlider();
                }
            }, 8000);
        };
        
        // Stop auto-slide on user interaction
        function stopAutoSlide() {
            clearInterval(autoSlideInterval);
        }
        
        // Event listeners for navigation buttons
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                stopAutoSlide();
                nextSlide();
                startAutoSlide();
            });
        }
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                stopAutoSlide();
                prevSlide();
                startAutoSlide();
            });
        }
        
        // Hover effects for service columns
        serviceColumns.forEach(column => {
            column.addEventListener('mouseenter', () => {
                stopAutoSlide();
                serviceColumns.forEach(col => {
                    if (col !== column) {
                        col.style.opacity = '0.4';
                    }
                });
                column.style.transform = 'scale(1.02)';
            });
            
            column.addEventListener('mouseleave', () => {
                serviceColumns.forEach(col => {
                    col.style.opacity = '1';
                });
                column.style.transform = 'scale(1)';
                startAutoSlide();
            });
        });
        
        // Handle window resize
        window.addEventListener('resize', () => {
            updateSlider();
        });
        
        // Initialize slider
        updateSlider();
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
document.addEventListener('DOMContentLoaded', function() {
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
        column.addEventListener('mouseenter', function() {
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

        column.addEventListener('mouseleave', function() {
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

