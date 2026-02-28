/**
 * NASA Earth Observatory RSS Feeds Loader
 * Carga noticias reales de NASA y las inserta en la página.
 */

document.addEventListener("DOMContentLoaded", () => {
    loadNasaNews();
});

async function loadNasaNews() {
    const rssUrl = 'https://earthobservatory.nasa.gov/feeds/image-of-the-day.rss';
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;

    const container = document.getElementById('nasa-news-container');
    if (!container) return; // No existe la sección en esta página

    try {
        const response = await fetch(proxyUrl);
        const data = await response.json();

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(data.contents, "text/xml");

        const items = xmlDoc.querySelectorAll("item");
        let html = '';

        // Categorías temáticas simuladas para darle variedad
        const categories = [
            { name: "Clima", color: "#0ea5e9", icon: "🌍" },
            { name: "Satélites", color: "#f59e0b", icon: "🛰️" },
            { name: "Biodiversidad", color: "#10b981", icon: "🌿" },
            { name: "Sostenibilidad", color: "#8b5cf6", icon: "♻️" }
        ];

        // Mostrar solo los primeros 4 artículos
        const maxNews = Math.min(items.length, 4);

        for (let i = 0; i < maxNews; i++) {
            const item = items[i];
            const title = item.querySelector("title")?.textContent || "Noticia NASA";
            const link = item.querySelector("link")?.textContent || "#";
            let description = item.querySelector("description")?.textContent || "";
            // Limpiar HTML de la descripción y cortar
            description = description.replace(/<[^>]*>?/gm, '').substring(0, 120) + '...';

            const enclosure = item.querySelector("enclosure");
            const imageUrl = enclosure ? enclosure.getAttribute("url") : "img/fondo_musgo.jpg";

            const rawDate = item.querySelector("pubDate")?.textContent;
            const formattedDate = rawDate ? new Date(rawDate).toLocaleDateString() : "Reciente";

            const cat = categories[i % categories.length];

            html += `
                <div class="news-card">
                    <div class="news-image" style="background-image: url('${imageUrl}')">
                    </div>
                    <div class="news-content">
                        <div class="news-meta">
                            <span><i class="fas fa-calendar-alt"></i> ${formattedDate}</span>
                            <span><i class="fas fa-globe-americas"></i> NASA Earth</span>
                        </div>
                        <h3><a href="${link}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
                        <p>${description}</p>
                        <a href="${link}" class="read-more" target="_blank" rel="noopener noreferrer">Leer artículo <i class="fas fa-arrow-right"></i></a>
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;

    } catch (error) {
        console.error("Error cargando noticias de la NASA:", error);
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; background: #fff; border-radius: 10px; color: #ef4444;">
                <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                <p>No se pudieron cargar las noticias de la NASA en este momento. Por favor, intenta de nuevo más tarde.</p>
            </div>
        `;
    }
}
