-- =====================================================================
-- FIXY · CONTROL DE DESPACHO  ·  Modelo de datos MVP (PostgreSQL)
-- Alcance: Módulo 1 (Despacho) + Auditoría base.
--
-- Idea central del Modelo A:
--   Cada BULTO físico que se escanea genera una fila en `escaneo`.
--   Como todos los bultos de una guía comparten el MISMO código
--   (el número de guía), NO se usa una restricción UNIQUE(guia, código).
--   El límite es "como mucho `bultos_esperados` escaneos por guía", y se
--   valida en la capa de aplicación (ver función/trigger opcional al final).
--   El conteo de bultos es siempre derivado: COUNT(escaneo) por guía.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos enumerados (estados de la operación)
-- ---------------------------------------------------------------------
CREATE TYPE estado_hoja_ruta AS ENUM ('abierta', 'en_control', 'despachada', 'anulada');
CREATE TYPE tipo_incidencia  AS ENUM ('guia_no_asignada', 'bulto_sobrante', 'cierre_con_diferencia');

-- ---------------------------------------------------------------------
-- Usuarios del módulo (operadores / supervisores)
-- ---------------------------------------------------------------------
CREATE TABLE usuario (
    id          BIGSERIAL PRIMARY KEY,
    nombre      VARCHAR(120) NOT NULL,
    email       VARCHAR(160) UNIQUE NOT NULL,
    rol         VARCHAR(30)  NOT NULL DEFAULT 'operador',  -- operador | supervisor | admin
    pin         VARCHAR(8),   -- PIN del prototipo. En producción: reemplazar por password_hash (bcrypt/argon2)
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Transportista. Se cachea localmente lo que viene de Presis.
-- presis_id = identificador del transportista en Presis (para sincronizar).
-- ---------------------------------------------------------------------
CREATE TABLE transportista (
    id          BIGSERIAL PRIMARY KEY,
    presis_id   VARCHAR(60) UNIQUE,            -- id del transportista en Presis
    nombre      VARCHAR(160) NOT NULL,
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Hoja de ruta / planilla. Es la "sesión" de despacho de un transportista.
-- Se trae de Presis al seleccionar el transportista.
-- ---------------------------------------------------------------------
CREATE TABLE hoja_ruta (
    id                BIGSERIAL PRIMARY KEY,
    presis_id         VARCHAR(60) UNIQUE NOT NULL,   -- id de la planilla/hoja en Presis
    transportista_id  BIGINT NOT NULL REFERENCES transportista(id),
    fecha             DATE   NOT NULL,
    zona              VARCHAR(120),
    estado            estado_hoja_ruta NOT NULL DEFAULT 'abierta',
    -- Totales esperados (cacheados desde Presis para validar el cierre).
    -- También se pueden derivar de `guia`, pero guardarlos permite detectar
    -- desfasajes entre lo que dice Presis y lo que se cargó.
    total_guias_esperadas   INTEGER NOT NULL DEFAULT 0,
    total_bultos_esperados  INTEGER NOT NULL DEFAULT 0,
    sincronizada_en   TIMESTAMPTZ,
    control_iniciado_en TIMESTAMPTZ,   -- cuándo el operador empezó a controlar (para medir duración)
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hoja_ruta_transportista ON hoja_ruta (transportista_id, fecha);
CREATE INDEX idx_hoja_ruta_estado        ON hoja_ruta (estado);

-- ---------------------------------------------------------------------
-- Guía. Pertenece a una hoja de ruta. bultos_esperados >= 1.
-- numero_guia es el código que imprime el lector (se repite por bulto).
-- ---------------------------------------------------------------------
CREATE TABLE guia (
    id                BIGSERIAL PRIMARY KEY,
    hoja_ruta_id      BIGINT NOT NULL REFERENCES hoja_ruta(id) ON DELETE CASCADE,
    numero_guia       VARCHAR(80) NOT NULL,            -- lo que lee el escáner
    presis_id         VARCHAR(60),
    bultos_esperados  INTEGER NOT NULL CHECK (bultos_esperados >= 1),
    zona              VARCHAR(120),
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Una misma guía no se repite dentro de la misma hoja de ruta.
    CONSTRAINT uq_guia_por_hoja UNIQUE (hoja_ruta_id, numero_guia)
);
-- Búsqueda rápida al escanear: numero_guia dentro de la hoja de ruta activa.
CREATE INDEX idx_guia_lookup ON guia (hoja_ruta_id, numero_guia);

-- ---------------------------------------------------------------------
-- Escaneo: UNA FILA POR BULTO FÍSICO. Aquí vive el Modelo A.
-- secuencia_bulto = 1, 2, 3... (orden en que se escaneó esa guía).
-- NO hay UNIQUE sobre (guia_id, numero_guia): el duplicado es esperado.
-- El tope (no superar bultos_esperados) se valida al insertar.
-- ---------------------------------------------------------------------
CREATE TABLE escaneo (
    id              BIGSERIAL PRIMARY KEY,
    guia_id         BIGINT NOT NULL REFERENCES guia(id) ON DELETE CASCADE,
    hoja_ruta_id    BIGINT NOT NULL REFERENCES hoja_ruta(id),
    usuario_id      BIGINT NOT NULL REFERENCES usuario(id),
    secuencia_bulto INTEGER NOT NULL CHECK (secuencia_bulto >= 1),
    escaneado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Evita que el MISMO bulto (misma secuencia) se inserte dos veces por
    -- una condición de carrera; el orden lógico lo asigna la app.
    CONSTRAINT uq_escaneo_secuencia UNIQUE (guia_id, secuencia_bulto)
);
CREATE INDEX idx_escaneo_hoja ON escaneo (hoja_ruta_id);
CREATE INDEX idx_escaneo_guia ON escaneo (guia_id);

-- ---------------------------------------------------------------------
-- Incidencias: todo intento de escaneo inválido o cierre forzado.
-- codigo_escaneado guarda lo leído aunque no exista como guía.
-- ---------------------------------------------------------------------
CREATE TABLE incidencia (
    id               BIGSERIAL PRIMARY KEY,
    hoja_ruta_id     BIGINT REFERENCES hoja_ruta(id),
    guia_id          BIGINT REFERENCES guia(id),        -- NULL si el código no existe
    usuario_id       BIGINT NOT NULL REFERENCES usuario(id),
    tipo             tipo_incidencia NOT NULL,
    codigo_escaneado VARCHAR(80),
    detalle          TEXT,
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_incidencia_hoja ON incidencia (hoja_ruta_id);

-- ---------------------------------------------------------------------
-- Despacho: el cierre confirmado de una hoja de ruta.
-- Sólo se permite cuando bultos_controlados == total_bultos_esperados.
-- ---------------------------------------------------------------------
CREATE TABLE despacho (
    id               BIGSERIAL PRIMARY KEY,
    hoja_ruta_id     BIGINT NOT NULL UNIQUE REFERENCES hoja_ruta(id),
    usuario_id       BIGINT NOT NULL REFERENCES usuario(id),   -- quién despachó
    total_guias      INTEGER NOT NULL,
    total_bultos     INTEGER NOT NULL,
    iniciado_en      TIMESTAMPTZ,        -- inicio del control
    confirmado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),       -- fin del control
    duracion_segundos INTEGER            -- cuánto tardó (confirmado - iniciado)
);

-- ---------------------------------------------------------------------
-- Auditoría: toda acción relevante (campos pedidos en el brief).
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
    id                BIGSERIAL PRIMARY KEY,
    usuario_id        BIGINT REFERENCES usuario(id),
    accion            VARCHAR(80) NOT NULL,   -- 'escaneo_valido', 'confirmar_despacho', etc.
    transportista_id  BIGINT REFERENCES transportista(id),
    numero_guia       VARCHAR(80),
    estado_anterior   VARCHAR(60),
    estado_nuevo      VARCHAR(60),
    observaciones     TEXT,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_fecha ON auditoria (creado_en);

-- =====================================================================
-- VISTA: progreso de control por guía (para la pantalla de escaneo).
-- bultos_controlados se DERIVA de los escaneos -> nunca se desincroniza.
-- =====================================================================
CREATE VIEW v_progreso_guia AS
SELECT  g.id                AS guia_id,
        g.hoja_ruta_id,
        g.numero_guia,
        g.bultos_esperados,
        COUNT(e.id)         AS bultos_controlados,
        (COUNT(e.id) >= g.bultos_esperados) AS completa
FROM    guia g
LEFT JOIN escaneo e ON e.guia_id = g.id
GROUP BY g.id;

-- VISTA: totales por hoja de ruta (KPIs de la sesión y gate de cierre).
CREATE VIEW v_progreso_hoja AS
SELECT  h.id AS hoja_ruta_id,
        h.total_bultos_esperados,
        COALESCE(SUM(p.bultos_controlados), 0)             AS bultos_controlados,
        h.total_bultos_esperados
          - COALESCE(SUM(p.bultos_controlados), 0)         AS bultos_faltantes,
        COUNT(p.guia_id) FILTER (WHERE p.completa)          AS guias_completas,
        COUNT(p.guia_id)                                    AS guias_totales
FROM    hoja_ruta h
LEFT JOIN v_progreso_guia p ON p.hoja_ruta_id = h.id
GROUP BY h.id;

-- =====================================================================
-- (OPCIONAL) Tope de bultos por guía a nivel base de datos.
-- La validación principal vive en la app (para dar feedback inmediato al
-- operador), pero este trigger es la red de seguridad contra duplicados
-- por encima del esperado, incluso ante condiciones de carrera.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_check_tope_bultos() RETURNS TRIGGER AS $$
DECLARE
    esperados INTEGER;
    actuales  INTEGER;
BEGIN
    SELECT bultos_esperados INTO esperados FROM guia WHERE id = NEW.guia_id;
    SELECT COUNT(*) INTO actuales FROM escaneo WHERE guia_id = NEW.guia_id;
    IF actuales >= esperados THEN
        RAISE EXCEPTION 'Guía % ya tiene todos sus bultos escaneados (%/%).',
            NEW.guia_id, actuales, esperados;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tope_bultos
    BEFORE INSERT ON escaneo
    FOR EACH ROW EXECUTE FUNCTION fn_check_tope_bultos();

-- =====================================================================
-- VISTA: métricas por operador (cómo trabaja cada uno)
-- =====================================================================
CREATE VIEW v_metricas_operador AS
SELECT  u.id   AS usuario_id,
        u.nombre,
        COUNT(d.id)                          AS planillas_despachadas,
        COALESCE(SUM(d.total_bultos),0)      AS bultos_despachados,
        COALESCE(SUM(d.duracion_segundos),0) AS tiempo_total_seg,
        ROUND(AVG(d.duracion_segundos))      AS prom_seg_por_planilla
FROM    usuario u
LEFT JOIN despacho d ON d.usuario_id = u.id
GROUP BY u.id, u.nombre;

-- =====================================================================
-- SEED: 6 operadores iniciales (PIN de prueba 1234).
-- En producción: cargar password_hash real, no PIN en texto plano.
-- =====================================================================
INSERT INTO usuario (nombre, email, rol, pin) VALUES
  ('Lucas Pereyra', 'lucas@fixy.com',  'operador',   '1234'),
  ('Marina Gómez',  'marina@fixy.com', 'operador',   '1234'),
  ('Diego Sosa',    'diego@fixy.com',  'operador',   '1234'),
  ('Carla Ríos',    'carla@fixy.com',  'operador',   '1234'),
  ('Javier Núñez',  'javier@fixy.com', 'operador',   '1234'),
  ('Sofía Acosta',  'sofia@fixy.com',  'supervisor', '1234')
ON CONFLICT (email) DO NOTHING;
