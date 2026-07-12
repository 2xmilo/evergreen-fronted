/**
 * Evergreen - cargador de noticias ambientales.
 * Fuente: Mongabay Latam RSS (es.mongabay.com/feed).
 * Robustez: se intenta una CADENA de proxies/APIs en orden hasta que uno
 * responda con artículos. Antes se usaba solo allorigins.win, que se cae
 * seguido → por eso "nunca cargaban bien". Ahora corsproxy.io es el primario
 * (rápido y con imágenes) y hay 2 respaldos.
 *
 * IMPORTANTE: NUNCA se inventan noticias. Si TODAS las fuentes fallan, solo se
 * muestra un aviso honesto ("no se pudieron cargar") con enlace a la fuente
 * real. Prohibido mostrar tarjetas de noticias locales/fabricadas.
 */

const CACHE_KEY = 'evergreen_news_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const TOTAL_CARDS = 3;
const FEED_URL = 'https://es.mongabay.com/feed/';
const FALLBACK_IMG = 'img/patagonia.jpeg';
const FETCH_TIMEOUT = 8000;

// Cadena de fuentes: se prueban en orden hasta que una entregue artículos.
const SOURCES = [
    { name: 'corsproxy', url: (f) => 'https://corsproxy.io/?url=' + encodeURIComponent(f), parse: parseXmlResponse },
    { name: 'rss2json',  url: (f) => 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(f), parse: parseRss2Json },
    { name: 'allorigins', url: (f) => 'https://api.allorigins.win/get?url=' + encodeURIComponent(f), parse: parseAllorigins },
];

document.addEventListener('DOMContentLoaded', () => loadNews());

async function loadNews() {
    const container = document.getElementById('nasa-news-container');
    if (!container) return;

    const cached = getCache();
    if (cached) {
        renderCards(container, cached);
        return;
    }

    for (const source of SOURCES) {
        try {
            const res = await fetchWithTimeout(source.url(FEED_URL), FETCH_TIMEOUT);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            const articles = source.parse(text);
            if (articles && articles.length) {
                setCache(articles);
                renderCards(container, articles);
                return;
            }
            throw new Error('Sin articulos');
        } catch (err) {
            console.warn(`[Evergreen] News source "${source.name}" fallo:`, err.message || err);
            // sigue con la próxima fuente
        }
    }

    showFallback(container);
}

/* ── Parsers por tipo de fuente ─────────────────────────────── */

// corsproxy: devuelve el XML crudo del RSS.
function parseXmlResponse(text) {
    return articlesFromXml(text);
}

// allorigins: devuelve { contents: "<xml…>" }.
function parseAllorigins(text) {
    const data = JSON.parse(text);
    if (!data.contents) return [];
    return articlesFromXml(data.contents);
}

// rss2json: devuelve JSON ya parseado.
function parseRss2Json(text) {
    const data = JSON.parse(text);
    if (data.status !== 'ok' || !Array.isArray(data.items)) return [];
    return data.items.slice(0, TOTAL_CARDS).map((it) => ({
        title: cleanText(it.title || '', 90),
        description: cleanText(it.description || '', 140),
        link: (it.link || '#').trim(),
        image: it.thumbnail || (it.enclosure && it.enclosure.link) || FALLBACK_IMG,
        date: it.pubDate || ''
    }));
}

function articlesFromXml(xmlString) {
    const xml = new DOMParser().parseFromString(xmlString, 'text/xml');
    const items = Array.from(xml.querySelectorAll('item'));
    return items.slice(0, TOTAL_CARDS).map((item) => {
        const enclosure = item.querySelector('enclosure');
        const media = item.querySelector('media\\:content, content');
        const imageUrl = enclosure?.getAttribute('url') || media?.getAttribute('url') || FALLBACK_IMG;
        return {
            title: cleanText(item.querySelector('title')?.textContent || '', 90),
            description: cleanText(item.querySelector('description')?.textContent || '', 140),
            link: item.querySelector('link')?.textContent?.trim() || '#',
            image: imageUrl || FALLBACK_IMG,
            date: item.querySelector('pubDate')?.textContent || ''
        };
    });
}

/* ── Cache ──────────────────────────────────────────────────── */

function getCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { timestamp, articles } = JSON.parse(raw);
        return (Date.now() - timestamp < CACHE_TTL) ? articles : null;
    } catch {
        return null;
    }
}

function setCache(articles) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), articles }));
    } catch {
        // Cache is optional.
    }
}

async function fetchWithTimeout(url, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/* ── Render ─────────────────────────────────────────────────── */

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
                Puedes revisar la fuente directamente en
                <a href="https://es.mongabay.com" target="_blank" rel="noopener noreferrer"
                    style="color:var(--accent); font-weight:600; text-decoration: none;">Mongabay Latinoamerica</a>.
            </p>
        </div>`;
}

function cleanText(text, maxLen) {
    const clean = text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]*>/gm, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#8230;/g, '...')
        .replace(/\s+/g, ' ')
        .trim();

    return clean.length > maxLen ? clean.substring(0, maxLen) + '...' : clean;
}
