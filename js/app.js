/**
 * BurgerRank — Entry Point & Router SPA
 *
 * Responsabilidades:
 * - Registrar el Service Worker
 * - Orquestar el flujo de auth → datos → UI
 * - Router hash-based simple
 * - Estado global AppState
 * - Utilidades compartidas (toast, navegación)
 *
 * No usamos ningún framework de router ni gestión de estado.
 * El estado vive en el objeto AppState; las vistas son funciones que
 * mutamos el DOM directamente. Simple y predecible.
 */

// ── Estado global ──────────────────────────────────────────────────────────
const AppState = {
  user:  null,     // { email, name, picture, hash } — seteado por Auth
  db:    null,     // instancia de SheetsDB
  data: {          // caché de datos del spreadsheet
    locales:       [],
    hamburguesas:  [],
    degustaciones: [],
    topOrder:      [],
  },
  isLoading: false,
  isOnline:  navigator.onLine,
};

// ── App (namespace principal) ──────────────────────────────────────────────
const App = (() => {

  // Todas las vistas registradas { hash: { show, hide } }
  const _views = {};
  let _currentView = null;

  // ── Service Worker ─────────────────────────────────────────────────────

  function _registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('[SW] Registrado:', reg.scope);

      // Notificar si hay nueva versión disponible
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW?.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            App.showToast('Nueva versión disponible. Recargá para actualizar.', 'info', 8000);
          }
        });
      });
    }).catch((err) => console.warn('[SW] Error al registrar:', err));
  }

  // ── Offline detection ──────────────────────────────────────────────────

  function _initOfflineDetection() {
    const updateStatus = () => {
      AppState.isOnline = navigator.onLine;
      document.body.classList.toggle('offline', !navigator.onLine);
      if (!navigator.onLine) {
        App.showToast('Sin conexión — mostrando datos en caché', 'info');
      }
    };
    window.addEventListener('online',  updateStatus);
    window.addEventListener('offline', updateStatus);
  }

  // ── Auth flow ──────────────────────────────────────────────────────────

  function _initAuth() {
    _showScreen('loading');

    Auth.init({
      onLoginSuccess: async (user) => {
        AppState.user = user;

        // ── Resolución del spreadsheet personal ──────────────────────────
        //
        // Prioridad:
        //   1. ID en localStorage (mismo dispositivo, camino rápido)
        //   2. Búsqueda en Google Drive (nuevo dispositivo, ya existe en Drive)
        //   3. Creación de uno nuevo (primer login real, nunca usó la app)
        //
        // Luego de obtener el ID, siempre se valida la estructura:
        //   - Si faltan hojas → se crean con sus headers
        //   - Si faltan headers → se agregan
        //   - Los datos existentes NO se tocan
        //
        const storageKey  = `burgerrank_sheet_${user.hash}`;
        let spreadsheetId = localStorage.getItem(storageKey);

        // Indicador de estado durante la resolución (el usuario ve el spinner de loading)
        const setStatus = (msg) => {
          const el = document.getElementById('loading-status');
          if (el) el.textContent = msg;
        };

        if (!spreadsheetId) {
          // No hay ID local → buscar en Drive antes de crear
          try {
            setStatus('Buscando tu spreadsheet en Drive…');
            spreadsheetId = await SheetsDB.findExistingSpreadsheet(Auth.getAccessToken());

            if (spreadsheetId) {
              // ✅ Encontrado en Drive → guardar en localStorage y validar estructura
              setStatus('Spreadsheet encontrado. Verificando estructura…');
              await SheetsDB.validateAndRepairSpreadsheet(spreadsheetId, Auth.getAccessToken());
              localStorage.setItem(storageKey, spreadsheetId);
              App.showToast('¡Datos recuperados de Drive! 🎉', 'success');
            } else {
              // 🆕 Búsqueda exitosa pero sin resultados → usuario nuevo → crear spreadsheet
              setStatus('Creando tu spreadsheet personal en Drive…');
              spreadsheetId = await SheetsDB.createPersonalSpreadsheet(
                Auth.getAccessToken(),
                user.name,
              );
              localStorage.setItem(storageKey, spreadsheetId);
              App.showToast('¡Tu spreadsheet personal fue creado! 🎉', 'success');
            }
          } catch (err) {
            console.error('Error al resolver spreadsheet:', err);

            if (err.message.startsWith('drive_search_error:')) {
              // La búsqueda en Drive falló (ej: scope no concedido).
              // NO creamos un nuevo spreadsheet vacío — mostramos error claro.
              const code = err.message.split(':')[1];
              const hint = code === '403'
                ? 'Permiso de Google Drive denegado. Cerrá sesión, volvé a ingresar y aceptá todos los permisos solicitados.'
                : `Error al buscar tu spreadsheet en Drive (código ${code}). Intentá de nuevo.`;
              App.showToast(hint, 'error', 8000);
              _showScreen('login');
              return;
            }

            // Cualquier otro error (Sheets API, red, etc.)
            App.showToast('Error con tu spreadsheet: ' + err.message, 'error');
            _showScreen('login');
            return;
          }
        } else {
          // ID en localStorage → validar estructura silenciosamente en background
          // No bloqueamos el arranque por esto; si falla, la app igual carga
          SheetsDB.validateAndRepairSpreadsheet(spreadsheetId, Auth.getAccessToken())
            .catch((err) => console.warn('[Sheet repair silencioso]', err));
        }

        AppState.db = new SheetsDB(spreadsheetId, () => Auth.getAccessToken());

        _updateHeader(user);
        _showScreen('app');

        await _loadData();
        App.navigate(location.hash || '#home');
      },

      onLoginRestricted: (user) => {
        document.getElementById('restricted-email').textContent = user.email;
        _showScreen('restricted');
      },

      onLogout: () => {
        AppState.user = null;
        AppState.db   = null;
        AppState.data = { locales: [], hamburguesas: [], degustaciones: [], topOrder: [] };
        _showScreen('login');
      },

      // Sin sesión guardada en sessionStorage → ir directo al login sin loading infinito
      onNoSession: () => {
        _showScreen('login');
      },
    });
  }

  // ── Carga de datos ─────────────────────────────────────────────────────

  async function _loadData(showLoading = true) {
    if (!AppState.db || !AppState.user) return;

    if (showLoading) Home.renderLoading();
    AppState.isLoading = true;

    try {
      const data = await AppState.db.loadAllData(AppState.user.email);
      AppState.data = data;
    } catch (err) {
      console.error('Error cargando datos:', err);
      if (!AppState.isOnline) {
        App.showToast('Offline — mostrando datos en caché', 'info');
      } else {
        App.showToast('Error al cargar datos: ' + err.message, 'error');
      }
    } finally {
      AppState.isLoading = false;
    }
  }

  // ── Screens (auth flow) ────────────────────────────────────────────────

  const _screens = ['loading', 'login', 'restricted', 'app'];

  function _showScreen(name) {
    _screens.forEach((s) => {
      const el = document.getElementById(`screen-${s}`);
      if (el) el.classList.toggle('hidden', s !== name);
    });
  }

  function _updateHeader(user) {
    const nameEl = document.getElementById('header-user-name');
    const avatarEl = document.getElementById('header-avatar');
    if (nameEl)   nameEl.textContent = user.name.split(' ')[0]; // solo primer nombre
    if (avatarEl) {
      if (user.picture) {
        avatarEl.innerHTML = `<img src="${user.picture}" alt="${user.name}" class="w-8 h-8 rounded-full">`;
      } else {
        avatarEl.textContent = user.name.charAt(0).toUpperCase();
      }
    }
  }

  // ── Router hash-based ──────────────────────────────────────────────────

  function _route() {
    // Parsear hash y query string dentro del hash
    // Ej: #add-degustacion?local=abc123
    const full = location.hash || '#home';
    const [hashPath, queryString] = full.split('?');
    const params = {};
    if (queryString) {
      queryString.split('&').forEach((pair) => {
        const [k, v] = pair.split('=');
        params[k] = decodeURIComponent(v || '');
      });
    }

    const routeKey = hashPath; // ej: '#home'

    // Ocultar vista anterior
    if (_currentView && _views[_currentView]) {
      const prevSection = document.getElementById(_views[_currentView].sectionId);
      if (prevSection) prevSection.classList.add('hidden');
    }

    // Mostrar nueva vista
    if (_views[routeKey]) {
      const { sectionId, onEnter } = _views[routeKey];
      const section = document.getElementById(sectionId);
      if (section) section.classList.remove('hidden');
      _currentView = routeKey;

      // Actualizar nav activo
      document.querySelectorAll('.nav-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.route === routeKey);
      });

      onEnter?.(params);
    } else {
      // Ruta no encontrada → ir a home
      location.hash = '#home';
    }
  }

  // ── API pública ────────────────────────────────────────────────────────

  return {
    /**
     * Inicializa toda la aplicación.
     * Llamar desde <script> al final del body, cuando GSI está cargado.
     */
    init() {
      _registerSW();
      _initOfflineDetection();

      // Registrar vistas
      this.registerView('#home', 'view-home', (params) => {
        Home.render(AppState.data);
      });

      this.registerView('#add-local', 'view-add-local', (params) => {
        AddLocal.init();
      });

      this.registerView('#add-degustacion', 'view-add-degustacion', (params) => {
        Degustacion.init(params.local || null);
      });

      this.registerView('#profile', 'view-profile', (params) => {
        Profile.render();
      });

      // Iniciar flujo de auth (puede mostrar pantalla de login o cargar directo)
      _initAuth();

      // Escuchar cambios de ruta
      window.addEventListener('hashchange', _route);
    },

    /**
     * Registra una vista en el router.
     * @param {string} hash - ej: '#home'
     * @param {string} sectionId - ID del elemento DOM
     * @param {Function} onEnter - callback al entrar a la vista
     */
    registerView(hash, sectionId, onEnter) {
      _views[hash] = { sectionId, onEnter };
    },

    /**
     * Navega a una ruta (modifica el hash).
     * @param {string} route - ej: '#add-degustacion?local=abc'
     */
    navigate(route) {
      location.hash = route;
    },

    /**
     * Recarga los datos del spreadsheet y re-renderiza la vista actual.
     */
    async refresh() {
      await _loadData();
      _route(); // re-renderiza vista actual con datos frescos
    },

    /**
     * Muestra una notificación toast.
     * @param {string} message
     * @param {'success'|'error'|'info'} type
     * @param {number} duration - ms (default 3000)
     */
    showToast(message, type = 'info', duration = 3000) {
      const container = document.getElementById('toast-container');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.textContent = message;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'opacity 0.3s, transform 0.3s';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },

    /** Cierra sesión. */
    signOut() {
      Auth.signOut();
    },

    /** Getter del usuario actual. */
    get user() { return AppState.user; },
  };
})();

// ── Módulo Profile (inline, simple) ───────────────────────────────────────
const Profile = (() => {
  return {
    render() {
      const container = document.getElementById('view-profile');
      if (!container || !AppState.user) return;

      const user = AppState.user;
      const degCount = AppState.data.degustaciones.length;
      const localCount = new Set(AppState.data.degustaciones.map((d) => d.local_id)).size;

      container.innerHTML = `
        <div class="px-4 pt-4 view-enter">
          <h2 class="text-xl font-bold mb-6">Mi perfil</h2>

          <!-- Avatar + nombre -->
          <div class="card p-4 flex items-center gap-4 mb-4">
            <div class="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center
                        text-2xl font-bold flex-shrink-0"
                 style="background:var(--color-primary)">
              ${user.picture
                ? `<img src="${user.picture}" alt="${user.name}" class="w-full h-full object-cover">`
                : user.name.charAt(0).toUpperCase()
              }
            </div>
            <div>
              <p class="font-bold text-lg">${user.name}</p>
              <p class="text-sm text-gray-400">${user.email}</p>
            </div>
          </div>

          <!-- Stats -->
          <div class="grid grid-cols-2 gap-3 mb-4">
            <div class="card p-4 text-center">
              <p class="text-3xl font-bold text-[#D2A679]">${degCount}</p>
              <p class="text-xs text-gray-400 mt-1">Degustaciones</p>
            </div>
            <div class="card p-4 text-center">
              <p class="text-3xl font-bold text-[#D2A679]">${localCount}</p>
              <p class="text-xs text-gray-400 mt-1">Locales visitados</p>
            </div>
          </div>

          <!-- Acciones -->
          <div class="space-y-2 mt-6">
            <button class="btn-secondary w-full" onclick="App.refresh()">
              🔄 Sincronizar datos
            </button>
            <button class="btn-secondary w-full" onclick="Home.shareTop5(); App.navigate('#home')">
              🔗 Compartir mi Top 5
            </button>
            <button class="btn-ghost w-full mt-4 text-[#E32636]"
                    onclick="if(confirm('¿Cerrar sesión?')) App.signOut()">
              Cerrar sesión
            </button>
          </div>

          <p class="text-center text-xs text-gray-600 mt-8">
            BurgerRank v1.0 · Datos almacenados en Google Sheets
          </p>
        </div>
      `;
    },
  };
})();

// ── Módulo Add Local (inline) ─────────────────────────────────────────────
const AddLocal = (() => {
  let _preview  = null;   // datos del local listo para guardar { nombre, direccion, maps_url, maps_place_id, foto_url }
  let _results  = [];     // lugares devueltos por searchByText
  let _debounce = null;

  function _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _isUrl(text) {
    return /^https?:\/\//i.test(text) ||
           text.includes('maps.google') ||
           text.includes('goo.gl');
  }

  // Convierte un objeto place de Places API v1 al formato interno
  function _placeToData(place) {
    const photoName = place.photos?.[0]?.name;
    return {
      nombre:        place.displayName?.text || '',
      direccion:     place.formattedAddress || '',
      maps_url:      `https://www.google.com/maps/place/?q=place_id:${place.id}`,
      maps_place_id: place.id || '',
      foto_url:      photoName ? Maps.getPhotoUrl(photoName, 600) : '',
    };
  }

  return {
    init() {
      _preview  = null;
      _results  = [];
      _debounce = null;
      this.render();
    },

    render() {
      const c = document.getElementById('view-add-local');
      if (!c) return;
      c.innerHTML = `
        <div class="px-4 pt-4 pb-8 view-enter">
          <h2 class="text-xl font-bold mb-1">Importar local</h2>
          <p class="text-sm text-gray-400 mb-4">
            Pegá un link de Google Maps o escribí el nombre del local.
          </p>
          <input id="local-input" type="text" autocomplete="off"
                 placeholder="Nombre o URL de Google Maps…"
                 class="input"
                 oninput="AddLocal.onInput(this.value)">
          <div id="local-suggestions" class="mt-2"></div>
          <div id="local-preview" class="mt-4"></div>
          <div class="mt-6 pt-4 border-t border-[#5c3d25]">
            <button class="btn-ghost w-full text-sm" onclick="AddLocal.showManualForm()">
              ✏️ Ingresar datos manualmente
            </button>
          </div>
        </div>
      `;
    },

    onInput(value) {
      const text = value.trim();
      clearTimeout(_debounce);
      _preview = null;
      _results = [];
      document.getElementById('local-suggestions').innerHTML = '';
      document.getElementById('local-preview').innerHTML = '';

      if (!text) return;

      if (_isUrl(text)) {
        this._handleUrl(text);
      } else if (text.length >= 3) {
        document.getElementById('local-suggestions').innerHTML =
          '<p class="text-xs text-gray-500 px-1 mt-2">Buscando…</p>';
        _debounce = setTimeout(() => this._searchText(text), 450);
      }
    },

    async _handleUrl(rawUrl) {
      const sugg = document.getElementById('local-suggestions');

      if (Maps.isShortUrl(rawUrl)) {
        // URL corta → no se puede resolver client-side → pedir nombre manual
        _preview = { nombre: '', direccion: '', maps_url: rawUrl, maps_place_id: '', foto_url: '' };
        this._renderPreview(true);
        return;
      }

      const result = Maps.parse(rawUrl);
      if (!result.isValid) {
        sugg.innerHTML = '<p class="text-xs text-[#E32636] px-1 mt-2">URL inválida — asegurate que sea de Google Maps</p>';
        return;
      }

      if (result.placeId) {
        sugg.innerHTML = '<p class="text-xs text-gray-500 px-1 mt-2">Obteniendo datos del local…</p>';
        try {
          const place = await Maps.fetchPlaceDetails(result.placeId);
          sugg.innerHTML = '';
          _preview = _placeToData(place);
          this._renderPreview();
        } catch {
          // Places API falló → usar lo que pudo extraer la URL
          sugg.innerHTML = '';
          _preview = {
            nombre:        Maps.formatName(result.name) || '',
            direccion:     result.address || '',
            maps_url:      result.mapsUrl || rawUrl,
            maps_place_id: result.placeId || '',
            foto_url:      '',
          };
          this._renderPreview();
        }
      } else {
        sugg.innerHTML = '';
        _preview = {
          nombre:        Maps.formatName(result.name) || '',
          direccion:     result.address || '',
          maps_url:      result.mapsUrl || rawUrl,
          maps_place_id: '',
          foto_url:      '',
        };
        this._renderPreview(!result.name); // pedir nombre si no se pudo extraer
      }
    },

    async _searchText(query) {
      const sugg = document.getElementById('local-suggestions');
      try {
        const places = await Maps.searchByText(query, 5);
        _results = places;
        if (!places.length) {
          sugg.innerHTML = `<p class="text-xs text-gray-500 px-1 mt-2">Sin resultados para "${_esc(query)}"</p>`;
          return;
        }
        sugg.innerHTML = `
          <div class="space-y-2 mt-2">
            ${places.map((p, i) => {
              const photo = p.photos?.[0]?.name;
              const photoUrl = photo ? Maps.getPhotoUrl(photo, 80) : null;
              return `
                <button class="w-full text-left card p-3 flex items-center gap-3
                               hover:border-[#D2A679] active:scale-[.99] transition-all"
                        onclick="AddLocal.selectResult(${i})">
                  ${photoUrl
                    ? `<img src="${_esc(photoUrl)}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                            onerror="this.replaceWith(document.createTextNode('🍔'))">`
                    : '<div class="w-12 h-12 rounded-lg bg-[#261509] flex items-center justify-center text-xl flex-shrink-0">🍔</div>'
                  }
                  <div class="min-w-0">
                    <p class="font-semibold text-sm truncate">${_esc(p.displayName?.text || '')}</p>
                    <p class="text-xs text-gray-400 truncate">${_esc(p.formattedAddress || '')}</p>
                    ${p.rating ? `<p class="text-xs text-[#FFD700] mt-0.5">★ ${p.rating}</p>` : ''}
                  </div>
                </button>
              `;
            }).join('')}
          </div>
        `;
      } catch (err) {
        sugg.innerHTML = `<p class="text-xs text-[#E32636] px-1 mt-2">Error al buscar: ${_esc(err.message)}</p>`;
      }
    },

    selectResult(index) {
      const place = _results[index];
      if (!place) return;
      document.getElementById('local-suggestions').innerHTML = '';
      _preview = _placeToData(place);
      this._renderPreview();
    },

    // Renderiza la tarjeta de previsualización con los campos editables
    // shortUrl=true → solo mostrar campo nombre (URL corta, sin datos extra)
    _renderPreview(shortUrl = false) {
      const p = _preview;
      document.getElementById('local-preview').innerHTML = `
        <div class="card overflow-hidden">
          ${p.foto_url
            ? `<img src="${_esc(p.foto_url)}" alt="${_esc(p.nombre)}"
                    class="w-full h-44 object-cover"
                    onerror="this.style.display='none'">`
            : '<div class="w-full h-32 bg-[#261509] flex items-center justify-center text-5xl">🍔</div>'
          }
          <div class="p-4 space-y-3">
            ${shortUrl ? '<p class="text-xs text-[#D2A679]">📎 Link guardado. Completá el nombre:</p>' : ''}
            <div>
              <label class="text-xs text-gray-400">Nombre *</label>
              <input type="text" id="preview-nombre" value="${_esc(p.nombre)}"
                     placeholder="Nombre del local" class="input mt-1" maxlength="100">
            </div>
            ${!shortUrl ? `
            <div>
              <label class="text-xs text-gray-400">Dirección</label>
              <input type="text" id="preview-direccion" value="${_esc(p.direccion)}"
                     placeholder="Dirección" class="input mt-1" maxlength="200">
            </div>` : ''}
            <button class="btn-primary w-full" onclick="AddLocal.savePreview()">
              💾 Guardar local
            </button>
          </div>
        </div>
      `;
    },

    async savePreview() {
      if (!_preview) return;
      const nombre    = document.getElementById('preview-nombre')?.value.trim();
      const direccion = document.getElementById('preview-direccion')?.value.trim() || _preview.direccion || '';
      if (!nombre) { App.showToast('El nombre es requerido', 'error'); return; }
      await this._doSave({ ..._preview, nombre, direccion });
    },

    showManualForm() {
      _preview = null;
      _results = [];
      document.getElementById('local-suggestions').innerHTML = '';
      document.getElementById('local-preview').innerHTML = `
        <div class="card p-4 space-y-3">
          <input type="text" id="manual-nombre" placeholder="Nombre del local *" class="input" maxlength="100">
          <input type="text" id="manual-direccion" placeholder="Dirección (opcional)" class="input" maxlength="200">
          <input type="url" id="manual-maps-url" placeholder="URL de Google Maps (opcional)" class="input">
          <button class="btn-primary w-full" onclick="AddLocal.saveManual()">
            💾 Guardar local
          </button>
        </div>
      `;
    },

    async saveManual() {
      const nombre    = document.getElementById('manual-nombre')?.value.trim();
      const direccion = document.getElementById('manual-direccion')?.value.trim() || '';
      const mapsUrl   = document.getElementById('manual-maps-url')?.value.trim() || '';
      if (!nombre) { App.showToast('El nombre es requerido', 'error'); return; }
      await this._doSave({ nombre, direccion, maps_url: mapsUrl, maps_place_id: '', foto_url: '' });
    },

    async _doSave(localData) {
      const btn = document.querySelector('#local-preview .btn-primary');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
      try {
        const saved = await AppState.db.addLocal(localData);
        AppState.data.locales.push(saved);
        App.showToast(`✅ "${saved.nombre}" importado`, 'success');
        App.navigate('#home');
        App.refresh();
      } catch (err) {
        App.showToast('Error al guardar: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar local'; }
      }
    },
  };
})();

// ── Bootstrap ─────────────────────────────────────────────────────────────
// La librería GSI llama a esta función cuando está lista
function onGoogleLibraryLoad() {
  App.init();
}

// Fallback si GSI ya cargó antes (poco probable pero posible)
if (typeof google !== 'undefined' && google.accounts) {
  App.init();
}
