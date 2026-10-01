-- ============================================================================
--  BODEGUITA CESAR RUIZ - SISTEMA DE GESTION COMERCIAL Y POS
--  Esquema COMPLETO para Supabase / PostgreSQL
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query
-- ============================================================================
--  Este script es idempotente: se puede correr en un proyecto nuevo limpio.
--  Orden: extensiones → enums → tablas → funciones → RLS → realtime → semilla
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONES
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. TIPOS ENUMERADOS
-- ----------------------------------------------------------------------------
do $$ begin
  create type rol_usuario as enum ('administrador', 'supervisor', 'cajero');
exception when duplicate_object then null; end $$;

-- Migracion en caliente: agrega el rol "supervisor" si el tipo ya existia
-- (proyectos creados antes de esta funcionalidad, con solo administrador/cajero).
-- Supervisor puede ver reportes (Rentabilidad, Compras, Mermas, Clientes,
-- Proveedores, Resumen) pero no crear/editar/eliminar nada — igual que un
-- cajero para todo lo que no sea lectura de reportes.
alter type rol_usuario add value if not exists 'supervisor';

do $$ begin
  create type metodo_pago as enum ('efectivo', 'tarjeta', 'yape', 'plin', 'transferencia', 'fiado');
exception when duplicate_object then null; end $$;

-- Migracion en caliente: "mixto" = una venta pagada con 2+ metodos distintos
-- (ver tabla pagos_venta y registrar_venta mas abajo). No se usa como valor
-- literal en ESTA transaccion (solo dentro de cuerpos de funciones, que se
-- evaluan recien cuando se invocan) — evita el error de Postgres "unsafe use
-- of new value of enum type" por usar un valor nuevo en la misma transaccion
-- que lo agrega.
alter type metodo_pago add value if not exists 'mixto';

do $$ begin
  create type tipo_movimiento as enum ('entrada', 'salida', 'ajuste', 'venta', 'devolucion');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_compra as enum ('pagado', 'pendiente');
exception when duplicate_object then null; end $$;

do $$ begin
  create type motivo_merma as enum ('vencido', 'danado', 'consumo_interno', 'otro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_caja as enum ('abierta', 'cerrada');
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

-- La politica perfiles_update (mas abajo) permite a cualquier usuario
-- actualizar SU PROPIA fila (para que pueda editar su nombre), pero eso
-- tambien le permitiria, sin este trigger, subir su propio "rol" a
-- administrador o reactivarse a si mismo llamando directamente a la API.
-- Este trigger bloquea el cambio de rol/activo salvo que quien ejecute el
-- update sea administrador (verificado en la base de datos, no en el cliente).
create or replace function public.proteger_columnas_perfil()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.es_admin() then
    if new.rol is distinct from old.rol or new.activo is distinct from old.activo then
      raise exception 'Solo un administrador puede cambiar el rol o el estado de un usuario.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_perfiles_proteger on public.perfiles;
create trigger trg_perfiles_proteger
  before update on public.perfiles
  for each row execute function public.proteger_columnas_perfil();

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
-- 4. PRODUCTOS (con columnas de caja, imagen y vencimiento)
-- ----------------------------------------------------------------------------
create table if not exists public.productos (
  id                  uuid primary key default gen_random_uuid(),
  sku                 text not null unique,
  nombre              text not null,
  categoria_id        uuid references public.categorias(id) on delete set null,
  precio_compra       numeric(10,2) not null default 0 check (precio_compra >= 0),
  precio_venta        numeric(10,2) not null default 0 check (precio_venta >= 0),
  precio_venta_caja   numeric(10,2),
  stock_actual        double precision not null default 0,
  stock_minimo        double precision not null default 5 check (stock_minimo >= 0),
  unidad              text not null default 'unidad',
  tiene_caja          boolean not null default false,
  unidades_por_caja   integer,
  tipo_venta          text not null default 'unidad',
  tiene_saco          boolean not null default false,
  kg_por_saco         double precision,
  precio_venta_saco   numeric(10,2),
  image_url           text,
  fecha_vencimiento   date,
  activo              boolean not null default true,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

-- Migracion en caliente: si el proyecto ya tenia esta tabla creada con los
-- tipos anteriores (integer / sin tipo_venta), estos ALTER la ponen al dia sin
-- perder datos. Son inofensivos si ya se corrieron antes o en un proyecto nuevo.
alter table public.productos alter column stock_actual type double precision using stock_actual::double precision;
alter table public.productos alter column stock_minimo type double precision using stock_minimo::double precision;
alter table public.productos add column if not exists tipo_venta text not null default 'unidad';
alter table public.productos add column if not exists tiene_saco boolean not null default false;
alter table public.productos add column if not exists kg_por_saco double precision;
alter table public.productos add column if not exists precio_venta_saco numeric(10,2);

do $$ begin
  alter table public.productos add constraint productos_tipo_venta_check
    check (tipo_venta in ('unidad', 'granel'));
exception when duplicate_object then null; end $$;

-- Un producto a granel (se vende por peso/volumen fraccionado) no tiene sentido
-- venderlo ademas por caja: son dos formas de fraccionar el mismo stock.
do $$ begin
  alter table public.productos add constraint productos_granel_sin_caja
    check (tipo_venta <> 'granel' or tiene_caja = false);
exception when duplicate_object then null; end $$;

-- "Venta por saco" (bolsa/costal completo) es la contraparte de "venta por
-- caja" pero para productos a granel: permite vender el saco entero (ej. 50kg
-- de arroz) ademas de venderlo suelto por kg.
do $$ begin
  alter table public.productos add constraint productos_saco_solo_granel
    check (tiene_saco = false or tipo_venta = 'granel');
exception when duplicate_object then null; end $$;

-- Endurecimiento: un 0 en estos campos no tiene sentido de negocio (una caja
-- de 0 unidades) y ademas es peligroso — el codigo de ventas/compras los usa
-- como multiplicador, y un 0 explicito (distinto de "no configurado" = null)
-- dejaria descontar/ingresar 0 unidades de stock al vender/comprar "cajas" o
-- "sacos" enteros, sin ningun aviso. Se normalizan valores invalidos
-- existentes a null (equivalente a "no configurado") antes de exigir la
-- restriccion, para no romper la migracion sobre datos previos.
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

create index if not exists idx_productos_sku       on public.productos (sku);
create index if not exists idx_productos_categoria on public.productos (categoria_id);
create index if not exists idx_productos_stock_bajo on public.productos (stock_actual)
  where activo = true;

comment on column public.productos.sku is 'Codigo unico escaneable (QR o barras).';
comment on column public.productos.tipo_venta is
  'unidad = se vende en piezas enteras (opcionalmente tambien por caja). granel = se vende fraccionado por peso/volumen (ej. kg de un saco de arroz).';

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
-- 4b. PRESENTACIONES DE PRODUCTO (empaquetado multinivel y ventas fraccionadas)
-- ----------------------------------------------------------------------------
-- Complementa (no reemplaza) el sistema de "caja"/"saco" de arriba: permite
-- definir CUALQUIER numero de presentaciones extra por producto — niveles
-- completos (Paquete Maestro, Bolsa intermedia) y/o fracciones (Media Caja,
-- Medio Paquete) — cada una con su propio precio de compra/venta.
--
-- Diseno clave: "factor_unidades" siempre esta expresado en UNIDADES BASE
-- (las mismas de productos.stock_actual), nunca relativo a otro nivel. Un
-- producto con 1 Paquete = 5 Bolsas = 10 unidades c/u (50 unidades base) se
-- modela como dos filas independientes: Bolsa=10, Paquete=50. Esto evita
-- arrastrar redondeos al encadenar niveles y hace que el descuento/ingreso de
-- stock sea una simple multiplicacion, sin importar cuantos niveles existan.
--
-- Un producto SIN filas aqui (el caso normal, sin tocar nada) sigue
-- funcionando exactamente igual que antes — compatibilidad hacia atras total.
create table if not exists public.producto_presentaciones (
  id               uuid primary key default gen_random_uuid(),
  producto_id      uuid not null references public.productos(id) on delete cascade,
  nombre           text not null check (char_length(btrim(nombre)) between 1 and 40),
  -- Unidades base que equivale UNA de esta presentacion (ver nota arriba).
  factor_unidades  numeric not null check (factor_unidades > 0),
  precio_compra    numeric(10,2) check (precio_compra is null or precio_compra >= 0),
  precio_venta     numeric(10,2) not null check (precio_venta >= 0),
  -- Puramente informativo (para mostrar un badge "Fraccion" en la UI); no
  -- afecta ningun calculo — el factor ya define correctamente la conversion.
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

-- Validacion adicional que un CHECK simple no puede expresar (depende de otra
-- tabla): en productos "por unidad" (piezas enteras, no a granel), el factor
-- debe ser un numero entero de unidades — no tiene sentido vender/fraccionar
-- "2.3 piezas" de un producto discreto. En productos a granel si se permiten
-- fracciones (ej. medio saco de 12.5 kg).
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

-- ----------------------------------------------------------------------------
-- 5. CAJAS REGISTRADORAS
-- ----------------------------------------------------------------------------
create table if not exists public.cajas (
  id              uuid primary key default gen_random_uuid(),
  cajero_id       uuid references public.perfiles(id) on delete set null,
  cajero_nombre   text,
  monto_inicial   numeric(10,2) not null default 0,
  total_efectivo  numeric(10,2) not null default 0,
  total_yape      numeric(10,2) not null default 0,
  total_fiado     numeric(10,2) not null default 0,
  total_egresos   numeric(10,2) not null default 0,
  monto_real      numeric(10,2),
  estado          estado_caja not null default 'abierta',
  abierta_en      timestamptz not null default now(),
  cerrada_en      timestamptz
);

-- Migracion en caliente (proyectos creados antes de "egresos").
alter table public.cajas add column if not exists total_egresos numeric(10,2) not null default 0;
comment on column public.cajas.total_egresos is
  'Suma de salidas de caja en efectivo durante el turno (ver tabla egresos). Se resta del efectivo esperado al cerrar caja.';

-- Migracion en caliente (proyectos creados antes de "cobros de deuda en caja").
-- Los abonos de clientes (tabla pagos_credito) que se registran durante un
-- turno se acumulan aqui, separados de "total_efectivo"/"total_yape" (que son
-- solo ventas directas) para que el reporte de cierre pueda desglosar
-- "Ventas" vs "Cobranzas" como dos lineas distintas, tal como exige el cuadre.
alter table public.cajas add column if not exists total_cobros_efectivo numeric(10,2) not null default 0;
alter table public.cajas add column if not exists total_cobros_yape     numeric(10,2) not null default 0;
-- Cobros por transferencia/tarjeta: no son efectivo fisico en la caja, pero
-- se registran para que el reporte del dia los muestre igual (ingreso real
-- del negocio aunque no cuente para el arqueo de billetes).
alter table public.cajas add column if not exists total_cobros_otros    numeric(10,2) not null default 0;
comment on column public.cajas.total_cobros_efectivo is
  'Suma de abonos de clientes (pagos_credito) cobrados en efectivo durante el turno. Suma al efectivo esperado al cerrar caja.';
comment on column public.cajas.total_cobros_yape is
  'Suma de abonos de clientes cobrados por Yape durante el turno (informativo, no es efectivo fisico).';
comment on column public.cajas.total_cobros_otros is
  'Suma de abonos de clientes cobrados por transferencia/tarjeta durante el turno (informativo, no es efectivo fisico).';

create index if not exists idx_cajas_cajero on public.cajas (cajero_id);
create index if not exists idx_cajas_estado on public.cajas (estado);

-- ----------------------------------------------------------------------------
-- 6. CLIENTES CREDITO (sistema de fiado)
-- ----------------------------------------------------------------------------
create table if not exists public.clientes_credito (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  telefono        text,
  direccion       text,
  limite_credito  numeric(10,2) not null default 0,
  deuda_actual    numeric(10,2) not null default 0,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);

create index if not exists idx_clientes_activo on public.clientes_credito (activo);

-- ----------------------------------------------------------------------------
-- 7. VENTAS (con caja_id y cliente_id)
-- ----------------------------------------------------------------------------
create table if not exists public.ventas (
  id              uuid primary key default gen_random_uuid(),
  numero          bigint generated always as identity,
  cajero_id       uuid references public.perfiles(id) on delete set null,
  cajero_nombre   text,
  caja_id         uuid references public.cajas(id) on delete set null,
  cliente_id      uuid references public.clientes_credito(id) on delete set null,
  cliente_nombre  text,
  subtotal        numeric(10,2) not null default 0,
  descuento       numeric(10,2) not null default 0 check (descuento >= 0),
  igv             numeric(10,2) not null default 0,
  total           numeric(10,2) not null default 0,
  metodo          metodo_pago not null default 'efectivo',
  pago_recibido   numeric(10,2) not null default 0,
  vuelto          numeric(10,2) not null default 0,
  anulada         boolean not null default false,
  creado_en       timestamptz not null default now()
);

-- Migracion en caliente: marca si una venta fue modificada despues de creada
-- (ver RPC editar_venta y tabla auditoria_ventas mas abajo).
alter table public.ventas add column if not exists editada boolean not null default false;
comment on column public.ventas.editada is
  'true si sus productos/cantidades fueron modificados despues de registrada (ver editar_venta() y auditoria_ventas).';

create index if not exists idx_ventas_fecha  on public.ventas (creado_en desc);
create index if not exists idx_ventas_cajero on public.ventas (cajero_id);
create index if not exists idx_ventas_metodo on public.ventas (metodo);
create index if not exists idx_ventas_caja   on public.ventas (caja_id);

-- ----------------------------------------------------------------------------
-- 8. DETALLE DE VENTAS
-- ----------------------------------------------------------------------------
create table if not exists public.detalle_ventas (
  id               uuid primary key default gen_random_uuid(),
  venta_id         uuid not null references public.ventas(id) on delete cascade,
  producto_id      uuid references public.productos(id) on delete set null,
  producto_nombre  text not null,
  sku              text,
  cantidad         double precision not null check (cantidad > 0),
  modalidad        text not null default 'unidad',
  unidades         double precision not null default 0,
  precio_unitario  numeric(10,2) not null,
  subtotal         numeric(10,2) not null,
  presentacion_nombre text
);

-- Migracion en caliente (ver nota en la tabla productos).
alter table public.detalle_ventas alter column cantidad type double precision using cantidad::double precision;
alter table public.detalle_ventas add column if not exists modalidad text not null default 'unidad';
alter table public.detalle_ventas add column if not exists unidades double precision not null default 0;
alter table public.detalle_ventas add column if not exists presentacion_nombre text;
-- Backfill unico: filas creadas antes de esta migracion no tienen "unidades"
-- (queda en 0 por el default). Para esas, "cantidad" es el mejor estimado
-- disponible (coincide siempre que la venta no haya sido por caja).
update public.detalle_ventas set unidades = cantidad where unidades = 0;

comment on column public.detalle_ventas.cantidad is
  'Cantidad tal como se vendio: N cajas, N kg, N unidades o N de una presentacion flexible, segun modalidad.';
comment on column public.detalle_ventas.unidades is
  'Unidades reales de stock descontadas (cantidad * factor de la presentacion). Se usa para anular ventas correctamente.';
comment on column public.detalle_ventas.presentacion_nombre is
  'Nombre a mostrar de la presentacion usada ("Caja", "Saco" o el nombre de una presentacion flexible), tomado en el momento de la venta. Null = unidad simple.';

create index if not exists idx_detalle_venta    on public.detalle_ventas (venta_id);
create index if not exists idx_detalle_producto on public.detalle_ventas (producto_id);

-- ----------------------------------------------------------------------------
-- 8b. PAGOS DE VENTA (desglose por metodo — soporta pagos mixtos)
-- ----------------------------------------------------------------------------
-- Toda venta tiene 1+ filas aqui, sin importar si se pago con un solo metodo
-- (el caso normal, una fila) o con varios (ej. Efectivo + Yape, dos filas).
-- "monto" es siempre la CONTRIBUCION real de esa pierna al total de la venta
-- (neto del vuelto si es la pierna en efectivo la que dio cambio) — por
-- diseno, sum(monto) de las filas de una venta SIEMPRE es igual a
-- ventas.total. Esto es lo que permite que editar_venta() reescale
-- proporcionalmente los pagos cuando cambia el total sin tener que volver a
-- pedirle el pago al cliente.
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

-- Backfill: toda venta NO anulada creada antes de esta migracion (o por
-- llamadas a registrar_venta que aun no mandaban pagos) no tiene filas aqui
-- todavia — se le crea una sola fila con su metodo/total tal cual, para que
-- anular_venta()/editar_venta() puedan operar de forma uniforme sobre
-- CUALQUIER venta sin distinguir "vieja" de "nueva".
insert into public.pagos_venta (venta_id, metodo, monto)
select v.id, v.metodo, v.total
from public.ventas v
where not v.anulada
  and v.total > 0
  and not exists (select 1 from public.pagos_venta pv where pv.venta_id = v.id);

-- ----------------------------------------------------------------------------
-- 8c. AUDITORIA DE VENTAS (anulaciones y ediciones: quien, cuando, por que)
-- ----------------------------------------------------------------------------
create table if not exists public.auditoria_ventas (
  id            uuid primary key default gen_random_uuid(),
  venta_id      uuid references public.ventas(id) on delete set null,
  venta_numero  bigint,
  accion        text not null check (accion in ('anulada', 'editada')),
  usuario_id    uuid references public.perfiles(id) on delete set null,
  usuario_nombre text,
  motivo        text not null check (btrim(motivo) <> ''),
  detalle       jsonb,
  creado_en     timestamptz not null default now()
);

create index if not exists idx_auditoria_ventas_venta on public.auditoria_ventas (venta_id, creado_en desc);

comment on table public.auditoria_ventas is
  'Rastro de auditoria de anulaciones y ediciones de ventas: quien, cuando y por que. Solo se escribe desde anular_venta()/editar_venta() (security definer).';

-- ----------------------------------------------------------------------------
-- 9. MOVIMIENTOS DE INVENTARIO (Kardex simplificado)
-- ----------------------------------------------------------------------------
create table if not exists public.movimientos_inventario (
  id              uuid primary key default gen_random_uuid(),
  producto_id     uuid references public.productos(id) on delete set null,
  producto_nombre text,
  tipo            tipo_movimiento not null,
  cantidad        double precision not null,
  stock_previo    double precision not null,
  stock_nuevo     double precision not null,
  motivo          text,
  usuario_id      uuid references public.perfiles(id) on delete set null,
  creado_en       timestamptz not null default now()
);

-- Migracion en caliente (ver nota en la tabla productos).
alter table public.movimientos_inventario alter column cantidad     type double precision using cantidad::double precision;
alter table public.movimientos_inventario alter column stock_previo type double precision using stock_previo::double precision;
alter table public.movimientos_inventario alter column stock_nuevo  type double precision using stock_nuevo::double precision;

create index if not exists idx_mov_producto on public.movimientos_inventario (producto_id, creado_en desc);

-- ----------------------------------------------------------------------------
-- 10. PAGOS CREDITO (abonos de clientes)
-- ----------------------------------------------------------------------------
create table if not exists public.pagos_credito (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes_credito(id) on delete cascade,
  monto       numeric(10,2) not null check (monto > 0),
  nota        text,
  cajero_id   uuid references public.perfiles(id) on delete set null,
  creado_en   timestamptz not null default now()
);

create index if not exists idx_pagos_cliente on public.pagos_credito (cliente_id, creado_en desc);

-- Migracion en caliente (proyectos creados antes de vincular abonos a caja).
alter table public.pagos_credito add column if not exists metodo text not null default 'efectivo';
do $$ begin
  alter table public.pagos_credito add constraint pagos_credito_metodo_check
    check (metodo in ('efectivo', 'yape', 'transferencia', 'tarjeta'));
exception when duplicate_object then null; end $$;
-- Caja en la que se cobro el abono (null = cobrado sin caja abierta en ese
-- momento; se puede vincular despues, ver adopcion de "huerfanos" al abrir caja).
alter table public.pagos_credito add column if not exists caja_id uuid references public.cajas(id) on delete set null;

create index if not exists idx_pagos_caja on public.pagos_credito (caja_id);

comment on column public.pagos_credito.metodo is
  'Metodo con el que el cliente pago el abono (efectivo/yape/transferencia/tarjeta). No es "fiado": un abono siempre es un ingreso real.';
comment on column public.pagos_credito.caja_id is
  'Caja del turno en que se cobro el abono. Los cobrados en efectivo suman al efectivo esperado de esa caja (ver RPC registrar_abono_cliente).';

-- ----------------------------------------------------------------------------
-- 11. PROVEEDORES
-- ----------------------------------------------------------------------------
create table if not exists public.proveedores (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  ruc         text,
  telefono    text,
  email       text,
  direccion   text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 12. COMPRAS
-- ----------------------------------------------------------------------------
create table if not exists public.compras (
  id               uuid primary key default gen_random_uuid(),
  numero           text,
  proveedor_id     uuid references public.proveedores(id) on delete set null,
  proveedor_nombre text,
  total            numeric(10,2) not null default 0,
  estado           estado_compra not null default 'pendiente',
  fecha_compra     date not null default current_date,
  notas            text,
  creado_en        timestamptz not null default now()
);

create index if not exists idx_compras_fecha on public.compras (fecha_compra desc);

-- ----------------------------------------------------------------------------
-- 13. DETALLE DE COMPRAS
-- ----------------------------------------------------------------------------
create table if not exists public.detalle_compras (
  id                  uuid primary key default gen_random_uuid(),
  compra_id           uuid not null references public.compras(id) on delete cascade,
  producto_id         uuid references public.productos(id) on delete set null,
  producto_nombre     text not null,
  cantidad            double precision not null check (cantidad > 0),
  modalidad           text not null default 'unidad',
  unidades            double precision not null default 0,
  presentacion_nombre text,
  precio_unitario     numeric(10,2) not null,
  subtotal            numeric(10,2) not null
);

-- Migracion en caliente (ver nota en la tabla productos).
alter table public.detalle_compras alter column cantidad type double precision using cantidad::double precision;
alter table public.detalle_compras add column if not exists modalidad text not null default 'unidad';
alter table public.detalle_compras add column if not exists unidades double precision not null default 0;
alter table public.detalle_compras add column if not exists presentacion_nombre text;
-- Backfill unico (ver misma nota en detalle_ventas): filas de antes de esta
-- migracion no tenian conversion por presentacion, asi que "cantidad" ya era
-- la cantidad real en unidades base.
update public.detalle_compras set unidades = cantidad where unidades = 0;

comment on column public.detalle_compras.cantidad is
  'Cantidad comprada tal como se ingreso: N cajas, N kg, N unidades o N de una presentacion flexible, segun modalidad.';
comment on column public.detalle_compras.unidades is
  'Unidades base que ingresaron al stock (cantidad * factor de la presentacion).';
comment on column public.detalle_compras.presentacion_nombre is
  'Nombre a mostrar de la presentacion usada, tomado en el momento de la compra. Null = unidad simple.';

create index if not exists idx_det_compras on public.detalle_compras (compra_id);

-- ----------------------------------------------------------------------------
-- 14. MERMAS (perdidas de inventario)
-- ----------------------------------------------------------------------------
create table if not exists public.mermas (
  id               uuid primary key default gen_random_uuid(),
  producto_id      uuid references public.productos(id) on delete set null,
  producto_nombre  text not null,
  cantidad         double precision not null check (cantidad > 0),
  costo_unitario   numeric(10,2) not null default 0,
  costo_total      numeric(10,2) not null default 0,
  motivo           motivo_merma not null,
  descripcion      text,
  usuario_id       uuid references public.perfiles(id) on delete set null,
  creado_en        timestamptz not null default now()
);

-- Migracion en caliente (ver nota en la tabla productos).
alter table public.mermas alter column cantidad type double precision using cantidad::double precision;

create index if not exists idx_mermas_fecha on public.mermas (creado_en desc);

-- ----------------------------------------------------------------------------
-- 15. EGRESOS (gastos del negocio: alquiler, servicios, sueldos, salidas de
--     caja para gastos menores, etc.)
-- ----------------------------------------------------------------------------
create table if not exists public.egresos (
  id              uuid primary key default gen_random_uuid(),
  concepto        text not null,
  categoria       text not null default 'otro',
  monto           numeric(10,2) not null check (monto > 0),
  metodo          text not null default 'efectivo',
  -- Si se registra durante un turno de caja abierto y se paga en efectivo,
  -- se descuenta del efectivo esperado al cerrar esa caja (ver RPC registrar_egreso).
  caja_id         uuid references public.cajas(id) on delete set null,
  usuario_id      uuid references public.perfiles(id) on delete set null,
  usuario_nombre  text,
  fecha           date not null default current_date,
  notas           text,
  creado_en       timestamptz not null default now()
);

do $$ begin
  alter table public.egresos add constraint egresos_categoria_check
    check (categoria in ('alquiler', 'servicios', 'sueldos', 'transporte', 'insumos', 'impuestos', 'mantenimiento', 'otro'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.egresos add constraint egresos_metodo_check
    check (metodo in ('efectivo', 'yape', 'transferencia', 'tarjeta'));
exception when duplicate_object then null; end $$;

create index if not exists idx_egresos_fecha on public.egresos (fecha desc);
create index if not exists idx_egresos_caja  on public.egresos (caja_id);

comment on table public.egresos is
  'Gastos del negocio. Los ligados a una caja (caja_id) y pagados en efectivo descuentan el efectivo esperado de ese turno.';

-- ----------------------------------------------------------------------------
-- 16. STORAGE - BUCKET DE FOTOS DE PRODUCTOS
-- ----------------------------------------------------------------------------
-- El frontend (useProductoImagen.ts) sube las fotos a este bucket y usa
-- getPublicUrl(), por lo que debe existir y ser publico para lectura.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- El bucket es publico (linea de arriba), asi que servir un archivo por su
-- URL publica NO pasa por esta politica — Storage lo hace por una ruta
-- aparte que ignora RLS. Esta politica solo gobierna poder LISTAR el
-- contenido del bucket via la API de Storage; el frontend nunca lista este
-- bucket (solo sube/borra por nombre de archivo conocido, ver
-- useProductoImagen.ts), asi que restringirla a "authenticated" cierra el
-- aviso "Los clientes pueden listar todos los archivos en este bucket" sin
-- afectar que las fotos se sigan viendo publicamente.
drop policy if exists product_images_select on storage.objects;
create policy product_images_select on storage.objects for select
  to authenticated using (bucket_id = 'product-images');

drop policy if exists product_images_insert on storage.objects;
create policy product_images_insert on storage.objects for insert
  to authenticated with check (bucket_id = 'product-images');

drop policy if exists product_images_update on storage.objects;
create policy product_images_update on storage.objects for update
  to authenticated using (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');

drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects for delete
  to authenticated using (bucket_id = 'product-images');

-- ============================================================================
-- FUNCIONES RPC (invocadas desde el frontend con supabase.rpc())
-- ============================================================================

-- ----------------------------------------------------------------------------
-- HELPER: resuelve una "modalidad" de venta/compra contra un producto.
-- ----------------------------------------------------------------------------
-- Unico lugar (usado por registrar_venta, registrar_compra y ajustar_stock)
-- que traduce una modalidad a (a) cuantas unidades base representa UNA de esa
-- presentacion y (b) el nombre a mostrar — evita duplicar y desincronizar
-- esta logica entre funciones, que fue el origen de bugs similares antes.
--
-- "modalidad" acepta:
--   - 'unidad' (o vacio/null)     -> 1 unidad base, sin etiqueta.
--   - 'caja'                      -> productos.unidades_por_caja (legacy).
--   - 'saco'                      -> productos.kg_por_saco (legacy, granel).
--   - el id (uuid) de una fila en producto_presentaciones -> su factor_unidades.
-- Cualquier otro valor, o una presentacion inactiva/de otro producto, revienta
-- con un mensaje claro en vez de dejar pasar un descuadre de stock silencioso.
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

-- ----------------------------------------------------------------------------
-- RPC 5: INCREMENTAR CAJA (acumula totales por metodo de pago)
-- ----------------------------------------------------------------------------
create or replace function public.incrementar_caja(
  p_caja_id uuid,
  p_metodo  text,
  p_monto   numeric
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_metodo = 'efectivo' then
    update public.cajas set total_efectivo = total_efectivo + p_monto where id = p_caja_id;
  elsif p_metodo = 'yape' then
    update public.cajas set total_yape = total_yape + p_monto where id = p_caja_id;
  elsif p_metodo = 'fiado' then
    update public.cajas set total_fiado = total_fiado + p_monto where id = p_caja_id;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC 6: REGISTRAR CARGO FIADO (suma deuda al cliente)
-- ----------------------------------------------------------------------------
create or replace function public.registrar_cargo_fiado(
  p_cliente_id uuid,
  p_monto      numeric
)
returns public.clientes_credito
language plpgsql
security definer set search_path = public
as $$
declare
  v_cliente public.clientes_credito%rowtype;
begin
  select * into v_cliente from public.clientes_credito where id = p_cliente_id for update;
  if not found then raise exception 'Cliente no encontrado.'; end if;

  update public.clientes_credito
    set deuda_actual = deuda_actual + p_monto
    where id = p_cliente_id
    returning * into v_cliente;

  return v_cliente;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC 7: REGISTRAR ABONO CLIENTE (resta deuda, guarda el pago y lo consolida
-- en la caja activa como ingreso por cobranza)
-- ----------------------------------------------------------------------------
-- Transaccional: valida, actualiza la deuda del cliente, inserta el abono y
-- suma el monto a la caja indicada, todo en una sola funcion plpgsql (una
-- funcion = una transaccion; si algo falla a mitad de camino, Postgres
-- revierte todo el bloque y no queda ningun registro a medias).
-- Parametros nuevos (p_metodo, p_caja_id) se agregaron al final para poder
-- usar "create or replace function" sin romper la firma existente.
create or replace function public.registrar_abono_cliente(
  p_cliente_id uuid,
  p_monto      numeric,
  p_nota       text default null,
  p_metodo     text default 'efectivo',
  p_caja_id    uuid default null
)
returns public.pagos_credito
language plpgsql
security definer set search_path = public
as $$
declare
  v_pago    public.pagos_credito%rowtype;
  v_cliente public.clientes_credito%rowtype;
  v_metodo  text := coalesce(nullif(btrim(p_metodo), ''), 'efectivo');
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del abono debe ser mayor a 0.';
  end if;

  if v_metodo not in ('efectivo', 'yape', 'transferencia', 'tarjeta') then
    raise exception 'Metodo de pago invalido: %.', v_metodo;
  end if;

  -- Bloqueo de fila: evita que dos abonos simultaneos al mismo cliente lean
  -- la misma deuda_actual "vieja" y ambos pasen la validacion por separado.
  select * into v_cliente from public.clientes_credito where id = p_cliente_id for update;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  if p_monto > v_cliente.deuda_actual then
    raise exception 'El abono (S/ %) no puede superar la deuda actual (S/ %).',
      round(p_monto, 2), round(v_cliente.deuda_actual, 2);
  end if;

  if p_caja_id is not null and not exists (select 1 from public.cajas where id = p_caja_id) then
    raise exception 'Caja no encontrada.';
  end if;

  update public.clientes_credito
    set deuda_actual = greatest(deuda_actual - p_monto, 0)
    where id = p_cliente_id;

  insert into public.pagos_credito (cliente_id, monto, nota, metodo, caja_id, cajero_id)
    values (p_cliente_id, p_monto, p_nota, v_metodo, p_caja_id, auth.uid())
    returning * into v_pago;

  -- Consolida el abono en la caja activa: efectivo/yape van a sus columnas
  -- dedicadas de cobranza (separadas de las ventas directas para el reporte);
  -- transferencia/tarjeta quedan solo como registro informativo (no es
  -- efectivo fisico, no debe sumar al arqueo de billetes).
  if p_caja_id is not null then
    if v_metodo = 'efectivo' then
      update public.cajas set total_cobros_efectivo = total_cobros_efectivo + p_monto where id = p_caja_id;
    elsif v_metodo = 'yape' then
      update public.cajas set total_cobros_yape = total_cobros_yape + p_monto where id = p_caja_id;
    else
      update public.cajas set total_cobros_otros = total_cobros_otros + p_monto where id = p_caja_id;
    end if;
  end if;

  return v_pago;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC 8: REGISTRAR EGRESO (gasto del negocio o salida de caja)
-- ----------------------------------------------------------------------------
-- Todas las escrituras a "egresos" pasan por este RPC (no hay politica RLS de
-- insert directa) para que el descuento del efectivo esperado de la caja
-- quede siempre sincronizado con el registro del gasto, de forma atomica.
create or replace function public.registrar_egreso(
  p_concepto  text,
  p_categoria text,
  p_monto     numeric,
  p_metodo    text default 'efectivo',
  p_caja_id   uuid default null,
  p_notas     text default null
)
returns public.egresos
language plpgsql
security definer set search_path = public
as $$
declare
  v_egreso  public.egresos%rowtype;
  v_caja    public.cajas%rowtype;
  v_nombre  text;
  v_metodo  text := coalesce(nullif(btrim(p_metodo), ''), 'efectivo');
begin
  if p_concepto is null or btrim(p_concepto) = '' then
    raise exception 'El concepto es obligatorio.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser mayor a 0.';
  end if;

  if p_caja_id is not null then
    select * into v_caja from public.cajas where id = p_caja_id for update;
    if not found then
      raise exception 'Caja no encontrada.';
    end if;
    -- Un cajero solo puede registrar salidas contra su propia caja; un
    -- administrador puede hacerlo contra cualquiera (ej. registro retroactivo).
    if v_caja.cajero_id is distinct from auth.uid() and not public.es_admin() then
      raise exception 'Solo puedes registrar salidas en tu propia caja.';
    end if;
  end if;

  select nombre into v_nombre from public.perfiles where id = auth.uid();

  insert into public.egresos (
    concepto, categoria, monto, metodo, caja_id, usuario_id, usuario_nombre, notas
  ) values (
    btrim(p_concepto), coalesce(nullif(btrim(p_categoria), ''), 'otro'), p_monto, v_metodo,
    p_caja_id, auth.uid(), v_nombre, p_notas
  ) returning * into v_egreso;

  -- Solo las salidas en efectivo ligadas a una caja afectan el efectivo
  -- esperado de ese turno (un gasto pagado por Yape/transferencia no saca
  -- dinero fisico de la caja).
  if p_caja_id is not null and v_metodo = 'efectivo' then
    update public.cajas set total_egresos = total_egresos + p_monto where id = p_caja_id;
  end if;

  return v_egreso;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC 9: ELIMINAR EGRESO (solo admin) - revierte el efectivo esperado si aplica
-- ----------------------------------------------------------------------------
create or replace function public.eliminar_egreso(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_egreso public.egresos%rowtype;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede eliminar egresos.';
  end if;

  select * into v_egreso from public.egresos where id = p_id;
  if not found then
    raise exception 'Egreso no encontrado.';
  end if;

  if v_egreso.caja_id is not null and v_egreso.metodo = 'efectivo' then
    update public.cajas
      set total_egresos = greatest(total_egresos - v_egreso.monto, 0)
      where id = v_egreso.caja_id;
  end if;

  delete from public.egresos where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC 10: IMPORTAR INVENTARIO (solo admin) - alta/actualizacion masiva desde
-- el .xlsx exportado por Inventario > Exportar Excel
-- ----------------------------------------------------------------------------
-- Cada fila se procesa en su propio bloque BEGIN/EXCEPTION (= un SAVEPOINT
-- implicito en PL/pgSQL): si una fila tiene datos invalidos, SOLO esa fila
-- se revierte y se reporta como error — las demas filas del archivo se
-- procesan igual, sin que una fila mala tumbe la importacion completa.
--
-- Reglas de "celda vacia":
--   - Actualizar un producto existente: celda vacia = no tocar ese campo
--     (nunca lo borra). Se logra con coalesce(valor_nuevo, valor_actual),
--     donde valor_nuevo ya viene en NULL desde nullif(..,'') cuando la
--     celda estaba vacia o la clave no vino en el JSON.
--   - Crear un producto nuevo (SKU no existe): celda vacia = usa el mismo
--     default que tiene la columna en la tabla productos.
--
-- El stock nunca se pisa en silencio: si la fila trae un stock_actual
-- distinto al que ya tiene un producto EXISTENTE, se aplica via
-- ajustar_stock() (mismo camino que un ajuste manual desde Inventario),
-- que deja el movimiento correspondiente en el kardex. Un producto NUEVO
-- simplemente nace con ese stock (igual que el alta manual en ProductForm,
-- que tampoco genera kardex para el stock inicial).
create or replace function public.importar_inventario(p_filas jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_fila                jsonb;
  v_idx                 bigint;
  v_resultados          jsonb := '[]'::jsonb;
  v_sku                 text;
  v_nombre              text;
  v_categoria           text;
  v_categoria_id        uuid;
  v_tipo_venta          text;
  v_unidad              text;
  v_precio_compra       numeric;
  v_precio_venta        numeric;
  v_precio_venta_caja   numeric;
  v_stock_actual        numeric;
  v_stock_minimo        numeric;
  v_tiene_caja          boolean;
  v_unidades_por_caja   integer;
  v_tiene_saco          boolean;
  v_kg_por_saco         numeric;
  v_precio_venta_saco   numeric;
  v_presentaciones_txt  text;
  v_presentaciones      jsonb;
  v_fecha_venc          text;
  v_activo              boolean;
  v_existente           public.productos%rowtype;
  v_producto_id         uuid;
  v_accion              text;
  v_mensaje             text;
  v_presentacion        jsonb;
  v_pres_nombre         text;
  v_pres_factor         numeric;
  v_pres_precio_venta   numeric;
  v_pres_precio_compra  numeric;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede importar el inventario.';
  end if;

  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'El formato de las filas a importar no es valido.';
  end if;

  for v_fila, v_idx in
    select elem, ord from jsonb_array_elements(p_filas) with ordinality as t(elem, ord)
  loop
    v_existente := null;
    v_categoria_id := null;
    v_accion := null;
    v_mensaje := null;

    begin -- sub-transaccion (savepoint) de esta fila
      v_sku := nullif(btrim(coalesce(v_fila->>'sku', '')), '');
      if v_sku is null then
        raise exception 'Falta el SKU.';
      end if;

      select * into v_existente from public.productos where sku = v_sku for update;

      v_nombre            := nullif(btrim(coalesce(v_fila->>'nombre', '')), '');
      v_categoria         := nullif(btrim(coalesce(v_fila->>'categoria', '')), '');
      v_tipo_venta        := nullif(lower(btrim(coalesce(v_fila->>'tipo_venta', ''))), '');
      v_unidad            := nullif(btrim(coalesce(v_fila->>'unidad', '')), '');
      v_precio_compra     := nullif(v_fila->>'precio_compra', '')::numeric;
      v_precio_venta      := nullif(v_fila->>'precio_venta', '')::numeric;
      v_precio_venta_caja := nullif(v_fila->>'precio_venta_caja', '')::numeric;
      v_stock_actual      := nullif(v_fila->>'stock_actual', '')::numeric;
      v_stock_minimo      := nullif(v_fila->>'stock_minimo', '')::numeric;
      v_unidades_por_caja := nullif(v_fila->>'unidades_por_caja', '')::integer;
      v_kg_por_saco       := nullif(v_fila->>'kg_por_saco', '')::numeric;
      v_precio_venta_saco := nullif(v_fila->>'precio_venta_saco', '')::numeric;
      v_fecha_venc        := nullif(btrim(coalesce(v_fila->>'fecha_vencimiento', '')), '');
      v_presentaciones_txt := nullif(btrim(coalesce(v_fila->>'presentaciones', '')), '');

      -- Booleanos SI/NO: un valor no reconocido se trata como "no indicado"
      -- (no bloquea la fila por un campo secundario con un typo).
      v_tiene_caja := case upper(btrim(coalesce(v_fila->>'tiene_caja', '')))
                        when 'SI' then true when 'SÍ' then true when 'NO' then false else null end;
      v_tiene_saco := case upper(btrim(coalesce(v_fila->>'tiene_saco', '')))
                        when 'SI' then true when 'SÍ' then true when 'NO' then false else null end;
      v_activo     := case upper(btrim(coalesce(v_fila->>'activo', '')))
                        when 'SI' then true when 'SÍ' then true when 'NO' then false else null end;

      if v_tipo_venta is not null and v_tipo_venta not in ('unidad', 'granel') then
        raise exception 'Tipo de venta invalido: "%" (usa Unidad o Granel).', v_tipo_venta;
      end if;
      if v_stock_actual is not null and v_stock_actual < 0 then
        raise exception 'El stock no puede ser negativo.';
      end if;

      -- Categoria: busca por nombre sin importar mayusculas/espacios; si no
      -- existe, la crea sola.
      if v_categoria is not null then
        select id into v_categoria_id from public.categorias
          where lower(btrim(nombre)) = lower(v_categoria);
        if v_categoria_id is null then
          insert into public.categorias (nombre) values (v_categoria)
            returning id into v_categoria_id;
        end if;
      end if;

      -- Presentaciones: valida con las mismas reglas que usa el sistema al
      -- vender por presentacion (nombre obligatorio, factor > 0, precio >= 0)
      -- ANTES de tocar nada — si el JSON esta mal formado o alguna fila es
      -- invalida, se rechaza la fila completa del Excel con un mensaje claro.
      v_presentaciones := null;
      if v_presentaciones_txt is not null then
        begin
          v_presentaciones := v_presentaciones_txt::jsonb;
        exception when others then
          raise exception 'La columna Presentaciones no es un JSON valido.';
        end;
        if jsonb_typeof(v_presentaciones) <> 'array' then
          raise exception 'La columna Presentaciones debe ser un arreglo JSON (use [] o dejela vacia).';
        end if;

        for v_presentacion in select * from jsonb_array_elements(v_presentaciones)
        loop
          v_pres_nombre := nullif(btrim(coalesce(v_presentacion->>'nombre', '')), '');
          if v_pres_nombre is null then
            raise exception 'Cada presentacion debe tener "nombre".';
          end if;
          begin
            v_pres_factor        := nullif(v_presentacion->>'factor_unidades', '')::numeric;
            v_pres_precio_venta  := nullif(v_presentacion->>'precio_venta', '')::numeric;
            v_pres_precio_compra := nullif(v_presentacion->>'precio_compra', '')::numeric;
          exception when others then
            raise exception 'La presentacion "%" tiene un numero invalido.', v_pres_nombre;
          end;
          if v_pres_factor is null or v_pres_factor <= 0 then
            raise exception 'La presentacion "%" debe tener factor_unidades mayor a 0.', v_pres_nombre;
          end if;
          if v_pres_precio_venta is null or v_pres_precio_venta < 0 then
            raise exception 'La presentacion "%" debe tener precio_venta valido (mayor o igual a 0).', v_pres_nombre;
          end if;
          if v_pres_precio_compra is not null and v_pres_precio_compra < 0 then
            raise exception 'La presentacion "%" tiene precio_compra invalido.', v_pres_nombre;
          end if;
        end loop;
      end if;

      if found then
        -- ── ACTUALIZAR: celda vacia (NULL aqui) = no tocar esa columna ──
        v_producto_id := v_existente.id;

        update public.productos set
          nombre            = coalesce(v_nombre, nombre),
          categoria_id      = coalesce(v_categoria_id, categoria_id),
          tipo_venta        = coalesce(v_tipo_venta, tipo_venta),
          unidad            = coalesce(v_unidad, unidad),
          precio_compra     = coalesce(v_precio_compra, precio_compra),
          precio_venta      = coalesce(v_precio_venta, precio_venta),
          precio_venta_caja = coalesce(v_precio_venta_caja, precio_venta_caja),
          stock_minimo      = coalesce(v_stock_minimo, stock_minimo),
          tiene_caja        = coalesce(v_tiene_caja, tiene_caja),
          unidades_por_caja = coalesce(v_unidades_por_caja, unidades_por_caja),
          tiene_saco        = coalesce(v_tiene_saco, tiene_saco),
          kg_por_saco       = coalesce(v_kg_por_saco, kg_por_saco),
          precio_venta_saco = coalesce(v_precio_venta_saco, precio_venta_saco),
          fecha_vencimiento = coalesce(v_fecha_venc::date, fecha_vencimiento),
          activo            = coalesce(v_activo, activo)
        where id = v_producto_id;

        -- El stock nunca se pisa en silencio: si cambio, pasa por
        -- ajustar_stock() para que quede su movimiento en el kardex.
        if v_stock_actual is not null and v_stock_actual <> v_existente.stock_actual then
          perform public.ajustar_stock(
            v_producto_id,
            v_stock_actual - v_existente.stock_actual,
            'ajuste',
            'Importacion masiva de inventario'
          );
        end if;

        v_accion := 'actualizado';
      else
        -- ── CREAR: celda vacia (NULL aqui) = default de la columna ──
        if v_nombre is null then
          raise exception 'Falta el nombre (obligatorio para crear un producto nuevo).';
        end if;

        insert into public.productos (
          sku, nombre, categoria_id, precio_compra, precio_venta, precio_venta_caja,
          stock_actual, stock_minimo, unidad, tiene_caja, unidades_por_caja,
          tipo_venta, tiene_saco, kg_por_saco, precio_venta_saco,
          fecha_vencimiento, activo
        ) values (
          v_sku, v_nombre, v_categoria_id,
          coalesce(v_precio_compra, 0), coalesce(v_precio_venta, 0), v_precio_venta_caja,
          coalesce(v_stock_actual, 0), coalesce(v_stock_minimo, 5), coalesce(v_unidad, 'unidad'),
          coalesce(v_tiene_caja, false), v_unidades_por_caja,
          coalesce(v_tipo_venta, 'unidad'), coalesce(v_tiene_saco, false), v_kg_por_saco, v_precio_venta_saco,
          v_fecha_venc::date, coalesce(v_activo, true)
        ) returning id into v_producto_id;

        v_accion := 'creado';
      end if;

      -- Presentaciones: si la celda vino con contenido, REEMPLAZA el
      -- conjunto completo (asi el export sirve de respaldo fiel: reimportar
      -- el mismo archivo reproduce el mismo estado). Celda vacia = no toca
      -- las presentaciones existentes.
      if v_presentaciones is not null then
        delete from public.producto_presentaciones where producto_id = v_producto_id;
        for v_presentacion in select * from jsonb_array_elements(v_presentaciones)
        loop
          insert into public.producto_presentaciones (
            producto_id, nombre, factor_unidades, precio_compra, precio_venta, es_fraccion
          ) values (
            v_producto_id,
            btrim(v_presentacion->>'nombre'),
            (v_presentacion->>'factor_unidades')::numeric,
            nullif(v_presentacion->>'precio_compra', '')::numeric,
            (v_presentacion->>'precio_venta')::numeric,
            coalesce((v_presentacion->>'es_fraccion')::boolean, false)
          );
        end loop;
      end if;

      v_resultados := v_resultados || jsonb_build_object(
        'fila', v_idx + 1, 'sku', v_sku, 'accion', v_accion,
        'mensaje', case v_accion when 'creado' then 'Producto creado.' else 'Producto actualizado.' end
      );
    exception when others then
      -- El PL/pgSQL de este bloque actua como SAVEPOINT: al entrar aqui, se
      -- revierte SOLO lo que hizo esta fila (incluye el "for update" del
      -- select de arriba) — las filas ya procesadas y las siguientes no se
      -- ven afectadas.
      v_resultados := v_resultados || jsonb_build_object(
        'fila', v_idx + 1, 'sku', coalesce(v_sku, ''), 'accion', 'error', 'mensaje', sqlerrm
      );
    end;
  end loop;

  return v_resultados;
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.perfiles                enable row level security;
alter table public.categorias              enable row level security;
alter table public.productos               enable row level security;
alter table public.producto_presentaciones enable row level security;
alter table public.cajas                   enable row level security;
alter table public.clientes_credito        enable row level security;
alter table public.ventas                  enable row level security;
alter table public.detalle_ventas          enable row level security;
alter table public.pagos_venta             enable row level security;
alter table public.auditoria_ventas        enable row level security;
alter table public.movimientos_inventario  enable row level security;
alter table public.pagos_credito           enable row level security;
alter table public.proveedores             enable row level security;
alter table public.compras                 enable row level security;
alter table public.detalle_compras         enable row level security;
alter table public.mermas                  enable row level security;
alter table public.egresos                 enable row level security;

-- PERFILES
drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select
  using (id = auth.uid() or public.es_admin());

drop policy if exists perfiles_update on public.perfiles;
create policy perfiles_update on public.perfiles for update
  using (id = auth.uid() or public.es_admin());

-- CATEGORIAS
drop policy if exists categorias_select on public.categorias;
create policy categorias_select on public.categorias for select
  to authenticated using (true);
drop policy if exists categorias_write on public.categorias;
create policy categorias_write on public.categorias for all
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- PRODUCTOS
drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos for select
  to authenticated using (true);
drop policy if exists productos_write on public.productos;
create policy productos_write on public.productos for all
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- PRESENTACIONES DE PRODUCTO (lectura para todos — los cajeros la necesitan
-- para vender por Caja/Paquete/Bolsa/etc.; escritura solo administrador)
drop policy if exists presentaciones_select on public.producto_presentaciones;
create policy presentaciones_select on public.producto_presentaciones for select
  to authenticated using (true);
drop policy if exists presentaciones_write on public.producto_presentaciones;
create policy presentaciones_write on public.producto_presentaciones for all
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- CAJAS
drop policy if exists cajas_select on public.cajas;
create policy cajas_select on public.cajas for select
  to authenticated using (true);
drop policy if exists cajas_insert on public.cajas;
create policy cajas_insert on public.cajas for insert
  to authenticated with check (cajero_id = auth.uid());
drop policy if exists cajas_update on public.cajas;
create policy cajas_update on public.cajas for update
  to authenticated using (cajero_id = auth.uid() or public.es_admin());

-- CLIENTES CREDITO
drop policy if exists clientes_select on public.clientes_credito;
create policy clientes_select on public.clientes_credito for select
  to authenticated using (true);
-- Reemplazada por 3 politicas granulares (insert/update/delete) mas abajo:
-- registro rapido de clientes desde el cobro (POS) requiere que un cajero
-- pueda CREAR un cliente nuevo, pero solo un administrador debe poder
-- modificar el limite de credito o desactivar clientes existentes.
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

-- VENTAS
drop policy if exists ventas_select on public.ventas;
create policy ventas_select on public.ventas for select
  to authenticated using (true);
drop policy if exists ventas_insert on public.ventas;
create policy ventas_insert on public.ventas for insert
  to authenticated with check (cajero_id = auth.uid());
drop policy if exists ventas_update on public.ventas;
create policy ventas_update on public.ventas for update
  to authenticated using (public.es_admin());

-- DETALLE VENTAS
drop policy if exists detalle_select on public.detalle_ventas;
create policy detalle_select on public.detalle_ventas for select
  to authenticated using (true);

-- PAGOS DE VENTA (sin politica de escritura a proposito: solo se escriben
-- desde registrar_venta/editar_venta/anular_venta, que son security definer)
drop policy if exists pagos_venta_select on public.pagos_venta;
create policy pagos_venta_select on public.pagos_venta for select
  to authenticated using (true);

-- AUDITORIA DE VENTAS (lectura para todo el personal — transparencia sobre
-- quien anulo/edito que y por que; escritura solo via RPC security definer)
drop policy if exists auditoria_ventas_select on public.auditoria_ventas;
create policy auditoria_ventas_select on public.auditoria_ventas for select
  to authenticated using (true);

-- MOVIMIENTOS INVENTARIO
drop policy if exists mov_select on public.movimientos_inventario;
create policy mov_select on public.movimientos_inventario for select
  to authenticated using (true);

-- PAGOS CREDITO
drop policy if exists pagos_select on public.pagos_credito;
create policy pagos_select on public.pagos_credito for select
  to authenticated using (true);

-- PROVEEDORES
drop policy if exists proveedores_select on public.proveedores;
create policy proveedores_select on public.proveedores for select
  to authenticated using (true);
drop policy if exists proveedores_write on public.proveedores;
create policy proveedores_write on public.proveedores for all
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- COMPRAS
drop policy if exists compras_select on public.compras;
create policy compras_select on public.compras for select
  to authenticated using (true);
drop policy if exists compras_write on public.compras;
create policy compras_write on public.compras for all
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- DETALLE COMPRAS
drop policy if exists det_compras_select on public.detalle_compras;
create policy det_compras_select on public.detalle_compras for select
  to authenticated using (true);

-- MERMAS
drop policy if exists mermas_select on public.mermas;
create policy mermas_select on public.mermas for select
  to authenticated using (true);
drop policy if exists mermas_write on public.mermas;
create policy mermas_write on public.mermas for all
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- EGRESOS (sin politicas de insert/update/delete directas a proposito: toda
-- escritura pasa por los RPC registrar_egreso / eliminar_egreso, que son
-- security definer y validan permisos y sincronizan cajas.total_egresos).
drop policy if exists egresos_select on public.egresos;
create policy egresos_select on public.egresos for select
  to authenticated using (true);

-- ============================================================================
-- CONFIGURACION DEL NEGOCIO (nombre, DNI/RUC, QR de Yape) — fila unica id = 1
-- (tambien disponible por separado en supabase/add_configuracion_negocio.sql)
-- ============================================================================
create table if not exists public.configuracion_negocio (
  id             smallint primary key default 1 check (id = 1),
  nombre         text not null default 'Comercial Ruiz'
                 check (char_length(btrim(nombre)) between 1 and 80),
  -- DNI (8 digitos) o RUC (11 digitos); vacio = no configurado.
  documento      text not null default ''
                 check (documento ~ '^([0-9]{8}|[0-9]{11})?$'),
  -- Imagen del QR de Yape como data URL (la app la reduce a <= 480 px).
  yape_qr        text
                 check (yape_qr is null or (yape_qr like 'data:image/%' and char_length(yape_qr) <= 600000)),
  actualizado_en timestamptz not null default now()
);

comment on table public.configuracion_negocio is
  'Configuracion unica (id=1) del negocio: nombre, DNI/RUC y QR de Yape.';

-- Fila inicial (no pisa una existente).
insert into public.configuracion_negocio (id) values (1) on conflict (id) do nothing;

drop trigger if exists trg_configuracion_negocio_touch on public.configuracion_negocio;
create trigger trg_configuracion_negocio_touch
  before update on public.configuracion_negocio
  for each row execute function public.touch_actualizado_en();

alter table public.configuracion_negocio enable row level security;

drop policy if exists configuracion_negocio_select on public.configuracion_negocio;
create policy configuracion_negocio_select on public.configuracion_negocio for select
  to authenticated using (true);

drop policy if exists configuracion_negocio_write on public.configuracion_negocio;
create policy configuracion_negocio_write on public.configuracion_negocio for all
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- ============================================================================
-- REALTIME: publicar tablas para sincronizacion instantanea
-- ============================================================================
do $$
begin
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

alter table public.productos replica identity full;
alter table public.ventas replica identity full;

-- ============================================================================
-- DATOS DE EJEMPLO (semilla - comenta estas lineas si no las necesitas)
-- ============================================================================
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
--  marca su rol como administrador ejecutando:
--    update public.perfiles set rol = 'administrador' where id = 'UUID-DEL-USUARIO';
-- ============================================================================
