import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// Render (y la mayoría de los Postgres administrados) exigen SSL en las
// conexiones externas. Sin esto, el backend falla con errores de SSL /
// "no pg_hba.conf entry". Se activa solo si la URL parece de un proveedor
// administrado o pide sslmode=require.
const url = process.env.DATABASE_URL || '';
const usaSSL = /render\.com|amazonaws\.com|neon\.tech|supabase|sslmode=require/i.test(url);

export const pool = new pg.Pool({
  connectionString: url,
  ssl: usaSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => console.error('Error inesperado en el pool de PG:', err));
