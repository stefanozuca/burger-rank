/**
 * BurgerRank — Módulo Home (Listado de Rankings)
 *
 * Maneja dos vistas:
 * - "Top Hamburgueserías": locales agrupados por su mejor Top N
 * - "Top Hamburguesas": burgers individuales ordenadas por Top N
 *
 * Lógica de ranking:
 * 1. Para cada local → encontrar el min(top_n) entre las degustaciones del usuario
 * 2. Ordenar locales por ese min(top_n) ascendente
 * 3. Para empates en top_n → aplicar orden manual de top_order (drag & drop)
 * 4. Para "Top Hamburguesas" → listar individualmente, filtrar por tags
 */

const Home = (() => {
  let _currentView = 'locales'; // 'locales' | 'hamburguesas'
  let _activeTagFilter = null;
  let _dragSrcIndex = null;
  let _localesRanked = [];      // cache del ranking calculado

  // ── Cálculo de ranking ─────────────────────────────────────────────────

  /**
   * Calcula el ranking de locales para el usuario.
   * @param {Object} data - { locales, hamburguesas, degustaciones, topOrder }
   * @returns {Array} locales ordenados con { local, bestTopN, bestBurger, degustacion }
   */
  function _calcLocalesRanking(data) {
    const { locales, hamburguesas, degustaciones, topOrder } = data;

    // Mapa: local_id → mejor degustación (menor top_n)
    const bestByLocal = {};
    degustaciones.forEach((deg) => {
      const topN = parseInt(deg.top_n, 10);
      if (isNaN(topN)) return;

      if (!bestByLocal[deg.local_id] || topN < bestByLocal[deg.local_id].topN) {
        bestByLocal[deg.local_id] = {
          topN,
          degustacion: deg,
          hamburguesa: hamburguesas.find((h) => h.id === deg.hamburguesa_id),
        };
      }
    });

    // Mapa: local_id → posicion_manual del usuario
    const manualOrder = {};
    topOrder.forEach((o) => {
      manualOrder[o.local_id] = parseInt(o.posicion_manual, 10);
    });

    // Construir lista de locales que tienen al menos una degustación
    const ranked = Object.entries(bestByLocal).map(([localId, best]) => ({
      local: locales.find((l) => l.id === localId) || { id: localId, nombre: 'Local desconocido' },
      bestTopN: best.topN,
      bestBurger: best.hamburguesa,
      degustacion: best.degustacion,
      manualPos: manualOrder[localId] ?? 9999,
    }));

    // Ordenar: primero por top_n, luego por orden manual, luego por nombre
    ranked.sort((a, b) => {
      if (a.bestTopN !== b.bestTopN) return a.bestTopN - b.bestTopN;
      if (a.manualPos !== b.manualPos) return a.manualPos - b.manualPos;
      return a.local.nombre.localeCompare(b.local.nombre);
    });

    return ranked;
  }

  /**
   * Calcula el ranking de hamburguesas individuales.
   */
  function _calcHamburguesasRanking(data) {
    const { hamburguesas, degustaciones, locales } = data;

    return degustaciones
      .filter((d) => !isNaN(parseInt(d.top_n, 10)))
      .map((deg) => ({
        hamburguesa: hamburguesas.find((h) => h.id === deg.hamburguesa_id),
        local: locales.find((l) => l.id === deg.local_id),
        degustacion: deg,
        topN: parseInt(deg.top_n, 10),
      }))
      .filter((item) => item.hamburguesa) // filtrar degustaciones huérfanas
      .sort((a, b) => a.topN - b.topN);
  }

  // ── Renderers de cards ─────────────────────────────────────────────────

  function _renderLocalCard(item, index) {
    const { local, bestTopN, bestBurger, degustacion } = item;
    const rankClass = bestTopN <= 3 ? `rank-${bestTopN}` : '';
    const hasPhoto = local.foto_url;

    return `
      <div class="card card-interactive draggable mb-3"
           data-local-id="${local.id}"
           data-index="${index}"
           draggable="true">
        ${hasPhoto
          ? `<img src="${local.foto_url}" alt="${local.nombre}" class="local-photo" onerror="this.style.display='none'">`
          : `<div class="local-photo-placeholder">🍔</div>`
        }
        <div class="p-4">
          <div class="flex items-start gap-3">
            <div class="rank-badge ${rankClass} flex-shrink-0" title="Top #${bestTopN}">
              #${bestTopN}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-bold text-base truncate">${_escHtml(local.nombre)}</h3>
              ${local.direccion
                ? `<p class="text-xs text-gray-400 mt-0.5 truncate">📍 ${_escHtml(local.direccion)}</p>`
                : ''
              }
            </div>
            <button class="btn-ghost flex-shrink-0"
                    onclick="Home.openLocalActions('${local.id}')"
                    aria-label="Opciones">
              <svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
              </svg>
            </button>
          </div>

          ${bestBurger ? `
            <div class="mt-3 p-2 rounded-lg" style="background:var(--color-surface2)">
              <p class="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Mejor hamburguesa</p>
              <p class="text-sm font-semibold">${_escHtml(bestBurger.nombre)}</p>
              ${degustacion.comentario
                ? `<p class="text-xs text-gray-400 mt-1 line-clamp-2">"${_escHtml(degustacion.comentario)}"</p>`
                : ''
              }
              ${bestBurger.tags
                ? `<div class="flex flex-wrap gap-1 mt-2">
                    ${bestBurger.tags.split(',').filter(Boolean).map((t) =>
                      `<span class="tag text-xs py-0.5">${_escHtml(t.trim())}</span>`
                    ).join('')}
                   </div>`
                : ''
              }
            </div>
          ` : ''}

          <div class="flex items-center justify-between mt-3">
            ${local.maps_url
              ? `<a href="${local.maps_url}" target="_blank" rel="noopener"
                    class="text-xs text-[#D2A679] flex items-center gap-1">
                   📍 Ver en Maps
                 </a>`
              : '<span></span>'
            }
            <button class="btn-secondary text-xs py-1.5 px-3"
                    onclick="App.navigate('#add-degustacion?local=${local.id}')">
              + Cargar degustación
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function _renderHamburguesaCard(item, index) {
    const { hamburguesa, local, topN, degustacion } = item;
    const rankClass = topN <= 3 ? `rank-${topN}` : '';
    const tags = hamburguesa.tags ? hamburguesa.tags.split(',').filter(Boolean) : [];

    return `
      <div class="card card-interactive mb-3 p-4">
        <div class="flex items-start gap-3">
          <div class="rank-badge ${rankClass} flex-shrink-0">#${topN}</div>
          <div class="flex-1 min-w-0">
            <h3 class="font-bold text-base">${_escHtml(hamburguesa.nombre)}</h3>
            ${local ? `<p class="text-xs text-gray-400 mt-0.5">📍 ${_escHtml(local.nombre)}</p>` : ''}
            ${hamburguesa.descripcion
              ? `<p class="text-xs text-gray-500 mt-1">${_escHtml(hamburguesa.descripcion)}</p>`
              : ''
            }
            ${tags.length
              ? `<div class="flex flex-wrap gap-1 mt-2">
                  ${tags.map((t) => `<span class="tag text-xs py-0.5">${_escHtml(t.trim())}</span>`).join('')}
                 </div>`
              : ''
            }
            ${degustacion.comentario
              ? `<p class="text-xs text-gray-400 mt-2 italic">"${_escHtml(degustacion.comentario)}"</p>`
              : ''
            }
          </div>
        </div>
      </div>
    `;
  }

  function _renderSkeleton() {
    return Array.from({ length: 3 }, () => `
      <div class="card mb-3 overflow-hidden">
        <div class="skeleton h-[140px]"></div>
        <div class="p-4 space-y-3">
          <div class="flex gap-3">
            <div class="skeleton w-9 h-9 rounded-full flex-shrink-0"></div>
            <div class="flex-1 space-y-2">
              <div class="skeleton h-4 w-3/4 rounded"></div>
              <div class="skeleton h-3 w-1/2 rounded"></div>
            </div>
          </div>
          <div class="skeleton h-16 rounded-lg"></div>
        </div>
      </div>
    `).join('');
  }

  // ── Tags disponibles ──────────────────────────────────────────────────

  function _extractAllTags(hamburguesas, degustaciones) {
    const tagSet = new Set();
    const degIds = new Set(degustaciones.map((d) => d.hamburguesa_id));
    hamburguesas
      .filter((h) => degIds.has(h.id))
      .forEach((h) => {
        if (h.tags) h.tags.split(',').forEach((t) => t.trim() && tagSet.add(t.trim()));
      });
    return [...tagSet].sort();
  }

  // ── Drag & Drop (reordenamiento manual) ──────────────────────────────

  function _initDragDrop(container) {
    container.querySelectorAll('[draggable]').forEach((card) => {
      card.addEventListener('dragstart', _onDragStart);
      card.addEventListener('dragover',  _onDragOver);
      card.addEventListener('drop',      _onDrop);
      card.addEventListener('dragend',   _onDragEnd);
    });
  }

  function _onDragStart(e) {
    _dragSrcIndex = parseInt(this.dataset.index, 10);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  function _onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    this.classList.add('drag-over');
  }

  async function _onDrop(e) {
    e.preventDefault();
    const destIndex = parseInt(this.dataset.index, 10);
    if (_dragSrcIndex === null || _dragSrcIndex === destIndex) return;

    // Reordenar el array de locales rankeados
    const moved = _localesRanked.splice(_dragSrcIndex, 1)[0];
    _localesRanked.splice(destIndex, 0, moved);

    // Guardar nuevo orden en Sheets (solo para locales con mismo top_n)
    const orders = _localesRanked.map((item, i) => ({
      local_id: item.local.id,
      posicion_manual: i + 1,
    }));

    Home.render(AppState.data); // re-render inmediato (optimistic)

    try {
      await AppState.db.saveTopOrder(AppState.user.email, orders);
    } catch (err) {
      App.showToast('No se pudo guardar el orden', 'error');
    }
  }

  function _onDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    _dragSrcIndex = null;
  }

  // ── Escape HTML básico ────────────────────────────────────────────────

  function _escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── API pública ───────────────────────────────────────────────────────

  return {
    /**
     * Renderiza la vista home completa.
     * @param {Object} data - { locales, hamburguesas, degustaciones, topOrder }
     * @param {boolean} loading - mostrar skeletons
     */
    render(data, loading = false) {
      const container = document.getElementById('view-home');
      if (!container) return;

      if (loading) {
        container.innerHTML = `
          <div class="px-4 pt-4">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-xl font-bold">Mi Ranking</h2>
            </div>
            ${_renderSkeleton()}
          </div>
        `;
        return;
      }

      _localesRanked = _calcLocalesRanking(data);
      const hamburguesasRanked = _calcHamburguesasRanking(data);
      const allTags = _extractAllTags(data.hamburguesas, data.degustaciones);

      // Tags filter bar
      const tagsBar = allTags.length && _currentView === 'hamburguesas' ? `
        <div class="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4">
          <button class="tag flex-shrink-0 ${!_activeTagFilter ? 'active' : ''}"
                  onclick="Home.filterByTag(null)">Todos</button>
          ${allTags.map((t) =>
            `<button class="tag flex-shrink-0 ${_activeTagFilter === t ? 'active' : ''}"
                     onclick="Home.filterByTag('${_escHtml(t)}')">${_escHtml(t)}</button>`
          ).join('')}
        </div>
      ` : '';

      // Lista de items según vista activa
      let listHtml;
      if (_currentView === 'locales') {
        if (_localesRanked.length === 0) {
          listHtml = `
            <div class="empty-state">
              <div class="emoji">🍔</div>
              <h3>Sin rankings todavía</h3>
              <p>Importá una hamburguesería y cargá tu primera degustación.</p>
              <button class="btn-primary mt-4" onclick="App.navigate('#add-local')">
                + Importar local
              </button>
            </div>
          `;
        } else {
          listHtml = _localesRanked.map((item, i) => _renderLocalCard(item, i)).join('');
        }
      } else {
        // Vista hamburguesas con filtro de tags
        let filtered = hamburguesasRanked;
        if (_activeTagFilter) {
          filtered = hamburguesasRanked.filter((item) => {
            const tags = item.hamburguesa?.tags?.split(',').map((t) => t.trim()) || [];
            return tags.includes(_activeTagFilter);
          });
        }
        if (filtered.length === 0) {
          listHtml = `
            <div class="empty-state">
              <div class="emoji">🔍</div>
              <h3>Sin hamburguesas${_activeTagFilter ? ` con tag "${_activeTagFilter}"` : ''}</h3>
              <p>Probá otro filtro o cargá una degustación.</p>
            </div>
          `;
        } else {
          listHtml = filtered.map((item, i) => _renderHamburguesaCard(item, i)).join('');
        }
      }

      container.innerHTML = `
        <div class="px-4 pt-4 view-enter">
          <!-- Header de la vista -->
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold">Mi Ranking</h2>
            <button class="btn-secondary text-xs py-1.5 px-3" onclick="Home.shareTop5()">
              🔗 Compartir Top 5
            </button>
          </div>

          <!-- Toggle de vistas -->
          <div class="toggle-group mb-4 w-full">
            <button class="toggle-btn flex-1 ${_currentView === 'locales' ? 'active' : ''}"
                    onclick="Home.setView('locales')">
              Hamburgueserías
            </button>
            <button class="toggle-btn flex-1 ${_currentView === 'hamburguesas' ? 'active' : ''}"
                    onclick="Home.setView('hamburguesas')">
              Hamburguesas
            </button>
          </div>

          ${tagsBar}

          <!-- Lista principal -->
          <div id="home-list">
            ${listHtml}
          </div>

          <!-- Tip de drag & drop solo en vista locales -->
          ${_currentView === 'locales' && _localesRanked.length > 1 ? `
            <p class="text-center text-xs text-gray-500 mt-4 mb-6">
              Arrastrá las cards para reordenar hamburgueserías con el mismo Top N
            </p>
          ` : '<div class="h-4"></div>'}
        </div>
      `;

      // Activar drag & drop en vista de locales
      if (_currentView === 'locales' && _localesRanked.length > 1) {
        const list = document.getElementById('home-list');
        if (list) _initDragDrop(list);
      }
    },

    /** Cambia entre vista de locales y hamburguesas. */
    setView(view) {
      _currentView = view;
      _activeTagFilter = null;
      this.render(AppState.data);
    },

    /** Aplica filtro por tag en vista hamburguesas. */
    filterByTag(tag) {
      _activeTagFilter = tag;
      this.render(AppState.data);
    },

    /** Abre el sheet de acciones para un local. */
    openLocalActions(localId) {
      const local = AppState.data.locales.find((l) => l.id === localId);
      if (!local) return;

      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-sheet">
          <div class="flex items-center gap-3 mb-6">
            <div class="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                 style="background:var(--color-surface2)">🍔</div>
            <div>
              <h3 class="font-bold">${_escHtml(local.nombre)}</h3>
              ${local.direccion ? `<p class="text-xs text-gray-400">${_escHtml(local.direccion)}</p>` : ''}
            </div>
          </div>
          <div class="space-y-2">
            <button class="btn-secondary w-full"
                    onclick="App.navigate('#add-degustacion?local=${localId}'); this.closest('.modal-overlay').remove()">
              🍔 Cargar degustación
            </button>
            ${local.maps_url ? `
              <a href="${local.maps_url}" target="_blank" rel="noopener"
                 class="btn-secondary w-full block text-center"
                 onclick="this.closest('.modal-overlay').remove()">
                📍 Ver en Google Maps
              </a>
            ` : ''}
            <button class="btn-ghost w-full mt-4"
                    onclick="this.closest('.modal-overlay').remove()">
              Cancelar
            </button>
          </div>
        </div>
      `;
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    },

    /**
     * Genera el link de compartir y abre Web Share API.
     * Los datos del top 5 van codificados en el hash de la URL (no toca servidor).
     */
    async shareTop5() {
      if (_localesRanked.length === 0) {
        App.showToast('Todavía no tenés items para compartir', 'info');
        return;
      }

      const top5 = _localesRanked.slice(0, 5).map((item) => ({
        n:  item.local.nombre,
        t:  item.bestTopN,
        b:  item.bestBurger?.nombre || '',
        c:  item.degustacion?.comentario || '',
      }));

      const shareData = {
        u: AppState.user.name,
        d: top5,
        ts: new Date().toLocaleDateString('es-AR'),
      };

      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(shareData))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const shareUrl = `${location.origin}${location.pathname.replace('index.html', '')}share.html#${encoded}`;

      if (navigator.share) {
        try {
          await navigator.share({
            title: `Mi Top 5 Burgers — ${AppState.user.name}`,
            text: `Mirá mi ranking personal de hamburguesas 🍔`,
            url: shareUrl,
          });
        } catch (err) {
          if (err.name !== 'AbortError') {
            _fallbackCopyLink(shareUrl);
          }
        }
      } else {
        _fallbackCopyLink(shareUrl);
      }
    },

    /** Carga el skeleton de carga. */
    renderLoading() {
      const container = document.getElementById('view-home');
      if (container) {
        container.innerHTML = `<div class="px-4 pt-4">${_renderSkeleton()}</div>`;
      }
    },
  };

  function _fallbackCopyLink(url) {
    navigator.clipboard.writeText(url).then(() => {
      App.showToast('Link copiado al portapapeles 📋', 'success');
    }).catch(() => {
      // Fallback manual si clipboard API falla
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      App.showToast('Link copiado al portapapeles 📋', 'success');
    });
  }
})();
