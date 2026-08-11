// src/routes/usuarios.js
//
// Reemplaza la lógica vieja de "GET /api/usuarios" (lista + PIN) por login
// con mail y auto-registro. Ajustá el import de "pool" a como se llame tu
// módulo de conexión a Postgres en tu proyecto (ej: "../db.js").

import { Router } from 'express';
import { pool } from '../db.js'; // <-- ajustá esta ruta si tu archivo se llama distinto

const router = Router();

// POST /api/usuarios/login   Body: { email, nombre? }
// - Si el mail ya existe, devuelve sus datos (incluye "admin").
// - Si no existe:
//     - sin "nombre" todavía → devuelve { nuevo: true } para que el
//       frontend pida el nombre y vuelva a pegarle a este mismo endpoint.
//     - con "nombre" → lo crea y lo devuelve ya logueado.
router.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const nombre = (req.body.nombre || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Mail inválido' });
  }

  const existente = await pool.query(
    'SELECT id, nombre, email, admin FROM usuarios WHERE email = $1',
    [email]
  );

  if (existente.rows.length) {
    return res.json(existente.rows[0]);
  }

  if (!nombre) {
    // Mail nuevo: el frontend tiene que pedir el nombre y reintentar.
    return res.json({ nuevo: true });
  }

  const creado = await pool.query(
    `INSERT INTO usuarios (email, nombre, admin)
     VALUES ($1, $2, false)
     RETURNING id, nombre, email, admin`,
    [email, nombre]
  );

  res.status(201).json(creado.rows[0]);
});

export default router;
