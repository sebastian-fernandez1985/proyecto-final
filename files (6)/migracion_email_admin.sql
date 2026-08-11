-- ============================================================
-- Migración: login por mail (sin PIN) + flag de admin
-- Corré esto UNA VEZ contra tu base de Postgres.
-- ============================================================

-- 1. Agregamos las columnas nuevas
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS admin BOOLEAN NOT NULL DEFAULT false;

-- 2. El PIN ya no se usa para entrar. Lo dejamos en la tabla por las dudas
--    (auditoría / rollback) pero se podría borrar más adelante con:
--    ALTER TABLE usuarios DROP COLUMN pin;
ALTER TABLE usuarios ALTER COLUMN pin DROP NOT NULL;

-- 3. Marcá acá a los admins iniciales (los que van a poder entrar a
--    Métricas y descargar el Excel). Editá los mails y ejecutá:
-- UPDATE usuarios SET admin = true WHERE email = 'seba@fixy.com.ar';

-- 4. Más adelante, para dar/sacar admin a alguien que YA se registró solo,
--    corré (cambiando el mail):
-- UPDATE usuarios SET admin = true  WHERE email = 'nueva.encargada@fixy.com.ar';
-- UPDATE usuarios SET admin = false WHERE email = 'alguien@fixy.com.ar';
