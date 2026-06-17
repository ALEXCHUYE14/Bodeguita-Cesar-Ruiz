-- ============================================================================
--  CESAR RUIZ - SISTEMA DE GESTION COMERCIAL Y POS
--  Esquema completo para Supabase / PostgreSQL
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query
-- ============================================================================
--  Orden de ejecucion: este script es idempotente en su mayoria y puede
--  correrse de una sola vez sobre un proyecto nuevo de Supabase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONES
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. TIPOS ENUMERADOS
-- ----------------------------------------------------------------------------
do $$ begin
  create type rol_usuario as enum ('administrador', 'cajero');
exception when duplicate_object then null; end $$;

do $$ begin
  create type metodo_pago as enum ('efectivo', 'tarjeta', 'yape', 'plin', 'transferencia');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_movimiento as enum ('entrada', 'salida', 'ajuste', 'venta', 'devolucion');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. PERFILES (extiende auth.users de Supabase)
-- ----------------------------------------------------------------------------
create table if not exists public.perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null default 'Usuario',
  rol         rol_usuario not null default 'cajero',
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

comment on table public.perfiles is 'Perfil y rol de cada usuario autenticado.';

-- Crea el perfil automaticamente al registrarse un usuario en Auth.
create or replace function public.handle_nuevo_usuario()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.perfiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'rol')::rol_usuario, 'cajero')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_nuevo_usuario();

-- Helper: es administrador? (evita recursion en politicas RLS)
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'administrador' and activo = true
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. CATEGORIAS
-- ----------------------------------------------------------------------------
create table if not exists public.categorias (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  color      text not null default '#56564f',
  creado_en  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. PRODUCTOS
-- ----------------------------------------------------------------------------
create table if not exists public.productos (
  id             uuid primary key default gen_random_uuid(),
  sku            text not null unique,            -- Codigo QR / codigo de barras
  nombre         text not null,
  categoria_id   uuid references public.categorias(id) on delete set null,
  precio_compra  numeric(10,2) not null default 0 check (precio_compra >= 0),
  precio_venta   numeric(10,2) not null default 0 check (precio_venta >= 0),
  stock_actual   integer not null default 0,
  stock_minimo   integer not null default 5 check (stock_minimo >= 0),
  unidad         text not null default 'unidad', -- unidad, kg, litro, paquete...
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_productos_sku on public.productos (sku);
create index if not exists idx_productos_categoria on public.productos (categoria_id);
create index if not exists idx_productos_stock_bajo on public.productos (stock_actual)
  where activo = true;

comment on column public.productos.sku is 'Codigo unico escaneable (QR o barras).';

-- Mantiene actualizado_en
create or replace function public.touch_actualizado_en()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_productos_touch on public.productos;
create trigger trg_productos_touch
  before update on public.productos
  for each row execute function public.touch_actualizado_en();

-- ----------------------------------------------------------------------------
-- 5. VENTAS
-- ----------------------------------------------------------------------------
create table if not exists public.ventas (
  id              uuid primary key default gen_random_uuid(),
  numero          bigint generated always as identity,  -- correlativo legible
  cajero_id       uuid references public.perfiles(id) on delete set null,
  cajero_nombre   text,                                 -- snapshot para historial
  subtotal        numeric(10,2) not null default 0,
  descuento       numeric(10,2) not null default 0 check (descuento >= 0),
  igv             numeric(10,2) not null default 0,     -- impuesto (Peru: 18%)
  total           numeric(10,2) not null default 0,
  metodo          metodo_pago not null default 'efectivo',
  pago_recibido   numeric(10,2) not null default 0,
  vuelto          numeric(10,2) not null default 0,
  anulada         boolean not null default false,
  creado_en       timestamptz not null default now()
);

create index if not exists idx_ventas_fecha on public.ventas (creado_en desc);
create index if not exists idx_ventas_cajero on public.ventas (cajero_id);
create index if not exists idx_ventas_metodo on public.ventas (metodo);

-- ----------------------------------------------------------------------------
-- 6. DETALLE DE VENTAS
-- ----------------------------------------------------------------------------
create table if not exists public.detalle_ventas (
  id               uuid primary key default gen_random_uuid(),
  venta_id         uuid not null references public.ventas(id) on delete cascade,
  producto_id      uuid references public.productos(id) on delete set null,
  producto_nombre  text not null,          -- snapshot
  sku              text,                    -- snapshot
  cantidad         integer not null check (cantidad > 0),
  precio_unitario  numeric(10,2) not null,
  subtotal         numeric(10,2) not null
);

create index if not exists idx_detalle_venta on public.detalle_ventas (venta_id);
create index if not exists idx_detalle_producto on public.detalle_ventas (producto_id);

-- ----------------------------------------------------------------------------
-- 7. MOVIMIENTOS DE INVENTARIO (Kardex simplificado)
-- ----------------------------------------------------------------------------
create table if not exists public.movimientos_inventario (
  id            uuid primary key default gen_random_uuid(),
  producto_id   uuid references public.productos(id) on delete set null,
  producto_nombre text,
  tipo          tipo_movimiento not null,
  cantidad      integer not null,            -- positivo entra, negativo sale
  stock_previo  integer not null,
  stock_nuevo   integer not null,
  motivo        text,
  usuario_id    uuid references public.perfiles(id) on delete set null,
  creado_en     timestamptz not null default now()
);

create index if not exists idx_mov_producto on public.movimientos_inventario (producto_id, creado_en desc);

-- ----------------------------------------------------------------------------
-- 8. FUNCION TRANSACCIONAL: REGISTRAR VENTA
--    Procesa carrito + descuenta stock + escribe kardex de forma atomica.
--    Se invoca desde el frontend con supabase.rpc('registrar_venta', {...})
-- ----------------------------------------------------------------------------
create or replace function public.registrar_venta(
  p_items        jsonb,        -- [{ producto_id, cantidad, precio_unitario }]
  p_metodo       metodo_pago,
  p_descuento    numeric default 0,
  p_pago_recibido numeric default 0,
  p_tasa_igv     numeric default 0.18
)
returns public.ventas
language plpgsql
security definer set search_path = public
as $$
declare
  v_item        jsonb;
  v_producto    public.productos%rowtype;
  v_cantidad    integer;
  v_precio      numeric(10,2);
  v_sub         numeric(10,2);
  v_subtotal    numeric(10,2) := 0;
  v_total       numeric(10,2);
  v_igv         numeric(10,2);
  v_base        numeric(10,2);
  v_venta       public.ventas%rowtype;
  v_nombre      text;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito esta vacio.';
  end if;

  select nombre into v_nombre from public.perfiles where id = auth.uid();

  -- 1) Validar stock y acumular subtotal (bloqueo de filas para evitar carreras)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_producto from public.productos
      where id = (v_item->>'producto_id')::uuid for update;

    if not found then
      raise exception 'Producto % no existe.', v_item->>'producto_id';
    end if;

    v_cantidad := (v_item->>'cantidad')::integer;
    v_precio   := coalesce((v_item->>'precio_unitario')::numeric, v_producto.precio_venta);

    if v_producto.stock_actual < v_cantidad then
      raise exception 'Stock insuficiente para "%": disponible %, solicitado %',
        v_producto.nombre, v_producto.stock_actual, v_cantidad;
    end if;

    v_subtotal := v_subtotal + (v_precio * v_cantidad);
  end loop;

  -- 2) Calculos (IGV incluido en el precio de venta, modelo peruano)
  v_subtotal := round(v_subtotal, 2);
  v_total    := round(greatest(v_subtotal - coalesce(p_descuento, 0), 0), 2);
  v_base     := round(v_total / (1 + p_tasa_igv), 2);
  v_igv      := round(v_total - v_base, 2);

  -- 3) Cabecera de la venta
  insert into public.ventas (
    cajero_id, cajero_nombre, subtotal, descuento, igv, total,
    metodo, pago_recibido, vuelto
  ) values (
    auth.uid(), v_nombre, v_subtotal, coalesce(p_descuento,0), v_igv, v_total,
    p_metodo, p_pago_recibido, round(greatest(p_pago_recibido - v_total, 0), 2)
  ) returning * into v_venta;

  -- 4) Detalle + descuento de stock + kardex
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_producto from public.productos
      where id = (v_item->>'producto_id')::uuid;
    v_cantidad := (v_item->>'cantidad')::integer;
    v_precio   := coalesce((v_item->>'precio_unitario')::numeric, v_producto.precio_venta);
    v_sub      := round(v_precio * v_cantidad, 2);

    insert into public.detalle_ventas (
      venta_id, producto_id, producto_nombre, sku, cantidad, precio_unitario, subtotal
    ) values (
      v_venta.id, v_producto.id, v_producto.nombre, v_producto.sku,
      v_cantidad, v_precio, v_sub
    );

    update public.productos
      set stock_actual = stock_actual - v_cantidad
      where id = v_producto.id;

    insert into public.movimientos_inventario (
      producto_id, producto_nombre, tipo, cantidad,
      stock_previo, stock_nuevo, motivo, usuario_id
    ) values (
      v_producto.id, v_producto.nombre, 'venta', -v_cantidad,
      v_producto.stock_actual, v_producto.stock_actual - v_cantidad,
      'Venta #' || v_venta.numero, auth.uid()
    );
  end loop;

  return v_venta;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. FUNCION: AJUSTE MANUAL DE STOCK (entradas / ajustes / devoluciones)
-- ----------------------------------------------------------------------------
create or replace function public.ajustar_stock(
  p_producto_id uuid,
  p_cantidad    integer,   -- positivo suma, negativo resta
  p_tipo        tipo_movimiento,
  p_motivo      text default null
)
returns public.productos
language plpgsql
security definer set search_path = public
as $$
declare
  v_prod  public.productos%rowtype;
  v_nuevo integer;
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
-- 9b. FUNCION: ANULAR VENTA (solo admin) - devuelve stock y marca anulada
--     Reposicion atomica del inventario + kardex tipo 'devolucion'.
-- ----------------------------------------------------------------------------
create or replace function public.anular_venta(p_venta_id uuid)
returns public.ventas
language plpgsql
security definer set search_path = public
as $$
declare
  v_venta  public.ventas%rowtype;
  v_det    record;
  v_prod   public.productos%rowtype;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede anular ventas.';
  end if;

  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada.'; end if;
  if v_venta.anulada then raise exception 'La venta ya esta anulada.'; end if;

  -- Devolver el stock de cada item al inventario
  for v_det in
    select * from public.detalle_ventas where venta_id = p_venta_id
  loop
    if v_det.producto_id is not null then
      select * into v_prod from public.productos
        where id = v_det.producto_id for update;
      if found then
        update public.productos
          set stock_actual = stock_actual + v_det.cantidad
          where id = v_det.producto_id
          returning * into v_prod;

        insert into public.movimientos_inventario (
          producto_id, producto_nombre, tipo, cantidad,
          stock_previo, stock_nuevo, motivo, usuario_id
        ) values (
          v_prod.id, v_prod.nombre, 'devolucion', v_det.cantidad,
          v_prod.stock_actual - v_det.cantidad, v_prod.stock_actual,
          'Anulacion venta #' || v_venta.numero, auth.uid()
        );
      end if;
    end if;
  end loop;

  update public.ventas set anulada = true where id = p_venta_id
    returning * into v_venta;

  return v_venta;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.perfiles                enable row level security;
alter table public.categorias              enable row level security;
alter table public.productos               enable row level security;
alter table public.ventas                  enable row level security;
alter table public.detalle_ventas          enable row level security;
alter table public.movimientos_inventario  enable row level security;

-- PERFILES: cada quien ve/edita el suyo; admin ve todos.
drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select
  using (id = auth.uid() or public.es_admin());

drop policy if exists perfiles_update on public.perfiles;
create policy perfiles_update on public.perfiles for update
  using (id = auth.uid() or public.es_admin());

-- CATEGORIAS: lectura para todo autenticado; escritura admin.
drop policy if exists categorias_select on public.categorias;
create policy categorias_select on public.categorias for select
  to authenticated using (true);
drop policy if exists categorias_write on public.categorias;
create policy categorias_write on public.categorias for all
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- PRODUCTOS: lectura para todo autenticado; gestion (CRUD) solo admin.
drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos for select
  to authenticated using (true);
drop policy if exists productos_write on public.productos;
create policy productos_write on public.productos for all
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- VENTAS: lectura para autenticados; insercion via RPC (security definer).
drop policy if exists ventas_select on public.ventas;
create policy ventas_select on public.ventas for select
  to authenticated using (true);
drop policy if exists ventas_insert on public.ventas;
create policy ventas_insert on public.ventas for insert
  to authenticated with check (cajero_id = auth.uid());
drop policy if exists ventas_update on public.ventas;
create policy ventas_update on public.ventas for update
  to authenticated using (public.es_admin());

-- DETALLE: lectura autenticados.
drop policy if exists detalle_select on public.detalle_ventas;
create policy detalle_select on public.detalle_ventas for select
  to authenticated using (true);

-- MOVIMIENTOS: lectura autenticados.
drop policy if exists mov_select on public.movimientos_inventario;
create policy mov_select on public.movimientos_inventario for select
  to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 11. REALTIME: publicar tablas para sincronizacion instantanea
-- ----------------------------------------------------------------------------
do $$
begin
  -- supabase_realtime ya existe en proyectos Supabase
  alter publication supabase_realtime add table public.ventas;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.productos;
exception when duplicate_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.detalle_ventas;
exception when duplicate_object then null; end $$;

-- Asegura payload completo en updates de stock
alter table public.productos replica identity full;
alter table public.ventas replica identity full;

-- ----------------------------------------------------------------------------
-- 12. DATOS DE EJEMPLO (semilla opcional - comenta si no la necesitas)
-- ----------------------------------------------------------------------------
insert into public.categorias (nombre, color) values
  ('Abarrotes',  '#059669'),
  ('Bebidas',    '#0ea5e9'),
  ('Snacks',     '#f59e0b'),
  ('Limpieza',   '#6366f1'),
  ('Lacteos',    '#ec4899')
on conflict (nombre) do nothing;

insert into public.productos (sku, nombre, categoria_id, precio_compra, precio_venta, stock_actual, stock_minimo, unidad)
select v.sku, v.nombre,
       (select id from public.categorias where nombre = v.cat),
       v.pc, v.pv, v.stock, v.minimo, v.unidad
from (values
  ('7501055300464','Coca Cola 500ml','Bebidas',1.80,3.00,48,12,'unidad'),
  ('7750885000123','Inca Kola 1L','Bebidas',3.20,5.00,30,10,'unidad'),
  ('7411001010108','Arroz Costeno 1kg','Abarrotes',3.50,4.80,60,15,'unidad'),
  ('7750243011037','Aceite Primor 1L','Abarrotes',7.20,9.50,24,8,'unidad'),
  ('7622300336738','Galleta Oreo','Snacks',1.10,1.80,80,20,'unidad'),
  ('7750670001234','Papas Lays 110g','Snacks',2.40,3.80,40,12,'unidad'),
  ('7501032300012','Detergente Bolivar 780g','Limpieza',4.10,6.20,18,6,'unidad'),
  ('7750885110556','Leche Gloria Tarro','Lacteos',2.80,4.20,52,15,'unidad'),
  ('7750182000019','Yogurt Laive 1L','Lacteos',5.00,7.50,16,6,'unidad'),
  ('7411001020107','Azucar Rubia 1kg','Abarrotes',3.00,4.20,45,12,'unidad')
) as v(sku, nombre, cat, pc, pv, stock, minimo, unidad)
on conflict (sku) do nothing;

-- ============================================================================
--  FIN DEL ESQUEMA
--  Siguiente paso: crea tu primer usuario en Authentication > Users y luego
--  marca su rol como administrador:
--    update public.perfiles set rol = 'administrador' where id = 'UUID-DEL-USUARIO';
-- ============================================================================
