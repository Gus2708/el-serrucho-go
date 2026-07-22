-- 036_pedidos_permission.sql
-- Control de permiso por usuario para emitir pedidos.
--
-- Semántica opt-out en profiles.notif_prefs:
--   "pedidos": ausente o true = HABILITADO, false = DESHABILITADO.
--
-- Los administradores gestionan esta clave desde admin-usuarios.tsx.

comment on column public.profiles.notif_prefs is
  'Preferencias y permisos por usuario. Keys: bots, zelle, pedidos. Ausente/true = habilitado, false = deshabilitado.';

-- Función auxiliar para verificar si el usuario actual tiene permiso para hacer pedidos
CREATE OR REPLACE FUNCTION public.can_user_make_pedidos()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND is_active = true
      AND (notif_prefs->>'pedidos') IS DISTINCT FROM 'false'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Actualización de políticas RLS en pedidos_app y pedidos_app_items para exigir can_user_make_pedidos()
DROP POLICY IF EXISTS "Active employees - write own pedidos" ON public.pedidos_app;
CREATE POLICY "Active employees - write own pedidos" ON public.pedidos_app
  FOR ALL TO authenticated
  USING      (is_active_employee() AND can_user_make_pedidos() AND creado_por = auth.uid() AND validate_session())
  WITH CHECK (is_active_employee() AND can_user_make_pedidos() AND creado_por = auth.uid() AND validate_session());

DROP POLICY IF EXISTS "Active employees - write own pedido items" ON public.pedidos_app_items;
CREATE POLICY "Active employees - write own pedido items" ON public.pedidos_app_items
  FOR ALL TO authenticated
  USING (is_active_employee() AND can_user_make_pedidos() AND pedido_id IN (
    SELECT id FROM public.pedidos_app WHERE creado_por = auth.uid()
  ) AND validate_session())
  WITH CHECK (is_active_employee() AND can_user_make_pedidos() AND pedido_id IN (
    SELECT id FROM public.pedidos_app WHERE creado_por = auth.uid()
  ) AND validate_session());
