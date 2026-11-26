-- Supplier-invoice automation: owner-scoped supplier aliases on the saved-decision feedback RPC (read-only).
--
-- Additive replacement of buscar_feedback_productos_factura (20261120001240_factura_matching_feedback.sql): same
-- signature, SECURITY INVOKER, STABLE, empty search_path, ACL, guards, typed errors, limits and "decisiones" output.
-- It adds NO table, trigger, private function or write path. The response gains one key:
--   { "decisiones": [...unchanged...], "aliases": [ { "lineIndex": n, "codigoInterno": text } ] }
-- An alias says: the caller's latest current saved decision for this invoice supplier's printed code + unit confirmed
-- this SKU, even if the printed description has changed since. Like a decision it is a hint, NOT purchase authority,
-- product identity or proof of absence: the client matcher still applies its guards and the human still confirms.
--
-- Alias rules (on top of every rule of the original migration, whose fences and CTEs are reused verbatim):
--   * Key = owner + the invoice's own proveedor_codigo (never OCR text) + printed extraction code + printed unit,
--     normalized ONLY by collapsing whitespace and lower-casing: leading zeros and punctuation stay significant and an
--     unknown (blank) unit only matches another blank unit. A blank or SIN_CODIGO code never forms a key.
--   * The latest decision per key is selected FIRST (same ordering as decisiones) and validated afterwards, so a later
--     producto_nuevo, a later different SKU, a placeholder/missing/deleted SKU or an ambiguous code reuse never lets an
--     older SKU through. Resets to pending and detached saves stop counting through the "latest current revision" rule.
--   * Ambiguous code reuse fails closed: if the winner's revision holds another decision for the same key, no alias.
--   * A target line whose exact printed context has a different winning decision gets no alias.
--   * Only lineIndex and the SKU leave the function: no code, description, supplier, invoice, user or count.

CREATE OR REPLACE FUNCTION public.buscar_feedback_productos_factura(
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
  v_resultado  jsonb;
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
    RETURN jsonb_build_object('decisiones', '[]'::jsonb, 'aliases', '[]'::jsonb);
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
                ELSE concat_ws(chr(31), p.codigo, p.descripcion, p.unidad) END AS ctx,
           CASE WHEN p.codigo IN ('', 'sin_codigo') THEN NULL
                ELSE concat_ws(chr(31), p.codigo, p.unidad) END AS clave
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
  ),
  claves AS (
    -- Latest decision per supplier code + unit, chosen before any validation so nothing older can win instead.
    SELECT DISTINCT ON (c.clave)
           c.clave, c.factura_id, c.revision, c.aso ->> 'tipo' AS decision, c.aso ->> 'codigoInterno' AS codigo
      FROM contextos AS c
     WHERE c.tipo = 'historial' AND c.clave IS NOT NULL
     ORDER BY c.clave, c.creado_en DESC, c.revision DESC, c.factura_id DESC, c.linea_id DESC
  ),
  alias_validos AS (
    SELECT k.clave, k.codigo
      FROM claves AS k
     WHERE k.decision = 'confirmado'
       AND EXISTS (
         SELECT 1 FROM public.productos_view AS p
          WHERE p.codigo_interno = k.codigo AND NOT coalesce(p.es_placeholder, false)
       )
       -- Code reuse inside the winning revision is ambiguous: fail closed.
       AND NOT EXISTS (
         SELECT 1 FROM contextos AS o
          WHERE o.tipo = 'historial' AND o.clave = k.clave
            AND o.factura_id = k.factura_id AND o.revision = k.revision
            AND (o.aso ->> 'tipo' <> 'confirmado' OR o.aso ->> 'codigoInterno' IS DISTINCT FROM k.codigo)
       )
  )
  SELECT jsonb_build_object(
           'decisiones', coalesce((
             SELECT jsonb_agg(
                      jsonb_build_object('lineIndex', o.idx, 'decision', g.decision, 'codigoInterno', g.codigo)
                      ORDER BY o.idx
                    )
               FROM contextos AS o
               JOIN ganadoras AS g ON g.ctx = o.ctx
              WHERE o.tipo = 'objetivo'
                AND (
                  g.decision = 'producto_nuevo'
                  OR EXISTS (
                    SELECT 1 FROM public.productos_view AS p
                     WHERE p.codigo_interno = g.codigo AND NOT coalesce(p.es_placeholder, false)
                  )
                )
           ), '[]'::jsonb),
           'aliases', coalesce((
             SELECT jsonb_agg(jsonb_build_object('lineIndex', o.idx, 'codigoInterno', a.codigo) ORDER BY o.idx)
               FROM contextos AS o
               JOIN alias_validos AS a ON a.clave = o.clave
               LEFT JOIN ganadoras AS g ON g.ctx = o.ctx
              WHERE o.tipo = 'objetivo'
                -- A disagreeing exact-context winner (another SKU or producto_nuevo) suppresses the alias.
                AND (g.ctx IS NULL OR (g.decision = 'confirmado' AND g.codigo = a.codigo))
           ), '[]'::jsonb)
         )
    INTO v_resultado;

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.buscar_feedback_productos_factura(uuid, uuid, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.buscar_feedback_productos_factura(uuid, uuid, integer)
  TO authenticated;
