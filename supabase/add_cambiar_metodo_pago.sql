-- ============================================================================
--  CAMBIAR FORMA DE PAGO DE UNA VENTA (correccion rapida, sin tocar productos)
--
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query. Idempotente y
--  seguro — solo agrega una funcion nueva, no toca datos existentes.
--
--  Que agrega: cambiar_metodo_pago_venta(p_venta_id, p_metodo_nuevo, p_motivo)
--  — RPC para corregir el metodo de pago de una venta ya registrada (ej. el
--  cajero marco "Yape" por error y en realidad fue en efectivo) SIN anularla
--  ni tocar productos/stock/kardex. Solo funciona entre 'efectivo' y 'yape'
--  (los unicos dos metodos de un solo toque en el POS); ventas con pago
--  mixto o al fiado se quedan fuera a proposito — ver el comentario dentro
--  de la funcion. Deja registro en auditoria_ventas y ajusta la caja de esa
--  venta por el mismo monto, moviendolo de un metodo al otro.
--
--  Requiere haber corrido antes supabase/add_ventas_avanzadas.sql (usa la
--  tabla pagos_venta y la columna ventas.editada).
-- ============================================================================

create or replace function public.cambiar_metodo_pago_venta(
  p_venta_id     uuid,
  p_metodo_nuevo metodo_pago,
  p_motivo       text
)
returns public.ventas
language plpgsql
security definer set search_path = public
as $$
declare
  v_venta           public.ventas%rowtype;
  v_pago            public.pagos_venta%rowtype;
  v_activo          boolean;
  v_nombre          text;
  v_metodo_anterior metodo_pago;
  v_cant_pagos      integer;
begin
  select activo, nombre into v_activo, v_nombre from public.perfiles where id = auth.uid();
  if not coalesce(v_activo, false) then
    raise exception 'Tu usuario no esta autorizado para cambiar la forma de pago.';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Debes indicar el motivo del cambio.';
  end if;
  if p_metodo_nuevo not in ('efectivo', 'yape') then
    raise exception 'Solo se puede cambiar entre Efectivo y Yape desde aqui.';
  end if;

  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada.'; end if;
  if v_venta.anulada then raise exception 'No se puede modificar una venta anulada.'; end if;
  if v_venta.metodo not in ('efectivo', 'yape') then
    raise exception 'Esta venta es de pago % — cambiala desde "Editar" en vez de este atajo.', v_venta.metodo;
  end if;
  if v_venta.metodo = p_metodo_nuevo then
    raise exception 'La venta ya esta registrada con esa forma de pago.';
  end if;

  -- Toda venta no anulada con metodo <> 'mixto' tiene EXACTAMENTE una fila en
  -- pagos_venta (ver backfill e invariante documentados junto a la tabla) —
  -- se valida el conteo en vez de asumirlo, para nunca operar a ciegas sobre
  -- una venta con datos inconsistentes.
  select count(*) into v_cant_pagos from public.pagos_venta where venta_id = p_venta_id;
  if v_cant_pagos <> 1 then
    raise exception 'Esta venta no tiene exactamente un pago registrado (tiene %) — no se puede cambiar por aqui.', v_cant_pagos;
  end if;
  select * into v_pago from public.pagos_venta where venta_id = p_venta_id for update;

  v_metodo_anterior := v_venta.metodo;

  -- Revierte el aporte del metodo viejo en la caja de esa venta y aplica el
  -- mismo monto al nuevo — el monto cobrado no cambia, solo la etiqueta.
  if v_venta.caja_id is not null then
    if v_metodo_anterior = 'efectivo' then
      update public.cajas set total_efectivo = total_efectivo - v_pago.monto where id = v_venta.caja_id;
    else
      update public.cajas set total_yape = total_yape - v_pago.monto where id = v_venta.caja_id;
    end if;
    if p_metodo_nuevo = 'efectivo' then
      update public.cajas set total_efectivo = total_efectivo + v_pago.monto where id = v_venta.caja_id;
    else
      update public.cajas set total_yape = total_yape + v_pago.monto where id = v_venta.caja_id;
    end if;
  end if;

  update public.pagos_venta set metodo = p_metodo_nuevo where id = v_pago.id;

  -- pago_recibido/vuelto solo tienen sentido para efectivo (ver
  -- registrar_venta) — al cambiar de/hacia efectivo se reponen a los unicos
  -- valores que siguen siendo validos pase lo que pase: pago exacto, sin
  -- vuelto pendiente.
  update public.ventas set
    metodo        = p_metodo_nuevo,
    pago_recibido = v_venta.total,
    vuelto        = 0,
    editada       = true
  where id = p_venta_id
  returning * into v_venta;

  insert into public.auditoria_ventas (
    venta_id, venta_numero, accion, usuario_id, usuario_nombre, motivo, detalle
  ) values (
    v_venta.id, v_venta.numero, 'editada', auth.uid(), v_nombre, p_motivo,
    jsonb_build_object(
      'tipo', 'cambio_forma_pago',
      'metodo_anterior', v_metodo_anterior,
      'metodo_nuevo', p_metodo_nuevo,
      'monto', v_pago.monto
    )
  );

  return v_venta;
end;
$$;
