/**
 * BurgerRank — Módulo Share Card
 *
 * Genera una imagen 9:16 (Instagram Stories) de una degustación
 * y la comparte via Web Share API (con fallback a descarga PNG).
 *
 * Flujo:
 *   ShareCard.open(item) → popula card off-screen → html2canvas →
 *   modal de preview → navigator.share({ files }) o <a download>
 */

const ShareCard = (() => {

  // Canvas capturado más recientemente (necesario para _doShare)
  let _canvas = null;
  let _burgerNombre = '';

  function _escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Populate ───────────────────────────────────────────────────────────

  function _populate({ hamburguesa, local, topN, degustacion }) {
    const topnEl      = document.getElementById('sc-topn');
    const burgerEl    = document.getElementById('sc-burger-name');
    const localEl     = document.getElementById('sc-local-name');
    const dirRow      = document.getElementById('sc-dir-row');
    const dirEl       = document.getElementById('sc-direccion');
    const commentEl   = document.getElementById('sc-comment');

    if (!topnEl) return;

    topnEl.textContent    = `#${topN}`;
    burgerEl.textContent  = hamburguesa?.nombre || '';
    localEl.textContent   = local?.nombre || '';

    if (local?.direccion) {
      dirEl.textContent        = local.direccion;
      dirRow.style.display     = 'flex';
    } else {
      dirRow.style.display     = 'none';
    }

    const comment = degustacion?.comentario?.trim();
    if (comment) {
      commentEl.textContent  = `"${comment}"`;
      commentEl.style.fontStyle = 'italic';
    } else {
      commentEl.textContent  = '¿Probaste esta burger? Compartí tu opinión sobre hamburgueserías en BurgerRank.';
      commentEl.style.fontStyle = 'normal';
    }
  }

  // ── Capture ────────────────────────────────────────────────────────────

  async function _capture() {
    const el = document.getElementById('share-card-offscreen');
    if (!el) throw new Error('Elemento share-card-offscreen no encontrado');

    return html2canvas(el, {
      scale:           3,
      useCORS:         true,
      backgroundColor: null,
      logging:         false,
      // Forzar dimensiones exactas por si el browser reescala
      width:  390,
      height: 693,
    });
  }

  // ── Share / Download ───────────────────────────────────────────────────

  async function _doShareOrDownload(canvas, nombre) {
    const slug     = (nombre || 'burger').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const fileName = `burgerrank-${slug}.png`;

    // Intentar Web Share API con archivo (funciona en mobile)
    if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
      try {
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        const file = new File([blob], fileName, { type: 'image/png' });

        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'BurgerRank' });
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return; // usuario canceló → no hacer fallback
        // Cualquier otro error → caer a descarga
      }
    }

    // Fallback: descarga directa
    const link     = document.createElement('a');
    link.download  = fileName;
    link.href      = canvas.toDataURL('image/png');
    link.click();
  }

  // ── Modal de preview ───────────────────────────────────────────────────

  function _showModal(canvas) {
    document.querySelector('.sc-modal-overlay')?.remove();

    const dataUrl = canvas.toDataURL('image/png');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay sc-modal-overlay';
    overlay.innerHTML = `
      <div class="modal-sheet sc-modal-sheet">
        <div class="sc-modal-header">
          <h3 class="sc-modal-title">Compartir card</h3>
          <button class="btn-ghost sc-modal-close"
                  onclick="this.closest('.sc-modal-overlay').remove()"
                  aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 style="width:20px;height:20px;">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Preview centrada, max 200px de ancho para que entre en el sheet -->
        <div class="sc-preview-wrap">
          <img src="${dataUrl}"
               alt="Preview de la share card"
               class="sc-preview-img">
        </div>

        <button id="sc-share-btn" class="btn-primary sc-share-action"
                onclick="ShareCard._triggerShare()">
          📤 Compartir imagen
        </button>
        <p class="sc-share-hint">
          Abre el menú del sistema para compartir en Instagram Stories, WhatsApp y más.
          En escritorio se descarga como PNG.
        </p>
      </div>
    `;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ── API pública ────────────────────────────────────────────────────────

  return {
    /**
     * Punto de entrada principal.
     * @param {{ hamburguesa, local, topN, degustacion }} item
     */
    async open(item) {
      _canvas       = null;
      _burgerNombre = item.hamburguesa?.nombre || '';

      _populate(item);
      App.showToast('Generando card…', 'info', 1500);

      try {
        _canvas = await _capture();
        _showModal(_canvas);
      } catch (err) {
        console.error('[ShareCard]', err);
        App.showToast('Error al generar la imagen', 'error');
      }
    },

    /** Llamado desde el botón dentro del modal. */
    async _triggerShare() {
      if (!_canvas) return;

      const btn = document.getElementById('sc-share-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Compartiendo…'; }

      try {
        await _doShareOrDownload(_canvas, _burgerNombre);
        document.querySelector('.sc-modal-overlay')?.remove();
      } catch (err) {
        if (err.name !== 'AbortError') {
          App.showToast('Error al compartir', 'error');
        }
        if (btn) { btn.disabled = false; btn.innerHTML = '📤 Compartir imagen'; }
      }
    },
  };
})();
