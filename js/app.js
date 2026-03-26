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
              // 🆕 No existe → crear uno nuevo
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
  let _parsedData = null;
  let _manualMode = false;

  function _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    init() {
      _parsedData = null;
      _manualMode = false;
      this.render();
    },

    render() {
      const container = document.getElementById('view-add-local');
      if (!container) return;

      container.innerHTML = `
        <div class="px-4 pt-4 pb-8 view-enter">
          <h2 class="text-xl font-bold mb-2">Importar local</h2>
          <p class="text-sm text-gray-400 mb-6">
            Pegá la URL de Google Maps de la hamburguesería.
          </p>

          <!-- URL Input -->
          <div class="space-y-3">
            <textarea id="maps-url-input"
                      placeholder="https://www.google.com/maps/place/..."
                      class="input" rows="3"
                      oninput="AddLocal.onUrlInput(this.value)"></textarea>
            <button class="btn-primary w-full" onclick="AddLocal.parseUrl()">
              🔍 Analizar URL
            </button>
          </div>

          <!-- Resultado del parse -->
          <div id="parse-result" class="mt-6"></div>

          <!-- Modo manual -->
          <div class="mt-4 pt-4 border-t border-[#5c3d25]">
            <button class="btn-ghost w-full text-sm" onclick="AddLocal.showManualForm()">
              ✏️ Ingresar datos manualmente
            </button>
          </div>
        </div>
      `;
    },

    onUrlInput(value) {
      // Limpiar resultado previo si el usuario edita
      if (value.trim() === '') {
        document.getElementById('parse-result').innerHTML = '';
        _parsedData = null;
      }
    },

    async parseUrl() {
      const rawUrl = document.getElementById('maps-url-input')?.value.trim();
      if (!rawUrl) {
        App.showToast('Ingresá una URL de Google Maps', 'error');
        return;
      }

      const container = document.getElementById('parse-result');
      let urlToParse = rawUrl;

      // Las URLs cortas (maps.app.goo.gl / goo.gl/maps) no se pueden parsear desde el browser
      // por restricciones de CORS — no hay proxy CORS confiable para resolverlas client-side.
      // La URL corta igual funciona como link de Maps: solo pedimos el nombre al usuario.
      if (Maps.isShortUrl(rawUrl)) {
        _parsedData = { isValid: true, isShortUrl: true, mapsUrl: rawUrl };
        container.innerHTML = `
          <div class="card p-4">
            <div class="flex items-start gap-3 mb-4">
              <span class="text-xl flex-shrink-0">📍</span>
              <div>
                <p class="text-sm font-semibold text-[#D2A679]">URL corta detectada</p>
                <p class="text-xs text-gray-400 mt-0.5">
                  El link de "Compartir" de Maps no incluye el nombre del local.
                  Escribilo y listo — el link ya está guardado.
                </p>
              </div>
            </div>
            ${this._manualFormHtml(rawUrl)}
          </div>
        `;
        return;
      }

      const result = Maps.parse(urlToParse);

      if (!result.isValid) {
        container.innerHTML = `
          <div class="card p-4 border-red-800">
            <p class="text-[#E32636] text-sm">❌ ${_escHtml(result.error)}</p>
            <p class="text-xs text-gray-500 mt-1">
              Asegurate de que sea una URL de Google Maps (google.com/maps o goo.gl/maps)
            </p>
          </div>
        `;
        return;
      }

      _parsedData = result;

      if (result.needsManualInput) {
        container.innerHTML = `
          <div class="card p-4">
            <p class="text-[#FFD700] text-sm mb-3">
              ⚠️ No se pudo extraer el nombre automáticamente. Completá los datos:
            </p>
            ${this._manualFormHtml(result.mapsUrl)}
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="card overflow-hidden">
            <div class="local-photo-placeholder text-5xl">🍔</div>
            <div class="p-4">
              <h3 class="font-bold text-lg">${_escHtml(Maps.formatName(result.name))}</h3>
              ${result.coords
                ? `<p class="text-xs text-gray-400 mt-1">📍 ${result.coords.lat.toFixed(6)}, ${result.coords.lng.toFixed(6)}</p>`
                : ''
              }
              ${result.placeId
                ? `<p class="text-xs text-gray-500 mt-0.5">Place ID: ${_escHtml(result.placeId)}</p>`
                : ''
              }

              <!-- Override de nombre -->
              <div class="mt-4 space-y-2">
                <label class="text-xs text-gray-400">Nombre del local (editá si es necesario):</label>
                <input type="text" id="local-name-override"
                       value="${_escHtml(Maps.formatName(result.name))}"
                       class="input" maxlength="100">
                <label class="text-xs text-gray-400">Dirección (opcional):</label>
                <input type="text" id="local-address-override"
                       placeholder="Ej: Av. Corrientes 1234, CABA"
                       class="input" maxlength="200">
              </div>

              <button class="btn-primary w-full mt-4" onclick="AddLocal.save()">
                💾 Guardar local
              </button>
            </div>
          </div>
        `;
      }
    },

    _manualFormHtml(mapsUrl = '') {
      return `
        <div class="space-y-3">
          <input type="text" id="manual-name" placeholder="Nombre del local *" class="input" maxlength="100">
          <input type="text" id="manual-address" placeholder="Dirección (opcional)" class="input" maxlength="200">
          <input type="url" id="manual-maps-url" value="${_escHtml(mapsUrl)}"
                 placeholder="URL de Google Maps" class="input">
          <button class="btn-primary w-full" onclick="AddLocal.saveManual()">
            💾 Guardar local
          </button>
        </div>
      `;
    },

    showManualForm() {
      _manualMode = true;
      const container = document.getElementById('parse-result');
      container.innerHTML = `
        <div class="card p-4">
          <h3 class="font-semibold mb-4">Datos manuales</h3>
          ${this._manualFormHtml()}
        </div>
      `;
    },

    async saveManual() {
      const nombre   = document.getElementById('manual-name')?.value.trim();
      const direccion = document.getElementById('manual-address')?.value.trim() || '';
      const mapsUrl  = document.getElementById('manual-maps-url')?.value.trim() || '';

      if (!nombre) {
        App.showToast('El nombre es requerido', 'error');
        return;
      }

      await this._doSave({ nombre, direccion, maps_url: mapsUrl, maps_place_id: '', foto_url: '' });
    },

    async save() {
      if (!_parsedData) return;

      const nombre   = document.getElementById('local-name-override')?.value.trim();
      const direccion = document.getElementById('local-address-override')?.value.trim() || '';

      if (!nombre) {
        App.showToast('El nombre del local es requerido', 'error');
        return;
      }

      await this._doSave({
        nombre,
        direccion,
        maps_url:      _parsedData.mapsUrl || _parsedData.originalUrl,
        maps_place_id: _parsedData.placeId || '',
        foto_url:      '',
      });
    },

    async _doSave(localData) {
      const btn = document.querySelector('#parse-result .btn-primary, #view-add-local .btn-primary:last-child');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

      try {
        const saved = await AppState.db.addLocal(localData);
        AppState.data.locales.push(saved);
        App.showToast(`✅ "${saved.nombre}" importado`, 'success');
        App.navigate('#home');
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
