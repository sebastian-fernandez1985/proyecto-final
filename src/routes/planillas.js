import { Router } from 'express';
import { pool } from '../db.js';
import { obtenerPlanillaPresis, estaDespachadaEnPresis } from '../presis.js';

const router = Router();

// GET /api/planillas/:numero
// 1) trae la planilla de Presis  2) la cachea en la base  3) la devuelve normalizada
router.get('/:numero', async (req, res) => {
  const { numero } = req.params;
  try {
    const planilla = await obtenerPlanillaPresis(numero);

    if (estaDespachadaEnPresis(planilla.estado)) {
      return res.status(409).json({ error: 'YA_DESPACHADA' });
    }

    const normalizada = await upsertPlanilla(planilla);
    return res.json(normalizada);
  } catch (err) {
    if (err.code === 'NO_EXISTE') return res.status(404).json({ error: 'NO_EXISTE' });
    console.error('Error trayendo planilla:', err);
    return res.status(502).json({ error: 'ERROR_PRESIS' });
  }
});

// Guarda/actualiza transportista + hoja de ruta + guías en la base local.
// Es idempotente: traer la misma planilla de nuevo actualiza, no duplica.
async function upsertPlanilla(p) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- transportista (por presis_id; si no hay, por nombre) ---
    const t = await client.query(
      `INSERT INTO transportista (presis_id, nombre)
       VALUES ($1, $2)
       ON CONFLICT (presis_id) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id`,
      [p.transportistaPresisId ?? `tmp-${p.transportista}`, p.transportista]
    );
    const transportistaId = t.rows[0].id;

    // --- hoja de ruta (por presis_id) ---
    const totalGuias = p.guias.length;
    const totalBultos = p.guias.reduce((s, g) => s + Number(g.esperados || 0), 0);
    const h = await client.query(
      `INSERT INTO hoja_ruta
         (presis_id, transportista_id, fecha, zona, estado,
          total_guias_esperadas, total_bultos_esperados, sincronizada_en)
       VALUES ($1,$2,$3,$4,'en_control',$5,$6, now())
       ON CONFLICT (presis_id) DO UPDATE SET
          transportista_id = EXCLUDED.transportista_id,
          zona = EXCLUDED.zona,
          total_guias_esperadas = EXCLUDED.total_guias_esperadas,
          total_bultos_esperados = EXCLUDED.total_bultos_esperados,
          sincronizada_en = now()
       RETURNING id`,
      [p.presisId, transportistaId, p.fecha, p.zona, totalGuias, totalBultos]
    );
    const hojaRutaId = h.rows[0].id;

    // --- guías (por hoja_ruta_id + numero_guia) ---
    for (const g of p.guias) {
      await client.query(
        `INSERT INTO guia (hoja_ruta_id, numero_guia, presis_id, bultos_esperados, zona)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (hoja_ruta_id, numero_guia) DO UPDATE SET
            bultos_esperados = EXCLUDED.bultos_esperados,
            zona = EXCLUDED.zona`,
        [hojaRutaId, g.numero, g.presisId ?? null, g.esperados, g.zona ?? null]
      );
    }

    await client.query('COMMIT');

    // Respuesta normalizada que consume el frontend
    return {
      hojaRutaId,
      hojaId: p.numeroPlanilla ?? String(p.presisId),
      transportista: p.transportista,
      zona: p.zona,
      fecha: p.fecha,
      usuario: p.usuario ?? null,
      guias: p.guias.map((g) => ({ numero: String(g.numero), esperados: Number(g.esperados), zona: g.zona })),
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export default router;
