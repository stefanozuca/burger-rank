/**
 * BurgerRank — Módulo de Carga de Degustación
 *
 * Formulario multi-step para registrar una degustación:
 * Step 1: Seleccionar local (búsqueda en lista)
 * Step 2: Seleccionar o crear hamburguesa del local
 * Step 3: Asignar Top N + comentario + tags
 * Step 4: Confirmar y guardar
 *
 * Lógica de Top N:
 * - El usuario asigna un número entero (1 = mejor de su vida)
 * - Si el número ya está ocupado, pregunta si desplazar o reemplazar
 * - El top_n no es una posición fija del 1 al N; puede haber saltos (1, 3, 7)
 */

const Degustacion = (() => {
  // Estado del formulario multi-step
  let _state = {
    step: 1,
    local: null,
    hamburguesa: null,
    isNewHamburguesa: false,
    newHamburguesaData: null,
    topN: null,
    comentario: '',
    tags: [],
    preselectedLocalId: null,
  };

  const AVAILABLE_TAGS = [
    'doble carne', 'smash', 'veggie', 'pollo', 'crispy', 'con cheddar',
    'trufa', 'bbq', 'picante', 'clásica', 'premium', 'artesanal',
  ];

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _resetState(preselectedLocalId = null) {
    _state = {
      step: 1,
      local: null,
      hamburguesa: null,
      isNewHamburguesa: false,
      newHamburguesaData: null,
      topN: null,
      comentario: '',
      tags: [],
      preselectedLocalId,
    };
  }

  function _getOccupiedTopNs() {
    return new Set(
      (AppState.data.degustaciones || []).map((d) => parseInt(d.top_n, 10)).filter((n) => !isNaN(n))
    );
  }

  // ── Renderizado de steps ─────────────────────────────────────────────────

  function _renderStepIndicator() {
    return `
      <div class="steps mb-6">
        ${[1,2,3].map((s) => `
          <div class="step-dot ${s < _state.step ? 'done' : s === _state.step ? 'current' : ''}"></div>
        `).join('')}
      </div>
    `;
  }

  function _renderStep1() {
    const locales = AppState.data.locales || [];

    return `
      <div class="view-enter">
        ${_renderStepIndicator()}
        <h3 class="text-lg font-bold mb-1">¿En qué local?</h3>
        <p class="text-sm text-gray-400 mb-4">Elegí la hamburguesería que visitaste.</p>

        <!-- Búsqueda -->
        <div class="relative mb-4">
          <input type="search" id="local-search" placeholder="Buscar local..."
                 class="input pl-10"
                 oninput="Degustacion.filterLocales(this.value)"
                 autocomplete="off">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        </div>

        <!-- Lista de locales -->
        <div id="locales-list" class="space-y-2 max-h-[50vh] overflow-y-auto">
          ${locales.length === 0
            ? `<div class="empty-state">
                 <div class="emoji">📍</div>
                 <h3>Sin locales importados</h3>
                 <p>Primero importá una hamburguesería.</p>
                 <button class="btn-primary mt-4" onclick="App.navigate('#add-local')">
                   + Importar local
                 </button>
               </div>`
            : locales.map((l) => _renderLocalOption(l)).join('')
          }
        </div>

        <div class="mt-4 pt-4 border-t border-[#5c3d25]">
          <button class="btn-secondary w-full" onclick="App.navigate('#add-local')">
            + Importar nuevo local
          </button>
        </div>
      </div>
    `;
  }

  function _renderLocalOption(local) {
    return `
      <button class="card card-interactive w-full text-left p-3 flex items-center gap-3"
              data-local-id="${local.id}"
              onclick="Degustacion.selectLocal('${local.id}')">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
             style="background:var(--color-surface2)">
          ${local.foto_url
            ? `<img src="${local.foto_url}" class="w-full h-full object-cover rounded-lg" onerror="this.outerHTML='🍔'">`
            : '🍔'
          }
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-sm truncate">${_escHtml(local.nombre)}</p>
          ${local.direccion
            ? `<p class="text-xs text-gray-400 truncate">${_escHtml(local.direccion)}</p>`
            : ''
          }
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             class="w-4 h-4 text-gray-500 flex-shrink-0">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </button>
    `;
  }

  function _renderStep2() {
    const hamburguesas = (AppState.data.hamburguesas || []).filter(
      (h) => h.local_id === _state.local.id
    );

    return `
      <div class="view-enter">
        ${_renderStepIndicator()}
        <div class="flex items-center gap-2 mb-4">
          <button class="btn-ghost -ml-2" onclick="Degustacion.goToStep(1)" aria-label="Volver">
            ←
          </button>
          <div>
            <h3 class="text-lg font-bold">¿Qué hamburguesa?</h3>
            <p class="text-xs text-gray-400">${_escHtml(_state.local.nombre)}</p>
          </div>
        </div>

        ${hamburguesas.length > 0 ? `
          <p class="text-sm text-gray-400 mb-3">Hamburguesas conocidas de este local:</p>
          <div class="space-y-2 mb-4">
            ${hamburguesas.map((h) => `
              <button class="card card-interactive w-full text-left p-3"
                      onclick="Degustacion.selectHamburguesa('${h.id}')">
                <p class="font-semibold text-sm">${_escHtml(h.nombre)}</p>
                ${h.descripcion ? `<p class="text-xs text-gray-400 mt-0.5">${_escHtml(h.descripcion)}</p>` : ''}
                ${h.tags ? `
                  <div class="flex flex-wrap gap-1 mt-1">
                    ${h.tags.split(',').filter(Boolean).map((t) =>
                      `<span class="tag text-xs py-0.5">${_escHtml(t.trim())}</span>`
                    ).join('')}
                  </div>
                ` : ''}
              </button>
            `).join('')}
          </div>
          <div class="border-t border-[#5c3d25] pt-4">
            <p class="text-sm text-gray-400 mb-3">¿No está en la lista? Agregala:</p>
        ` : `
          <p class="text-sm text-gray-400 mb-3">
            Todavía no hay hamburguesas cargadas para este local. Agregá la primera:
          </p>
        `}

        <!-- Formulario nueva hamburguesa -->
        <div class="space-y-3">
          <input type="text" id="new-burger-name" placeholder="Nombre de la hamburguesa *"
                 class="input" maxlength="80">
          <input type="text" id="new-burger-desc" placeholder="Descripción (opcional)"
                 class="input" maxlength="200">
          <div>
            <p class="text-xs text-gray-400 mb-2">Tags:</p>
            <div class="flex flex-wrap gap-2" id="tag-selector">
              ${AVAILABLE_TAGS.map((t) => `
                <button class="tag" data-tag="${_escHtml(t)}"
                        onclick="Degustacion.toggleNewBurgerTag('${_escHtml(t)}', this)">
                  ${_escHtml(t)}
                </button>
              `).join('')}
            </div>
          </div>
          <button class="btn-primary w-full" onclick="Degustacion.confirmNewHamburguesa()">
            Usar esta hamburguesa →
          </button>
        </div>

        ${hamburguesas.length > 0 ? '</div>' : ''}
      </div>
    `;
  }

  function _renderStep3() {
    const occupiedTopNs = _getOccupiedTopNs();
    const burguerName = _state.isNewHamburguesa
      ? _state.newHamburguesaData.nombre
      : _state.hamburguesa.nombre;

    return `
      <div class="view-enter">
        ${_renderStepIndicator()}
        <div class="flex items-center gap-2 mb-4">
          <button class="btn-ghost -ml-2" onclick="Degustacion.goToStep(2)" aria-label="Volver">
            ←
          </button>
          <div>
            <h3 class="text-lg font-bold">Rankeá la experiencia</h3>
            <p class="text-xs text-gray-400">${_escHtml(burguerName)} — ${_escHtml(_state.local.nombre)}</p>
          </div>
        </div>

        <!-- Top N input -->
        <div class="text-center my-6">
          <label class="block text-sm text-gray-400 mb-2">
            ¿En qué posición de tu ranking personal va?
          </label>
          <input type="number" id="topn-input" min="1" max="999"
                 placeholder="ej: 3"
                 class="topn-input"
                 value="${_state.topN || ''}"
                 oninput="Degustacion.onTopNChange(this.value)">
          <p id="topn-warning" class="text-xs text-[#FFD700] mt-2 min-h-4"></p>
          <p class="text-xs text-gray-500 mt-1">
            1 = la mejor burger de tu vida 🏆
          </p>
        </div>

        <!-- Tags de la degustación (adicionales a los de la hamburguesa) -->
        <div class="mb-4">
          <label class="block text-sm font-medium mb-2">
            Tags adicionales de esta degustación:
          </label>
          <div class="flex flex-wrap gap-2" id="deg-tag-selector">
            ${AVAILABLE_TAGS.map((t) => `
              <button class="tag ${_state.tags.includes(t) ? 'active' : ''}"
                      data-tag="${_escHtml(t)}"
                      onclick="Degustacion.toggleDegTag('${_escHtml(t)}', this)">
                ${_escHtml(t)}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Comentario -->
        <div class="mb-6">
          <label class="block text-sm font-medium mb-2">Comentario:</label>
          <textarea id="comentario-input" placeholder="¿Qué te pareció? Patty, pan, cocción, precio..."
                    class="input" maxlength="500" rows="3"
                    oninput="Degustacion.onComentarioChange(this.value)">${_escHtml(_state.comentario)}</textarea>
          <p class="text-right text-xs text-gray-500 mt-1">
            <span id="char-count">${_state.comentario.length}</span>/500
          </p>
        </div>

        <!-- Botón guardar -->
        <button id="save-btn" class="btn-primary w-full" onclick="Degustacion.save()">
          Guardar degustación 🍔
        </button>
      </div>
    `;
  }

  // ── API pública ──────────────────────────────────────────────────────────

  return {
    /**
     * Inicializa el formulario.
     * @param {string|null} preselectedLocalId - si viene de "#add-degustacion?local=..."
     */
    init(preselectedLocalId = null) {
      _resetState(preselectedLocalId);

      if (preselectedLocalId) {
        const local = (AppState.data.locales || []).find((l) => l.id === preselectedLocalId);
        if (local) {
          _state.local = local;
          _state.step = 2;
        }
      }

      this.render();
    },

    /** Renderiza el step actual en el contenedor. */
    render() {
      const container = document.getElementById('view-add-degustacion');
      if (!container) return;

      let content;
      switch (_state.step) {
        case 1: content = _renderStep1(); break;
        case 2: content = _renderStep2(); break;
        case 3: content = _renderStep3(); break;
        default: content = _renderStep1();
      }

      container.innerHTML = `
        <div class="px-4 pt-4 pb-8">
          <h2 class="text-xl font-bold mb-6">Nueva degustación</h2>
          ${content}
        </div>
      `;
    },

    /** Navega a un step específico. */
    goToStep(step) {
      _state.step = step;
      this.render();
    },

    // ── Step 1 ────────────────────────────────────────────────────────────

    /** Filtra locales por búsqueda de texto. */
    filterLocales(query) {
      const q = query.toLowerCase();
      const container = document.getElementById('locales-list');
      if (!container) return;

      const locales = (AppState.data.locales || []).filter((l) =>
        !q || l.nombre.toLowerCase().includes(q) || (l.direccion || '').toLowerCase().includes(q)
      );

      container.innerHTML = locales.length
        ? locales.map((l) => _renderLocalOption(l)).join('')
        : `<p class="text-center text-gray-500 py-8">Sin resultados para "${_escHtml(query)}"</p>`;
    },

    /** Selecciona un local y avanza al step 2. */
    selectLocal(localId) {
      _state.local = (AppState.data.locales || []).find((l) => l.id === localId);
      if (!_state.local) return;
      _state.step = 2;
      this.render();
    },

    // ── Step 2 ────────────────────────────────────────────────────────────

    /** Selecciona una hamburguesa existente y avanza al step 3. */
    selectHamburguesa(hamburquesaId) {
      _state.hamburguesa = (AppState.data.hamburguesas || []).find((h) => h.id === hamburquesaId);
      _state.isNewHamburguesa = false;
      _state.step = 3;
      this.render();
    },

    /** Toggle tag para nueva hamburguesa. */
    toggleNewBurgerTag(tag, el) {
      el.classList.toggle('active');
    },

    /** Valida el formulario de nueva hamburguesa y avanza. */
    confirmNewHamburguesa() {
      const nombre = document.getElementById('new-burger-name')?.value.trim();
      if (!nombre) {
        App.showToast('El nombre de la hamburguesa es requerido', 'error');
        document.getElementById('new-burger-name')?.focus();
        return;
      }

      const desc = document.getElementById('new-burger-desc')?.value.trim() || '';
      const activeTags = [...document.querySelectorAll('#tag-selector .tag.active')]
        .map((el) => el.dataset.tag);

      _state.isNewHamburguesa = true;
      _state.newHamburguesaData = { nombre, descripcion: desc, tags: activeTags };
      _state.step = 3;
      this.render();
    },

    // ── Step 3 ────────────────────────────────────────────────────────────

    toggleDegTag(tag, el) {
      el.classList.toggle('active');
      if (_state.tags.includes(tag)) {
        _state.tags = _state.tags.filter((t) => t !== tag);
      } else {
        _state.tags.push(tag);
      }
    },

    onTopNChange(value) {
      _state.topN = parseInt(value, 10);
      const warning = document.getElementById('topn-warning');
      if (!warning) return;

      if (!isNaN(_state.topN) && _getOccupiedTopNs().has(_state.topN)) {
        warning.textContent = `⚠️ El Top #${_state.topN} ya está ocupado. Al guardar, te preguntaremos qué hacer.`;
      } else {
        warning.textContent = '';
      }
    },

    onComentarioChange(value) {
      _state.comentario = value;
      const counter = document.getElementById('char-count');
      if (counter) counter.textContent = value.length;
    },

    /** Guarda la degustación (y la hamburguesa nueva si aplica). */
    async save() {
      // Validaciones
      if (!_state.topN || isNaN(_state.topN) || _state.topN < 1) {
        App.showToast('Asigná un Top N válido (número mayor a 0)', 'error');
        document.getElementById('topn-input')?.focus();
        return;
      }

      const saveBtn = document.getElementById('save-btn');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }

      try {
        // Verificar si el Top N ya está ocupado
        const occupiedTopNs = _getOccupiedTopNs();
        if (occupiedTopNs.has(_state.topN)) {
          const action = await _askTopNConflict(_state.topN);
          if (action === 'cancel') {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar degustación 🍔'; }
            return;
          }
          if (action === 'displace') {
            await _displaceTopN(_state.topN);
          }
          // Si 'replace' → simplemente se guarda con el mismo número (la vieja queda en el historial)
        }

        // 1. Guardar hamburguesa nueva si corresponde
        let hamburquesaId;
        if (_state.isNewHamburguesa) {
          const { nombre, descripcion, tags } = _state.newHamburguesaData;
          const newH = await AppState.db.addHamburguesa({
            local_id: _state.local.id,
            nombre,
            descripcion,
            tags,
          });
          hamburquesaId = newH.id;
          // Actualizar estado local
          AppState.data.hamburguesas.push(newH);
        } else {
          hamburquesaId = _state.hamburguesa.id;
        }

        // 2. Obtener tags de la degustación
        const degTags = [...document.querySelectorAll('#deg-tag-selector .tag.active')]
          .map((el) => el.dataset.tag);

        // 3. Guardar degustación
        const newDeg = await AppState.db.addDegustacion({
          user_email: AppState.user.email,
          hamburguesa_id: hamburquesaId,
          local_id: _state.local.id,
          top_n: _state.topN,
          comentario: _state.comentario,
        });

        // Actualizar estado local inmediatamente para que el home muestre los datos al instante
        AppState.data.degustaciones.push(newDeg);

        App.showToast('¡Degustación guardada! 🍔', 'success');
        App.navigate('#home');
        // Refresh en background para confirmar con los datos del Sheet
        App.refresh();

      } catch (err) {
        console.error('Error guardando degustación:', err);
        App.showToast('Error al guardar: ' + err.message, 'error');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar degustación 🍔'; }
      }
    },
  };

  // ── Helpers privados async ────────────────────────────────────────────────

  /**
   * Muestra un modal preguntando qué hacer con el conflicto de Top N.
   * @returns {Promise<'replace'|'displace'|'cancel'>}
   */
  function _askTopNConflict(topN) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-sheet">
          <h3 class="text-lg font-bold mb-2">Top #${topN} ya está ocupado</h3>
          <p class="text-sm text-gray-400 mb-6">
            Ya tenés una hamburguesa en el Top #${topN}. ¿Qué querés hacer?
          </p>
          <div class="space-y-2">
            <button class="btn-primary w-full" id="modal-displace">
              Desplazar — mover la actual al #${topN + 1} (y las siguientes)
            </button>
            <button class="btn-secondary w-full" id="modal-replace">
              Reemplazar — el nuevo #${topN} desplaza al anterior
            </button>
            <button class="btn-ghost w-full" id="modal-cancel">Cancelar</button>
          </div>
        </div>
      `;

      modal.querySelector('#modal-displace').addEventListener('click', () => {
        modal.remove(); resolve('displace');
      });
      modal.querySelector('#modal-replace').addEventListener('click', () => {
        modal.remove(); resolve('replace');
      });
      modal.querySelector('#modal-cancel').addEventListener('click', () => {
        modal.remove(); resolve('cancel');
      });

      document.body.appendChild(modal);
    });
  }

  /**
   * Desplaza todos los Top Ns >= topN sumándoles 1.
   * Actualiza tanto el estado local como el sheet.
   */
  async function _displaceTopN(fromTopN) {
    const toUpdate = AppState.data.degustaciones.filter(
      (d) => parseInt(d.top_n, 10) >= fromTopN
    );

    // Actualizar en Sheets (en serie para no saturar quota)
    for (const deg of toUpdate) {
      const newTopN = parseInt(deg.top_n, 10) + 1;
      await AppState.db.updateDegustacion(deg.id, { top_n: String(newTopN) });
      deg.top_n = String(newTopN); // actualizar estado local
    }
  }
})();
