import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/metricas/operadores
// Devuelve, por operador: planillas despachadas, bultos, tiempo total,
// promedio por planilla y bultos por minuto. Sale de la vista v_metricas_operador.
router.get('/operadores', async (_req, res) => {
  try {
    const q = await pool.query(
      `SELECT usuario_id, nombre, planillas_despachadas, bultos_despachados,
              tiempo_total_seg, prom_seg_por_planilla
         FROM v_metricas_operador
        ORDER BY bultos_despachados DESC`
    );
    return res.json(q.rows);
  } catch (e) {
    console.error('Error en métricas:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  }
});

// GET /api/metricas/despachos?fecha=AAAA-MM-DD&usuarioId=
// Detalle: qué planilla despachó cada operador, con fecha y tiempo.
// Permite saber quién despachó un número de planilla y filtrar por día.
router.get('/despachos', async (req, res) => {
  const { fecha, usuarioId } = req.query;
  try {
    const q = await pool.query(
      `SELECT u.nombre AS operador, h.presis_id AS planilla, h.fecha,
              t.nombre AS transportista, d.total_guias AS guias,
              d.total_bultos AS bultos, d.duracion_segundos, d.confirmado_en
         FROM despacho d
         JOIN hoja_ruta h    ON h.id = d.hoja_ruta_id
         JOIN transportista t ON t.id = h.transportista_id
         JOIN usuario u      ON u.id = d.usuario_id
        WHERE ($1::date   IS NULL OR h.fecha = $1::date)
          AND ($2::bigint IS NULL OR d.usuario_id = $2::bigint)
        ORDER BY u.nombre, h.fecha`,
      [fecha || null, usuarioId || null]
    );
    return res.json(q.rows);
  } catch (e) {
    console.error('Error en detalle de despachos:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  }
});

export default router;
