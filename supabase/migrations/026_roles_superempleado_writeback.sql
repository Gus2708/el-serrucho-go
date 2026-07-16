-- Migration 026: roles de write-back (admin / superempleado / empleado) + gate de aprobación
--
-- Modelo de permisos para el write-back a HybridLite:
--   admin         → ajustes + compras, write-back directo.
--   superempleado → ajustes + compras, write-back directo; aprueba/rechaza ajustes de empleados.
--   empleado      → solo ajustes, que quedan EN ESPERA hasta que un privilegiado los apruebe;
--                   no puede registrar compras.
--
-- Idea del gate (sin tocar el backend Python): el listener solo procesa items con
-- backend_status='pendiente'. Un empleado que emite un ajuste ve sus items forzados a
-- 'espera_aprobacion' por trigger; aprobar los pasa a 'pendiente' (recién ahí el backend
-- los escribe en el POS); rechazar los pasa a 'rechazado'. Los inserts anon/service del
-- backend (creado_por NULL, auth.uid() NULL) no se tocan.

-- ── 1. Rol nuevo: superempleado ──────────────────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'superempleado', 'empleado'));

-- ── 2. Helper: usuario privilegiado (admin o superempleado, activo) ───────────
CREATE OR REPLACE FUNCTION public.is_privileged()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'superempleado')
      AND is_active = true
  );
END;
$$;

-- ── 3. Estados nuevos en ordenes_cambio_items.backend_status ──────────────────
ALTER TABLE public.ordenes_cambio_items
  DROP CONSTRAINT IF EXISTS ordenes_cambio_items_backend_status_check;
ALTER TABLE public.ordenes_cambio_items
  ADD CONSTRAINT ordenes_cambio_items_backend_status_check
  CHECK (backend_status IN (
    'pendiente', 'aplicando', 'error', 'completado',
    'espera_aprobacion', 'rechazado'
  ));

-- ── 4. Cabecera de aprobación en ordenes_cambio ──────────────────────────────
ALTER TABLE public.ordenes_cambio
  ADD COLUMN IF NOT EXISTS aprobacion_estado text NOT NULL DEFAULT 'no_aplica'
    CHECK (aprobacion_estado IN ('no_aplica', 'pendiente', 'aprobado', 'rechazado')),
  ADD COLUMN IF NOT EXISTS aprobado_por   uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS aprobado_en    timestamptz,
  ADD COLUMN IF NOT EXISTS rechazo_motivo text;

CREATE INDEX IF NOT EXISTS idx_ordenes_cambio_aprobacion_estado
  ON public.ordenes_cambio (aprobacion_estado);

-- ── 5. Trigger de gate (items): fuerza espera_aprobacion para no privilegiados ─
CREATE OR REPLACE FUNCTION public.fn_gate_item_aprobacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo aplica a inserts hechos por un usuario autenticado NO privilegiado.
  -- Inserts del backend (anon/service, auth.uid() NULL) quedan intactos.
  IF auth.uid() IS NOT NULL
     AND NEW.backend_status = 'pendiente'
     AND NOT public.is_privileged() THEN
    NEW.backend_status := 'espera_aprobacion';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gate_item_aprobacion ON public.ordenes_cambio_items;
CREATE TRIGGER trg_gate_item_aprobacion
  BEFORE INSERT ON public.ordenes_cambio_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_gate_item_aprobacion();

-- ── 6. Trigger de gate (cabecera): marca la orden como pendiente de aprobación ─
CREATE OR REPLACE FUNCTION public.fn_gate_orden_aprobacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_privileged() THEN
    NEW.aprobacion_estado := 'pendiente';
  ELSE
    NEW.aprobacion_estado := 'no_aplica';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gate_orden_aprobacion ON public.ordenes_cambio;
CREATE TRIGGER trg_gate_orden_aprobacion
  BEFORE INSERT ON public.ordenes_cambio
  FOR EACH ROW EXECUTE FUNCTION public.fn_gate_orden_aprobacion();

-- ── 7. RPCs de resolución (solo privilegiados; SECURITY DEFINER bypassa RLS) ──
CREATE OR REPLACE FUNCTION public.aprobar_orden(p_orden bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_privileged() THEN
    RAISE EXCEPTION 'No autorizado: se requiere admin o superempleado';
  END IF;

  UPDATE public.ordenes_cambio
    SET aprobacion_estado = 'aprobado',
        aprobado_por      = auth.uid(),
        aprobado_en       = now()
    WHERE id = p_orden
      AND aprobacion_estado = 'pendiente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden % no está pendiente de aprobación', p_orden;
  END IF;

  UPDATE public.ordenes_cambio_items
    SET backend_status = 'pendiente'
    WHERE orden_id = p_orden
      AND backend_status = 'espera_aprobacion';
END;
$$;

CREATE OR REPLACE FUNCTION public.rechazar_orden(p_orden bigint, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_privileged() THEN
    RAISE EXCEPTION 'No autorizado: se requiere admin o superempleado';
  END IF;

  UPDATE public.ordenes_cambio
    SET aprobacion_estado = 'rechazado',
        rechazo_motivo    = p_motivo
    WHERE id = p_orden
      AND aprobacion_estado = 'pendiente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden % no está pendiente de aprobación', p_orden;
  END IF;

  UPDATE public.ordenes_cambio_items
    SET backend_status = 'rechazado'
    WHERE orden_id = p_orden
      AND backend_status = 'espera_aprobacion';
END;
$$;

GRANT EXECUTE ON FUNCTION public.aprobar_orden(bigint)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.rechazar_orden(bigint, text)  TO authenticated;

-- ── 8. Compras: solo privilegiados pueden escribir (empleado no registra compras)
DROP POLICY IF EXISTS "Active employees - write own compras" ON public.compras_app;
CREATE POLICY "Privileged - write own compras" ON public.compras_app
  FOR ALL TO authenticated
  USING      (is_privileged() AND creado_por = auth.uid() AND validate_session())
  WITH CHECK (is_privileged() AND creado_por = auth.uid() AND validate_session());

DROP POLICY IF EXISTS "Active employees - write own compra items" ON public.compras_app_items;
CREATE POLICY "Privileged - write own compra items" ON public.compras_app_items
  FOR ALL TO authenticated
  USING (
    is_privileged()
    AND compra_id IN (SELECT id FROM public.compras_app WHERE creado_por = auth.uid())
    AND validate_session()
  )
  WITH CHECK (
    is_privileged()
    AND compra_id IN (SELECT id FROM public.compras_app WHERE creado_por = auth.uid())
    AND validate_session()
  );

-- ── 9. Gestión de usuarios (admin) + hardening anti-escalada ──────────────────
-- Un admin puede actualizar cualquier perfil (para asignar roles / activar usuarios).
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING      (is_admin())
  WITH CHECK (is_admin());

-- Impide que un usuario autenticado NO admin cambie su propio role/is_active
-- (la policy "update own profile" no protegía estas columnas → auto-promoción).
-- No aplica a operaciones server-side (dashboard / service_role, auth.uid() NULL).
CREATE OR REPLACE FUNCTION public.fn_protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar el rol o el estado de activación';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileges ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_profile_privileges();
