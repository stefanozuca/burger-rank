/**
 * BurgerRank — Módulo de Google Maps URL Parser
 *
 * Extrae información de hamburgueserías a partir de URLs de Google Maps.
 * Sin Places API (no la usamos para simplificar el setup):
 * - Parsea el nombre del path de la URL
 * - Extrae place_id del segmento de datos codificado
 * - Extrae coordenadas para construir un link de Maps
 *
 * Formatos de URL soportados:
 * 1. https://www.google.com/maps/place/{Name}/@{lat},{lng},{zoom}z/data=...
 * 2. https://maps.google.com/?q={name}&ll={lat},{lng}
 * 3. https://goo.gl/maps/{code} → NO se puede parsear sin fetch (CORS)
 * 4. https://maps.app.goo.gl/{code} → idem
 */

const Maps = (() => {

  /**
   * Intenta extraer el place_id de los datos codificados en la URL.
   * El place_id aparece como `!1s{placeId}` en el segmento `data=`.
   * Ejemplo: data=!3m1!4b1!4m5!3m4!1sChIJ...!8m2!3d...
   */
  function _extractPlaceId(url) {
    // El place_id viene después de !1s y antes del próximo !
    const match = url.match(/!1s([^!&]+)/);
    if (!match) return null;
    const candidate = match[1];
    // Los place_id de Google empiezan con "ChIJ" o son strings alfanuméricos
    if (candidate.startsWith('ChIJ') || candidate.startsWith('0x')) return candidate;
    return null;
  }

  /**
   * Extrae el nombre del local del path de la URL.
   * /maps/place/La+Burguesía+Palermo/@... → "La Burguesía Palermo"
   */
  function _extractName(url) {
    try {
      const urlObj = new URL(url);
      const pathMatch = urlObj.pathname.match(/\/maps\/place\/([^/@]+)/);
      if (pathMatch) {
        return decodeURIComponent(pathMatch[1].replace(/\+/g, ' '));
      }
      // Para URLs tipo maps.google.com/?q=
      const q = urlObj.searchParams.get('q');
      if (q) return decodeURIComponent(q.replace(/\+/g, ' '));
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Extrae coordenadas del path o query params.
   */
  function _extractCoords(url) {
    // Formato: /@lat,lng,zoom
    const coordMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coordMatch) {
      return { lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]) };
    }
    // Formato: ?ll=lat,lng
    try {
      const urlObj = new URL(url);
      const ll = urlObj.searchParams.get('ll') || urlObj.searchParams.get('sll');
      if (ll) {
        const [lat, lng] = ll.split(',').map(parseFloat);
        if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
      }
    } catch { /* noop */ }
    return null;
  }

  /**
   * Extrae dirección (si viene en la URL, muy raro pero posible).
   * Usualmente no viene en la URL estándar.
   */
  function _extractAddress(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.get('daddr') || null;
    } catch {
      return null;
    }
  }

  /**
   * Detecta si es una URL corta (goo.gl o maps.app.goo.gl).
   */
  function _isShortUrl(url) {
    return url.includes('goo.gl/maps') || url.includes('maps.app.goo.gl');
  }

  /**
   * Valida que la URL sea de Google Maps.
   */
  function _isGoogleMapsUrl(url) {
    return url.includes('google.com/maps') ||
           url.includes('maps.google.com') ||
           url.includes('goo.gl/maps') ||
           url.includes('maps.app.goo.gl');
  }

  /**
   * Construye una URL de Maps a partir de place_id o coordenadas.
   */
  function _buildMapsUrl(placeId, lat, lng, name) {
    if (placeId) return `https://maps.google.com/?cid=&q=place_id:${placeId}`;
    if (lat && lng) return `https://maps.google.com/?q=${lat},${lng}`;
    if (name) return `https://maps.google.com/?q=${encodeURIComponent(name)}`;
    return null;
  }

  /**
   * Intenta obtener la foto del local via Google Places Photo API.
   * Solo funciona si tenemos el place_id y una API Key configurada con Places.
   * Retorna null si no está disponible (sin Places API key).
   */
  async function _fetchPlacePhoto(placeId) {
    if (!placeId || !CONFIG.API_KEY) return null;

    // Places Details API para obtener el primer photo reference
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,photo&key=${CONFIG.API_KEY}`;

    try {
      const resp = await fetch(detailsUrl);
      // NOTA: Google Places API no tiene CORS habilitado para browser requests.
      // Esta llamada solo funcionaría con un backend o si hay CORS headers.
      // En browser siempre fallará con CORS → retornamos null gracefully.
      if (!resp.ok) return null;
      const data = await resp.json();
      const photoRef = data.result?.photos?.[0]?.photo_reference;
      if (photoRef) {
        return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photoRef}&key=${CONFIG.API_KEY}`;
      }
    } catch {
      // CORS bloqueará esto siempre desde browser → fail silencioso
    }
    return null;
  }

  // ── API pública ───────────────────────────────────────────────────────────

  return {
    /** Expone la detección de URL corta para uso externo. */
    isShortUrl(url) { return _isShortUrl(url.trim()); },

    /**
     * Parsea una URL de Google Maps y retorna la info extraída.
     * @param {string} rawUrl
     * @returns {{ name, placeId, coords, address, mapsUrl, isShortUrl, isValid }}
     */
    parse(rawUrl) {
      const url = rawUrl.trim();

      if (!_isGoogleMapsUrl(url)) {
        return { isValid: false, error: 'No es una URL de Google Maps válida' };
      }

      if (_isShortUrl(url)) {
        return {
          isValid: true,
          isShortUrl: true,
          originalUrl: url,
          name: null,
          placeId: null,
          coords: null,
          address: null,
          mapsUrl: url,
          // Indicamos que el nombre deberá ser ingresado manualmente
          needsManualInput: true,
        };
      }

      const name    = _extractName(url);
      const placeId = _extractPlaceId(url);
      const coords  = _extractCoords(url);
      const address = _extractAddress(url);
      const mapsUrl = _buildMapsUrl(placeId, coords?.lat, coords?.lng, name);

      return {
        isValid: true,
        isShortUrl: false,
        needsManualInput: !name,
        originalUrl: url,
        name,
        placeId,
        coords,
        address,
        mapsUrl: mapsUrl || url,
      };
    },

    // ── New Places API (v1) ──────────────────────────────────────────────────

    /**
     * Obtiene detalles completos de un local via Place Details API (v1).
     * Retorna el objeto de la API (displayName, formattedAddress, photos, id, etc.)
     *
     * Por qué la nueva API (places.googleapis.com) y no la vieja:
     * - La nueva soporta CORS desde el browser con API Key
     * - La vieja requería un backend o tenía problemas de CORS
     *
     * @param {string} placeId - e.g. "ChIJN1t_tDeuEmsRUsoyG83frY4"
     */
    async fetchPlaceDetails(placeId) {
      if (!CONFIG.API_KEY) throw new Error('API_KEY no configurada');
      const fields = 'id,displayName,formattedAddress,location,photos,rating,websiteUri';
      const resp = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?key=${CONFIG.API_KEY}`,
        {
          headers: { 'X-Goog-FieldMask': fields },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `Place Details error HTTP ${resp.status}`);
      }
      return resp.json();
    },

    /**
     * Busca locales por texto libre via Text Search API (v1).
     * Retorna un array de places (hasta maxResultCount).
     *
     * @param {string} query - texto libre, ej: "La Birra Bar, Palermo"
     * @param {number} maxResults - máximo de resultados (default 6)
     */
    async searchByText(query, maxResults = 6) {
      if (!CONFIG.API_KEY) throw new Error('API_KEY no configurada');
      const resp = await fetch(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.rating',
          },
          body: JSON.stringify({
            textQuery:      query,
            maxResultCount: maxResults,
            languageCode:   'es',
          }),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `Text Search error HTTP ${resp.status}`);
      }
      const data = await resp.json();
      return data.places || [];
    },

    /**
     * Construye la URL de foto usando la nueva Photo API (v1).
     * La URL redirige a la imagen real (el browser la sigue automáticamente).
     *
     * @param {string} photoName - e.g. "places/ChIJ.../photos/AXCi..."
     * @param {number} maxWidth  - ancho máximo en px (default 400)
     */
    getPhotoUrl(photoName, maxWidth = 400) {
      if (!photoName || !CONFIG.API_KEY) return null;
      return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${CONFIG.API_KEY}`;
    },

    /**
     * Construye la URL de "Cómo llegar" en Google Maps.
     */
    getDirectionsUrl(mapsUrl, name) {
      if (mapsUrl) return mapsUrl;
      if (name) return `https://maps.google.com/?q=${encodeURIComponent(name)}`;
      return null;
    },

    /**
     * Formatea un nombre crudo de URL (puede tener +, %20, etc.) a título limpio.
     */
    formatName(rawName) {
      if (!rawName) return '';
      return rawName
        .replace(/\+/g, ' ')
        .replace(/%20/g, ' ')
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .trim();
    },
  };
})();
