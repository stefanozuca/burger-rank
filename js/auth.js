/**
 * BurgerRank — Módulo de Autenticación
 *
 * Flujo:
 * 1. Google Identity Services (GSI) → ID Token (identidad del usuario)
 * 2. OAuth 2.0 Token Client → Access Token (para Sheets API)
 * 3. Verificación whitelist contra hoja `users` del spreadsheet
 *
 * Por qué dos pasos:
 * - El ID Token solo nos dice "quién es" el usuario (email, nombre, foto)
 * - El Access Token nos permite actuar en su nombre (leer/escribir Sheets)
 * La librería GSI de Google separa ambos conceptos deliberadamente.
 */

const Auth = (() => {
  // ── Estado interno ────────────────────────────────────────────────────────
  let _user = null;          // { email, name, picture }
  let _accessToken = null;   // OAuth access token para Sheets API
  let _tokenExpiry = 0;      // timestamp en ms cuando expira el token
  let _tokenClient = null;   // google.accounts.oauth2 token client

  // Callbacks de ciclo de vida (asignados desde app.js)
  const _callbacks = {
    onLoginSuccess: null,
    onLoginRestricted: null,
    onLogout: null,
    onTokenRefreshed: null,
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Decodifica el payload de un JWT sin verificar la firma
   * (la verificación la hace Google server-side; nosotros solo leemos el claim)
   */
  function _parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join('')
      );
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  /**
   * Hash SHA-256 del email (para URLs de share sin exponer el email real).
   * Retorna los primeros 16 chars en hex.
   */
  async function _hashEmail(email) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase()));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  }

  /**
   * Guarda el usuario y el token en sessionStorage para restaurar sesión sin re-login.
   * El token dura máx. 1 hora; al cerrar la pestaña se limpia solo (sessionStorage).
   */
  function _persistSession() {
    sessionStorage.setItem('burgerrank_user', JSON.stringify(_user));
  }

  function _persistToken() {
    sessionStorage.setItem('burgerrank_token', JSON.stringify({
      token:  _accessToken,
      expiry: _tokenExpiry,
    }));
  }

  function _clearSession() {
    sessionStorage.removeItem('burgerrank_user');
    sessionStorage.removeItem('burgerrank_token');
    _user = null;
    _accessToken = null;
    _tokenExpiry = 0;
  }

  // ── Inicialización GSI ────────────────────────────────────────────────────

  function _initGSI() {
    google.accounts.id.initialize({
      client_id: CONFIG.CLIENT_ID,
      callback: _handleCredentialResponse,
      auto_select: true,           // intenta auto-login si hay sesión previa
      cancel_on_tap_outside: false,
    });
  }

  function _initTokenClient() {
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      callback: _handleTokenResponse,
      // prompt vacío → no muestra dialog de consentimiento si ya fue aceptado
      prompt: '',
    });
  }

  /**
   * Callback del ID Token (después de Sign-In con Google).
   * Solo extraemos identidad; luego mostramos un botón para que el usuario
   * autorice el acceso a Sheets con un click directo.
   *
   * Por qué no llamamos _requestAccessToken() directamente acá:
   * Este callback no es un gesto de usuario → el browser bloquea el popup OAuth.
   * La solución es mostrar un botón intermedio que sí es un click directo.
   */
  async function _handleCredentialResponse(response) {
    const payload = _parseJwt(response.credential);
    if (!payload) {
      App.showToast('Error al leer el token de Google', 'error');
      return;
    }

    _user = {
      email:   payload.email,
      name:    payload.name,
      picture: payload.picture,
      hash:    await _hashEmail(payload.email),
    };

    _persistSession();

    // Mostrar botón de autorización para que el usuario lo clickee
    // y el popup de OAuth sea disparado desde un gesto directo
    _showAuthorizeButton();
  }

  /**
   * Muestra un botón "Autorizar acceso" después del Sign-In.
   * Necesario para que el popup OAuth de Sheets no sea bloqueado por el browser.
   */
  function _showAuthorizeButton() {
    const container = document.getElementById('google-signin-btn');
    if (!container) return;

    container.innerHTML = `
      <div class="flex flex-col items-center gap-3">
        <p class="text-sm" style="color: var(--color-cheese);">
          ¡Hola, ${_user.name.split(' ')[0]}! Un paso más 👇
        </p>
        <button
          id="authorize-sheets-btn"
          class="flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-white transition-opacity hover:opacity-90"
          style="background-color: var(--color-tomato);"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Autorizar acceso a mis datos
        </button>
        <p class="text-xs opacity-50">Necesario para leer y guardar tu ranking</p>
      </div>
    `;

    // Este click SÍ es un gesto directo → el popup OAuth no será bloqueado
    document.getElementById('authorize-sheets-btn').addEventListener('click', () => {
      _requestAccessToken();
    });
  }

  /**
   * Callback del OAuth Access Token.
   */
  async function _handleTokenResponse(tokenResponse) {
    if (tokenResponse.error) {
      console.error('OAuth error:', tokenResponse.error);
      App.showToast('Error de autorización: ' + tokenResponse.error, 'error');
      return;
    }

    _accessToken = tokenResponse.access_token;
    // Los tokens de Google duran 3600 seg; guardamos con margen de 5 min
    _tokenExpiry = Date.now() + (tokenResponse.expires_in - 300) * 1000;

    // Cachear token para evitar el popup en cada F5 dentro de la misma sesión
    _persistToken();

    _callbacks.onLoginSuccess?.(_user);
  }

  function _requestAccessToken() {
    if (_tokenClient) {
      _tokenClient.requestAccessToken({ prompt: '' });
    }
  }

  // ── API pública ───────────────────────────────────────────────────────────

  return {
    /**
     * Inicializa los módulos de Google (llamar cuando la lib GSI esté cargada).
     * @param {Object} callbacks - { onLoginSuccess, onLoginRestricted, onLogout }
     */
    init(callbacks) {
      Object.assign(_callbacks, callbacks);
      _initGSI();
      _initTokenClient();

      // Intentar restaurar sesión previa desde sessionStorage
      const savedUser = sessionStorage.getItem('burgerrank_user');
      if (savedUser) {
        try {
          _user = JSON.parse(savedUser);

          // Intentar reutilizar el token cacheado (evita round-trip a Google en cada F5)
          const savedToken = sessionStorage.getItem('burgerrank_token');
          if (savedToken) {
            const { token, expiry } = JSON.parse(savedToken);
            if (token && expiry > Date.now()) {
              // Token válido: usarlo directamente sin mostrar popup
              _accessToken = token;
              _tokenExpiry = expiry;
              _callbacks.onLoginSuccess?.(_user);
              return;
            }
          }

          // Token expirado o no cacheado: pedir uno nuevo silenciosamente
          // prompt:'' no abre popup si el usuario ya consintió antes
          _requestAccessToken();
          return;
        } catch {
          _clearSession();
        }
      }

      // Sin sesión → renderizar botón de Google Sign-In
      google.accounts.id.renderButton(
        document.getElementById('google-signin-btn'),
        {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          locale: 'es',
        }
      );

      // También intentar One Tap (solo en HTTPS)
      if (location.protocol === 'https:') {
        google.accounts.id.prompt();
      }
    },

    /** Retorna el user actual o null. */
    getUser() { return _user; },

    /** Retorna el access token vigente. */
    getAccessToken() { return _accessToken; },

    /** Retorna true si el token no expiró. */
    isTokenValid() { return _accessToken && Date.now() < _tokenExpiry; },

    /**
     * Refresca el access token silenciosamente.
     * La llama SheetsDB cuando detecta 401.
     */
    refreshToken() {
      return new Promise((resolve) => {
        const original = _handleTokenResponse;
        // Interceptar la próxima respuesta de token para resolver la promesa
        const oneShot = async (resp) => {
          await original(resp);
          resolve(_accessToken);
        };
        if (_tokenClient) {
          _tokenClient.requestAccessToken({ prompt: '' });
        }
        // Fallback: resolver con el token actual si el callback no se llama
        setTimeout(() => resolve(_accessToken), 10000);
      });
    },

    /** Cierra sesión. */
    signOut() {
      if (_user?.email) {
        google.accounts.id.revoke(_user.email, () => {
          console.log('Token revocado');
        });
      }
      _clearSession();
      _callbacks.onLogout?.();
    },

    /** Fuerza re-autenticación (cuando el token expira en uso). */
    forceReauth() {
      _requestAccessToken();
    },
  };
})();

// Escuchar evento de token expirado emitido por SheetsDB
window.addEventListener('burgerrank:tokenExpired', () => {
  Auth.forceReauth();
});
