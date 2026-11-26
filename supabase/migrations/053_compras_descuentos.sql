-- Migration 053: soporte de descuentos (por ítem, generales y en cascada) en compras manuales
--
-- El usuario ingresa el costo de lista y uno o más porcentajes de descuento
-- (ej. [20, 5] para 20% + 5% = 24% real). La app calcula exactamente el costo neto
-- redondeado a 2 decimales y lo guarda en compras_app_items.costo.
-- El listener/robot de HybridLite sigue leyendo exclusivamente compras_app_items.costo,
-- por lo que el write-back recibe el costo ya reducido sin cambiar el backend.

ALTER TABLE public.compras_app
  ADD COLUMN IF NOT EXISTS descuentos_generales jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.compras_app_items
  ADD COLUMN IF NOT EXISTS costo_lista numeric,
  ADD COLUMN IF NOT EXISTS descuentos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS excluir_descuento_general boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compras_app_descuentos_generales_array') THEN
    ALTER TABLE public.compras_app
      ADD CONSTRAINT compras_app_descuentos_generales_array
      CHECK (jsonb_typeof(descuentos_generales) = 'array');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compras_app_items_descuentos_array') THEN
    ALTER TABLE public.compras_app_items
      ADD CONSTRAINT compras_app_items_descuentos_array
      CHECK (jsonb_typeof(descuentos) = 'array');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compras_app_items_costo_lista_non_negative') THEN
    ALTER TABLE public.compras_app_items
      ADD CONSTRAINT compras_app_items_costo_lista_non_negative
      CHECK (costo_lista IS NULL OR costo_lista >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.compras_app.descuentos_generales IS
  'Arreglo ordenado de porcentajes de descuento general de la compra (ej. [10, 5] para cascada).';

COMMENT ON COLUMN public.compras_app_items.costo IS
  'Costo neto final en USD sin IVA ya reducido tras aplicar descuentos. Es el campo que consume el write-back de HybridLite.';

COMMENT ON COLUMN public.compras_app_items.costo_lista IS
  'Costo de lista original en USD sin IVA antes de aplicar descuentos (para reabrir borradores o reintentos sin doble descuento).';

COMMENT ON COLUMN public.compras_app_items.descuentos IS
  'Arreglo ordenado de porcentajes de descuento propios del ítem (ej. [20, 5] para cascada).';

COMMENT ON COLUMN public.compras_app_items.excluir_descuento_general IS
  'true cuando este ítem excluye los descuentos_generales de la cabecera.';
