-- Migration 045: creditos_reabrir_cuenta verifica que la cuenta exista
--
-- Hallazgo de las pruebas de cierre/reapertura: a diferencia de
-- creditos_cerrar_cuenta (que sí valida existencia vía vw_creditos_saldo),
-- creditos_reabrir_cuenta hacía un UPDATE directo sin comprobar FOUND. Con un
-- id inexistente, el UPDATE afectaba 0 filas y el RPC "tenía éxito" sin haber
-- hecho nada — ni error, ni cambio, silencio total.
--
-- Impacto real bajo: las cuentas nunca se borran (no hay política ni RPC de
-- DELETE), así que cualquier id que la app cargó en pantalla siempre existe.
-- Se corrige de todos modos por consistencia con el resto de los RPC, que
-- siempre confirman qué tocaron antes de decir que tuvieron éxito.

CREATE OR REPLACE FUNCTION creditos_reabrir_cuenta(p_cuenta_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_privileged() THEN
    RAISE EXCEPTION 'No tienes permiso para reabrir cuentas.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM creditos_cuenta WHERE id = p_cuenta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta % no existe.', p_cuenta_id USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE creditos_cuenta
     SET estado = 'activa', cerrado_por = NULL, cerrado_en = NULL
   WHERE id = p_cuenta_id;
END;
$$;
