// src/middleware/requireAdmin.js
//
// Protege las rutas de métricas (ver + exportar) para que solo entren
// los usuarios marcados como admin en la base.
//
// Uso en tus rutas de métricas (ej. src/routes/metricas.js):
//
//   import { requireAdmin } from '../middleware/requireAdmin.js';
//   router.get('/operadores', requireAdmin, async (req, res) => {...});
//   router.get('/despachos',  requireAdmin, async (req, res) => {...});
//   router.get('/export',     requireAdmin, async (req, res) => {...});
//
// El frontend tiene que mandar el usuarioId logueado, por ejemplo como
// header (más simple para este prototipo, sin sesiones todavía):
//
//   fetch('/api/metricas/export', { headers: { 'x-usuario-id': USUARIO.id } })

import { pool } from '../db.js'; // <-- ajustá esta ruta si hace falta

export async function requireAdmin(req, res, next) {
  const usuarioId = req.header('x-usuario-id');
  if (!usuarioId) {
    return res.status(401).json({ error: 'Falta identificar al usuario' });
  }

  const r = await pool.query('SELECT admin FROM usuarios WHERE id = $1', [usuarioId]);
  if (!r.rows.length || !r.rows[0].admin) {
    return res.status(403).json({ error: 'No tenés permiso para ver las métricas' });
  }

  next();
}
