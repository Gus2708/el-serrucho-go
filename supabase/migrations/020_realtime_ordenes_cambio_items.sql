-- Migration 020: habilitar Realtime para ordenes_cambio_items
--
-- La app muestra el avance del write-back (backend_status) en vivo dentro del
-- detalle de una orden de cambio. Para que postgres_changes emita eventos de
-- esta tabla hay que agregarla a la publicación supabase_realtime (ya están
-- ordenes_cambio, productos, ventas, etc. — esta faltaba).
--
-- RLS sigue aplicando a los eventos: authenticated recibe cambios de items
-- según su política de SELECT (empleados activos leen todos los items).

ALTER PUBLICATION supabase_realtime ADD TABLE public.ordenes_cambio_items;
