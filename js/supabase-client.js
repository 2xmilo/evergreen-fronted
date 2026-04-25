/* ==========================================================================
   SUPABASE CLIENT — Monitor Pro · Evergreen
   ========================================================================== */

var SUPA_URL = 'https://tdwxyusefmtvyslzbzkr.supabase.co';
var SUPA_KEY = 'sb_publishable_-FQE-ri7aMa2QwS1wCfE7A_4nMjEhml';

var _sb = (function () {
    if (typeof supabase === 'undefined') {
        console.error('[Evergreen] Supabase JS no cargado. Verifica el CDN.');
        return null;
    }
    try {
        return supabase.createClient(SUPA_URL, SUPA_KEY);
    } catch (e) {
        console.error('[Evergreen] Error inicializando Supabase:', e);
        return null;
    }
})();
