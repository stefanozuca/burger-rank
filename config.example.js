/**
 * BurgerRank — Configuración
 *
 * INSTRUCCIONES:
 * 1. Copiá este archivo: `cp config.example.js config.js`
 * 2. Completá los valores en config.js con tus credenciales reales
 * 3. NUNCA subas config.js al repositorio (está en .gitignore)
 *
 * Para obtener las credenciales, seguí el README.md → sección "Setup Google Cloud Console"
 */
const CONFIG = {
  // OAuth 2.0 Client ID de Google Cloud Console
  // Tipo: "Aplicación web"
  CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',

  // API Key de Google Cloud Console (para lectura pública en share.html)
  // Restricción recomendada: HTTP referrers → tu dominio
  API_KEY: 'YOUR_GOOGLE_API_KEY',

  // ID del Google Spreadsheet que funciona como base de datos
  // Lo encontrás en la URL del sheet: docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',

  // Scopes OAuth requeridos — no cambiar
  SCOPES: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly',
  ].join(' '),

  // Nombre de las hojas (tabs) — deben coincidir exactamente con los nombres en el Sheet
  SHEETS: {
    USERS:       'users',
    LOCALES:     'locales',
    HAMBURGUESAS: 'hamburguesas',
    DEGUSTACIONES: 'degustaciones',
    TOP_ORDER:   'top_order',
    SHARES:      'shares',
  },
};
