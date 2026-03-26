/**
 * BurgerRank — Módulo de Autenticación
 *
 * Flujo simplificado (un solo popup, nunca bloqueado por el browser):
 *
 *   [Botón HTML] → onclick → Auth.startLogin()
 *                         → requestAccessToken({ prompt:'select_account' })
 *                         → [popup OAuth de Google — permitido porque viene de click directo]
 *                         → _handleTokenResponse()
 *                         → fetch userinfo API → obtener email/nombre/foto
 *                         → onLoginSuccess()
 *
 * Por qué el flujo anterior (GSI button → callback → botón intermedio) era problemático:
 * - El primer paso (GSI button) disparaba _handleCredentialResponse desde un callback,
 *   no desde un gesto de usuario. Cuando ese callback intentaba abrir el popup OAuth,
 *   Chrome lo bloqueaba por política de seguridad.
 * - La solución es usar únicamente el OAuth Token Client y dispararlo directamente
 *   desde el onclick del botón en el HTML. Así el popup tiene "user gesture" y no se bloquea.
 */

const Auth = (() => {
  // ── Estado interno ────────────────────────────────────────────────────────
  let _user        = null;  // { email, name, picture, hash }
  let _accessToken = null;  // OAuth 2.0 access token
  let _tokenExpiry = 0;     // timestamp (ms) de expiración
  let _tokenClient = null;  // google.accounts.oauth2.TokenClient

  const _callbacks = {
    onLoginSuccess: null,
    onLogout:       null,
    onNoSession:    null,   // disparado cuando no hay sesión guardada → mostrar pantalla de login
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Hash SHA-256 del email, recortado a 16 chars hex.
   * Usado como clave en localStorage sin exponer el email real.
   */
  async function _hashEmail(email) {
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(email.toLowerCase()),
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  }

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
    _user        = null;
    _accessToken = null;
    _tokenExpiry = 0;
  }

  // ── Inicialización OAuth ──────────────────────────────────────────────────

  function _initTokenClient() {
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope:     CONFIG.SCOPES,
      callback:  _handleTokenResponse,
      // prompt vacío → no re-pide consentimiento si ya fue otorgado.
      // startLogin() lo sobreescribe con 'select_account' para el primer login.
      prompt: '',
    });
  }

  /**
   * Llama a la Google userinfo API para obtener email, nombre y foto.
   * Más simple que decodificar un JWT: el access token es suficiente.
   */
  async function _fetchUserInfo(accessToken) {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error('No se pudo obtener el perfil del usuario');
    return resp.json();
  }

  // ── Callbacks OAuth ───────────────────────────────────────────────────────

  async function _handleTokenResponse(tokenResponse) {
    if (tokenResponse.error) {
      console.error('OAuth error:', tokenResponse.error, tokenResponse.error_description);
      App.showToast('Error de autorización: ' + tokenResponse.error, 'error');
      return;
    }

    _accessToken = tokenResponse.access_token;
    // Tokens de Google duran 3600 seg; guardamos con margen de 5 min
    _tokenExpiry = Date.now() + (tokenResponse.expires_in - 300) * 1000;
    _persistToken();

    // Si ya tenemos el usuario (sesión restaurada con token expirado), ir directo
    if (_user) {
      _callbacks.onLoginSuccess?.(_user);
      return;
    }

    // Primera vez: obtener datos del usuario via userinfo API
    try {
      const info = await _fetchUserInfo(_accessToken);
      _user = {
        email:   info.email,
        name:    info.name,
        picture: info.picture,
        hash:    await _hashEmail(info.email),
      };
      _persistSession();
      _callbacks.onLoginSuccess?.(_user);
    } catch (err) {
      console.error('Error obteniendo perfil:', err);
      App.showToast('Error al obtener tu perfil. Intentá de nuevo.', 'error');
    }
  }

  // ── API pública ───────────────────────────────────────────────────────────

  return {
    /**
     * Inicializa el módulo OAuth. Llamar cuando la librería GSI esté cargada.
     * @param {Object} callbacks - { onLoginSuccess, onLogout }
     */
    init(callbacks) {
      Object.assign(_callbacks, callbacks);
      _initTokenClient();

      // Intentar restaurar sesión previa desde sessionStorage
      const savedUser = sessionStorage.getItem('burgerrank_user');
      if (savedUser) {
        try {
          _user = JSON.parse(savedUser);

          // Reutilizar token cacheado si aún no expiró (evita round-trip en cada F5)
          const savedToken = sessionStorage.getItem('burgerrank_token');
          if (savedToken) {
            const { token, expiry } = JSON.parse(savedToken);
            if (token && expiry > Date.now()) {
              _accessToken = token;
              _tokenExpiry = expiry;
              _callbacks.onLoginSuccess?.(_user);
              return;
            }
          }

          // Token expirado: pedir uno nuevo silenciosamente.
          // prompt:'' no abre popup si el usuario ya consintió antes.
          _tokenClient.requestAccessToken({ prompt: '' });
          return;
        } catch {
          _clearSession();
        }
      }

      // Sin sesión guardada → notificar a app.js para que muestre la pantalla de login.
      // El botón en index.html llamará a Auth.startLogin() cuando el usuario haga click.
      _callbacks.onNoSession?.();
    },

    /**
     * Inicia el flujo OAuth completo con selección de cuenta.
     * IMPORTANTE: debe ser llamado desde un onclick directo (nunca desde un callback)
     * para que el popup de Google no sea bloqueado por el browser.
     */
    startLogin() {
      if (!_tokenClient) {
        App.showToast('Cargando... intentá en un segundo', 'info');
        return;
      }
      _tokenClient.requestAccessToken({ prompt: 'select_account' });
    },

    getUser()        { return _user; },
    getAccessToken() { return _accessToken; },
    isTokenValid()   { return !!_accessToken && Date.now() < _tokenExpiry; },

    /**
     * Refresca el access token silenciosamente (llamado por SheetsDB en 401).
     * No abre popup ya que el usuario ya consintió.
     */
    refreshToken() {
      return new Promise((resolve) => {
        if (_tokenClient) {
          _tokenClient.requestAccessToken({ prompt: '' });
        }
        // Fallback: si el callback no llega en 10s, resolver con el token actual
        setTimeout(() => resolve(_accessToken), 10000);
      });
    },

    /** Cierra sesión y revoca el token de Google. */
    signOut() {
      if (_accessToken) {
        google.accounts.oauth2.revoke(_accessToken, () => {
          console.log('Token de Google revocado');
        });
      }
      _clearSession();
      _callbacks.onLogout?.();
    },

    /** Fuerza re-autenticación (cuando el token expiró durante el uso). */
    forceReauth() {
      if (_tokenClient) {
        _tokenClient.requestAccessToken({ prompt: '' });
      }
    },
  };
})();

// Escuchar evento de token expirado emitido por SheetsDB
window.addEventListener('burgerrank:tokenExpired', () => {
  Auth.forceReauth();
});
