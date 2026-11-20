-- Supplier-invoice automation: saved human product decisions as search feedback (read-only).
--
-- The append-only public.facturas_proveedores_revisiones history is already the durable audit trail of every
-- explicit association a person saved. This migration adds NO table, trigger, vote counter or write path: it adds one
-- read-only RPC that turns that history into hints for the lines of a current extraction.
--
-- Contract: buscar_feedback_productos_factura(p_factura_id, p_extraccion_id, p_version_esperada) returns
--   { "decisiones": [ { "lineIndex": n, "decision": "confirmado" | "producto_nuevo", "codigoInterno": text | null } ] }
-- lineIndex is the zero-based position in the target extraction's lineas (first 200 lines only). Nothing else is
-- exposed: no invoice, user, description or count. A hint is NOT purchase authority, a product identity or proof of
-- absence: the client matcher still applies its hard variant/model guards and the human still confirms.
--
-- Authority and evidence rules:
--   * SECURITY INVOKER + fixed empty search_path: every read goes through the caller's RLS (own, privileged,
--     valid-session rows only). The checks below are explicit as well, never a bypass.
--   * The target must be the caller's invoice and one of its completed extractions, with the exact current invoice
--     version and document hash. Stale/foreign/missing sources fail with stable typed errors and no data.
--   * Supplier = the selected invoice's own proveedor_codigo (never OCR text). A missing or blank supplier learns
--     nothing and nothing is learned from other supplier-less invoices.
--   * Only the LATEST revision of each of the caller's invoices of the same supplier counts, and only while that
--     revision is still current (same invoice version and document hash, completed extraction of the same version).
--     A newer pending/reset/detached save therefore supersedes older confirmations instead of reviving them.
--   * Only lines that come from an extraction line (origen.numeroLinea) with a saved confirmado/producto_nuevo
--     decision count. Manual lines and unconfirmed (pendiente) lines are skipped. Unsaved clicks never reach here.
--   * Context = raw printed supplier code + raw description + raw unit of the EXTRACTION line (never corrected
--     values), normalized ONLY by collapsing whitespace and lower-casing: leading zeros, punctuation, model and unit
--     stay significant.
--   * Per context the latest explicit decision wins (creado_en, revision, invoice id, line id; all descending), so a
--     corrected selection B replaces A and repeated saves or confirmations add no weight. The winner is validated
--     afterwards: a confirmed SKU that no longer exists in productos_view, or is a placeholder, yields no hint and
--     never falls back to an older SKU. Stock is never a filter.
--   * Bounded work: at most 200 target lines and the 200 most recent eligible historical invoices.
--
-- Error codes: 42501 no_autorizado · 22023 payload_invalido / extraccion_invalida · P0002 fuente_no_disponible ·
--              PV409 version_obsoleta

CREATE FUNCTION public.buscar_feedback_productos_factura(
  p_factura_id        uuid,
  p_extraccion_id     uuid,
  p_version_esperada  integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_factura    public.facturas_proveedores%ROWTYPE;
  v_extraccion public.facturas_proveedores_extracciones%ROWTYPE;
  v_proveedor  text;
  v_decisiones jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_privileged() OR NOT public.validate_session() THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_factura_id IS NULL OR p_extraccion_id IS NULL OR p_version_esperada IS NULL OR p_version_esperada < 1 THEN
    RAISE EXCEPTION 'payload_invalido: identificadores o version' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_factura FROM public.facturas_proveedores
   WHERE id = p_factura_id AND creado_por = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fuente_no_disponible' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_extraccion FROM public.facturas_proveedores_extracciones
   WHERE id = p_extraccion_id AND factura_id = p_factura_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fuente_no_disponible' USING ERRCODE = 'P0002';
  END IF;

  IF v_factura.version <> p_version_esperada
     OR v_extraccion.factura_version <> v_factura.version
     OR v_extraccion.documento_sha256 IS DISTINCT FROM v_factura.documento_sha256 THEN
    RAISE EXCEPTION 'version_obsoleta' USING ERRCODE = 'PV409';
  END IF;

  IF v_extraccion.estado <> 'completado' OR jsonb_typeof(v_extraccion.resultado -> 'lineas') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'extraccion_invalida' USING ERRCODE = '22023';
  END IF;

  -- Unknown supplier: nothing is reusable and nothing is shared across supplier-less invoices.
  v_proveedor := lower(btrim(regexp_replace(coalesce(v_factura.proveedor_codigo, ''), '\s+', ' ', 'g')));
  IF v_proveedor = '' THEN
    RETURN jsonb_build_object('decisiones', '[]'::jsonb);
  END IF;

  WITH vigentes AS (
    -- Latest revision per invoice, kept only while it still matches the invoice and its completed extraction.
    SELECT f.id AS factura_id, r.revision, r.creado_en, r.contenido, e.resultado
      FROM public.facturas_proveedores AS f
      JOIN public.facturas_proveedores_revisiones AS r ON r.factura_id = f.id
      JOIN public.facturas_proveedores_extracciones AS e ON e.id = r.extraccion_id AND e.factura_id = f.id
     WHERE f.creado_por = v_uid
       AND r.creado_por = v_uid
       AND lower(btrim(regexp_replace(coalesce(f.proveedor_codigo, ''), '\s+', ' ', 'g'))) = v_proveedor
       AND r.revision = (SELECT max(m.revision) FROM public.facturas_proveedores_revisiones AS m WHERE m.factura_id = f.id)
       AND r.factura_version = f.version
       AND r.documento_sha256 IS NOT DISTINCT FROM f.documento_sha256
       AND e.estado = 'completado'
       AND e.factura_version = f.version
       AND e.documento_sha256 IS NOT DISTINCT FROM f.documento_sha256
       AND jsonb_typeof(e.resultado -> 'lineas') = 'array'
     ORDER BY r.creado_en DESC, r.revision DESC, f.id DESC
     LIMIT 200
  ),
  fuentes AS (
    SELECT 'objetivo'::text AS tipo, (t.pos - 1)::integer AS idx,
           NULL::timestamptz AS creado_en, NULL::integer AS revision, NULL::uuid AS factura_id,
           NULL::text AS linea_id, NULL::jsonb AS aso, t.elem
      FROM jsonb_array_elements(v_extraccion.resultado -> 'lineas') WITH ORDINALITY AS t(elem, pos)
     WHERE t.pos <= 200
    UNION ALL
    SELECT 'historial'::text, NULL::integer, v.creado_en, v.revision, v.factura_id,
           l.elem ->> 'lineaId', l.elem -> 'asociacion', src.elem
      FROM vigentes AS v
     CROSS JOIN LATERAL jsonb_array_elements(v.contenido -> 'lineas') AS l(elem)
      JOIN LATERAL (
        -- Same origin rule as the revision validator: the numeric numeroLinea, else the 1-based position.
        SELECT x.elem
          FROM jsonb_array_elements(v.resultado -> 'lineas') WITH ORDINALITY AS x(elem, pos)
         WHERE CASE WHEN jsonb_typeof(x.elem -> 'numeroLinea') = 'number'
                    THEN (x.elem ->> 'numeroLinea')::numeric ELSE x.pos::numeric END
               = (l.elem -> 'origen' ->> 'numeroLinea')::numeric
         LIMIT 1
      ) AS src ON true
     WHERE jsonb_typeof(l.elem -> 'origen') = 'object'
       AND l.elem -> 'asociacion' ->> 'tipo' IN ('confirmado', 'producto_nuevo')
  ),
  contextos AS (
    SELECT f.*,
           CASE WHEN p.codigo = '' AND p.descripcion = '' THEN NULL
                ELSE concat_ws(chr(31), p.codigo, p.descripcion, p.unidad) END AS ctx
      FROM fuentes AS f
     CROSS JOIN LATERAL (
       SELECT lower(btrim(regexp_replace(coalesce(f.elem ->> 'codigoProveedor', ''), '\s+', ' ', 'g'))) AS codigo,
              lower(btrim(regexp_replace(coalesce(f.elem ->> 'descripcion', ''), '\s+', ' ', 'g'))) AS descripcion,
              lower(btrim(regexp_replace(coalesce(f.elem ->> 'unidad', ''), '\s+', ' ', 'g'))) AS unidad
     ) AS p
  ),
  ganadoras AS (
    SELECT DISTINCT ON (c.ctx)
           c.ctx, c.aso ->> 'tipo' AS decision, c.aso ->> 'codigoInterno' AS codigo
      FROM contextos AS c
     WHERE c.tipo = 'historial' AND c.ctx IS NOT NULL
     ORDER BY c.ctx, c.creado_en DESC, c.revision DESC, c.factura_id DESC, c.linea_id DESC
  )
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object('lineIndex', o.idx, 'decision', g.decision, 'codigoInterno', g.codigo)
             ORDER BY o.idx
           ),
           '[]'::jsonb
         )
    INTO v_decisiones
    FROM contextos AS o
    JOIN ganadoras AS g ON g.ctx = o.ctx
   WHERE o.tipo = 'objetivo'
     AND (
       g.decision = 'producto_nuevo'
       OR EXISTS (
         SELECT 1 FROM public.productos_view AS p
          WHERE p.codigo_interno = g.codigo AND NOT coalesce(p.es_placeholder, false)
       )
     );

  RETURN jsonb_build_object('decisiones', v_decisiones);
END;
$$;

REVOKE ALL ON FUNCTION public.buscar_feedback_productos_factura(uuid, uuid, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.buscar_feedback_productos_factura(uuid, uuid, integer)
  TO authenticated;
