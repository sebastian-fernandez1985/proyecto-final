import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// POST /api/despachos
// body: { hojaRutaId, usuarioId }
// Confirma el despacho SOLO si no faltan bultos. Es transaccional.
router.post('/', async (req, res) => {
  const { hojaRutaId, usuarioId } = req.body;
  if (!hojaRutaId || !usuarioId) return res.status(400).json({ error: 'FALTAN_DATOS' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Totales derivados (la vista calcula bultos controlados vs esperados)
    const p = await client.query(
      `SELECT total_bultos_esperados, bultos_controlados, bultos_faltantes, guias_completas
         FROM v_progreso_hoja WHERE hoja_ruta_id = $1`,
      [hojaRutaId]
    );
    if (p.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'HOJA_INEXISTENTE' }); }

    const { total_bultos_esperados, bultos_controlados, bultos_faltantes, guias_completas } = p.rows[0];

    // GATE: no se puede cerrar con diferencia.
    if (bultos_faltantes !== 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'DIFERENCIA', bultos_faltantes });
    }

    // Inicio del control + duración (cuánto tardó el operador)
    const hr = await client.query('SELECT control_iniciado_en FROM hoja_ruta WHERE id=$1', [hojaRutaId]);
    const iniciadoEn = hr.rows[0]?.control_iniciado_en || null;

    // Registrar el despacho (quién, cuándo, cuánto tardó)
    const ins = await client.query(
      `INSERT INTO despacho (hoja_ruta_id, usuario_id, total_guias, total_bultos, iniciado_en, duracion_segundos)
       VALUES ($1,$2,$3,$4,$5,
               CASE WHEN $5::timestamptz IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (now() - $5::timestamptz))::int
                    ELSE NULL END)
       RETURNING duracion_segundos`,
      [hojaRutaId, usuarioId, guias_completas, bultos_controlados, iniciadoEn]
    );
    const duracionSeg = ins.rows[0].duracion_segundos;
    await client.query(`UPDATE hoja_ruta SET estado='despachada' WHERE id=$1`, [hojaRutaId]);
    await client.query(
      `INSERT INTO auditoria (usuario_id, accion, estado_anterior, estado_nuevo, observaciones)
       VALUES ($1,'confirmar_despacho','en_control','despachada',$2)`,
      [usuarioId, `${guias_completas} guías · ${bultos_controlados} bultos`]
    );

    await client.query('COMMIT');

    // n8n se dispara DESPUÉS del commit (fire-and-forget): si falla, el
    // despacho igual quedó confirmado. n8n se encarga de notificar/avisar a Presis.
    dispararWebhookN8n({
      evento: 'despacho_confirmado',
      hojaRutaId,
      usuarioId,
      total_guias: guias_completas,
      total_bultos: bultos_controlados,
      total_bultos_esperados,
      duracion_segundos: duracionSeg,
      fecha: new Date().toISOString(),
    });

    return res.json({ ok: true, total_guias: guias_completas, total_bultos: bultos_controlados, duracion_segundos: duracionSeg });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error confirmando despacho:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  } finally {
    client.release();
  }
});

// Notifica a n8n. No bloquea la respuesta al operador.
async function dispararWebhookN8n(payload) {
  if (!process.env.N8N_WEBHOOK_URL) return; // opcional
  try {
    await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Webhook n8n falló (el despacho ya quedó confirmado):', e.message);
  }
}

export default router;
