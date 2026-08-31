-- ============================================================================
--  RECONCILIACION: corrige los descuadres historicos causados por el bug de
--  registrar_venta no-atomico (ver fix_registrar_venta_atomico.sql).
--
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query, en tu proyecto
--  real de produccion.
--
--  IMPORTANTE — orden recomendado:
--   1) Corre PRIMERO fix_registrar_venta_atomico.sql (si no lo hiciste ya).
--      Ese es el arreglo de raiz: sin el, las ventas nuevas pueden volver a
--      desincronizarse y este script solo limpiaria el pasado una vez.
--   2) Corre este script para corregir los registros ya existentes.
--   3) Vuelve a correr el SELECT de diagnostico que te pase antes — debe
--      devolver 0 filas para cajas y 0 filas para clientes.
--
--  Que hace: recalcula cajas.total_efectivo / total_yape / total_fiado
--  sumando directamente las ventas reales (no anuladas) de cada caja, y
--  clientes_credito.deuda_actual sumando sus ventas fiado reales menos sus
--  abonos. Solo escribe en las filas cuyo valor guardado sea distinto del
--  recalculado — no toca nada que ya este correcto.
--
--  Seguro: no borra ni modifica ninguna venta, pago, ni movimiento de
--  inventario. Solo corrige los totales/saldos derivados.
-- ============================================================================

-- 1) Totales de caja (efectivo / yape / fiado) recalculados desde ventas
with sumas as (
  select
    c.id as caja_id,
    coalesce(sum(v.total) filter (where v.metodo = 'efectivo' and not v.anulada), 0) as efectivo_real,
    coalesce(sum(v.total) filter (where v.metodo = 'yape'     and not v.anulada), 0) as yape_real,
    coalesce(sum(v.total) filter (where v.metodo = 'fiado'    and not v.anulada), 0) as fiado_real
  from public.cajas c
  left join public.ventas v on v.caja_id = c.id
  group by c.id
)
update public.cajas c
set total_efectivo = s.efectivo_real,
    total_yape     = s.yape_real,
    total_fiado    = s.fiado_real
from sumas s
where s.caja_id = c.id
  and (c.total_efectivo is distinct from s.efectivo_real
    or c.total_yape is distinct from s.yape_real
    or c.total_fiado is distinct from s.fiado_real);

-- 2) Deuda de clientes fiado recalculada desde sus ventas fiado - sus abonos
with deuda as (
  select
    cc.id as cliente_id,
    round(coalesce(vf.total_fiado, 0) - coalesce(pc.total_abonado, 0), 2) as deuda_real
  from public.clientes_credito cc
  left join (
    select cliente_id, sum(total) as total_fiado
    from public.ventas
    where metodo = 'fiado' and not anulada and cliente_id is not null
    group by cliente_id
  ) vf on vf.cliente_id = cc.id
  left join (
    select cliente_id, sum(monto) as total_abonado
    from public.pagos_credito
    group by cliente_id
  ) pc on pc.cliente_id = cc.id
)
update public.clientes_credito cc
set deuda_actual = greatest(d.deuda_real, 0)
from deuda d
where d.cliente_id = cc.id
  and cc.deuda_actual is distinct from greatest(d.deuda_real, 0);
