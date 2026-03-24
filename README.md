# 🍔 BurgerRank

PWA para rankear hamburgueserías y hamburguesas entre un grupo cerrado de amigos.

## Stack

- **Frontend:** HTML5 + CSS3 + JavaScript ES6+ vanilla
- **UI:** Tailwind CSS (CDN)
- **Auth:** Google Identity Services (GSI)
- **DB:** Google Sheets API v4
- **Hosting:** GitHub Pages / Google Cloud Storage

---

## Setup local

```bash
git clone https://github.com/TU_USUARIO/burgerrank.git
cd burgerrank

# Crear el archivo de configuración con tus credenciales
cp config.example.js config.js
# → Editar config.js con tus valores reales

# Servir localmente (necesitás HTTPS o localhost para GSI)
npx serve .          # opción A
python -m http.server 8080  # opción B
```

> **Importante:** Google Identity Services requiere que el dominio esté en la lista de orígenes autorizados de tu OAuth Client. `localhost` con cualquier puerto funciona para desarrollo.

---

## Setup Google Cloud Console

### 1. Crear proyecto

1. Ir a [console.cloud.google.com](https://console.cloud.google.com)
2. Crear nuevo proyecto: `BurgerRank`

### 2. Habilitar APIs

En **APIs & Services → Library**, habilitar:
- **Google Sheets API**
- **Google Drive API** (para `drive.readonly`)
- **Maps JavaScript API** *(opcional, para embeds)*
- **Places API** *(opcional, para fotos de locales)*

### 3. Crear OAuth 2.0 Client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Tipo: **Web application**
3. Nombre: `BurgerRank Web`
4. **Authorized JavaScript origins:**
   ```
   http://localhost:8080
   https://TU_USUARIO.github.io
   ```
5. **Authorized redirect URIs:** (dejar vacío para GSI client-side)
6. Copiar el **Client ID** → pegar en `config.js`

### 4. Crear API Key

1. **APIs & Services → Credentials → Create Credentials → API Key**
2. Nombre: `BurgerRank API Key`
3. **Restricciones recomendadas:**
   - HTTP referrers: `https://TU_USUARIO.github.io/*` y `http://localhost:8080/*`
   - APIs: Sheets API, Maps JavaScript API
4. Copiar la key → pegar en `config.js`

### 5. Configurar OAuth Consent Screen

1. **APIs & Services → OAuth consent screen**
2. User Type: **External** (o Internal si usás Google Workspace)
3. App name: `BurgerRank`
4. Scopes: agregar `spreadsheets` y `drive.readonly`
5. Test users: agregar los emails del grupo de amigos

---

## Setup Google Sheets

### Crear el Spreadsheet

1. Crear un nuevo Google Sheet en Drive del owner
2. Renombrar las hojas (tabs) exactamente así:

| Tab | Columnas |
|-----|----------|
| `users` | `email` \| `nombre` \| `fecha_alta` |
| `locales` | `id` \| `nombre` \| `direccion` \| `maps_url` \| `maps_place_id` \| `foto_url` \| `fecha_import` |
| `hamburguesas` | `id` \| `local_id` \| `nombre` \| `descripcion` \| `tags` |
| `degustaciones` | `id` \| `user_email` \| `hamburguesa_id` \| `local_id` \| `top_n` \| `comentario` \| `fecha` |
| `top_order` | `user_email` \| `local_id` \| `posicion_manual` |
| `shares` | `user_hash` \| `display_name` \| `data_json` \| `updated_at` |

3. La primera fila de cada tab son los **headers** (exactamente como arriba)
4. Copiar el **Spreadsheet ID** de la URL:
   ```
   https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
   ```
5. Pegar en `config.js`

### Agregar usuarios autorizados

En el tab `users`, agregar una fila por cada amigo:
```
email                    | nombre   | fecha_alta
usuario@gmail.com        | Fede     | 2024-01-01
otro@gmail.com           | Martina  | 2024-01-01
```

### Permisos del Sheet

- El owner debe **compartir el sheet** con acceso de edición a sí mismo (se maneja via OAuth)
- Para que `share.html` funcione sin auth, el sheet debe estar configurado como:
  **Share → Anyone with the link → Viewer**
  Esto permite lectura pública con API Key pero escritura solo via OAuth

---

## Generar iconos PWA

1. Abrir `icons/generate-icons.html` en un browser
2. Descargar `icon-192.png` e `icon-512.png`
3. Guardarlos en la carpeta `icons/`

---

## Deploy en GitHub Pages

```bash
# Opción A: rama gh-pages
git checkout -b gh-pages
git push origin gh-pages
# → Settings → Pages → Source: gh-pages branch

# Opción B: carpeta /docs en main
# Mover todos los archivos a /docs y configurar en Settings → Pages → /docs
```

> **Importante:** `config.js` está en `.gitignore` y **nunca** debe subirse al repo.
> Cada colaborador necesita su propia copia de `config.js`.
>
> Para producción, considerar configurar las credenciales como variables del pipeline de CI/CD
> o usar GitHub Actions para inyectarlas en el build.

---

## Migration path: GitHub Pages → Google Cloud Storage

Cuando el tráfico o las necesidades lo justifiquen:

### 1. Crear bucket en GCS

```bash
gsutil mb -l southamerica-east1 gs://burgerrank-app
gsutil web set -m index.html -e index.html gs://burgerrank-app
gsutil iam ch allUsers:objectViewer gs://burgerrank-app
```

### 2. Subir archivos

```bash
gsutil -m rsync -r -x "config.js|node_modules" . gs://burgerrank-app
```

### 3. Configurar dominio custom (opcional)

```bash
# Con Cloud Load Balancing + CDN
gcloud compute backend-buckets create burgerrank-backend \
  --gcs-bucket-name=burgerrank-app \
  --enable-cdn

# Configurar certificado SSL managed
gcloud compute ssl-certificates create burgerrank-cert \
  --domains=burgerrank.tudominio.com
```

### 4. Actualizar OAuth origins

En Google Cloud Console → Credentials → OAuth Client:
```
https://burgerrank.tudominio.com
```

Y actualizar las restricciones de la API Key con el nuevo dominio.

### Diferencias vs GitHub Pages

| | GitHub Pages | Google Cloud Storage |
|--|--|--|
| Costo | Gratis | ~$0.02/GB/mes |
| CDN | Global (Fastly) | Global (Google CDN) |
| Custom domain | ✅ | ✅ |
| HTTPS | ✅ | ✅ (con LB) |
| Deploy | `git push` | `gsutil rsync` |
| SLA | Sin SLA | 99.9% |

---

## Estructura de archivos

```
burgerrank/
├── index.html              ← SPA principal
├── share.html              ← Vista pública compartible (sin auth)
├── manifest.json           ← PWA manifest
├── sw.js                   ← Service Worker (cache-first + network-first)
├── config.js               ← ⚠️ Excluido del repo (ver config.example.js)
├── config.example.js       ← Template de configuración
├── css/
│   └── styles.css          ← Estilos custom (complemento a Tailwind)
├── js/
│   ├── app.js              ← Entry point, router SPA, módulos AddLocal y Profile
│   ├── auth.js             ← Google Sign-In + verificación whitelist
│   ├── sheets.js           ← Wrapper CRUD de Sheets API v4
│   ├── maps.js             ← Parser de URLs de Google Maps
│   ├── home.js             ← Vista de ranking (locales y hamburguesas)
│   ├── degustacion.js      ← Formulario multi-step de carga
│   └── share.js            ← Vista pública compartible
├── icons/
│   ├── icon-192.png        ← Ícono PWA (generar con generate-icons.html)
│   ├── icon-512.png        ← Ícono PWA splash
│   └── generate-icons.html ← Helper para generar los PNGs
└── README.md
```

---

## Casos de uso

| CU | Descripción |
|----|-------------|
| CU-01 | Importar local via URL de Google Maps |
| CU-02 | Cargar degustación (local → hamburguesa → Top N + comentario) |
| CU-03 | Home con Top Hamburgueserías y Top Hamburguesas |
| CU-04 | Compartir Top 5 via Web Share API / link |

---

## Limitaciones conocidas

- **Rate limit de Sheets API:** 100 requests / 100 segundos por usuario. Con uso normal del grupo no debería ser un problema.
- **Sin transacciones:** escrituras concurrentes simultáneas pueden generar inconsistencias mínimas (muy poco probable en un grupo pequeño).
- **URLs cortas de Maps** (`goo.gl/maps`, `maps.app.goo.gl`): no se pueden expandir desde el browser por CORS. El usuario debe ingresar datos manualmente.
- **Fotos de locales via Places API:** bloqueado por CORS desde browser. Se puede solucionar con un Cloud Function proxy si se quiere en el futuro.
- **Share.html sin red:** funciona offline (datos en URL hash). La app principal requiere red para sincronizar con Sheets.

---

## Seguridad

- El **Client ID** y **API Key** son públicos por diseño (van en el JS del cliente). La seguridad real está en:
  1. Los permisos del Google Sheet (solo el owner tiene acceso de edición vía OAuth)
  2. La whitelist de usuarios en el tab `users`
  3. Las restricciones de la API Key (dominios autorizados)
- **Nunca** commitear `config.js` al repositorio.
- El token de Google se valida por Google server-side; nosotros solo leemos el email del claim.
