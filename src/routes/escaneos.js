import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// POST /api/escaneos
// body: { hojaRutaId, numeroGuia, usuarioId }
// Valida el Modelo A en el servidor (fuente de verdad) y registra el bulto.
router.post('/', async (req, res) => {
  const { hojaRutaId, numeroGuia, usuarioId } = req.body;
  if (!hojaRutaId || !numeroGuia || !usuarioId) {
    return res.status(400).json({ error: 'FALTAN_DATOS' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloqueamos la fila de la guía para serializar escaneos concurrentes
    // de la misma guía (evita pasarse del tope por condición de carrera).
    const g = await client.query(
      `SELECT id, bultos_esperados
         FROM guia
        WHERE hoja_ruta_id = $1 AND numero_guia = $2
        FOR UPDATE`,
      [hojaRutaId, numeroGuia]
    );

    // 1) La guía NO pertenece a esta hoja de ruta -> incidencia
    if (g.rows.length === 0) {
      await client.query(
        `INSERT INTO incidencia (hoja_ruta_id, usuario_id, tipo, codigo_escaneado)
         VALUES ($1,$2,'guia_no_asignada',$3)`,
        [hojaRutaId, usuarioId, numeroGuia]
      );
      await client.query('COMMIT');
      return res.json({ ok: false, tipo: 'guia_no_asignada' });
    }

    const guia = g.rows[0];
    const c = await client.query('SELECT COUNT(*)::int AS n FROM escaneo WHERE guia_id = $1', [guia.id]);
    const actuales = c.rows[0].n;

    // 2) La guía ya está completa -> bulto sobrante (incidencia)
    if (actuales >= guia.bultos_esperados) {
      await client.query(
        `INSERT INTO incidencia (hoja_ruta_id, guia_id, usuario_id, tipo, codigo_escaneado)
         VALUES ($1,$2,$3,'bulto_sobrante',$4)`,
        [hojaRutaId, guia.id, usuarioId, numeroGuia]
      );
      await client.query('COMMIT');
      return res.json({ ok: false, tipo: 'bulto_sobrante', bultos_controlados: actuales, bultos_esperados: guia.bultos_esperados });
    }

    // 3) Bulto válido -> se registra un escaneo (Modelo A: una fila por bulto)
    // Marca el inicio del control en el primer escaneo (para medir duración).
    await client.query(
      `UPDATE hoja_ruta SET control_iniciado_en = COALESCE(control_iniciado_en, now()) WHERE id = $1`,
      [hojaRutaId]
    );
    const sec = actuales + 1;
    await client.query(
      `INSERT INTO escaneo (guia_id, hoja_ruta_id, usuario_id, secuencia_bulto)
       VALUES ($1,$2,$3,$4)`,
      [guia.id, hojaRutaId, usuarioId, sec]
    );
    await client.query(
      `INSERT INTO auditoria (usuario_id, accion, numero_guia, estado_nuevo, observaciones)
       VALUES ($1,'escaneo_valido',$2,$3,$4)`,
      [usuarioId, numeroGuia, `bulto ${sec}/${guia.bultos_esperados}`, null]
    );

    await client.query('COMMIT');
    return res.json({
      ok: true,
      tipo: 'valido',
      secuencia: sec,
      completa: sec >= guia.bultos_esperados,
      bultos_controlados: sec,
      bultos_esperados: guia.bultos_esperados,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error en escaneo:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  } finally {
    client.release();
  }
});

export default router;
