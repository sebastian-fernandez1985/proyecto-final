import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import usuarios from './routes/usuarios.js';
import metricas from './routes/metricas.js';
import guias from './routes/guias.js';
import importar from './routes/importar.js';
import planillas from './routes/planillas.js';
import escaneos from './routes/escaneos.js';
import despachos from './routes/despachos.js';

dotenv.config();

const app = express();
app.use(cors());           // en producción, restringir al dominio del frontend
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/usuarios', usuarios);
app.use('/api/metricas', metricas);
app.use('/api/guias', guias);
app.use('/api/planillas', importar);   // POST /importar  +  GET /  (lista)
app.use('/api/planillas', planillas);  // GET /:numero
app.use('/api/escaneos', escaneos);
app.use('/api/despachos', despachos);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FIXY backend escuchando en http://localhost:${PORT}`));
