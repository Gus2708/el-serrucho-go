-- Migration: 023_presupuesto_config.sql
-- Description: Create budget config table and add Bs fields to budgets table

-- Create budget config table
CREATE TABLE IF NOT EXISTS public.presupuesto_config (
    id INT PRIMARY KEY DEFAULT 1,
    markup_porcentaje NUMERIC NOT NULL DEFAULT 30, -- default 30%
    CONSTRAINT singleton_row CHECK (id = 1)
);

-- Insert default values
INSERT INTO public.presupuesto_config (id, markup_porcentaje)
VALUES (1, 30)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE public.presupuesto_config ENABLE ROW LEVEL SECURITY;

-- Select policy
CREATE POLICY "Allow authenticated read on budget config" ON public.presupuesto_config
    FOR SELECT TO authenticated USING (true);

-- Update policy for admins
CREATE POLICY "Admins can update budget config" ON public.presupuesto_config
    FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Add columns to presupuestos
ALTER TABLE public.presupuestos 
ADD COLUMN IF NOT EXISTS en_bs BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS tasa_cambio NUMERIC,
ADD COLUMN IF NOT EXISTS porcentaje_recargo NUMERIC;
