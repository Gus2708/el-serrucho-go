-- Migration 041: Créditos (cuentas por cobrar)
--
-- Libro de cuentas por cobrar de la ferretería. Dos cosas se anotan a crédito:
--   1. una FACTURA ya existente en `ventas` (origen = 'factura'), y
--   2. una VENTA LIBRE — monto + concepto escritos a mano (origen = 'libre').
--
-- Créditos NO toca inventario, NO dispara write-back a HybridLite y NO escribe en
-- `ventas`. Es un libro contable aparte: solo lee facturas para referenciarlas.
--
-- ── El principio que hace imposible el desastre ──────────────────────────────
--
-- `creditos_movimiento` es APPEND-ONLY. Un saldo nunca se guarda: se DERIVA
-- sumando los movimientos vivos. Por lo tanto no existe "el número del saldo"
-- que se pueda corromper — solo existen los hechos que lo producen.
--
-- Corregir un abono NO es un UPDATE. Es: anular el original (dejando el rastro)
-- + insertar el corregido. Ambas filas quedan para siempre en el historial, así
-- que "volver atrás" es siempre posible y siempre auditable — el equivalente a
-- un commit revert, no a un borrado.
--
--   saldo = Σ(cargos vivos) − Σ(abonos vivos)
--   vivo  = anulado_por_id IS NULL AND reversa_de_id IS NULL
--
-- Los cuatro guardianes, todos en la base de datos (la app NO puede saltárselos):
--   G1. Trigger anti-mutación: UPDATE solo puede sellar la anulación, una vez.
--   G2. Trigger anti-borrado: DELETE siempre falla, sin excepción.
--   G3. Índice único parcial: una factura no puede cargarse dos veces ni a dos cuentas.
--   G4. Trigger de reversa: la anulación debe calcar cuenta/tipo/monto del original.
--
-- Escritura EXCLUSIVAMENTE por RPC SECURITY DEFINER con gate is_privileged().
-- Las tablas no tienen políticas de INSERT/UPDATE/DELETE: ni un admin con la
-- anon key puede escribir directo. Solo lectura para empleados activos.

-- ── Cuentas ─────────────────────────────────────────────────────────────────
--
-- `nombre` es un SNAPSHOT deliberado, no un join. `ventas.rif_cliente` matchea
-- más de una fila de `clientes` (ej. el RIF 11246149 existe como '11246149' y
-- como 'V11246149'), así que resolver el beneficiario en vivo duplicaría cuentas.
-- La cuenta guarda a quién se le fía; `cliente_codigo` es solo una pista opcional.

CREATE TABLE IF NOT EXISTS creditos_cuenta (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre         text NOT NULL CHECK (length(btrim(nombre)) >= 3),
  cliente_codigo text,
  documento_id   text,
  telefono       text,
  nota           text,
  estado         text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'cerrada')),
  creado_por     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  cerrado_por    uuid REFERENCES auth.users(id),
  cerrado_en     timestamptz
);

-- Dos cuentas con el mismo nombre son casi siempre un error de dedo, no dos
-- personas. Se bloquea entre las activas; las cerradas quedan libres para reusar
-- el nombre. Case-insensitive y sin espacios de sobra.
CREATE UNIQUE INDEX IF NOT EXISTS uq_creditos_cuenta_nombre_activa
  ON creditos_cuenta (lower(btrim(nombre)))
  WHERE estado = 'activa';

-- ── Movimientos (append-only) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS creditos_movimiento (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cuenta_id bigint NOT NULL REFERENCES creditos_cuenta(id) ON DELETE RESTRICT,

  -- `monto_usd` SIEMPRE positivo: la dirección la da `tipo`, nunca el signo.
  -- Un monto negativo suelto es el bug clásico que descuadra un libro contable.
  -- numeric(14,2) → aritmética exacta, sin deriva de punto flotante.
  tipo      text NOT NULL CHECK (tipo IN ('cargo', 'abono')),
  monto_usd numeric(14,2) NOT NULL CHECK (monto_usd > 0),
  fecha     date NOT NULL DEFAULT current_date,
  concepto  text NOT NULL CHECK (length(btrim(concepto)) > 0),

  -- Origen del cargo. 'factura' referencia una venta real; 'libre' es el apunte
  -- a mano. Los abonos siempre llevan 'abono'.
  origen    text NOT NULL CHECK (origen IN ('factura', 'libre', 'abono')),

  -- Referencia a la factura. SIN foreign key a `ventas` a propósito: esa tabla la
  -- reescribe el sync de Python y un DELETE/INSERT rompería el libro. `documento`
  -- es único en las 29.213 ventas válidas → es la llave durable.
  venta_documento text,
  venta_id_unico  bigint,

  -- Datos del abono
  metodo     text CHECK (metodo IS NULL OR metodo IN ('efectivo', 'zelle', 'pago_movil', 'transferencia', 'otro')),
  referencia text,

  -- Rastro de reversa: el mecanismo de "volver atrás".
  --   reversa_de_id  → esta fila ANULA a otra (es el revert).
  --   anulado_por_id → esta fila FUE anulada por otra (el sello).
  --   corrige_a_id   → esta fila REEMPLAZA a una anulada (el valor bueno).
  reversa_de_id    bigint REFERENCES creditos_movimiento(id),
  anulado_por_id   bigint REFERENCES creditos_movimiento(id),
  corrige_a_id     bigint REFERENCES creditos_movimiento(id),
  motivo_anulacion text,

  creado_por uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  creado_en  timestamptz NOT NULL DEFAULT now(),

  -- Coherencia tipo ↔ origen: un cargo nunca es 'abono' y viceversa.
  CONSTRAINT chk_creditos_tipo_origen CHECK (
    (tipo = 'abono' AND origen = 'abono') OR
    (tipo = 'cargo' AND origen IN ('factura', 'libre'))
  ),
  -- Un cargo de factura sin número de factura no es rastreable.
  CONSTRAINT chk_creditos_factura_documento CHECK (
    origen <> 'factura' OR (venta_documento IS NOT NULL AND length(btrim(venta_documento)) > 0)
  ),
  -- Una fila no puede anularse ni corregirse a sí misma.
  CONSTRAINT chk_creditos_no_autoreferencia CHECK (
    id <> reversa_de_id AND id <> anulado_por_id AND id <> corrige_a_id
  )
);

-- G3 — Una factura vive en UNA sola cuenta, UNA sola vez.
-- El índice cubre solo movimientos vivos: si el cargo se anula, la factura queda
-- libre para volver a cargarse (a la misma cuenta o a otra).
CREATE UNIQUE INDEX IF NOT EXISTS uq_creditos_factura_viva
  ON creditos_movimiento (venta_documento)
  WHERE origen = 'factura' AND anulado_por_id IS NULL AND reversa_de_id IS NULL;

-- Una fila solo puede ser anulada por UNA reversa (no dos reversas del mismo hecho).
CREATE UNIQUE INDEX IF NOT EXISTS uq_creditos_reversa_unica
  ON creditos_movimiento (reversa_de_id)
  WHERE reversa_de_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_creditos_mov_cuenta ON creditos_movimiento (cuenta_id, fecha DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_creditos_mov_vivos  ON creditos_movimiento (cuenta_id)
  WHERE anulado_por_id IS NULL AND reversa_de_id IS NULL;

-- ── G1 · Anti-mutación ──────────────────────────────────────────────────────
-- Un movimiento es un hecho ocurrido. Lo único que puede cambiarle después es el
-- sello de anulación, y solo de NULL a un valor, una única vez.

CREATE OR REPLACE FUNCTION fn_creditos_mov_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id             IS DISTINCT FROM OLD.id             OR
     NEW.cuenta_id      IS DISTINCT FROM OLD.cuenta_id      OR
     NEW.tipo           IS DISTINCT FROM OLD.tipo           OR
     NEW.monto_usd      IS DISTINCT FROM OLD.monto_usd      OR
     NEW.fecha          IS DISTINCT FROM OLD.fecha          OR
     NEW.concepto       IS DISTINCT FROM OLD.concepto       OR
     NEW.origen         IS DISTINCT FROM OLD.origen         OR
     NEW.venta_documento IS DISTINCT FROM OLD.venta_documento OR
     NEW.venta_id_unico IS DISTINCT FROM OLD.venta_id_unico OR
     NEW.metodo         IS DISTINCT FROM OLD.metodo         OR
     NEW.referencia     IS DISTINCT FROM OLD.referencia     OR
     NEW.reversa_de_id  IS DISTINCT FROM OLD.reversa_de_id  OR
     NEW.corrige_a_id   IS DISTINCT FROM OLD.corrige_a_id   OR
     NEW.creado_por     IS DISTINCT FROM OLD.creado_por     OR
     NEW.creado_en      IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'Un movimiento de crédito no se puede modificar. Para corregirlo, anúlalo y registra el correcto.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.anulado_por_id IS NOT NULL AND NEW.anulado_por_id IS DISTINCT FROM OLD.anulado_por_id THEN
    RAISE EXCEPTION 'Este movimiento ya fue anulado; no se puede volver a anular.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_creditos_mov_inmutable ON creditos_movimiento;
CREATE TRIGGER trg_creditos_mov_inmutable
  BEFORE UPDATE ON creditos_movimiento
  FOR EACH ROW EXECUTE FUNCTION fn_creditos_mov_inmutable();

-- ── G2 · Anti-borrado ───────────────────────────────────────────────────────
-- Nada se borra. Nunca. Ni por la app, ni por un script, ni por el service_role.

CREATE OR REPLACE FUNCTION fn_creditos_mov_no_borrar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de crédito no se borran. Usa creditos_anular_movimiento() para dejar el rastro.'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_creditos_mov_no_borrar ON creditos_movimiento;
CREATE TRIGGER trg_creditos_mov_no_borrar
  BEFORE DELETE ON creditos_movimiento
  FOR EACH ROW EXECUTE FUNCTION fn_creditos_mov_no_borrar();

-- ── G4 · Integridad de la reversa ───────────────────────────────────────────
-- Una reversa que no calca exactamente al original desbalancea el libro en
-- silencio. Se verifica cuenta, tipo y monto contra el original.

CREATE OR REPLACE FUNCTION fn_creditos_reversa_valida()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original creditos_movimiento%ROWTYPE;
BEGIN
  IF NEW.reversa_de_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO original FROM creditos_movimiento WHERE id = NEW.reversa_de_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el movimiento % que se intenta anular.', NEW.reversa_de_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF original.reversa_de_id IS NOT NULL THEN
    RAISE EXCEPTION 'Una anulación no se puede anular.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF original.cuenta_id <> NEW.cuenta_id
     OR original.tipo    <> NEW.tipo
     OR original.monto_usd <> NEW.monto_usd
  THEN
    RAISE EXCEPTION 'La anulación debe calcar cuenta, tipo y monto del movimiento original.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_creditos_reversa_valida ON creditos_movimiento;
CREATE TRIGGER trg_creditos_reversa_valida
  BEFORE INSERT ON creditos_movimiento
  FOR EACH ROW EXECUTE FUNCTION fn_creditos_reversa_valida();

-- ── Vistas ──────────────────────────────────────────────────────────────────

-- Saldo derivado. Nunca se almacena: se calcula. Un cargo suma, un abono resta.
-- Saldo negativo = el cliente pagó de más (saldo a favor), y se muestra como tal.
CREATE OR REPLACE VIEW vw_creditos_saldo AS
SELECT
  c.id,
  c.nombre,
  c.cliente_codigo,
  c.documento_id,
  c.telefono,
  c.nota,
  c.estado,
  c.creado_por,
  c.creado_en,
  COALESCE(SUM(m.monto_usd) FILTER (WHERE m.tipo = 'cargo'), 0)::numeric(14,2) AS total_cargos,
  COALESCE(SUM(m.monto_usd) FILTER (WHERE m.tipo = 'abono'), 0)::numeric(14,2) AS total_abonos,
  COALESCE(
    SUM(CASE WHEN m.tipo = 'cargo' THEN m.monto_usd ELSE -m.monto_usd END), 0
  )::numeric(14,2) AS saldo,
  COUNT(m.id)                              AS num_movimientos,
  MAX(m.fecha) FILTER (WHERE m.tipo = 'abono')  AS ultimo_abono_en,
  MAX(m.fecha) FILTER (WHERE m.tipo = 'cargo')  AS ultimo_cargo_en,
  MAX(m.creado_en)                          AS ultima_actividad_en
FROM creditos_cuenta c
LEFT JOIN creditos_movimiento m
  ON m.cuenta_id = c.id
 AND m.anulado_por_id IS NULL   -- el original anulado no cuenta
 AND m.reversa_de_id  IS NULL   -- ni la fila de anulación en sí
GROUP BY c.id;

-- Historial completo de una cuenta, incluyendo lo anulado (con su rastro).
-- `vivo` es la única fuente de verdad sobre qué suma al saldo.
CREATE OR REPLACE VIEW vw_creditos_movimientos AS
SELECT
  m.id,
  m.cuenta_id,
  m.tipo,
  m.monto_usd,
  m.fecha,
  m.concepto,
  m.origen,
  m.venta_documento,
  m.metodo,
  m.referencia,
  m.reversa_de_id,
  m.anulado_por_id,
  m.corrige_a_id,
  m.motivo_anulacion,
  m.creado_por,
  m.creado_en,
  (m.anulado_por_id IS NULL AND m.reversa_de_id IS NULL) AS vivo,
  p.display_name AS autor_nombre,
  p.email        AS autor_email,
  anu.creado_en  AS anulado_en,
  pa.display_name AS anulado_por_nombre,
  (SELECT r.id FROM creditos_movimiento r WHERE r.corrige_a_id = m.id) AS corregido_por_id,
  (SELECT r.monto_usd FROM creditos_movimiento r WHERE r.corrige_a_id = m.id) AS corregido_monto
FROM creditos_movimiento m
LEFT JOIN profiles p            ON p.id = m.creado_por
LEFT JOIN creditos_movimiento anu ON anu.id = m.anulado_por_id
LEFT JOIN profiles pa           ON pa.id = anu.creado_por;

-- KPI de cabecera: cuánto hay en la calle.
CREATE OR REPLACE VIEW vw_creditos_resumen AS
SELECT
  COALESCE(SUM(saldo) FILTER (WHERE saldo > 0), 0)::numeric(14,2) AS total_por_cobrar,
  COALESCE(SUM(-saldo) FILTER (WHERE saldo < 0), 0)::numeric(14,2) AS total_a_favor,
  COUNT(*) FILTER (WHERE saldo > 0 AND estado = 'activa')          AS cuentas_con_deuda,
  COUNT(*) FILTER (WHERE estado = 'activa')                        AS cuentas_activas,
  MAX(saldo)::numeric(14,2)                                        AS mayor_saldo
FROM vw_creditos_saldo;

-- Facturas que todavía se pueden pasar a crédito, con el beneficiario SUGERIDO
-- ya resuelto. El DISTINCT ON mata el duplicado del join (un RIF puede matchear
-- varias filas de `clientes`): gana el codigo_cliente menor, de forma estable.
CREATE OR REPLACE VIEW vw_ventas_credito_disponibles AS
SELECT
  v.id,
  v.documento,
  v.id_unico,
  v.fecha_emision,
  v.created_at,
  v.total_neto AS total_usd,
  v.metodo_pago,
  v.rif_cliente,
  sug.codigo_cliente AS sugerido_codigo,
  sug.nombre         AS sugerido_nombre,
  sug.telefono       AS sugerido_telefono,
  -- Sin cliente identificable: la factura queda abierta a nombrar a cualquiera.
  (sug.nombre IS NULL) AS es_cliente_natural
FROM ventas v
LEFT JOIN LATERAL (
  SELECT c.codigo_cliente, c.nombre, c.telefono
  FROM clientes c
  WHERE c.rif = v.rif_cliente
    AND v.rif_cliente IS NOT NULL
    AND v.rif_cliente NOT IN ('001', 'V-0000000000')
  ORDER BY c.codigo_cliente
  LIMIT 1
) sug ON TRUE
WHERE v.status = 1
  AND NOT EXISTS (
    SELECT 1 FROM creditos_movimiento m
    WHERE m.venta_documento = v.documento
      AND m.origen = 'factura'
      AND m.anulado_por_id IS NULL
      AND m.reversa_de_id  IS NULL
  );

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- SOLO LECTURA para empleados activos. Cero políticas de escritura: toda
-- mutación pasa obligatoriamente por los RPC de abajo.

ALTER TABLE creditos_cuenta     ENABLE ROW LEVEL SECURITY;
ALTER TABLE creditos_movimiento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active employees - read cuentas"     ON creditos_cuenta;
DROP POLICY IF EXISTS "Active employees - read movimientos" ON creditos_movimiento;

CREATE POLICY "Active employees - read cuentas" ON creditos_cuenta
  FOR SELECT TO authenticated USING (is_active_employee());
CREATE POLICY "Active employees - read movimientos" ON creditos_movimiento
  FOR SELECT TO authenticated USING (is_active_employee());

REVOKE INSERT, UPDATE, DELETE ON creditos_cuenta, creditos_movimiento FROM anon, authenticated;

-- ── RPC · única puerta de escritura ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION creditos_crear_cuenta(
  p_nombre         text,
  p_cliente_codigo text DEFAULT NULL,
  p_documento_id   text DEFAULT NULL,
  p_telefono       text DEFAULT NULL,
  p_nota           text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF NOT is_privileged() THEN
    RAISE EXCEPTION 'No tienes permiso para crear cuentas de crédito.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO creditos_cuenta (nombre, cliente_codigo, documento_id, telefono, nota)
  VALUES (btrim(p_nombre), NULLIF(btrim(p_cliente_codigo), ''), NULLIF(btrim(p_documento_id), ''),
          NULLIF(btrim(p_telefono), ''), NULLIF(btrim(p_nota), ''))
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe una cuenta activa a nombre de "%".', btrim(p_nombre)
      USING ERRCODE = 'unique_violation';
END;
$$;

-- Registra un cargo. `p_origen` = 'factura' exige el número de documento y lo
-- valida contra `ventas`; 'libre' es el apunte a mano.
CREATE OR REPLACE FUNCTION creditos_registrar_cargo(
  p_cuenta_id       bigint,
  p_monto_usd       numeric,
  p_concepto        text,
  p_origen          text DEFAULT 'libre',
  p_venta_documento text DEFAULT NULL,
  p_fecha           date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id      bigint;
  v_venta   ventas%ROWTYPE;
  v_estado  text;
BEGIN
  IF NOT is_privileged() THEN
    RAISE EXCEPTION 'No tienes permiso para registrar cargos.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT estado INTO v_estado FROM creditos_cuenta WHERE id = p_cuenta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta % no existe.', p_cuenta_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado = 'cerrada' THEN
    RAISE EXCEPTION 'La cuenta está cerrada. Reábrela antes de cargarle algo.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_origen = 'factura' THEN
    SELECT * INTO v_venta FROM ventas WHERE documento = btrim(p_venta_documento) AND status = 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No existe la factura % (o está anulada).', p_venta_documento USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  INSERT INTO creditos_movimiento (
    cuenta_id, tipo, monto_usd, fecha, concepto, origen, venta_documento, venta_id_unico
  ) VALUES (
    p_cuenta_id, 'cargo', round(p_monto_usd, 2), COALESCE(p_fecha, current_date),
    btrim(p_concepto), p_origen,
    CASE WHEN p_origen = 'factura' THEN v_venta.documento END,
    CASE WHEN p_origen = 'factura' THEN v_venta.id_unico END
  ) RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'La factura % ya está cargada a una cuenta de crédito.', p_venta_documento
      USING ERRCODE = 'unique_violation';
END;
$$;

CREATE OR REPLACE FUNCTION creditos_registrar_abono(
  p_cuenta_id  bigint,
  p_monto_usd  numeric,
  p_concepto   text DEFAULT NULL,
  p_metodo     text DEFAULT 'efectivo',
  p_referencia text DEFAULT NULL,
  p_fecha      date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id     bigint;
  v_estado text;
BEGIN
  IF NOT is_privileged() THEN
    RAISE EXCEPTION 'No tienes permiso para registrar abonos.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT estado INTO v_estado FROM creditos_cuenta WHERE id = p_cuenta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta % no existe.', p_cuenta_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado = 'cerrada' THEN
    RAISE EXCEPTION 'La cuenta está cerrada. Reábrela antes de abonarle.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO creditos_movimiento (cuenta_id, tipo, monto_usd, fecha, concepto, origen, metodo, referencia)
  VALUES (
    p_cuenta_id, 'abono', round(p_monto_usd, 2), COALESCE(p_fecha, current_date),
    COALESCE(NULLIF(btrim(p_concepto), ''), 'Abono'), 'abono',
    COALESCE(p_metodo, 'efectivo'), NULLIF(btrim(p_referencia), '')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Anula un movimiento dejando el rastro. Devuelve el id de la fila de anulación.
-- El FOR UPDATE + el trigger G1 hacen imposible la doble anulación en carrera.
CREATE OR REPLACE FUNCTION creditos_anular_movimiento(
  p_movimiento_id bigint,
  p_motivo        text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m         creditos_movimiento%ROWTYPE;
  v_reversa bigint;
BEGIN
  IF NOT is_privileged() THEN
    RAISE EXCEPTION 'No tienes permiso para anular movimientos.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) = 0 THEN
    RAISE EXCEPTION 'Anular exige un motivo: queda en el historial.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO m FROM creditos_movimiento WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El movimiento % no existe.', p_movimiento_id USING ERRCODE = 'no_data_found';
  END IF;
  IF m.anulado_por_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ese movimiento ya estaba anulado.' USING ERRCODE = 'check_violation';
  END IF;
  IF m.reversa_de_id IS NOT NULL THEN
    RAISE EXCEPTION 'Una anulación no se puede anular.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO creditos_movimiento (
    cuenta_id, tipo, monto_usd, fecha, concepto, origen,
    venta_documento, venta_id_unico, metodo, referencia, reversa_de_id, motivo_anulacion
  ) VALUES (
    m.cuenta_id, m.tipo, m.monto_usd, current_date,
    'Anulación de: ' || m.concepto, m.origen,
    m.venta_documento, m.venta_id_unico, m.metodo, m.referencia,
    m.id, btrim(p_motivo)
  ) RETURNING id INTO v_reversa;

  UPDATE creditos_movimiento
     SET anulado_por_id = v_reversa, motivo_anulacion = btrim(p_motivo)
   WHERE id = m.id;

  RETURN v_reversa;
END;
$$;

-- Corregir = anular + registrar el bueno, en UNA transacción. El nuevo movimiento
-- apunta al viejo por `corrige_a_id`, así el historial cuenta la historia completa:
-- "eran $50, se corrigió a $45, lo hizo Fulano, porque X".
CREATE OR REPLACE FUNCTION creditos_corregir_movimiento(
  p_movimiento_id bigint,
  p_monto_usd     numeric,
  p_concepto      text DEFAULT NULL,
  p_fecha         date DEFAULT NULL,
  p_metodo        text DEFAULT NULL,
  p_referencia    text DEFAULT NULL,
  p_motivo        text DEFAULT 'Corrección'
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m       creditos_movimiento%ROWTYPE;
  v_nuevo bigint;
BEGIN
  IF NOT is_privileged() THEN
    RAISE EXCEPTION 'No tienes permiso para corregir movimientos.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF round(p_monto_usd, 2) <= 0 THEN
    RAISE EXCEPTION 'El monto corregido debe ser mayor que cero.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO m FROM creditos_movimiento WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El movimiento % no existe.', p_movimiento_id USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM creditos_anular_movimiento(p_movimiento_id, btrim(p_motivo));

  INSERT INTO creditos_movimiento (
    cuenta_id, tipo, monto_usd, fecha, concepto, origen,
    venta_documento, venta_id_unico, metodo, referencia, corrige_a_id
  ) VALUES (
    m.cuenta_id, m.tipo, round(p_monto_usd, 2), COALESCE(p_fecha, m.fecha),
    COALESCE(NULLIF(btrim(p_concepto), ''), m.concepto), m.origen,
    m.venta_documento, m.venta_id_unico,
    COALESCE(p_metodo, m.metodo), COALESCE(NULLIF(btrim(p_referencia), ''), m.referencia),
    m.id
  ) RETURNING id INTO v_nuevo;

  RETURN v_nuevo;
END;
$$;

-- Cerrar exige saldo exactamente 0. Cerrar una cuenta con deuda es justo el tipo
-- de "desastre silencioso" que este libro debe impedir.
CREATE OR REPLACE FUNCTION creditos_cerrar_cuenta(p_cuenta_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_saldo numeric(14,2);
BEGIN
  IF NOT is_privileged() THEN
    RAISE EXCEPTION 'No tienes permiso para cerrar cuentas.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM creditos_cuenta WHERE id = p_cuenta_id FOR UPDATE;
  SELECT saldo INTO v_saldo FROM vw_creditos_saldo WHERE id = p_cuenta_id;
  IF v_saldo IS NULL THEN
    RAISE EXCEPTION 'La cuenta % no existe.', p_cuenta_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_saldo <> 0 THEN
    RAISE EXCEPTION 'No se puede cerrar: la cuenta tiene un saldo de %.', v_saldo USING ERRCODE = 'check_violation';
  END IF;

  UPDATE creditos_cuenta
     SET estado = 'cerrada', cerrado_por = auth.uid(), cerrado_en = now()
   WHERE id = p_cuenta_id;
END;
$$;

CREATE OR REPLACE FUNCTION creditos_reabrir_cuenta(p_cuenta_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_privileged() THEN
    RAISE EXCEPTION 'No tienes permiso para reabrir cuentas.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE creditos_cuenta
     SET estado = 'activa', cerrado_por = NULL, cerrado_en = NULL
   WHERE id = p_cuenta_id;
END;
$$;

-- Editar los datos del beneficiario (nombre, teléfono…). No toca movimientos.
CREATE OR REPLACE FUNCTION creditos_actualizar_cuenta(
  p_cuenta_id    bigint,
  p_nombre       text,
  p_documento_id text DEFAULT NULL,
  p_telefono     text DEFAULT NULL,
  p_nota         text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_privileged() THEN
    RAISE EXCEPTION 'No tienes permiso para editar cuentas.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE creditos_cuenta
     SET nombre       = btrim(p_nombre),
         documento_id = NULLIF(btrim(p_documento_id), ''),
         telefono     = NULLIF(btrim(p_telefono), ''),
         nota         = NULLIF(btrim(p_nota), '')
   WHERE id = p_cuenta_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe otra cuenta activa a nombre de "%".', btrim(p_nombre)
      USING ERRCODE = 'unique_violation';
END;
$$;

-- Los RPC son la única puerta: se exponen a authenticated, nunca a anon.
REVOKE ALL ON FUNCTION creditos_crear_cuenta(text, text, text, text, text)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION creditos_registrar_cargo(bigint, numeric, text, text, text, date)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION creditos_registrar_abono(bigint, numeric, text, text, text, date)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION creditos_anular_movimiento(bigint, text)                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION creditos_corregir_movimiento(bigint, numeric, text, date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION creditos_cerrar_cuenta(bigint)                                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION creditos_reabrir_cuenta(bigint)                                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION creditos_actualizar_cuenta(bigint, text, text, text, text)                 FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION creditos_crear_cuenta(text, text, text, text, text)                        TO authenticated;
GRANT EXECUTE ON FUNCTION creditos_registrar_cargo(bigint, numeric, text, text, text, date)          TO authenticated;
GRANT EXECUTE ON FUNCTION creditos_registrar_abono(bigint, numeric, text, text, text, date)          TO authenticated;
GRANT EXECUTE ON FUNCTION creditos_anular_movimiento(bigint, text)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION creditos_corregir_movimiento(bigint, numeric, text, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION creditos_cerrar_cuenta(bigint)                                             TO authenticated;
GRANT EXECUTE ON FUNCTION creditos_reabrir_cuenta(bigint)                                            TO authenticated;
GRANT EXECUTE ON FUNCTION creditos_actualizar_cuenta(bigint, text, text, text, text)                 TO authenticated;

-- Las vistas exponen datos de cuentas: authenticated sí, anon nunca.
REVOKE ALL ON vw_creditos_saldo, vw_creditos_movimientos, vw_creditos_resumen,
              vw_ventas_credito_disponibles FROM anon;
GRANT SELECT ON vw_creditos_saldo, vw_creditos_movimientos, vw_creditos_resumen,
                vw_ventas_credito_disponibles TO authenticated;

-- Realtime: los saldos se ven al instante en todos los dispositivos.
-- Idempotente — la migración debe poder re-correrse sin explotar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'creditos_cuenta'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.creditos_cuenta;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'creditos_movimiento'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.creditos_movimiento;
  END IF;
END;
$$;
