/**
 * Evergreen - Cargador de Noticias Ambientales
 * Fuente: Mongabay Latam (es.mongabay.com)
 * Proxy: allorigins.win (gratuito, sin límites, sin cuenta)
 * Caché: localStorage 24h — las visitas del mismo día son instantáneas
 */

const CACHE_KEY = 'evergreen_news_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas
const TOTAL_CARDS = 3;
const FEED_URL = 'https://es.mongabay.com/feed/';
const PROXY_URL = `https://api.allorigins.win/get?url=${encodeURIComponent(FEED_URL)}`;
const FALLBACK_IMG = 'img/fondo_musgo.jpg';

document.addEventListener('DOMContentLoaded', () => loadNews());

async function loadNews() {
    const container = document.getElementById('nasa-news-container');
    if (!container) return;

    // ─── 1. Caché válido → render inmediato ───────────────────
    const cached = getCache();
    if (cached) {
        renderCards(container, cached);
        return;
    }

    // ─── 2. Fetch + parse RSS ─────────────────────────────────
    try {
        const res = await fetch(PROXY_URL);
        const data = await res.json();

        const parser = new DOMParser();
        const xml = parser.parseFromString(data.contents, 'text/xml');
        const items = Array.from(xml.querySelectorAll('item'));

        if (!items.length) throw new Error('Sin artículos');

        const articles = items.slice(0, TOTAL_CARDS).map(item => {
            const enclosure = item.querySelector('enclosure');
            const imageUrl = enclosure ? enclosure.getAttribute('url') : FALLBACK_IMG;

            return {
                title: cleanText(item.querySelector('title')?.textContent || '', 90),
                description: cleanText(item.querySelector('description')?.textContent || '', 140),
                link: item.querySelector('link')?.textContent?.trim() || '#',
                image: imageUrl || FALLBACK_IMG,
                date: item.querySelector('pubDate')?.textContent || ''
            };
        });

        setCache(articles);
        renderCards(container, articles);

    } catch (err) {
        console.warn('[Evergreen] News load error:', err);
        showFallback(container);
    }
}

// ─────────────────────────────────────────────────────────────
// CACHÉ
// ─────────────────────────────────────────────────────────────

function getCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { timestamp, articles } = JSON.parse(raw);
        return (Date.now() - timestamp < CACHE_TTL) ? articles : null;
    } catch { return null; }
}

function setCache(articles) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), articles }));
    } catch { /* localStorage lleno o bloqueado — sin problema */ }
}

// ─────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────

function renderCards(container, articles) {
    container.innerHTML = articles.map(a => {
        const dateStr = a.date
            ? new Date(a.date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'Reciente';

        return `
        <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="proj-card r v">
            <div class="proj-card-bg" style="background-image: url('${a.image}'); filter: brightness(0.6);"></div>
            <div class="proj-card-overlay"></div>
            <div class="proj-card-body">
                <div class="proj-tag">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="5" cy="5" r="4"/><path d="M5 2v3l2 1.5"/></svg>
                    Actualidad
                </div>
                <h3 class="proj-name-news">${a.title}</h3>
                <div class="news-meta">
                    <i class="fas fa-calendar-alt"></i> ${dateStr}
                </div>
                <p class="proj-desc" style="margin-top: 10px;">${a.description}</p>
            </div>
        </a>`;
    }).join('');
}

function showFallback(container) {
    container.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:3rem; background: var(--glass-bg); backdrop-filter: blur(12px); border: 1px solid var(--glass-brd); border-radius:16px; color:var(--white-60);">
            <i class="fas fa-rss" style="font-size:2.5rem; color:var(--accent); margin-bottom:1rem; display:block;"></i>
            <p style="font-size:1.05rem; line-height:1.7;">
                No se pudieron cargar las noticias en este momento.<br>
                Visita <a href="https://es.mongabay.com" target="_blank"
                    style="color:var(--accent); font-weight:600; text-decoration: none;">Mongabay Latinoamérica</a>
                para las últimas noticias ambientales.
            </p>
        </div>`;
}

// ─────────────────────────────────────────────────────────────
// UTILIDAD
// ─────────────────────────────────────────────────────────────

function cleanText(text, maxLen) {
    const clean = text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]*>/gm, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#8230;/g, '...')
        .replace(/\s+/g, ' ').trim();
    return clean.length > maxLen ? clean.substring(0, maxLen) + '...' : clean;
}
