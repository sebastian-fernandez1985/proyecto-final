import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// POST /api/guias/quitar
// body: { hojaRutaId, numeroGuia, usuarioId, motivo }
// Marca la guía como faltante (removida). Deja de contar para el cierre.
// Los bultos escaneados de esa guía se descartan (se borran sus escaneos).
router.post('/quitar', async (req, res) => {
  const { hojaRutaId, numeroGuia, usuarioId, motivo } = req.body;
  if (!hojaRutaId || !numeroGuia || !usuarioId) {
    return res.status(400).json({ error: 'FALTAN_DATOS' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const g = await client.query(
      `SELECT id FROM guia WHERE hoja_ruta_id = $1 AND numero_guia = $2 FOR UPDATE`,
      [hojaRutaId, numeroGuia]
    );
    if (g.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'GUIA_INEXISTENTE' }); }
    const guiaId = g.rows[0].id;

    // Descartar escaneos previos de esa guía y marcarla como removida
    await client.query('DELETE FROM escaneo WHERE guia_id = $1', [guiaId]);
    await client.query(
      `UPDATE guia SET removida = TRUE, motivo_removida = $2 WHERE id = $1`,
      [guiaId, motivo || 'Faltante']
    );

    // Registrar incidencia + auditoría
    await client.query(
      `INSERT INTO incidencia (hoja_ruta_id, guia_id, usuario_id, tipo, codigo_escaneado, detalle)
       VALUES ($1,$2,$3,'guia_faltante',$4,$5)`,
      [hojaRutaId, guiaId, usuarioId, numeroGuia, motivo || 'Faltante']
    );
    await client.query(
      `INSERT INTO auditoria (usuario_id, accion, numero_guia, observaciones)
       VALUES ($1,'quitar_guia',$2,$3)`,
      [usuarioId, numeroGuia, motivo || 'Faltante']
    );

    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error quitando guía:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  } finally {
    client.release();
  }
});

export default router;
