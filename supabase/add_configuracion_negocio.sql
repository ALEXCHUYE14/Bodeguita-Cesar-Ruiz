-- ============================================================================
--  CONFIGURACION DEL NEGOCIO (Ajustes > Datos del negocio)
--
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query.
--  Es seguro correrlo mas de una vez (idempotente) y NO toca datos existentes.
--
--  Guarda en UNA sola fila (id = 1) el nombre del negocio, el DNI/RUC y la
--  imagen del codigo QR de Yape, para que todos los dispositivos/cajeros vean
--  y usen los mismos datos en tickets, pantalla de cobro y reportes.
--
--  Lectura: cualquier usuario autenticado (los cajeros la necesitan para
--  imprimir tickets y mostrar el QR). Escritura: solo administradores.
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
