/**
 * BurgerRank — Sheets API Wrapper
 *
 * Wrapper CRUD sobre Google Sheets API v4.
 * Cada hoja tiene su primera fila como encabezado; los datos empiezan en la fila 2.
 *
 * Limitaciones conocidas:
 * - Rate limit: ~100 req / 100 seg por usuario (Google quota)
 * - No hay transacciones → escrituras concurrentes pueden generar inconsistencias
 * - El ID de fila es posicional; borrar filas puede corromper referencias cruzadas
 *   (por eso usamos IDs lógicos en cada registro, no el número de fila)
 */

class SheetsDB {
  /**
   * @param {string} spreadsheetId
   * @param {Function} getToken - función que retorna el access token vigente
   */
  constructor(spreadsheetId, getToken) {
    this.spreadsheetId = spreadsheetId;
    this.getToken = getToken;
    this.baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  }

  // ── Utilidades internas ─────────────────────────────────────────────────

  /**
   * Convierte un array de filas (arrays) a array de objetos usando la primera fila como keys.
   */
  _rowsToObjects(values) {
    if (!values || values.length < 2) return [];
    const [headers, ...rows] = values;
    return rows.map((row) =>
      headers.reduce((obj, key, i) => {
        obj[key] = row[i] ?? '';
        return obj;
      }, {})
    );
  }

  /**
   * Convierte un objeto a array de valores siguiendo el orden de los headers dados.
   */
  _objectToRow(obj, headers) {
    return headers.map((h) => obj[h] ?? '');
  }

  /**
   * Genera un ID único basado en timestamp + random.
   */
  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /**
   * Fecha actual en formato ISO local Argentina.
   */
  _now() {
    return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  async _fetch(path, options = {}) {
    const token = this.getToken();
    if (!token) throw new Error('No hay access token disponible');

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      // 401 → token expirado; la app debe re-autenticar
      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent('burgerrank:tokenExpired'));
      }
      throw new Error(error.error?.message || `Sheets API error ${response.status}`);
    }

    return response.json();
  }

  /** Lee un rango. Retorna los valores crudos (array de arrays). */
  async _read(range) {
    const data = await this._fetch(`/values/${encodeURIComponent(range)}`);
    return data.values || [];
  }

  /** Appends rows al final de un rango. */
  async _append(range, rows) {
    return this._fetch(
      `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        body: JSON.stringify({ values: rows }),
      }
    );
  }

  /** Actualiza un rango específico (sobrescribe). */
  async _update(range, rows) {
    return this._fetch(
      `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        body: JSON.stringify({ values: rows }),
      }
    );
  }

  /** Borra el contenido de un rango. */
  async _clear(range) {
    return this._fetch(`/values/${encodeURIComponent(range)}:clear`, { method: 'POST' });
  }

  /**
   * Lectura batch: múltiples rangos en un solo request (ahorra quota).
   * @returns {Object} mapa { range: values }
   */
  async _batchRead(ranges) {
    const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
    const data = await this._fetch(`/values:batchGet?${params}`);
    const result = {};
    (data.valueRanges || []).forEach((vr) => {
      result[vr.range] = vr.values || [];
    });
    return result;
  }

  // ── Creación de spreadsheet personal ────────────────────────────────────

  /**
   * Crea un nuevo Google Spreadsheet en el Drive del usuario autenticado.
   * Se llama solo la primera vez que el usuario inicia sesión.
   *
   * Por qué aquí y no en un backend: el scope `spreadsheets` permite crear
   * y modificar hojas en el Drive del usuario sin necesidad de servidor propio.
   *
   * @param {string} accessToken
   * @param {string} userName - nombre del usuario para el título del sheet
   * @returns {string} spreadsheetId del nuevo documento
   */
  // ── Schema de referencia (usado en validación) ──────────────────────────
  static get SCHEMA() {
    return {
      locales:       ['id','nombre','direccion','maps_url','maps_place_id','foto_url','fecha_import'],
      hamburguesas:  ['id','local_id','nombre','descripcion','tags'],
      degustaciones: ['id','user_email','hamburguesa_id','local_id','top_n','comentario','fecha'],
      top_order:     ['user_email','local_id','posicion_manual'],
    };
  }

  /**
   * Busca en Google Drive del usuario si ya existe un spreadsheet de BurgerRank.
   * Usa el scope drive.readonly que ya fue otorgado en el flujo OAuth.
   *
   * Retorna el spreadsheetId del primero encontrado (orden por fecha de creación),
   * o null si no hay ninguno.
   *
   * Por qué buscar en Drive en vez de solo localStorage:
   * localStorage es por dispositivo → nuevo dispositivo = localStorage vacío,
   * aunque el spreadsheet ya exista en Drive desde otro dispositivo.
   */
  static async findExistingSpreadsheet(accessToken) {
    const q = encodeURIComponent(
      "name contains 'BurgerRank' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
    );
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!resp.ok) return null;   // falla silenciosamente (scope no disponible, etc.)
    const data = await resp.json();
    // El primero en orden cronológico es el original (no duplicados por creación fallida)
    return data.files?.[0]?.id || null;
  }

  /**
   * Valida la estructura de un spreadsheet existente y repara lo que falte.
   *
   * Chequeos:
   * 1. Verifica que existan las 4 hojas requeridas → crea las faltantes
   * 2. Verifica que cada hoja tenga headers en la fila 1 → los agrega si faltan
   *
   * No toca los datos existentes; solo agrega lo que falta.
   * Útil para: nuevo dispositivo, spreadsheet creado a medias, hojas borradas accidentalmente.
   *
   * @param {string} spreadsheetId
   * @param {string} accessToken
   * @returns {string} el mismo spreadsheetId (para encadenar)
   */
  static async validateAndRepairSpreadsheet(spreadsheetId, accessToken) {
    const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const authHeader = { Authorization: `Bearer ${accessToken}` };

    // ── 1. Obtener metadata del spreadsheet (lista de hojas existentes) ────
    const metaResp = await fetch(`${baseUrl}?fields=sheets.properties.title`, {
      headers: authHeader,
    });
    if (!metaResp.ok) {
      const err = await metaResp.json().catch(() => ({}));
      throw new Error(err.error?.message || `No se pudo acceder al spreadsheet (HTTP ${metaResp.status})`);
    }
    const meta = await metaResp.json();
    const existingSheets = new Set(meta.sheets.map((s) => s.properties.title));

    const schema = SheetsDB.SCHEMA;
    const missingSheets  = Object.keys(schema).filter((name) => !existingSheets.has(name));
    const presentSheets  = Object.keys(schema).filter((name) =>  existingSheets.has(name));

    // ── 2. Crear hojas faltantes ───────────────────────────────────────────
    if (missingSheets.length > 0) {
      const batchResp = await fetch(`${baseUrl}:batchUpdate`, {
        method:  'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: missingSheets.map((title) => ({ addSheet: { properties: { title } } })),
        }),
      });
      if (!batchResp.ok) {
        const err = await batchResp.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Error al crear hojas faltantes');
      }
    }

    // ── 3. Verificar headers en hojas que ya existían ─────────────────────
    // (Las hojas recién creadas no tienen datos → sus headers se agregan en paso 4)
    let sheetsNeedingHeaders = [...missingSheets]; // las nuevas siempre necesitan headers

    if (presentSheets.length > 0) {
      const ranges = presentSheets.map((name) => `${name}!A1:Z1`);
      const batchGetUrl = `${baseUrl}/values:batchGet?ranges=${ranges.map(encodeURIComponent).join('&ranges=')}`;
      const readResp = await fetch(batchGetUrl, { headers: authHeader });

      if (readResp.ok) {
        const readData = await readResp.json();
        readData.valueRanges?.forEach((vr, i) => {
          const sheetName = presentSheets[i];
          const firstRow  = vr.values?.[0] || [];
          // Si la fila 1 está vacía o no tiene las columnas base → necesita headers
          if (firstRow.length === 0) {
            sheetsNeedingHeaders.push(sheetName);
          }
        });
      }
    }

    // ── 4. Escribir headers en las hojas que los necesitan ─────────────────
    if (sheetsNeedingHeaders.length > 0) {
      const updateResp = await fetch(`${baseUrl}/values:batchUpdate`, {
        method:  'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: sheetsNeedingHeaders.map((name) => ({
            range:  `${name}!A1`,
            values: [schema[name]],
          })),
        }),
      });
      if (!updateResp.ok) {
        const err = await updateResp.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Error al escribir headers');
      }
    }

    return spreadsheetId;
  }

  static async createPersonalSpreadsheet(accessToken, userName) {
    // 1. Crear el documento con todas las hojas requeridas
    const createResp = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: `BurgerRank — ${userName}` },
        sheets: [
          { properties: { title: 'locales' } },
          { properties: { title: 'hamburguesas' } },
          { properties: { title: 'degustaciones' } },
          { properties: { title: 'top_order' } },
        ],
      }),
    });

    if (!createResp.ok) {
      const err = await createResp.json().catch(() => ({}));
      throw new Error(err.error?.message || 'No se pudo crear el spreadsheet personal');
    }

    const { spreadsheetId } = await createResp.json();

    // 2. Inicializar los headers de cada hoja en un solo batch request
    const headers = [
      { range: 'locales!A1:G1',       values: [['id','nombre','direccion','maps_url','maps_place_id','foto_url','fecha_import']] },
      { range: 'hamburguesas!A1:E1',   values: [['id','local_id','nombre','descripcion','tags']] },
      { range: 'degustaciones!A1:G1',  values: [['id','user_email','hamburguesa_id','local_id','top_n','comentario','fecha']] },
      { range: 'top_order!A1:C1',      values: [['user_email','local_id','posicion_manual']] },
    ];

    const initResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ valueInputOption: 'RAW', data: headers }),
      }
    );

    if (!initResp.ok) {
      throw new Error('El spreadsheet se creó pero no se pudo inicializar');
    }

    return spreadsheetId;
  }

  // ── Lectura pública (API Key, sin OAuth) ─────────────────────────────────

  /**
   * Lectura pública usando API Key (para share.html que no requiere auth).
   */
  static async publicRead(spreadsheetId, range, apiKey) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('No se pudo leer el sheet público');
    const data = await response.json();
    return data.values || [];
  }

  // ── CRUD: Users ──────────────────────────────────────────────────────────

  async getUsers() {
    const values = await this._read(`${CONFIG.SHEETS.USERS}!A:C`);
    return this._rowsToObjects(values);
  }

  async isUserAuthorized(email) {
    const users = await this.getUsers();
    return users.some((u) => u.email?.toLowerCase() === email.toLowerCase());
  }

  // ── CRUD: Locales ────────────────────────────────────────────────────────

  async getLocales() {
    const values = await this._read(`${CONFIG.SHEETS.LOCALES}!A:G`);
    return this._rowsToObjects(values);
  }

  async addLocal({ nombre, direccion, maps_url, maps_place_id, foto_url }) {
    const id = this._generateId();
    const headers = ['id', 'nombre', 'direccion', 'maps_url', 'maps_place_id', 'foto_url', 'fecha_import'];
    const row = this._objectToRow(
      { id, nombre, direccion, maps_url, maps_place_id: maps_place_id || '', foto_url: foto_url || '', fecha_import: this._now() },
      headers
    );
    await this._append(`${CONFIG.SHEETS.LOCALES}!A:G`, [row]);
    return { id, nombre, direccion, maps_url, maps_place_id, foto_url, fecha_import: this._now() };
  }

  // ── CRUD: Hamburguesas ───────────────────────────────────────────────────

  async getHamburguesas(localId = null) {
    const values = await this._read(`${CONFIG.SHEETS.HAMBURGUESAS}!A:E`);
    const all = this._rowsToObjects(values);
    return localId ? all.filter((h) => h.local_id === localId) : all;
  }

  async addHamburguesa({ local_id, nombre, descripcion, tags }) {
    const id = this._generateId();
    const headers = ['id', 'local_id', 'nombre', 'descripcion', 'tags'];
    const row = this._objectToRow(
      { id, local_id, nombre, descripcion: descripcion || '', tags: Array.isArray(tags) ? tags.join(',') : (tags || '') },
      headers
    );
    await this._append(`${CONFIG.SHEETS.HAMBURGUESAS}!A:E`, [row]);
    return { id, local_id, nombre, descripcion, tags };
  }

  // ── CRUD: Degustaciones ──────────────────────────────────────────────────

  async getDegustaciones(userEmail = null) {
    const values = await this._read(`${CONFIG.SHEETS.DEGUSTACIONES}!A:G`);
    const all = this._rowsToObjects(values);
    return userEmail
      ? all.filter((d) => d.user_email?.toLowerCase() === userEmail.toLowerCase())
      : all;
  }

  async addDegustacion({ user_email, hamburguesa_id, local_id, top_n, comentario }) {
    const id = this._generateId();
    const headers = ['id', 'user_email', 'hamburguesa_id', 'local_id', 'top_n', 'comentario', 'fecha'];
    const row = this._objectToRow(
      { id, user_email, hamburguesa_id, local_id, top_n: String(top_n), comentario: comentario || '', fecha: this._now() },
      headers
    );
    await this._append(`${CONFIG.SHEETS.DEGUSTACIONES}!A:G`, [row]);
    return { id, user_email, hamburguesa_id, local_id, top_n, comentario, fecha: this._now() };
  }

  /**
   * Actualiza la degustación más reciente del usuario para esa hamburguesa.
   * Necesario para el caso de "actualizar top_n".
   * Estrategia: busca la fila, calcula su posición y hace PUT.
   */
  async updateDegustacion(id, updates) {
    const values = await this._read(`${CONFIG.SHEETS.DEGUSTACIONES}!A:G`);
    if (!values || values.length < 2) throw new Error('No hay degustaciones');

    const headers = values[0];
    const rowIndex = values.findIndex((row, i) => i > 0 && row[0] === id);
    if (rowIndex === -1) throw new Error('Degustación no encontrada');

    const existing = headers.reduce((obj, key, i) => { obj[key] = values[rowIndex][i] ?? ''; return obj; }, {});
    const updated = { ...existing, ...updates };
    const row = this._objectToRow(updated, headers);

    // rowIndex en el array == rowIndex+1 en la hoja (porque 0-indexed + header en fila 1)
    const sheetRow = rowIndex + 1;
    await this._update(`${CONFIG.SHEETS.DEGUSTACIONES}!A${sheetRow}:G${sheetRow}`, [row]);
    return updated;
  }

  // ── CRUD: Top Order (drag & drop manual) ─────────────────────────────────

  async getTopOrder(userEmail) {
    const values = await this._read(`${CONFIG.SHEETS.TOP_ORDER}!A:C`);
    const all = this._rowsToObjects(values);
    return all
      .filter((o) => o.user_email?.toLowerCase() === userEmail.toLowerCase())
      .sort((a, b) => Number(a.posicion_manual) - Number(b.posicion_manual));
  }

  /**
   * Reescribe toda la top_order del usuario con el nuevo orden.
   * @param {string} userEmail
   * @param {Array<{local_id, posicion_manual}>} orders
   */
  async saveTopOrder(userEmail, orders) {
    // Leer todo el top_order sheet para preservar otras rows de otros usuarios
    const values = await this._read(`${CONFIG.SHEETS.TOP_ORDER}!A:C`);
    const headers = values[0] || ['user_email', 'local_id', 'posicion_manual'];
    const otherRows = (values.slice(1) || []).filter(
      (row) => row[0]?.toLowerCase() !== userEmail.toLowerCase()
    );

    const myRows = orders.map(({ local_id, posicion_manual }) => [userEmail, local_id, String(posicion_manual)]);
    const allRows = [headers, ...otherRows, ...myRows];

    await this._update(`${CONFIG.SHEETS.TOP_ORDER}!A1:C${allRows.length}`, allRows);
  }

  // ── CRUD: Shares (para vista pública) ────────────────────────────────────

  async saveShare(userHash, displayName, topData) {
    const values = await this._read(`${CONFIG.SHEETS.SHARES}!A:D`);
    const headers = values[0] || ['user_hash', 'display_name', 'data_json', 'updated_at'];
    const rows = values.slice(1) || [];

    const existingIndex = rows.findIndex((r) => r[0] === userHash);
    const newRow = [userHash, displayName, JSON.stringify(topData), this._now()];

    if (existingIndex >= 0) {
      // Actualizar fila existente
      const sheetRow = existingIndex + 2; // +1 header +1 1-indexed
      await this._update(`${CONFIG.SHEETS.SHARES}!A${sheetRow}:D${sheetRow}`, [newRow]);
    } else {
      await this._append(`${CONFIG.SHEETS.SHARES}!A:D`, [newRow]);
    }
  }

  // ── Carga masiva para inicializar la app ─────────────────────────────────

  /**
   * Carga todos los datos necesarios para el home en un solo batch request.
   */
  async loadAllData(userEmail) {
    const ranges = [
      `${CONFIG.SHEETS.LOCALES}!A:G`,
      `${CONFIG.SHEETS.HAMBURGUESAS}!A:E`,
      `${CONFIG.SHEETS.DEGUSTACIONES}!A:G`,
      `${CONFIG.SHEETS.TOP_ORDER}!A:C`,
    ];

    const batch = await this._batchRead(ranges);

    // Las keys del batch incluyen el spreadsheet ID en el range retornado; usamos Object.values
    const batchValues = Object.values(batch);

    return {
      locales:       this._rowsToObjects(batchValues[0] || []),
      hamburguesas:  this._rowsToObjects(batchValues[1] || []),
      degustaciones: this._rowsToObjects(batchValues[2] || []).filter(
        (d) => d.user_email?.toLowerCase() === userEmail.toLowerCase()
      ),
      topOrder:      this._rowsToObjects(batchValues[3] || []).filter(
        (o) => o.user_email?.toLowerCase() === userEmail.toLowerCase()
      ),
    };
  }
}
