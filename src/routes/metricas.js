import { Router } from 'express';
import * as XLSX from 'xlsx';
import { pool } from '../db.js';

const router = Router();

// Lunes de la semana actual (para arrancar limpio cada semana sin borrar nada).
function inicioSemanaISO() {
  const x = new Date();
  const dia = (x.getDay() + 6) % 7; // 0 = lunes
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - dia);
  return x.toISOString().slice(0, 10);
}

// Resumen por operador. Por defecto: SEMANA ACTUAL (desde el lunes).
// GET /api/metricas/operadores?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
router.get('/operadores', async (req, res) => {
  const desde = req.query.desde || inicioSemanaISO();
  const hasta = req.query.hasta || null;
  try {
    const q = await pool.query(
      `SELECT u.id AS usuario_id, u.nombre,
              COUNT(d.id)                          AS planillas_despachadas,
              COALESCE(SUM(d.total_bultos),0)      AS bultos_despachados,
              COALESCE(SUM(d.duracion_segundos),0) AS tiempo_total_seg,
              ROUND(AVG(d.duracion_segundos))      AS prom_seg_por_planilla
         FROM usuario u
         LEFT JOIN despacho d ON d.usuario_id = u.id
              AND ($1::date IS NULL OR d.confirmado_en::date >= $1::date)
              AND ($2::date IS NULL OR d.confirmado_en::date <= $2::date)
        GROUP BY u.id, u.nombre
        ORDER BY bultos_despachados DESC`,
      [desde, hasta]
    );
    return res.json({ desde, hasta, operadores: q.rows });
  } catch (e) {
    console.error('Error en métricas:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  }
});

// Detalle: qué planilla despachó cada operador, con fecha y tiempo.
// GET /api/metricas/despachos?desde=&hasta=&usuarioId=
router.get('/despachos', async (req, res) => {
  const desde = req.query.desde || inicioSemanaISO();
  const hasta = req.query.hasta || null;
  const usuarioId = req.query.usuarioId || null;
  try {
    const rows = await consultarDetalle(desde, hasta, usuarioId);
    return res.json({ desde, hasta, despachos: rows });
  } catch (e) {
    console.error('Error en detalle:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  }
});

// Exportar a Excel (semana actual por defecto). Dos hojas: Resumen y Detalle.
// GET /api/metricas/export?desde=&hasta=
router.get('/export', async (req, res) => {
  const desde = req.query.desde || inicioSemanaISO();
  const hasta = req.query.hasta || null;
  try {
    const detalle = await consultarDetalle(desde, hasta, null);

    const agg = new Map();
    for (const d of detalle) {
      if (!agg.has(d.operador)) agg.set(d.operador, { Operador: d.operador, Planillas: 0, Bultos: 0, _t: 0 });
      const a = agg.get(d.operador); a.Planillas++; a.Bultos += d.bultos; a._t += (d.duracion_segundos || 0);
    }
    const resumen = [...agg.values()].map((a) => ({
      Operador: a.Operador, Planillas: a.Planillas, Bultos: a.Bultos,
      'Tiempo total': fmtDur(a._t), 'Prom/planilla': fmtDur(a.Planillas ? Math.round(a._t / a.Planillas) : 0),
    }));
    const filasDetalle = detalle.map((d) => ({
      Operador: d.operador, Planilla: d.planilla, Fecha: d.fecha,
      Transportista: d.transportista, Guias: d.guias, Bultos: d.bultos, Tiempo: fmtDur(d.duracion_segundos || 0),
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasDetalle), 'Detalle');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="metricas_${desde}.xlsx"`);
    return res.send(buf);
  } catch (e) {
    console.error('Error exportando métricas:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  }
});

async function consultarDetalle(desde, hasta, usuarioId) {
  const q = await pool.query(
    `SELECT u.nombre AS operador, h.presis_id AS planilla, h.fecha,
            t.nombre AS transportista, d.total_guias AS guias,
            d.total_bultos AS bultos, d.duracion_segundos, d.confirmado_en
       FROM despacho d
       JOIN hoja_ruta h     ON h.id = d.hoja_ruta_id
       JOIN transportista t ON t.id = h.transportista_id
       JOIN usuario u       ON u.id = d.usuario_id
      WHERE ($1::date   IS NULL OR d.confirmado_en::date >= $1::date)
        AND ($2::date   IS NULL OR d.confirmado_en::date <= $2::date)
        AND ($3::bigint IS NULL OR d.usuario_id = $3::bigint)
      ORDER BY u.nombre, h.fecha`,
    [desde, hasta, usuarioId]
  );
  return q.rows;
}

function fmtDur(seg) {
  const m = Math.floor(seg / 60), s = seg % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default router;
