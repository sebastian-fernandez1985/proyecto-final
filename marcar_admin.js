// marcar_admin.js
//
// Uso (parado en la carpeta del backend, con el .env ya configurado):
//
//   node marcar_admin.js dar juan.perez@fixy.com.ar
//   node marcar_admin.js sacar juan.perez@fixy.com.ar
//
// "dar"   → lo convierte en admin (puede entrar a Métricas)
// "sacar" → le saca el admin
//
// Requiere que ya hayas corrido migracion_email_admin.sql contra tu base,
// y que el usuario ya se haya registrado entrando una vez con ese mail
// (si todavía no entró nunca, no va a existir en la tabla y el script
// te va a avisar).

import 'dotenv/config';
import pg from 'pg';

const [, , accion, email] = process.argv;

if (!accion || !email || !['dar', 'sacar'].includes(accion)) {
  console.log('Uso: node marcar_admin.js dar|sacar mail@fixy.com.ar');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const valor = accion === 'dar';

const r = await pool.query(
  'UPDATE usuarios SET admin = $1 WHERE email = $2 RETURNING id, nombre, email, admin',
  [valor, email.trim().toLowerCase()]
);

if (!r.rows.length) {
  console.log(`No encontré ningún usuario con el mail ${email}. Esa persona tiene que entrar una vez a la app primero (así se auto-registra) y después corrés este script.`);
} else {
  console.log(`Listo: ${r.rows[0].nombre} (${r.rows[0].email}) → admin: ${r.rows[0].admin}`);
}

await pool.end();
