function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = JSON.parse(e.postData.contents);
  var tipo = data.tipo;

  if (tipo === 'registro') {
    // NO TOCADO: sigue guardando el alta de cada mail exactamente igual que antes.
    var hoja = ss.getSheetByName('mail registrados');
    hoja.appendRow([data.mail, data.admin || false]);

  } else if (tipo === 'metrica') {
    var hoja = ss.getSheetByName('metricas');
    hoja.appendRow([
      data.operador || '',
      data.mail || '',
      data.planilla || '',
      data.transportista || '',
      data.guias || '',
      data.bultos || '',
      data.tiempo || '',
      data.fecha || new Date(),
      data.noAsignados || 0,
      data.bultoSobrante || 0,
      data.eliminadas || 0,
      data.incidencias || ''
    ]);
    actualizarResumen(ss);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Recalcula la pestaña "resumen" (por operador) a partir de TODAS las filas
// que hay hasta ahora en "metricas". Se llama sola cada vez que llega un
// despacho nuevo, así queda siempre al día sin que nadie tenga que
// descargar ni tocar nada a mano.
function actualizarResumen(ss) {
  var metricas = ss.getSheetByName('metricas');
  var resumen = ss.getSheetByName('resumen');
  if (!resumen) return; // si todavía no creaste la pestaña, no rompe nada

  var filas = metricas.getDataRange().getValues();
  filas.shift(); // saca el encabezado

  var agg = {};
  filas.forEach(function (f) {
    var operador = f[0], mail = f[1], bultos = Number(f[5]) || 0,
        tiempo = Number(f[6]) || 0, noAsig = Number(f[8]) || 0,
        sobra = Number(f[9]) || 0, elim = Number(f[10]) || 0;
    if (!operador) return;
    if (!agg[operador]) {
      agg[operador] = { mail: mail, planillas: 0, bultos: 0, tiempo: 0, noAsig: 0, sobra: 0, elim: 0 };
    }
    var a = agg[operador];
    a.planillas++; a.bultos += bultos; a.tiempo += tiempo;
    a.noAsig += noAsig; a.sobra += sobra; a.elim += elim;
  });

  resumen.clearContents();
  resumen.appendRow(['Operador', 'Mail', 'Planillas', 'Bultos', 'Tiempo total (seg)', 'Prom/planilla (seg)', 'No asignados', 'Bultos sobrantes', 'Guías eliminadas']);
  Object.keys(agg).forEach(function (op) {
    var a = agg[op];
    resumen.appendRow([op, a.mail, a.planillas, a.bultos, a.tiempo, Math.round(a.tiempo / a.planillas), a.noAsig, a.sobra, a.elim]);
  });
}

function doGet(e) {
  return ContentService.createTextOutput('FIXY endpoint activo');
}
