# Slicer3D Server

Servidor de slicing para el Cotizador 3D Pro. Recibe archivos STL y devuelve gramos de filamento y tiempo de impresión usando OrcaSlicer CLI.

## Deploy en Render

### 1. Subir a GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/slicer3d/slicer3d-server.git
git push -u origin main
```

### 2. Crear servicio en Render

1. render.com → New → Web Service
2. Connect GitHub → selecciona `slicer3d-server`
3. Configuración:
   - **Environment:** Docker
   - **Branch:** main
   - **Instance Type:** Free
4. Clic en **Create Web Service**
5. Espera ~5 minutos para el deploy

### 3. URL del servidor

Render te asigna una URL como:
```
https://slicer3d-server.onrender.com
```

Cópiala y pégala en el Cotizador 3D Pro → Admin → Tarifas → URL del servidor slicer.

## API

### POST /slice

Slicea un archivo STL y devuelve datos reales.

**Request:**
```
Content-Type: multipart/form-data
file: archivo.stl
profile: bambu_a1_mini (opcional, default)
```

**Response:**
```json
{
  "ok": true,
  "grams": 36.81,
  "time_min": 149,
  "filament_m": 12.15,
  "profile": "bambu_a1_mini"
}
```

### Perfiles disponibles

| Profile | Impresora |
|---|---|
| `bambu_a1_mini` | Bambu Lab A1 Mini |
| `ender3_se` | Ender 3 SE |
| `prusa_mk4` | Prusa MK4 |

## Desarrollo local

```bash
npm install
node server.js
```

Requiere OrcaSlicer instalado en el sistema.
