CREATE TABLE IF NOT EXISTS public.fallas_negocio (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  texto text NOT NULL,
  codigo_producto text REFERENCES public.productos(codigo_interno) ON DELETE SET NULL,
  creado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pedido boolean DEFAULT false,
  creado_en timestamptz DEFAULT now()
);

ALTER TABLE public.fallas_negocio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fallas de negocio accesibles por todos los autenticados" 
ON public.fallas_negocio FOR ALL TO authenticated 
USING (true) WITH CHECK (true);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.fallas_negocio;
