# FIXY · Backend de Control de Despacho

Backend del Módulo 1 (Despacho). Trae planillas de **Presis**, valida el escaneo
de bultos (Modelo A) y confirma el despacho, disparando un webhook a **n8n**.

---

## ⚠️ DÓNDE MODIFICÁS CON LA DOCUMENTACIÓN DE PRESIS

Solo hay **dos lugares** para tocar. Todo lo demás ya está hecho.

### 1. `.env`  → credenciales
Copiá `.env.example` a `.env` y completá:
- `PRESIS_BASE_URL` — URL base de la API de Presis.
- `PRESIS_TOKEN` — el token / credencial.
- `DATABASE_URL` — tu PostgreSQL.
- `N8N_WEBHOOK_URL` — (opcional) webhook de n8n.

### 2. `src/presis.js`  → el adaptador (ÚNICO archivo con lógica de Presis)
Adentro hay tres cosas marcadas con `*** COMPLETAR ***` y `<<<`:
1. **El endpoint**: la línea `const url = ...` — poné la ruta real de Presis.
2. **La autenticación**: dejá el header que use Presis (Bearer / API-Key / Basic) y borrá los otros.
3. **El mapeo de campos**: en `mapearPlanilla()`, cambiá cada `raw.NOMBRE_EN_PRESIS`
   por el nombre real del campo en el JSON de Presis. El más importante es
   `esperados` (cantidad de bultos por guía): es el dato que hace funcionar todo el control.

Cuando esos dos archivos quedan bien, **el resto funciona solo**.

> **Importar por Excel:** si en vez de la API usás un Excel con las planillas del
> día, el endpoint `POST /api/planillas/importar` ya lo parsea. Los nombres de las
> columnas se mapean en `src/routes/importar.js` (objeto `COLUMNAS`); si tu Excel
> usa otros nombres, agregás el alias ahí y listo. El formato esperado está en
> `plantilla_planillas.xlsx`.

---

## Cómo correrlo

```bash
# 1. Base de datos
createdb fixy
psql fixy < db/schema.sql

# 2. Dependencias y arranque
npm install
cp .env.example .env      # y completá los valores
npm run dev
```

El backend queda en `http://localhost:3001`.

---

## Endpoints

| Método | Ruta                       | Qué hace                                                    |
|--------|----------------------------|------------------------------------------------------------|
| GET    | `/api/usuarios`            | Lista de operadores para la pantalla de login (sin PIN)    |
| POST   | `/api/usuarios/login`      | Valida `{usuarioId, pin}` e identifica al operador         |
| POST   | `/api/planillas/importar`  | Sube un Excel con las planillas del día (campo `archivo`). Parsea y cachea todo |
| GET    | `/api/planillas?fecha=`    | Lista las planillas (para la pantalla de selección)        |
| GET    | `/api/planillas/:numero`   | Trae UNA planilla de Presis por número, la cachea y la devuelve normalizada |
| POST   | `/api/escaneos`            | Registra un bulto. Valida el Modelo A. Marca el inicio del control |
| POST   | `/api/despachos`           | Confirma el despacho. Guarda quién, cuándo y cuánto tardó  |
| POST   | `/api/guias/quitar`        | Quita una guía faltante (no cuenta para el cierre). Body: `{hojaRutaId, numeroGuia, usuarioId, motivo}` |
| GET    | `/api/metricas/operadores?desde=&hasta=` | Resumen por operador (por defecto, semana actual) |
| GET    | `/api/metricas/despachos?desde=&hasta=` | Detalle: qué planilla despachó cada operador (por defecto, semana actual) |
| GET    | `/api/metricas/export?desde=&hasta=` | Descarga un Excel (Resumen + Detalle) de la semana |
| POST   | `/api/escaneos`          | Registra un bulto. Valida el Modelo A. Body: `{hojaRutaId, numeroGuia, usuarioId}` |
| POST   | `/api/despachos`         | Confirma el despacho (solo si no faltan bultos). Body: `{hojaRutaId, usuarioId}` |
| GET    | `/health`                | Chequeo de estado                                          |

Respuesta normalizada de `GET /api/planillas/:numero`:
```json
{
  "hojaRutaId": 12,
  "hojaId": "HR-2026-04821",
  "transportista": "Andreani · Móvil 142",
  "zona": "CABA Sur",
  "fecha": "2026-06-25",
  "usuario": null,
  "guias": [
    { "numero": "770012845", "esperados": 1, "zona": "Barracas" }
  ]
}
```

---

## Conectar el frontend (la pantalla de escaneo)

En `fixy_pantalla_escaneo.html`, dentro de la función `traerPlanillaDePresis(numero)`:
1. Descomentá el bloque de `fetch` real y borrá el mock (`PRESIS_MOCK`).
2. Apuntá la URL al backend, por ejemplo:
   ```js
   const r = await fetch(`http://localhost:3001/api/planillas/${numero}`);
   ```
Como el backend ya devuelve el mismo formato que usa la pantalla, no hay que tocar nada más.

---

## Notas de diseño

- **Usuarios / login**: el `schema.sql` siembra 6 operadores con PIN de prueba `1234`.
  El PIN está en texto plano SOLO para el prototipo: en producción reemplazá la
  columna `pin` por `password_hash` (bcrypt/argon2) y un token de sesión.
- **Métricas por operador**: cada despacho guarda `usuario_id`, `iniciado_en`,
  `confirmado_en` y `duracion_segundos`. El inicio se marca en el primer escaneo.
- **Semana limpia**: las métricas se consultan por SEMANA (por defecto desde el
  lunes), así cada semana arranca en cero SIN borrar el historial. Si además querés
  el borrado real de datos viejos, programá un job (cron o n8n) que corra los
  domingos; tené en cuenta que eso elimina la posibilidad de consultar semanas
  anteriores y la auditoría. Recomendado: dejar los datos y filtrar por semana.
- **Modelo A**: cada bulto físico es una fila en `escaneo`. No hay `UNIQUE` sobre
  (guía, código) porque el mismo número se repite por bulto. El tope se valida con
  un `SELECT ... FOR UPDATE` (serializa escaneos de la misma guía) y un trigger de
  red de seguridad en la base.
- **Conteos derivados**: los bultos controlados se calculan con las vistas
  `v_progreso_guia` / `v_progreso_hoja`. Nunca se guarda un contador suelto.
- **n8n** se dispara después del commit del despacho: si n8n falla, el despacho
  igual quedó confirmado.
