import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { pool } from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// =====================================================================
//  MAPEO DE COLUMNAS DEL EXCEL  (mismo criterio que el frontend)
//  Si tu Excel usa otros nombres, agregá los alias acá. Nada más.
// =====================================================================
const COLUMNAS = {
  planilla:      ['planilla', 'nro planilla', 'numero planilla', 'planilla nro', 'hoja de ruta'],
  fecha:         ['fecha'],
  transportista: ['transportista', 'chofer', 'movil', 'móvil'],
  zona:          ['zona'],
  guia:          ['guia', 'guía', 'numero guia', 'nro guia', 'tracking'],
  // 'bultos reales' PRIMERO -> toma la columna F de Presis. Para usar la col E
  // ("BULTOS"), poné 'bultos' primero.
  bultos:        ['bultos reales', 'bulto real', 'bultos real', 'bultos', 'cantidad bultos', 'cant bultos', 'cantidad de bultos'],
  zona_guia:     ['zona_guia', 'zona guia', 'localidad'],
};

// Saca planilla y fecha del nombre del archivo (formato Presis).
// "30_06_2026_570102026-06-30.xls" -> { planilla:'57010', fecha:'2026-06-30' }
function metaDeNombre(fn) {
  const base = String(fn || '').replace(/\.[^.]+$/, '');
  const m = base.match(/(\d{4}-\d{2}-\d{2})$/);
  const fecha = m ? m[1] : null;
  const ult = base.split('_').pop() || base;
  const planilla = fecha ? ult.slice(0, -10) : ult;
  return { planilla: planilla || base, fecha };
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
function indiceDe(headers, alias) {
  const h = headers.map(norm);
  for (const a of alias) { const i = h.indexOf(norm(a)); if (i >= 0) return i; }
  return -1;
}

// POST /api/planillas/importar   (multipart/form-data, campo "archivo")
// Parsea el Excel, agrupa por planilla y hace upsert de todo en la base.
router.post('/importar', upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'FALTA_ARCHIVO' });

  let aoa;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.SheetNames.includes('Planillas') ? 'Planillas' : wb.SheetNames[0];
    aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
  } catch {
    return res.status(400).json({ error: 'EXCEL_INVALIDO' });
  }
  if (!aoa.length) return res.status(400).json({ error: 'EXCEL_VACIO' });

  const headers = aoa[0];
  const idx = {};
  for (const campo of Object.keys(COLUMNAS)) idx[campo] = indiceDe(headers, COLUMNAS[campo]);

  if (idx.guia < 0 || idx.bultos < 0) {
    return res.status(400).json({ error: 'FALTAN_COLUMNAS', columnas: ['guia', 'bultos'] });
  }

  const errores = [];
  let planillas = [];

  if (idx.planilla >= 0) {
    // ---- Formato A: varias planillas agrupadas por columna 'planilla' ----
    const mapa = new Map();
    for (let r = 1; r < aoa.length; r++) {
      const f = aoa[r];
      if (!f || f.every((c) => String(c).trim() === '')) continue;
      const nroPl = String(f[idx.planilla]).trim();
      const guia = String(f[idx.guia]).trim();
      const bultos = parseInt(String(f[idx.bultos]).trim(), 10);
      if (!nroPl) { errores.push(`Fila ${r + 1}: sin planilla.`); continue; }
      if (!guia) { errores.push(`Fila ${r + 1}: sin guía.`); continue; }
      if (!Number.isInteger(bultos) || bultos < 1) { errores.push(`Fila ${r + 1} (guía ${guia}): bultos inválido.`); continue; }
      if (!mapa.has(nroPl)) {
        mapa.set(nroPl, {
          presisId: nroPl, numeroPlanilla: nroPl,
          transportista: idx.transportista >= 0 ? String(f[idx.transportista]).trim() : (req.body.transportista || 'Sin asignar'),
          zona: idx.zona >= 0 ? String(f[idx.zona]).trim() : null,
          fecha: idx.fecha >= 0 ? String(f[idx.fecha]).trim() : null,
          guias: [],
        });
      }
      mapa.get(nroPl).guias.push({
        numero: guia, esperados: bultos,
        zona: idx.zona_guia >= 0 && f[idx.zona_guia] ? String(f[idx.zona_guia]).trim() : null,
      });
    }
    planillas = [...mapa.values()];
  } else {
    // ---- Formato B (Presis): un archivo = una planilla; meta del nombre ----
    const meta = metaDeNombre(req.file.originalname);
    const guias = [];
    for (let r = 1; r < aoa.length; r++) {
      const f = aoa[r];
      if (!f || f.every((c) => String(c).trim() === '')) continue;
      const guia = String(f[idx.guia]).trim();
      if (!/^\d/.test(guia)) continue; // saltea totales / filas no-guía
      const bultos = parseInt(String(f[idx.bultos]).trim(), 10);
      if (!Number.isInteger(bultos) || bultos < 1) { errores.push(`Fila ${r + 1} (guía ${guia}): bultos inválido.`); continue; }
      guias.push({ numero: guia, esperados: bultos, zona: idx.zona_guia >= 0 && f[idx.zona_guia] ? String(f[idx.zona_guia]).trim() : null });
    }
    if (guias.length) {
      planillas = [{
        presisId: meta.planilla, numeroPlanilla: meta.planilla,
        transportista: req.body.transportista || 'Sin asignar', // <<< el transportista NO viene en el Excel
        zona: null, fecha: meta.fecha, guias,
      }];
    }
  }
  if (!planillas.length) return res.status(400).json({ error: 'SIN_FILAS_VALIDAS', detalle: errores });

  try {
    for (const p of planillas) await upsertPlanilla(p);
    return res.json({ importadas: planillas.length, errores });
  } catch (e) {
    console.error('Error importando:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  }
});

// GET /api/planillas?fecha=AAAA-MM-DD   -> lista para la pantalla de selección
router.get('/', async (req, res) => {
  const { fecha } = req.query;
  try {
    const q = await pool.query(
      `SELECT h.id AS "hojaRutaId", h.presis_id AS "hojaId", t.nombre AS transportista,
              h.zona, h.fecha, h.estado,
              h.total_guias_esperadas AS guias, h.total_bultos_esperados AS bultos
         FROM hoja_ruta h
         JOIN transportista t ON t.id = h.transportista_id
        WHERE ($1::date IS NULL OR h.fecha = $1::date)
        ORDER BY h.fecha DESC, t.nombre`,
      [fecha || null]
    );
    return res.json(q.rows);
  } catch (e) {
    console.error('Error listando planillas:', e);
    return res.status(500).json({ error: 'ERROR_INTERNO' });
  }
});

// Upsert idempotente: transportista + hoja_ruta + guias.
async function upsertPlanilla(p) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await client.query(
      `INSERT INTO transportista (presis_id, nombre) VALUES ($1,$2)
       ON CONFLICT (presis_id) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`,
      [`tmp-${p.transportista}`, p.transportista]
    );
    const transportistaId = t.rows[0].id;
    const totalGuias = p.guias.length;
    const totalBultos = p.guias.reduce((s, g) => s + Number(g.esperados || 0), 0);
    const h = await client.query(
      `INSERT INTO hoja_ruta (presis_id, transportista_id, fecha, zona, estado,
              total_guias_esperadas, total_bultos_esperados, sincronizada_en)
       VALUES ($1,$2,$3,$4,'en_control',$5,$6, now())
       ON CONFLICT (presis_id) DO UPDATE SET
              transportista_id=EXCLUDED.transportista_id, zona=EXCLUDED.zona,
              total_guias_esperadas=EXCLUDED.total_guias_esperadas,
              total_bultos_esperados=EXCLUDED.total_bultos_esperados, sincronizada_en=now()
       RETURNING id`,
      [p.presisId, transportistaId, p.fecha, p.zona, totalGuias, totalBultos]
    );
    const hojaRutaId = h.rows[0].id;
    for (const g of p.guias) {
      await client.query(
        `INSERT INTO guia (hoja_ruta_id, numero_guia, bultos_esperados, zona)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (hoja_ruta_id, numero_guia) DO UPDATE SET
              bultos_esperados=EXCLUDED.bultos_esperados, zona=EXCLUDED.zona`,
        [hojaRutaId, g.numero, g.esperados, g.zona]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export default router;
