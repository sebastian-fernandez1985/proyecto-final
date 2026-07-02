// =====================================================================
//  ADAPTADOR PRESIS
//  =====================================================================
//  >>> ESTE ES EL ÚNICO ARCHIVO QUE TOCÁS CON LA DOCUMENTACIÓN DE PRESIS <<<
//
//  Tenés que completar 3 cosas, todas marcadas con  *** COMPLETAR ***:
//    1) La URL del endpoint que devuelve una planilla.
//    2) El esquema de autenticación (Bearer / API-Key / Basic).
//    3) El mapeo de campos: cómo se llama cada dato en el JSON de Presis.
//
//  El resto del backend ya consume el formato NORMALIZADO que devuelve
//  este archivo, así que cuando esto quede bien, no tocás nada más.
// =====================================================================

const PRESIS_BASE  = process.env.PRESIS_BASE_URL; // *** COMPLETAR en .env *** URL base de la API de Presis
const PRESIS_TOKEN = process.env.PRESIS_TOKEN;    // *** COMPLETAR en .env *** token / credencial

/**
 * Trae una planilla de Presis y la devuelve NORMALIZADA.
 * Lanza un error con .code = 'NO_EXISTE' | 'YA_DESPACHADA' | 'ERROR_PRESIS'.
 */
export async function obtenerPlanillaPresis(numero) {
  // -------------------------------------------------------------------
  // 1) ENDPOINT  *** COMPLETAR con la doc de Presis ***
  //    Reemplazá la ruta por la real. Ejemplos posibles:
  //      `${PRESIS_BASE}/api/v1/planillas/${numero}`
  //      `${PRESIS_BASE}/hojaderuta?nro=${numero}`
  // -------------------------------------------------------------------
  const url = `${PRESIS_BASE}/REEMPLAZAR/${encodeURIComponent(numero)}`; // <<< RUTA EXACTA DE PRESIS

  // -------------------------------------------------------------------
  // 2) AUTENTICACIÓN  *** COMPLETAR según la doc ***
  //    Dejá SOLO el header que use Presis y borrá los otros.
  // -------------------------------------------------------------------
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${PRESIS_TOKEN}`,   // <<< si usa Bearer
      // 'X-API-Key': PRESIS_TOKEN,                 // <<< si usa API-Key, usá este y borrá el de arriba
      // 'Authorization': 'Basic ' + Buffer.from(`usuario:${PRESIS_TOKEN}`).toString('base64'), // <<< si usa Basic
    },
  });

  if (res.status === 404) { const e = new Error('Planilla inexistente'); e.code = 'NO_EXISTE'; throw e; }
  if (!res.ok)            { const e = new Error('Error Presis ' + res.status); e.code = 'ERROR_PRESIS'; throw e; }

  const raw = await res.json();
  return mapearPlanilla(raw);
}

// =====================================================================
// 3) MAPEO DE CAMPOS  *** COMPLETAR con los nombres reales del JSON ***
//    Cambiá cada  raw.NOMBRE_EN_PRESIS  por el campo que figure en la doc.
//    A la izquierda están los nombres que usa FIXY (NO los cambies).
// =====================================================================
function mapearPlanilla(raw) {
  return {
    // ---- Datos de la planilla / hoja de ruta ----
    presisId:              raw.NOMBRE_EN_PRESIS,   // <<< id de la planilla en Presis (string/num)
    numeroPlanilla:        raw.NOMBRE_EN_PRESIS,   // <<< número visible de la planilla
    zona:                  raw.NOMBRE_EN_PRESIS,   // <<< zona de la hoja de ruta
    fecha:                 raw.NOMBRE_EN_PRESIS,   // <<< fecha (la guardamos como viene)
    estado:                raw.NOMBRE_EN_PRESIS,   // <<< estado en Presis (para detectar "ya despachada")
    usuario:               raw.NOMBRE_EN_PRESIS,   // <<< (opcional) usuario/responsable, si Presis lo manda

    // ---- Transportista ----
    transportistaPresisId: raw.NOMBRE_EN_PRESIS,   // <<< id del transportista en Presis
    transportista:         raw.NOMBRE_EN_PRESIS,   // <<< nombre del transportista a mostrar

    // ---- Guías de la planilla ----
    //  raw.NOMBRE_DEL_ARRAY_DE_GUIAS  es la lista de guías dentro del JSON.
    guias: (raw.NOMBRE_DEL_ARRAY_DE_GUIAS || []).map((g) => ({
      numero:    g.NOMBRE_EN_PRESIS,   // <<< número de guía (LO QUE LEE EL ESCÁNER)
      presisId:  g.NOMBRE_EN_PRESIS,   // <<< (opcional) id interno de la guía en Presis
      esperados: g.NOMBRE_EN_PRESIS,   // <<< CANTIDAD DE BULTOS  ***CRÍTICO PARA EL MODELO A***
      zona:      g.NOMBRE_EN_PRESIS,   // <<< (opcional) zona de la guía
    })),
  };
}

// ---------------------------------------------------------------------
// Detecta si una planilla ya está despachada según el estado de Presis.
// *** COMPLETAR con los valores reales que use Presis para "despachada" ***
// ---------------------------------------------------------------------
export function estaDespachadaEnPresis(estado) {
  const ESTADOS_DESPACHADA = ['DESPACHADA', 'CERRADA']; // <<< AJUSTAR a los valores de Presis
  return ESTADOS_DESPACHADA.includes(String(estado || '').toUpperCase());
}
