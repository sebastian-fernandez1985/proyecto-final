import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/usuarios  -> lista para la pantalla de login (sin el PIN)
router.get('/', async (_req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, nombre, rol FROM usuario WHERE activo = TRUE ORDER BY nombre`
    );
    return res.json(q.rows);
  } catch (e) {
    console.error('Error listando usuarios:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  }
});

// POST /api/usuarios/login  body: { usuarioId, pin }
// NOTA: para el prototipo se compara el PIN directo. En producción,
// reemplazar por verificación de hash (bcrypt/argon2) y token de sesión.
router.post('/login', async (req, res) => {
  const { usuarioId, pin } = req.body;
  if (!usuarioId || !pin) return res.status(400).json({ error: 'FALTAN_DATOS' });
  try {
    const q = await pool.query(
      `SELECT id, nombre, rol FROM usuario WHERE id = $1 AND pin = $2 AND activo = TRUE`,
      [usuarioId, String(pin)]
    );
    if (q.rows.length === 0) return res.status(401).json({ error: 'PIN_INVALIDO' });
    return res.json({ ok: true, usuario: q.rows[0] });
  } catch (e) {
    console.error('Error en login:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  }
});

export default router;
