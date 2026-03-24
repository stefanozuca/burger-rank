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
   * Guarda el usuario en sessionStorage para restaurar sesión sin re-login.
   */
  function _persistSession() {
    sessionStorage.setItem('burgerrank_user', JSON.stringify(_user));
  }

  function _clearSession() {
    sessionStorage.removeItem('burgerrank_user');
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
   * Solo extraemos identidad; luego pedimos el access token por separado.
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

    // Ahora pedimos el access token para Sheets API
    // Si ya autorizó antes, no muestra popup → silencioso
    _requestAccessToken();
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

    // Verificar whitelist
    await _verifyAndProceed();
  }

  function _requestAccessToken() {
    if (_tokenClient) {
      _tokenClient.requestAccessToken({ prompt: '' });
    }
  }

  /**
   * Verifica el email contra la hoja `users` del spreadsheet.
   * Si está autorizado → dispara onLoginSuccess; si no → onLoginRestricted.
   */
  async function _verifyAndProceed() {
    try {
      // Creamos un SheetsDB temporal solo para la verificación
      const tempDB = new SheetsDB(CONFIG.SPREADSHEET_ID, () => _accessToken);
      const authorized = await tempDB.isUserAuthorized(_user.email);

      if (authorized) {
        _callbacks.onLoginSuccess?.(_user, _accessToken);
      } else {
        _callbacks.onLoginRestricted?.(_user);
      }
    } catch (err) {
      console.error('Error verificando whitelist:', err);
      App.showToast('Error al verificar acceso. Revisá tu conexión.', 'error');
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
      const saved = sessionStorage.getItem('burgerrank_user');
      if (saved) {
        try {
          _user = JSON.parse(saved);
          // Si hay sesión guardada, pedimos access token silenciosamente
          _requestAccessToken();
          return; // No mostrar botón de login todavía
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
        const originalCallback = _callbacks.onTokenRefreshed;
        _callbacks.onTokenRefreshed = () => {
          _callbacks.onTokenRefreshed = originalCallback;
          resolve(_accessToken);
        };
        if (_tokenClient) {
          _tokenClient.requestAccessToken({ prompt: '' });
        }
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
