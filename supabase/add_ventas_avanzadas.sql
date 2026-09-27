-- ============================================================================
--  VENTAS: edicion, anulacion abierta a cajeros, pagos mixtos, auditoria
--
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query, en tu proyecto
--  de produccion. Es idempotente (seguro correrlo mas de una vez) y NO borra
--  ningun dato existente.
--
--  Requiere haber corrido antes supabase/add_presentaciones.sql (o tener ya
--  esa migracion aplicada) — este script usa la funcion
--  resolver_presentacion() que esa migracion crea.
--
--  Que agrega:
--   - Persistencia del carrito del POS (ver src/hooks/useCarrito.ts) — no
--     requiere cambios de base de datos, solo codigo de frontend.
--   - Pagos mixtos (ej. Efectivo + Yape en una misma venta): tabla
--     pagos_venta con el desglose real de cada venta, y registrar_venta()
--     actualizado para aceptar un arreglo de pagos ademas del flujo de
--     siempre de un solo metodo (100% compatible, sin cambios de
--     comportamiento para llamadas existentes).
--   - editar_venta(): NUEVA funcion transaccional que reemplaza los
--     productos de una venta ya registrada sin anularla — repone el stock
--     viejo, valida y descuenta el nuevo, recalcula subtotal/IGV/total, y
--     reescala proporcionalmente los pagos originales para ajustar la caja
--     y la deuda del cliente por la diferencia.
--   - anular_venta() ahora exige un motivo, esta abierta a cualquier usuario
--     activo (antes solo admin) y ADEMAS revierte caja y deuda del cliente
--     (antes solo reponia stock) — usa el desglose de pagos_venta.
--   - auditoria_ventas: registro de quien anulo/edito que venta, cuando y
--     por que — la salvaguarda de abrir la anulacion a cajeros.
--   - Registro rapido de clientes desde el cobro: nueva politica RLS que
--     permite a cualquier cajero CREAR un cliente de credito (antes solo
--     administrador); modificar/eliminar clientes sigue siendo admin-only.
-- ============================================================================

-- ── 1) Enum: agrega 'mixto' como metodo de pago (para ventas.metodo) ────────
alter type metodo_pago add value if not exists 'mixto';

-- ── 2) Columna nueva en ventas ───────────────────────────────────────────────
alter table public.ventas add column if not exists editada boolean not null default false;
comment on column public.ventas.editada is
  'true si sus productos/cantidades fueron modificados despues de registrada (ver editar_venta() y auditoria_ventas).';

-- ── 3) Tabla de pagos por venta (desglose por metodo — pagos mixtos) ────────
create table if not exists public.pagos_venta (
  id         uuid primary key default gen_random_uuid(),
  venta_id   uuid not null references public.ventas(id) on delete cascade,
  metodo     metodo_pago not null,
  monto      numeric(10,2) not null check (monto > 0),
  creado_en  timestamptz not null default now()
);

create index if not exists idx_pagos_venta_venta on public.pagos_venta (venta_id);

comment on table public.pagos_venta is
  'Desglose de como se pago cada venta. sum(monto) por venta_id == ventas.total siempre. metodo=mixto en ventas.metodo cuando hay 2+ filas con distinto metodo aqui.';

-- Backfill: toda venta no anulada que todavia no tenga filas aqui recibe una
-- sola fila con su metodo/total tal cual, para que anular_venta()/
-- editar_venta() operen igual sobre cualquier venta, vieja o nueva.
insert into public.pagos_venta (venta_id, metodo, monto)
select v.id, v.metodo, v.total
from public.ventas v
where not v.anulada
  and v.total > 0
  and not exists (select 1 from public.pagos_venta pv where pv.venta_id = v.id);

-- ── 4) Auditoria de ventas (anulaciones y ediciones) ─────────────────────────
create table if not exists public.auditoria_ventas (
  id             uuid primary key default gen_random_uuid(),
  venta_id       uuid references public.ventas(id) on delete set null,
  venta_numero   bigint,
  accion         text not null check (accion in ('anulada', 'editada')),
  usuario_id     uuid references public.perfiles(id) on delete set null,
  usuario_nombre text,
  motivo         text not null check (btrim(motivo) <> ''),
  detalle        jsonb,
  creado_en      timestamptz not null default now()
);

create index if not exists idx_auditoria_ventas_venta on public.auditoria_ventas (venta_id, creado_en desc);

comment on table public.auditoria_ventas is
  'Rastro de auditoria de anulaciones y ediciones de ventas: quien, cuando y por que. Solo se escribe desde anular_venta()/editar_venta() (security definer).';

-- ── 5) RLS: pagos_venta y auditoria_ventas (lectura para todo el personal;
--      escritura solo via las funciones RPC security definer) ──────────────
alter table public.pagos_venta      enable row level security;
alter table public.auditoria_ventas enable row level security;

drop policy if exists pagos_venta_select on public.pagos_venta;
create policy pagos_venta_select on public.pagos_venta for select
  to authenticated using (true);

drop policy if exists auditoria_ventas_select on public.auditoria_ventas;
create policy auditoria_ventas_select on public.auditoria_ventas for select
  to authenticated using (true);

-- ── 6) RLS: clientes_credito — permite a cualquier cajero CREAR un cliente
--      nuevo (registro rapido desde el cobro); modificar/eliminar sigue
--      siendo solo administrador ────────────────────────────────────────────
drop policy if exists clientes_write on public.clientes_credito;
drop policy if exists clientes_insert on public.clientes_credito;
create policy clientes_insert on public.clientes_credito for insert
  to authenticated with check (true);
drop policy if exists clientes_update on public.clientes_credito;
create policy clientes_update on public.clientes_credito for update
  to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists clientes_delete on public.clientes_credito;
create policy clientes_delete on public.clientes_credito for delete
  to authenticated using (public.es_admin());

-- ── 7) Funciones: registrar_venta (pagos mixtos), anular_venta (motivo +
--      abierta a cajeros + revierte caja/deuda), editar_venta (nueva) ──────
create or replace function public.registrar_venta(
  p_items         jsonb,         -- [{ producto_id, cantidad, precio_unitario, modalidad }]
  p_metodo        metodo_pago default null,
  p_descuento     numeric  default 0,
  p_pago_recibido numeric  default 0,
  p_caja_id       uuid     default null,
  p_cliente_id    uuid     default null,
  p_tasa_igv      numeric  default 0.18,
  -- Pago mixto: [{ metodo, monto }, ...] con 2+ metodos distintos (ej.
  -- Efectivo + Yape). Si es null/vacio, se usa el flujo de siempre
  -- (p_metodo + p_pago_recibido, un solo metodo) — 100% compatible con
  -- llamadas existentes que no conocen este parametro.
  p_pagos         jsonb    default null
)
returns public.ventas
language plpgsql
security definer set search_path = public
as $$
declare
  v_item        jsonb;
  v_producto    public.productos%rowtype;
  -- numeric (no double precision): se usan en round(x, 2) para los montos,
  -- y Postgres no tiene una funcion round(double precision, integer).
  -- Al insertar/comparar contra columnas double precision, Postgres castea
  -- implicitamente sin problema.
  v_cantidad    numeric;
  v_modalidad   text;
  v_unidades    numeric;
  v_precio      numeric(10,2);
  v_sub         numeric(10,2);
  v_subtotal    numeric(10,2) := 0;
  v_total       numeric(10,2);
  v_igv         numeric(10,2);
  v_base        numeric(10,2);
  v_venta       public.ventas%rowtype;
  v_nombre      text;
  v_cli_nombre  text;
  -- Acumula, por producto, el total de unidades reales que se van a
  -- descontar en TODA la venta — un mismo producto puede aparecer dos veces
  -- en el carrito (ej. unidades sueltas + una caja completa). Validar cada
  -- linea del carrito por separado contra el stock (como hacia esta funcion
  -- antes) dejaba pasar combinaciones que, SUMADAS, superaban el stock
  -- disponible, y el stock quedaba negativo sin ningun aviso.
  v_mapa        jsonb := '{}'::jsonb;
  v_req         record;
  v_resuelto    record;
  v_pres_nombre text;
  -- Pagos (una o mas "piernas"): ver nota del parametro p_pagos arriba.
  v_pagos            jsonb;
  v_pago             jsonb;
  v_pago_metodo       metodo_pago;
  v_pago_monto        numeric(10,2);
  v_suma_pagos         numeric(10,2) := 0;
  v_vuelto             numeric(10,2);
  v_vuelto_restante    numeric(10,2);
  v_efectivo_total      numeric(10,2);
  v_metodo_final        metodo_pago;
  v_metodos_distintos   int;
  v_hay_fiado           boolean;
  v_contribucion        numeric(10,2);
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito esta vacio.';
  end if;

  select nombre into v_nombre from public.perfiles where id = auth.uid();

  if p_cliente_id is not null then
    select nombre into v_cli_nombre from public.clientes_credito where id = p_cliente_id;
  end if;

  -- 0) Arma la lista unificada de pagos y valida que cubran el total. Se
  --    hace ANTES de tocar stock/cabecera para fallar rapido y limpio.
  if p_pagos is not null and jsonb_array_length(p_pagos) > 0 then
    v_pagos := p_pagos;
  else
    if p_metodo is null then
      raise exception 'Debes indicar un metodo de pago.';
    end if;
    v_pagos := jsonb_build_array(jsonb_build_object('metodo', p_metodo, 'monto', p_pago_recibido));
  end if;

  select count(distinct value->>'metodo') into v_metodos_distintos
    from jsonb_array_elements(v_pagos);
  v_hay_fiado := exists (select 1 from jsonb_array_elements(v_pagos) p where p->>'metodo' = 'fiado');

  if v_hay_fiado and p_cliente_id is null then
    raise exception 'Debes seleccionar un cliente para la parte al fiado.';
  end if;

  for v_pago in select * from jsonb_array_elements(v_pagos)
  loop
    v_pago_monto := (v_pago->>'monto')::numeric;
    if v_pago_monto is null or v_pago_monto <= 0 then
      raise exception 'Cada monto de pago debe ser mayor a 0.';
    end if;
    v_suma_pagos := v_suma_pagos + v_pago_monto;
  end loop;

  -- 1) Bloquea cada producto involucrado y acumula subtotal + unidades
  --    totales requeridas por producto (bloqueo de filas para evitar carreras).
  --    "unidades" es siempre lo que realmente se descuenta del stock (calculado
  --    aqui, en servidor, en vez de confiar en lo que mande el frontend) via
  --    resolver_presentacion(): legacy 'caja'/'saco'/'unidad' o el id de una
  --    presentacion flexible (Paquete, Bolsa, Media Caja, etc.).
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_producto from public.productos
      where id = (v_item->>'producto_id')::uuid for update;

    if not found then
      raise exception 'Producto % no existe.', v_item->>'producto_id';
    end if;

    v_cantidad  := (v_item->>'cantidad')::numeric;
    v_modalidad := coalesce(v_item->>'modalidad', 'unidad');

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad invalida para "%".', v_producto.nombre;
    end if;

    select * into v_resuelto from public.resolver_presentacion(v_producto, v_modalidad);
    v_unidades := v_resuelto.factor * v_cantidad;
    v_precio   := coalesce((v_item->>'precio_unitario')::numeric, v_producto.precio_venta);

    v_mapa := jsonb_set(
      v_mapa,
      array[v_producto.id::text],
      to_jsonb(coalesce((v_mapa->>v_producto.id::text)::numeric, 0) + v_unidades)
    );

    v_subtotal := v_subtotal + (v_precio * v_cantidad);
  end loop;

  -- Valida el stock disponible contra el TOTAL acumulado por producto (no
  -- por linea de carrito individual).
  for v_req in select key as producto_id, value::numeric as unidades from jsonb_each_text(v_mapa)
  loop
    select * into v_producto from public.productos where id = v_req.producto_id::uuid;
    if v_producto.stock_actual < v_req.unidades then
      raise exception 'Stock insuficiente para "%": disponible % %, solicitado %',
        v_producto.nombre, v_producto.stock_actual, v_producto.unidad, v_req.unidades;
    end if;
  end loop;

  -- 2) Calculos (IGV incluido en precio de venta - modelo peruano)
  v_subtotal := round(v_subtotal, 2);
  v_total    := round(greatest(v_subtotal - coalesce(p_descuento, 0), 0), 2);
  v_base     := round(v_total / (1 + p_tasa_igv), 2);
  v_igv      := round(v_total - v_base, 2);

  -- 2b) Ahora que se conoce el total, valida que los pagos lo cubran.
  --     "vuelto" solo puede salir de piernas en efectivo — Yape/tarjeta/
  --     fiado son montos exactos, no dan cambio.
  if v_suma_pagos < v_total then
    raise exception 'La suma de los pagos (%) no cubre el total de la venta (%).', v_suma_pagos, v_total;
  end if;
  v_vuelto := round(v_suma_pagos - v_total, 2);

  select coalesce(sum((p->>'monto')::numeric), 0) into v_efectivo_total
    from jsonb_array_elements(v_pagos) p where p->>'metodo' = 'efectivo';

  if v_vuelto > 0 and v_efectivo_total < v_vuelto then
    raise exception 'El vuelto (%) no puede exceder el efectivo recibido (%).', v_vuelto, v_efectivo_total;
  end if;

  v_metodo_final := case when v_metodos_distintos > 1 then 'mixto'::metodo_pago
                          else (v_pagos->0->>'metodo')::metodo_pago end;

  -- 3) Cabecera de la venta
  insert into public.ventas (
    cajero_id, cajero_nombre, caja_id, cliente_id, cliente_nombre,
    subtotal, descuento, igv, total, metodo, pago_recibido, vuelto
  ) values (
    auth.uid(), v_nombre, p_caja_id, p_cliente_id, v_cli_nombre,
    v_subtotal, coalesce(p_descuento, 0), v_igv, v_total,
    v_metodo_final, v_suma_pagos, v_vuelto
  ) returning * into v_venta;

  -- 4) Detalle + descuento de stock + kardex
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_producto from public.productos
      where id = (v_item->>'producto_id')::uuid;
    v_cantidad  := (v_item->>'cantidad')::numeric;
    v_modalidad := coalesce(v_item->>'modalidad', 'unidad');
    select * into v_resuelto from public.resolver_presentacion(v_producto, v_modalidad);
    v_unidades    := v_resuelto.factor * v_cantidad;
    v_pres_nombre := v_resuelto.nombre;
    v_precio    := coalesce((v_item->>'precio_unitario')::numeric, v_producto.precio_venta);
    v_sub       := round(v_precio * v_cantidad, 2);

    insert into public.detalle_ventas (
      venta_id, producto_id, producto_nombre, sku, cantidad, modalidad, unidades,
      precio_unitario, subtotal, presentacion_nombre
    ) values (
      v_venta.id, v_producto.id, v_producto.nombre, v_producto.sku,
      v_cantidad, v_modalidad, v_unidades, v_precio, v_sub, v_pres_nombre
    );

    update public.productos
      set stock_actual = stock_actual - v_unidades
      where id = v_producto.id;

    insert into public.movimientos_inventario (
      producto_id, producto_nombre, tipo, cantidad,
      stock_previo, stock_nuevo, motivo, usuario_id
    ) values (
      v_producto.id, v_producto.nombre, 'venta', -v_unidades,
      v_producto.stock_actual, v_producto.stock_actual - v_unidades,
      'Venta #' || v_venta.numero, auth.uid()
    );
  end loop;

  -- 5) Pagos + caja + deuda del cliente fiado, DENTRO de la misma
  --    transaccion que la venta. Antes esto se hacia con llamadas RPC
  --    separadas desde el cliente (incrementar_caja / registrar_cargo_fiado)
  --    DESPUES de que esta funcion ya habia confirmado la venta: si el
  --    navegador perdia conexion justo entre esas llamadas (tipico en datos
  --    moviles de una bodega), la venta quedaba registrada y el stock
  --    descontado correctamente, pero el total de la caja o la deuda del
  --    cliente NO se actualizaban — un descuadre invisible que no aparecia
  --    en ningun lado hasta el cierre de caja. Ahora todo ocurre en un solo
  --    commit: o se guarda completo, o no se guarda nada.
  --
  --    Se inserta una fila en pagos_venta por cada pierna, con su
  --    CONTRIBUCION real (neta del vuelto si es la pierna en efectivo la que
  --    da cambio) — por eso sum(monto) de pagos_venta para esta venta
  --    siempre da exactamente v_total, invariante que editar_venta() usa
  --    para reescalar los pagos cuando el total cambia.
  v_vuelto_restante := v_vuelto;
  for v_pago in select * from jsonb_array_elements(v_pagos)
  loop
    v_pago_metodo := (v_pago->>'metodo')::metodo_pago;
    v_pago_monto  := (v_pago->>'monto')::numeric;

    if v_pago_metodo = 'efectivo' and v_vuelto_restante > 0 then
      v_contribucion := v_pago_monto - least(v_pago_monto, v_vuelto_restante);
      v_vuelto_restante := v_vuelto_restante - (v_pago_monto - v_contribucion);
    else
      v_contribucion := v_pago_monto;
    end if;

    insert into public.pagos_venta (venta_id, metodo, monto)
      values (v_venta.id, v_pago_metodo, v_contribucion);

    if p_caja_id is not null then
      if v_pago_metodo = 'efectivo' then
        update public.cajas set total_efectivo = total_efectivo + v_contribucion where id = p_caja_id;
      elsif v_pago_metodo = 'yape' then
        update public.cajas set total_yape = total_yape + v_contribucion where id = p_caja_id;
      elsif v_pago_metodo = 'fiado' then
        update public.cajas set total_fiado = total_fiado + v_contribucion where id = p_caja_id;
      end if;
      -- tarjeta/plin/transferencia: sin columna dedicada en cajas (igual que
      -- antes de los pagos mixtos); quedan en pagos_venta para el detalle.
    end if;

    if v_pago_metodo = 'fiado' then
      update public.clientes_credito
        set deuda_actual = deuda_actual + v_contribucion
        where id = p_cliente_id;
    end if;
  end loop;

  return v_venta;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC 2: AJUSTE MANUAL DE STOCK (entradas / salidas / ajustes / devoluciones)
-- ----------------------------------------------------------------------------
-- El parametro p_cantidad cambio de integer a numeric (para soportar ajustes
-- fraccionados en productos a granel), por lo que hay que tumbar la firma vieja:
-- "create or replace" no permite cambiar el tipo de un parametro existente.
drop function if exists public.ajustar_stock(uuid, integer, tipo_movimiento, text);

create or replace function public.ajustar_stock(
  p_producto_id uuid,
  p_cantidad    numeric,
  p_tipo        tipo_movimiento,
  p_motivo      text default null
)
returns public.productos
language plpgsql
security definer set search_path = public
as $$
declare
  v_prod  public.productos%rowtype;
  v_nuevo double precision;
begin
  select * into v_prod from public.productos where id = p_producto_id for update;
  if not found then raise exception 'Producto no encontrado.'; end if;

  v_nuevo := v_prod.stock_actual + p_cantidad;
  if v_nuevo < 0 then
    raise exception 'El ajuste dejaria el stock en negativo (% + %).',
      v_prod.stock_actual, p_cantidad;
  end if;

  update public.productos set stock_actual = v_nuevo where id = p_producto_id
    returning * into v_prod;

  insert into public.movimientos_inventario (
    producto_id, producto_nombre, tipo, cantidad,
    stock_previo, stock_nuevo, motivo, usuario_id
  ) values (
    p_producto_id, v_prod.nombre, p_tipo, p_cantidad,
    v_nuevo - p_cantidad, v_nuevo, p_motivo, auth.uid()
  );

  return v_prod;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC 3: REGISTRAR COMPRA (transaccional: cabecera + detalle + stock + kardex)
-- ----------------------------------------------------------------------------
-- Antes esto se hacia con 3 llamadas separadas desde el cliente (insert en
-- compras, insert en detalle_compras, y un ajustar_stock() por cada item) sin
-- ninguna transaccion que las uniera: si el navegador se quedaba sin
-- conexion a mitad de camino (tipico en datos moviles), la compra quedaba a
-- medias — el mismo tipo de descuadre invisible que ya se habia corregido
-- para las ventas (ver registrar_venta). Ahora es una sola funcion: o se
-- guarda todo (cabecera + detalle + stock + kardex), o no se guarda nada.
-- Tambien resuelve la presentacion (caja/saco/flexible) de cada item igual
-- que registrar_venta, para que "comprar 2 Cajas" o "1 Paquete Maestro"
-- ingrese las unidades base correctas al inventario.
create or replace function public.registrar_compra(
  p_items            jsonb,  -- [{ producto_id, producto_nombre, cantidad, precio_unitario, modalidad }]
  p_numero           text default null,
  p_proveedor_id     uuid default null,
  p_proveedor_nombre text default null,
  p_fecha_compra     date default current_date,
  p_estado           estado_compra default 'pendiente',
  p_notas            text default null
)
returns public.compras
language plpgsql
security definer set search_path = public
as $$
declare
  v_item        jsonb;
  v_producto    public.productos%rowtype;
  v_resuelto    record;
  v_cantidad    numeric;
  v_precio      numeric(10,2);
  v_modalidad   text;
  v_unidades    numeric;
  v_pres_nombre text;
  v_prod_id     uuid;
  v_prod_nombre text;
  v_sub         numeric(10,2);
  v_total       numeric(10,2) := 0;
  v_compra      public.compras%rowtype;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede registrar compras.';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'La compra no tiene productos.';
  end if;

  -- 1) Valida cada item y calcula el total (bloquea las filas de producto
  --    involucradas para evitar carreras con otra compra/venta concurrente).
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := (v_item->>'cantidad')::numeric;
    v_precio   := coalesce((v_item->>'precio_unitario')::numeric, 0);

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad invalida para "%".', coalesce(v_item->>'producto_nombre', 'producto');
    end if;
    if v_precio < 0 then
      raise exception 'Precio invalido para "%".', coalesce(v_item->>'producto_nombre', 'producto');
    end if;

    v_prod_id := nullif(v_item->>'producto_id', '')::uuid;
    if v_prod_id is not null then
      select * into v_producto from public.productos where id = v_prod_id for update;
      if not found then
        raise exception 'Producto % no existe.', v_prod_id;
      end if;
      v_modalidad := coalesce(v_item->>'modalidad', 'unidad');
      -- Valida que la presentacion exista y sea valida para este producto,
      -- aunque el resultado no se use hasta el paso 3 (mismo criterio que
      -- registrar_venta: fallar aqui, antes de tocar nada, no a mitad de la
      -- insercion del detalle).
      perform public.resolver_presentacion(v_producto, v_modalidad);
    end if;

    v_total := v_total + round(v_cantidad * v_precio, 2);
  end loop;

  -- 2) Cabecera de la compra
  insert into public.compras (numero, proveedor_id, proveedor_nombre, total, estado, fecha_compra, notas)
  values (
    p_numero, p_proveedor_id, p_proveedor_nombre, round(v_total, 2),
    coalesce(p_estado, 'pendiente'), coalesce(p_fecha_compra, current_date), p_notas
  ) returning * into v_compra;

  -- 3) Detalle + ingreso de stock + kardex, todo en la misma transaccion que
  --    la cabecera recien insertada.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad    := (v_item->>'cantidad')::numeric;
    v_precio      := coalesce((v_item->>'precio_unitario')::numeric, 0);
    v_modalidad   := coalesce(v_item->>'modalidad', 'unidad');
    v_prod_id     := nullif(v_item->>'producto_id', '')::uuid;
    v_prod_nombre := coalesce(v_item->>'producto_nombre', 'Producto');
    v_unidades    := v_cantidad;
    v_pres_nombre := null;

    if v_prod_id is not null then
      select * into v_producto from public.productos where id = v_prod_id;
      select * into v_resuelto from public.resolver_presentacion(v_producto, v_modalidad);
      v_unidades    := v_resuelto.factor * v_cantidad;
      v_pres_nombre := v_resuelto.nombre;
      v_prod_nombre := v_producto.nombre;
    end if;

    v_sub := round(v_cantidad * v_precio, 2);

    insert into public.detalle_compras (
      compra_id, producto_id, producto_nombre, cantidad, modalidad, unidades,
      presentacion_nombre, precio_unitario, subtotal
    ) values (
      v_compra.id, v_prod_id, v_prod_nombre, v_cantidad, v_modalidad, v_unidades,
      v_pres_nombre, v_precio, v_sub
    );

    if v_prod_id is not null then
      update public.productos
        set stock_actual = stock_actual + v_unidades
        where id = v_prod_id;

      insert into public.movimientos_inventario (
        producto_id, producto_nombre, tipo, cantidad,
        stock_previo, stock_nuevo, motivo, usuario_id
      ) values (
        v_prod_id, v_producto.nombre, 'entrada', v_unidades,
        v_producto.stock_actual, v_producto.stock_actual + v_unidades,
        'Compra ' || coalesce('#' || p_numero, left(v_compra.id::text, 8)), auth.uid()
      );
    end if;
  end loop;

  return v_compra;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC 4: ANULAR VENTA (administrador o cajero) - repone stock, revierte caja
-- y deuda del cliente, y marca anulada
-- ----------------------------------------------------------------------------
-- Abierta a cualquier usuario autenticado ACTIVO (antes: solo admin) —
-- requisito explicito de negocio. El motivo es obligatorio y queda en
-- auditoria_ventas junto con quien anulo y cuando, como salvaguarda de este
-- permiso mas amplio.
-- Se agrego el parametro p_motivo (antes no existia): "create or replace"
-- con un parametro nuevo sin default crea un OVERLOAD en vez de reemplazar
-- la funcion — hay que tumbar la firma vieja primero para que no queden
-- ambas versiones coexistiendo (la vieja, admin-only y sin motivo, seguiria
-- siendo invocable).
drop function if exists public.anular_venta(uuid);

create or replace function public.anular_venta(p_venta_id uuid, p_motivo text)
returns public.ventas
language plpgsql
security definer set search_path = public
as $$
declare
  v_venta   public.ventas%rowtype;
  v_det     record;
  v_prod    public.productos%rowtype;
  v_pago    record;
  v_activo  boolean;
  v_nombre  text;
begin
  select activo, nombre into v_activo, v_nombre from public.perfiles where id = auth.uid();
  if not coalesce(v_activo, false) then
    raise exception 'Tu usuario no esta autorizado para anular ventas.';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Debes indicar el motivo de la anulacion.';
  end if;

  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada.'; end if;
  if v_venta.anulada then raise exception 'La venta ya esta anulada.'; end if;

  -- 1) Repone el stock vendido en cada linea.
  for v_det in
    select * from public.detalle_ventas where venta_id = p_venta_id
  loop
    if v_det.producto_id is not null then
      select * into v_prod from public.productos
        where id = v_det.producto_id for update;
      if found then
        -- Se repone "unidades" (stock real descontado), no "cantidad" (que
        -- para ventas por caja es el numero de cajas, no de unidades).
        update public.productos
          set stock_actual = stock_actual + v_det.unidades
          where id = v_det.producto_id
          returning * into v_prod;

        insert into public.movimientos_inventario (
          producto_id, producto_nombre, tipo, cantidad,
          stock_previo, stock_nuevo, motivo, usuario_id
        ) values (
          v_prod.id, v_prod.nombre, 'devolucion', v_det.unidades,
          v_prod.stock_actual - v_det.unidades, v_prod.stock_actual,
          'Anulacion venta #' || v_venta.numero, auth.uid()
        );
      end if;
    end if;
  end loop;

  -- 2) Revierte caja y deuda del cliente, pierna de pago por pierna (ver
  --    tabla pagos_venta) — cubre por igual ventas de un solo metodo y
  --    ventas mixtas, viejas y nuevas (toda venta no anulada tiene 1+ filas
  --    ahi, ver backfill al crear la tabla).
  for v_pago in select * from public.pagos_venta where venta_id = p_venta_id
  loop
    if v_venta.caja_id is not null then
      if v_pago.metodo = 'efectivo' then
        update public.cajas set total_efectivo = total_efectivo - v_pago.monto where id = v_venta.caja_id;
      elsif v_pago.metodo = 'yape' then
        update public.cajas set total_yape = total_yape - v_pago.monto where id = v_venta.caja_id;
      elsif v_pago.metodo = 'fiado' then
        update public.cajas set total_fiado = total_fiado - v_pago.monto where id = v_venta.caja_id;
      end if;
    end if;
    if v_pago.metodo = 'fiado' and v_venta.cliente_id is not null then
      update public.clientes_credito
        set deuda_actual = greatest(deuda_actual - v_pago.monto, 0)
        where id = v_venta.cliente_id;
    end if;
  end loop;

  update public.ventas set anulada = true where id = p_venta_id
    returning * into v_venta;

  -- 3) Auditoria: quien, cuando, por que.
  insert into public.auditoria_ventas (
    venta_id, venta_numero, accion, usuario_id, usuario_nombre, motivo, detalle
  ) values (
    v_venta.id, v_venta.numero, 'anulada', auth.uid(), v_nombre, p_motivo,
    jsonb_build_object('total', v_venta.total, 'metodo', v_venta.metodo, 'cliente_id', v_venta.cliente_id)
  );

  return v_venta;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC 4b: EDITAR VENTA (administrador o cajero) - reemplaza los productos de
-- una venta existente SIN anularla: repone el stock viejo, valida y descuenta
-- el nuevo, recalcula subtotal/IGV/total, y ajusta caja + deuda del cliente
-- por la diferencia reescalando proporcionalmente los pagos originales (ver
-- tabla pagos_venta) — nunca hay que volver a pedirle el pago al cliente.
-- ----------------------------------------------------------------------------
create or replace function public.editar_venta(
  p_venta_id  uuid,
  p_items     jsonb,          -- mismo formato que registrar_venta
  p_motivo    text,
  p_descuento numeric default null,  -- null = mantiene el descuento actual de la venta
  p_tasa_igv  numeric default 0.18
)
returns public.ventas
language plpgsql
security definer set search_path = public
as $$
declare
  v_venta          public.ventas%rowtype;
  v_activo         boolean;
  v_nombre         text;
  v_det            record;
  v_prod           public.productos%rowtype;
  v_item           jsonb;
  v_cantidad       numeric;
  v_modalidad      text;
  v_unidades       numeric;
  v_precio         numeric(10,2);
  v_sub            numeric(10,2);
  v_subtotal       numeric(10,2) := 0;
  v_total          numeric(10,2);
  v_igv            numeric(10,2);
  v_base           numeric(10,2);
  v_descuento      numeric(10,2);
  v_mapa           jsonb := '{}'::jsonb;
  v_req            record;
  v_resuelto       record;
  v_pres_nombre    text;
  v_total_anterior numeric(10,2);
  v_factor         numeric;
  v_pago           record;
  v_nuevo_monto    numeric(10,2);
  v_restante       numeric(10,2);
  v_ultimo_id      uuid;
  v_detalle_json   jsonb;
  v_pago_recibido  numeric(10,2);
begin
  select activo, nombre into v_activo, v_nombre from public.perfiles where id = auth.uid();
  if not coalesce(v_activo, false) then
    raise exception 'Tu usuario no esta autorizado para editar ventas.';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Debes indicar el motivo de la edicion.';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un producto.';
  end if;

  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada.'; end if;
  if v_venta.anulada then raise exception 'No se puede editar una venta anulada.'; end if;

  v_total_anterior := v_venta.total;
  if v_total_anterior <= 0 then
    raise exception 'Esta venta no se puede editar (total original invalido).';
  end if;

  -- Snapshot del detalle anterior, para dejar registro de que cambio.
  select coalesce(jsonb_agg(jsonb_build_object(
      'producto_nombre', d.producto_nombre, 'cantidad', d.cantidad,
      'modalidad', d.modalidad, 'precio_unitario', d.precio_unitario, 'subtotal', d.subtotal
    )), '[]'::jsonb) into v_detalle_json
  from public.detalle_ventas d where d.venta_id = p_venta_id;

  -- 1) Repone el stock de las lineas ACTUALES (equivale a una anulacion
  --    parcial) y las borra — las nuevas se insertan mas abajo, ya
  --    validadas contra el stock recien repuesto.
  for v_det in select * from public.detalle_ventas where venta_id = p_venta_id
  loop
    if v_det.producto_id is not null then
      select * into v_prod from public.productos where id = v_det.producto_id for update;
      if found then
        update public.productos set stock_actual = stock_actual + v_det.unidades where id = v_det.producto_id
          returning * into v_prod;
        insert into public.movimientos_inventario (
          producto_id, producto_nombre, tipo, cantidad, stock_previo, stock_nuevo, motivo, usuario_id
        ) values (
          v_prod.id, v_prod.nombre, 'devolucion', v_det.unidades,
          v_prod.stock_actual - v_det.unidades, v_prod.stock_actual,
          'Edicion venta #' || v_venta.numero || ' (linea anterior revertida)', auth.uid()
        );
      end if;
    end if;
  end loop;
  delete from public.detalle_ventas where venta_id = p_venta_id;

  -- 2) Valida los items NUEVOS y calcula el nuevo total (misma logica de
  --    registrar_venta: bloquea filas, acumula por producto, valida stock).
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_prod from public.productos where id = (v_item->>'producto_id')::uuid for update;
    if not found then raise exception 'Producto % no existe.', v_item->>'producto_id'; end if;

    v_cantidad  := (v_item->>'cantidad')::numeric;
    v_modalidad := coalesce(v_item->>'modalidad', 'unidad');
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad invalida para "%".', v_prod.nombre;
    end if;

    select * into v_resuelto from public.resolver_presentacion(v_prod, v_modalidad);
    v_unidades := v_resuelto.factor * v_cantidad;
    v_precio   := coalesce((v_item->>'precio_unitario')::numeric, v_prod.precio_venta);

    v_mapa := jsonb_set(v_mapa, array[v_prod.id::text],
      to_jsonb(coalesce((v_mapa->>v_prod.id::text)::numeric, 0) + v_unidades));

    v_subtotal := v_subtotal + (v_precio * v_cantidad);
  end loop;

  for v_req in select key as producto_id, value::numeric as unidades from jsonb_each_text(v_mapa)
  loop
    select * into v_prod from public.productos where id = v_req.producto_id::uuid;
    if v_prod.stock_actual < v_req.unidades then
      raise exception 'Stock insuficiente para "%": disponible % %, solicitado %',
        v_prod.nombre, v_prod.stock_actual, v_prod.unidad, v_req.unidades;
    end if;
  end loop;

  v_descuento := coalesce(p_descuento, v_venta.descuento);
  v_subtotal  := round(v_subtotal, 2);
  v_total     := round(greatest(v_subtotal - v_descuento, 0), 2);
  if v_total <= 0 then
    raise exception 'El total de la venta editada debe ser mayor a 0.';
  end if;
  v_base := round(v_total / (1 + p_tasa_igv), 2);
  v_igv  := round(v_total - v_base, 2);

  -- 3) Inserta las lineas nuevas + descuenta stock + kardex (igual que registrar_venta).
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_prod from public.productos where id = (v_item->>'producto_id')::uuid;
    v_cantidad  := (v_item->>'cantidad')::numeric;
    v_modalidad := coalesce(v_item->>'modalidad', 'unidad');
    select * into v_resuelto from public.resolver_presentacion(v_prod, v_modalidad);
    v_unidades    := v_resuelto.factor * v_cantidad;
    v_pres_nombre := v_resuelto.nombre;
    v_precio    := coalesce((v_item->>'precio_unitario')::numeric, v_prod.precio_venta);
    v_sub       := round(v_precio * v_cantidad, 2);

    insert into public.detalle_ventas (
      venta_id, producto_id, producto_nombre, sku, cantidad, modalidad, unidades,
      precio_unitario, subtotal, presentacion_nombre
    ) values (
      v_venta.id, v_prod.id, v_prod.nombre, v_prod.sku,
      v_cantidad, v_modalidad, v_unidades, v_precio, v_sub, v_pres_nombre
    );

    update public.productos set stock_actual = stock_actual - v_unidades where id = v_prod.id;

    insert into public.movimientos_inventario (
      producto_id, producto_nombre, tipo, cantidad, stock_previo, stock_nuevo, motivo, usuario_id
    ) values (
      v_prod.id, v_prod.nombre, 'venta', -v_unidades,
      v_prod.stock_actual, v_prod.stock_actual - v_unidades,
      'Edicion venta #' || v_venta.numero || ' (linea nueva)', auth.uid()
    );
  end loop;

  -- 4) Reescala los pagos originales proporcionalmente al nuevo total y
  --    ajusta caja/deuda por la DIFERENCIA (resta el aporte viejo, suma el
  --    nuevo). La ultima pierna se ajusta al resto EXACTO en vez de un
  --    round(monto*factor) para que la suma de todas de exactamente
  --    v_total, sin arrastrar centavos de diferencia por redondeo.
  v_factor := v_total / v_total_anterior;

  select id into v_ultimo_id from public.pagos_venta where venta_id = p_venta_id
    order by creado_en desc, id desc limit 1;

  if v_ultimo_id is null then
    raise exception
      'Esta venta no tiene registro de pagos — ejecuta supabase/add_ventas_avanzadas.sql antes de editar ventas.';
  end if;

  v_restante := v_total;
  for v_pago in select * from public.pagos_venta where venta_id = p_venta_id order by creado_en, id
  loop
    if v_pago.id = v_ultimo_id then
      v_nuevo_monto := v_restante;
    else
      v_nuevo_monto := round(v_pago.monto * v_factor, 2);
    end if;
    v_restante := v_restante - v_nuevo_monto;

    if v_venta.caja_id is not null then
      if v_pago.metodo = 'efectivo' then
        update public.cajas set total_efectivo = total_efectivo - v_pago.monto + v_nuevo_monto where id = v_venta.caja_id;
      elsif v_pago.metodo = 'yape' then
        update public.cajas set total_yape = total_yape - v_pago.monto + v_nuevo_monto where id = v_venta.caja_id;
      elsif v_pago.metodo = 'fiado' then
        update public.cajas set total_fiado = total_fiado - v_pago.monto + v_nuevo_monto where id = v_venta.caja_id;
      end if;
    end if;

    if v_pago.metodo = 'fiado' and v_venta.cliente_id is not null then
      update public.clientes_credito
        set deuda_actual = greatest(deuda_actual - v_pago.monto + v_nuevo_monto, 0)
        where id = v_venta.cliente_id;
    end if;

    -- El CHECK monto > 0 de pagos_venta actua como ultima red de seguridad:
    -- si el redondeo dejara una pierna en 0 o negativa, la transaccion entera
    -- se revierte con un error claro en vez de dejar un pago mal registrado.
    update public.pagos_venta set monto = v_nuevo_monto where id = v_pago.id;
  end loop;

  -- 5) Actualiza la cabecera de la venta. pago_recibido/vuelto se mantienen
  --    si ya cubrian el nuevo total, o se ajustan al nuevo total si no.
  v_pago_recibido := greatest(v_venta.pago_recibido, v_total);
  update public.ventas set
    subtotal      = v_subtotal,
    descuento     = v_descuento,
    igv           = v_igv,
    total         = v_total,
    pago_recibido = v_pago_recibido,
    vuelto        = greatest(v_pago_recibido - v_total, 0),
    editada       = true
  where id = p_venta_id
  returning * into v_venta;

  -- 6) Auditoria: quien, cuando, por que y que cambio.
  insert into public.auditoria_ventas (
    venta_id, venta_numero, accion, usuario_id, usuario_nombre, motivo, detalle
  ) values (
    v_venta.id, v_venta.numero, 'editada', auth.uid(), v_nombre, p_motivo,
    jsonb_build_object(
      'total_anterior', v_total_anterior, 'total_nuevo', v_total,
      'detalle_anterior', v_detalle_json
    )
  );

  return v_venta;
end;
$$;

