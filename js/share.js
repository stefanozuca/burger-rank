/**
 * BurgerRank — Módulo de Vista Pública (Share)
 *
 * Muestra el top personal de un usuario en modo read-only.
 * Los datos vienen codificados en el hash de la URL (no requiere red ni auth):
 *   share.html#<base64url_encoded_json>
 *
 * Formato del JSON codificado:
 * {
 *   u: "Nombre del usuario",
 *   d: [{ n: "Nombre local", t: topN, b: "Nombre burger", c: "Comentario" }],
 *   ts: "fecha"
 * }
 *
 * Por qué en el hash:
 * - El hash no se envía al servidor → GitHub Pages no necesita manejar rutas
 * - Funciona offline (los datos están en la URL)
 * - No hay backend ni base de datos involucrada para la vista pública
 */

const ShareView = (() => {

  function _escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * Decodifica los datos del hash de la URL.
   * Acepta base64url (con - y _ en lugar de + y /).
   */
  function _decodeShareData(hash) {
    try {
      // Remover el # inicial
      const encoded = hash.startsWith('#') ? hash.slice(1) : hash;
      if (!encoded) return null;

      // Revertir los reemplazos de base64url
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      // Agregar padding si fue removido
      const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4);

      const json = decodeURIComponent(escape(atob(padded)));
      return JSON.parse(json);
    } catch (err) {
      console.error('Error decodificando share data:', err);
      return null;
    }
  }

  function _renderMedal(position) {
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    return medals[position] || `#${position}`;
  }

  function _renderSharePage(data) {
    const { u: userName, d: items, ts: date } = data;

    document.title = `Top 5 de ${userName} — BurgerRank`;

    // Meta tags OG para compartir en redes (mejor preview)
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc  = document.querySelector('meta[property="og:description"]');
    if (ogTitle) ogTitle.content = `🍔 Top 5 Burgers de ${userName}`;
    if (ogDesc)  ogDesc.content  = items.map((item, i) => `#${i+1} ${item.n}`).join(' · ');

    const container = document.getElementById('share-container');
    if (!container) return;

    container.innerHTML = `
      <!-- Header con gradiente naranja -->
      <div class="share-header">
        <div class="text-5xl mb-3">🍔</div>
        <h1 class="text-2xl font-bold">Top 5 de ${_escHtml(userName)}</h1>
        <p class="text-[#D2A679] text-sm mt-1">Actualizado: ${_escHtml(date || '')}</p>
        <p class="text-white/70 text-xs mt-3">Rankeado con BurgerRank</p>
      </div>

      <!-- Lista de top 5 -->
      <div class="bg-[#261509] mx-4 -mt-4 rounded-2xl overflow-hidden shadow-xl border border-[#5c3d25]">
        ${items.map((item, i) => `
          <div class="share-rank-item">
            <div class="text-2xl w-10 text-center flex-shrink-0">
              ${_renderMedal(i + 1)}
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-bold text-sm leading-tight">${_escHtml(item.n)}</p>
              ${item.b
                ? `<p class="text-xs text-[#D2A679] mt-0.5 truncate">🍔 ${_escHtml(item.b)}</p>`
                : ''
              }
              ${item.c
                ? `<p class="text-xs text-gray-400 mt-1 line-clamp-2 italic">"${_escHtml(item.c)}"</p>`
                : ''
              }
            </div>
            <div class="rank-badge ${i < 3 ? `rank-${i+1}` : ''} flex-shrink-0 ml-2">
              #${item.t}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- CTA para instalar la app -->
      <div class="mx-4 mt-6 p-4 rounded-xl text-center" style="background:var(--color-surface)">
        <p class="text-sm text-gray-400 mb-3">¿Querés rankear tus hamburguesas?</p>
        <a href="${location.origin}${location.pathname.replace('share.html', 'index.html')}"
           class="btn-primary inline-flex">
          🍔 Usar BurgerRank
        </a>
      </div>

      <!-- Botón compartir -->
      <div class="mx-4 mt-4 mb-8 text-center">
        <button onclick="ShareView.shareThis()" class="btn-secondary w-full">
          📤 Compartir este ranking
        </button>
      </div>
    `;
  }

  function _renderError(msg) {
    const container = document.getElementById('share-container');
    if (!container) return;
    container.innerHTML = `
      <div class="share-header">
        <div class="text-5xl mb-3">🍔</div>
        <h1 class="text-2xl font-bold">BurgerRank</h1>
      </div>
      <div class="mx-4 mt-8">
        <div class="empty-state">
          <div class="emoji">😕</div>
          <h3>Link inválido</h3>
          <p>${_escHtml(msg)}</p>
          <a href="index.html" class="btn-primary mt-4 inline-flex">Ir a BurgerRank</a>
        </div>
      </div>
    `;
  }

  // ── API pública ─────────────────────────────────────────────────────────

  return {
    /** Inicializa la vista de share. Llamar desde share.html. */
    init() {
      const hash = location.hash;

      if (!hash || hash === '#') {
        _renderError('No se encontraron datos de ranking en este link.');
        return;
      }

      const data = _decodeShareData(hash);

      if (!data || !data.d || !Array.isArray(data.d)) {
        _renderError('El link está dañado o es inválido.');
        return;
      }

      _renderSharePage(data);
    },

    /** Vuelve a compartir la página actual via Web Share API. */
    async shareThis() {
      const url = location.href;
      const title = document.title;

      if (navigator.share) {
        try {
          await navigator.share({ title, url });
        } catch (err) {
          if (err.name !== 'AbortError') this._copyLink(url);
        }
      } else {
        this._copyLink(url);
      }
    },

    _copyLink(url) {
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.querySelector('[onclick="ShareView.shareThis()"]');
        if (btn) {
          btn.textContent = '✅ ¡Link copiado!';
          setTimeout(() => { btn.textContent = '📤 Compartir este ranking'; }, 2000);
        }
      });
    },
  };
})();

// Auto-inicializar cuando el DOM esté listo (share.html lo incluye directamente)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ShareView.init());
} else {
  ShareView.init();
}
