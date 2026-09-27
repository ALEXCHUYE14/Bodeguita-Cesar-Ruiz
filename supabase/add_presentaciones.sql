-- ============================================================================
--  EMPAQUETADO MULTINIVEL Y VENTAS/COMPRAS FRACCIONADAS
--  (Paquete Maestro -> Bolsas/Subempaques -> Unidades, + Media Caja, etc.)
--
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query, en tu proyecto
--  de produccion. Es idempotente (seguro correrlo mas de una vez) y NO borra
--  ni modifica ningun dato existente: todo lo nuevo es opcional por producto.
--
--  Que agrega:
--   - Tabla producto_presentaciones: cualquier numero de presentaciones extra
--     por producto (Paquete, Bolsa, Media Caja...), cada una con su propio
--     precio de compra/venta, ademas del sistema existente de "caja"/"saco".
--   - resolver_presentacion(): funcion compartida que traduce una modalidad
--     (legacy 'unidad'/'caja'/'saco' o el id de una presentacion flexible) a
--     unidades base de stock — usada por ventas y compras, un solo lugar.
--   - registrar_venta() actualizado para usar ese resolver (mismo
--     comportamiento de siempre para productos sin presentaciones nuevas).
--   - registrar_compra(): NUEVA funcion transaccional (todo o nada) que
--     reemplaza el registro de compras en 3 pasos sueltos desde el cliente
--     — ese flujo anterior no era atomico (un corte de conexion a mitad de
--     camino dejaba la compra a medias) y ademas el insert directo a
--     detalle_compras ya fallaba por RLS sin una politica de escritura.
--   - Endurece unidades_por_caja / kg_por_saco / precio_venta_caja /
--     precio_venta_saco contra valores 0 o negativos (normalizando a null
--     cualquier valor invalido que ya existiera).
--
--  Requiere haber corrido antes supabase/schema.sql (o su version anterior).
-- ============================================================================

-- ── 1) Endurecimiento del sistema existente de caja/saco ────────────────────
update public.productos set unidades_por_caja = null where unidades_por_caja is not null and unidades_por_caja <= 0;
update public.productos set kg_por_saco       = null where kg_por_saco       is not null and kg_por_saco       <= 0;
update public.productos set precio_venta_caja = null where precio_venta_caja is not null and precio_venta_caja < 0;
update public.productos set precio_venta_saco = null where precio_venta_saco is not null and precio_venta_saco < 0;

do $$ begin
  alter table public.productos add constraint productos_unidades_caja_positivas
    check (unidades_por_caja is null or unidades_por_caja > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.productos add constraint productos_kg_saco_positivo
    check (kg_por_saco is null or kg_por_saco > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.productos add constraint productos_precio_caja_no_negativo
    check (precio_venta_caja is null or precio_venta_caja >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.productos add constraint productos_precio_saco_no_negativo
    check (precio_venta_saco is null or precio_venta_saco >= 0);
exception when duplicate_object then null; end $$;

-- ── 2) Tabla de presentaciones flexibles ─────────────────────────────────────
-- "factor_unidades" siempre esta expresado en UNIDADES BASE (las mismas de
-- productos.stock_actual), nunca relativo a otro nivel: 1 Paquete = 5 Bolsas
-- de 10 unidades c/u se modela como dos filas independientes (Bolsa=10,
-- Paquete=50), evitando arrastrar redondeos al encadenar niveles.
create table if not exists public.producto_presentaciones (
  id               uuid primary key default gen_random_uuid(),
  producto_id      uuid not null references public.productos(id) on delete cascade,
  nombre           text not null check (char_length(btrim(nombre)) between 1 and 40),
  factor_unidades  numeric not null check (factor_unidades > 0),
  precio_compra    numeric(10,2) check (precio_compra is null or precio_compra >= 0),
  precio_venta     numeric(10,2) not null check (precio_venta >= 0),
  es_fraccion      boolean not null default false,
  orden            smallint not null default 0,
  activo           boolean not null default true,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  unique (producto_id, nombre)
);

comment on column public.producto_presentaciones.factor_unidades is
  'Unidades base (mismas de productos.stock_actual) que equivale UNA de esta presentacion. Siempre absoluto, nunca relativo a otro nivel.';

create index if not exists idx_presentaciones_producto on public.producto_presentaciones (producto_id) where activo = true;

drop trigger if exists trg_presentaciones_touch on public.producto_presentaciones;
create trigger trg_presentaciones_touch
  before update on public.producto_presentaciones
  for each row execute function public.touch_actualizado_en();

create or replace function public.validar_presentacion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_tipo_venta text;
begin
  new.nombre := btrim(new.nombre);
  if new.nombre = '' then
    raise exception 'El nombre de la presentacion no puede estar vacio.';
  end if;
  if new.factor_unidades is null or new.factor_unidades <= 0 then
    raise exception 'La presentacion debe equivaler a una cantidad de unidades mayor a cero.';
  end if;

  select tipo_venta into v_tipo_venta from public.productos where id = new.producto_id;
  if v_tipo_venta is null then
    raise exception 'Producto no encontrado.';
  end if;
  if v_tipo_venta = 'unidad' and new.factor_unidades <> trunc(new.factor_unidades) then
    raise exception
      'Para productos por unidad, "%" debe equivaler a un numero entero de unidades (recibido %).',
      new.nombre, new.factor_unidades;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_presentaciones_validar on public.producto_presentaciones;
create trigger trg_presentaciones_validar
  before insert or update on public.producto_presentaciones
  for each row execute function public.validar_presentacion();

-- ── 3) Columnas nuevas en detalle_ventas / detalle_compras ──────────────────
alter table public.detalle_ventas add column if not exists presentacion_nombre text;
comment on column public.detalle_ventas.presentacion_nombre is
  'Nombre a mostrar de la presentacion usada ("Caja", "Saco" o el nombre de una presentacion flexible), tomado en el momento de la venta. Null = unidad simple.';

alter table public.detalle_compras add column if not exists modalidad text not null default 'unidad';
alter table public.detalle_compras add column if not exists unidades double precision not null default 0;
alter table public.detalle_compras add column if not exists presentacion_nombre text;
update public.detalle_compras set unidades = cantidad where unidades = 0;
comment on column public.detalle_compras.unidades is
  'Unidades base que ingresaron al stock (cantidad * factor de la presentacion).';
comment on column public.detalle_compras.presentacion_nombre is
  'Nombre a mostrar de la presentacion usada, tomado en el momento de la compra. Null = unidad simple.';

-- ── 4) Funciones: resolver_presentacion, registrar_venta, ajustar_stock,
--      registrar_compra (version completa y actualizada de cada una) ───────
create or replace function public.resolver_presentacion(
  p_producto  public.productos,
  p_modalidad text,
  out factor  numeric,
  out nombre  text
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_fila public.producto_presentaciones%rowtype;
begin
  if p_modalidad is null or p_modalidad = '' or p_modalidad = 'unidad' then
    factor := 1;
    nombre := null;
    return;
  end if;

  if p_modalidad = 'caja' then
    if not p_producto.tiene_caja then
      raise exception '"%" no tiene venta por caja habilitada.', p_producto.nombre;
    end if;
    factor := coalesce(p_producto.unidades_por_caja, 1);
    nombre := 'Caja';
    return;
  end if;

  if p_modalidad = 'saco' then
    if not p_producto.tiene_saco then
      raise exception '"%" no tiene venta por saco habilitada.', p_producto.nombre;
    end if;
    factor := coalesce(p_producto.kg_por_saco, 1);
    nombre := 'Saco';
    return;
  end if;

  select * into v_fila from public.producto_presentaciones
    where producto_id = p_producto.id and id::text = p_modalidad and activo = true;

  if not found then
    raise exception 'Presentacion no valida o ya no disponible para "%".', p_producto.nombre;
  end if;

  factor := v_fila.factor_unidades;
  nombre := v_fila.nombre;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC 1: REGISTRAR VENTA (transaccional: stock + kardex + caja)
-- ----------------------------------------------------------------------------
create or replace function public.registrar_venta(
  p_items         jsonb,         -- [{ producto_id, cantidad, precio_unitario, modalidad }]
  p_metodo        metodo_pago,
  p_descuento     numeric  default 0,
  p_pago_recibido numeric  default 0,
  p_caja_id       uuid     default null,
  p_cliente_id    uuid     default null,
  p_tasa_igv      numeric  default 0.18
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
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito esta vacio.';
  end if;

  select nombre into v_nombre from public.perfiles where id = auth.uid();

  if p_cliente_id is not null then
    select nombre into v_cli_nombre from public.clientes_credito where id = p_cliente_id;
  end if;

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

  -- 3) Cabecera de la venta
  insert into public.ventas (
    cajero_id, cajero_nombre, caja_id, cliente_id, cliente_nombre,
    subtotal, descuento, igv, total, metodo, pago_recibido, vuelto
  ) values (
    auth.uid(), v_nombre, p_caja_id, p_cliente_id, v_cli_nombre,
    v_subtotal, coalesce(p_descuento, 0), v_igv, v_total,
    p_metodo, p_pago_recibido, round(greatest(p_pago_recibido - v_total, 0), 2)
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

  -- 5) Caja y deuda del cliente fiado, DENTRO de la misma transaccion que la
  --    venta. Antes esto se hacia con llamadas RPC separadas desde el
  --    cliente (incrementar_caja / registrar_cargo_fiado) DESPUES de que
  --    esta funcion ya habia confirmado la venta: si el navegador perdia
  --    conexion justo entre esas llamadas (tipico en datos moviles de una
  --    bodega), la venta quedaba registrada y el stock descontado
  --    correctamente, pero el total de la caja o la deuda del cliente NO se
  --    actualizaban — un descuadre invisible que no aparecia en ningun lado
  --    hasta el cierre de caja. Ahora todo ocurre en un solo commit: o se
  --    guarda completo, o no se guarda nada.
  if p_caja_id is not null then
    if p_metodo = 'efectivo' then
      update public.cajas set total_efectivo = total_efectivo + v_total where id = p_caja_id;
    elsif p_metodo = 'yape' then
      update public.cajas set total_yape = total_yape + v_total where id = p_caja_id;
    elsif p_metodo = 'fiado' then
      update public.cajas set total_fiado = total_fiado + v_total where id = p_caja_id;
    end if;
  end if;

  if p_metodo = 'fiado' and p_cliente_id is not null then
    update public.clientes_credito
      set deuda_actual = deuda_actual + v_total
      where id = p_cliente_id;
  end if;

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
-- para las ventas (ver registrar_venta). Ademas, el insert directo del
-- cliente a detalle_compras ya fallaba porque esa tabla nunca tuvo una
-- politica RLS de escritura. Ahora es una sola funcion: o se guarda todo
-- (cabecera + detalle + stock + kardex), o no se guarda nada. Tambien
-- resuelve la presentacion (caja/saco/flexible) de cada item igual que
-- registrar_venta, para que "comprar 2 Cajas" o "1 Paquete Maestro" ingrese
-- las unidades base correctas al inventario.
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

-- ── 5) RLS: lectura para todos los usuarios autenticados, escritura solo
--      administrador (igual criterio que la tabla productos) ────────────────
alter table public.producto_presentaciones enable row level security;

drop policy if exists presentaciones_select on public.producto_presentaciones;
create policy presentaciones_select on public.producto_presentaciones for select
  to authenticated using (true);

drop policy if exists presentaciones_write on public.producto_presentaciones;
create policy presentaciones_write on public.producto_presentaciones for all
  to authenticated using (public.es_admin()) with check (public.es_admin());
