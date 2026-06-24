-- Migration: 017_presupuestos_admin_edit.sql
-- Description: Allow admins to EDIT (update/insert) any budget, complementing the
--              existing admin DELETE policies. Owners keep full write on their own
--              budgets via the pre-existing "Active employees - write own budgets"
--              and "Active employees - write budget details" policies.
--
-- Without these, an admin editing another user's budget would be silently rejected
-- by RLS (rows updated = 0 / insert blocked), even though the UI allowed it.

-- ── presupuestos: admin can update any header ──────────────────────────────────
CREATE POLICY "Admins can update all budgets" ON public.presupuestos
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ── presupuestos_detalle: admin can insert any detail row ──────────────────────
CREATE POLICY "Admins can insert all budget details" ON public.presupuestos_detalle
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

-- ── presupuestos_detalle: admin can update any detail row ──────────────────────
CREATE POLICY "Admins can update all budget details" ON public.presupuestos_detalle
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());
