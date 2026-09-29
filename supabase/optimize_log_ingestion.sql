-- ============================================================================
--  REDUCIR VOLUMEN DE REALTIME / LOG INGESTION
--
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query. Idempotente y
--  seguro — no toca datos, solo la forma en que Postgres registra los
--  cambios para replicacion logica (de donde sale Realtime).
--
--  Por que: con REPLICA IDENTITY FULL, cada UPDATE escribe la fila COMPLETA
--  (antes y despues) al WAL. Con REPLICA IDENTITY DEFAULT, solo escribe la
--  clave primaria de la fila anterior — de sobra para lo que el frontend
--  realmente usa (ver src/hooks/useProductos.ts y useVentasRealtime.ts: solo
--  leen payload.old.id en un DELETE, nunca otras columnas viejas). En una
--  bodega donde el stock se actualiza en cada linea de cada venta, este solo
--  cambio puede reducir bastante el volumen de Realtime/logs.
-- ============================================================================

alter table public.productos replica identity default;
alter table public.ventas    replica identity default;

-- detalle_ventas esta publicada a supabase_realtime pero ningun cliente la
-- escucha (grep "channel(" en src/ solo encuentra 'rt-productos' y
-- 'rt-ventas') — cada linea de venta insertada generaba trafico de Realtime
-- para nadie. Se puede volver a agregar en el futuro si algun componente
-- llega a necesitarla.
do $$
begin
  alter publication supabase_realtime drop table public.detalle_ventas;
exception when undefined_object then null; end $$;
