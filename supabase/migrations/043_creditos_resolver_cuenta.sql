-- Migration 043: find-or-create atómico de cuenta de crédito
--
-- Al anotar una factura a nombre del cliente SUGERIDO, esa persona puede no
-- tener cuenta todavía. El cliente resolvía eso con tres viajes a la red
-- (buscar → crear → si choca, volver a buscar), apoyándose en atrapar la
-- unique_violation. Funciona, pero deja la lógica de una carrera en el
-- dispositivo y rompe la convención del proyecto de que toda escritura sea un
-- RPC.
--
-- Aquí se resuelve en UNA transacción del servidor. La carrera se maneja donde
-- realmente ocurre: si dos cajeros anotan facturas a la misma persona nueva al
-- mismo tiempo, uno inserta y el otro recibe el id del ganador. Nadie pierde el
-- cargo y nunca nacen dos cuentas para la misma persona.

CREATE OR REPLACE FUNCTION creditos_resolver_cuenta(
  p_nombre         text,
  p_cliente_codigo text DEFAULT NULL,
  p_documento_id   text DEFAULT NULL,
  p_telefono       text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id     bigint;
  v_nombre text := btrim(p_nombre);
BEGIN
  IF NOT is_privileged() THEN
    RAISE EXCEPTION 'No tienes permiso para abrir cuentas de crédito.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF length(v_nombre) < 3 THEN
    RAISE EXCEPTION 'El nombre del cliente es muy corto.' USING ERRCODE = 'check_violation';
  END IF;

  -- Camino normal: la cuenta ya existe.
  SELECT id INTO v_id
  FROM creditos_cuenta
  WHERE lower(btrim(nombre)) = lower(v_nombre) AND estado = 'activa';

  IF FOUND THEN
    RETURN v_id;
  END IF;

  -- No existía: crearla. Si otra sesión ganó la carrera entre el SELECT y el
  -- INSERT, el índice único parcial la detiene aquí y recuperamos SU id.
  BEGIN
    INSERT INTO creditos_cuenta (nombre, cliente_codigo, documento_id, telefono)
    VALUES (v_nombre, NULLIF(btrim(p_cliente_codigo), ''),
            NULLIF(btrim(p_documento_id), ''), NULLIF(btrim(p_telefono), ''))
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO v_id
      FROM creditos_cuenta
      WHERE lower(btrim(nombre)) = lower(v_nombre) AND estado = 'activa';
  END;

  RETURN v_id;
END;
$$;

REVOKE ALL  ON FUNCTION creditos_resolver_cuenta(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION creditos_resolver_cuenta(text, text, text, text) TO authenticated;
