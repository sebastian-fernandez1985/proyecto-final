import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// Pool de conexiones a PostgreSQL.
// La cadena DATABASE_URL se configura en .env
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => console.error('Error inesperado en el pool de PG:', err));
