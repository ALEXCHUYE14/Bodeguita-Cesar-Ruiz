-- ============================================================================
--  FIX: registrar_venta atomico (venta + stock + kardex + caja + fiado)
--  y validacion de stock acumulada por producto.
--
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query (proyecto real
--  de produccion, el que usa tu app — revisa que la URL del dashboard
--  coincida con VITE_SUPABASE_URL de tu .env antes de correrlo).
--
--  Seguro de correr en cualquier momento: no borra ni modifica datos
--  existentes, solo reemplaza la definicion de la funcion registrar_venta.
--  Las ventas ya registradas no se tocan.
--
--  Que corrige:
--   1) Antes, la caja (cajas.total_efectivo/total_yape/total_fiado) y la
--      deuda del cliente fiado (clientes_credito.deuda_actual) se
--      actualizaban con llamadas RPC SEPARADAS desde el navegador, DESPUES
--      de ya haber confirmado la venta. Si la conexion se cortaba justo
--      entre esas llamadas (comun en datos moviles), la venta quedaba
--      registrada y el stock descontado correctamente, pero el total de la
--      caja o la deuda del cliente NO se actualizaban — un descuadre
--      invisible que solo aparecia como diferencia en el cierre de caja.
--      Ahora todo ocurre en una sola transaccion: o se guarda completo, o
--      no se guarda nada.
--   2) La validacion de stock revisaba cada linea del carrito por separado.
--      Si el mismo producto se vendia dos veces en una misma venta (ej.
--      unidades sueltas + una caja completa), cada linea pasaba la
--      validacion de forma independiente aunque, SUMADAS, superaran el
--      stock disponible — el stock podia terminar en negativo sin ningun
--      aviso. Ahora se valida el total acumulado por producto.
-- ============================================================================

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
  v_mapa        jsonb := '{}'::jsonb;
  v_req         record;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito esta vacio.';
  end if;

  select nombre into v_nombre from public.perfiles where id = auth.uid();

  if p_cliente_id is not null then
    select nombre into v_cli_nombre from public.clientes_credito where id = p_cliente_id;
  end if;

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

    v_unidades := case v_modalidad
                    when 'caja' then v_cantidad * coalesce(v_producto.unidades_por_caja, 1)
                    when 'saco' then v_cantidad * coalesce(v_producto.kg_por_saco, 1)
                    else v_cantidad
                  end;
    v_precio   := coalesce((v_item->>'precio_unitario')::numeric, v_producto.precio_venta);

    v_mapa := jsonb_set(
      v_mapa,
      array[v_producto.id::text],
      to_jsonb(coalesce((v_mapa->>v_producto.id::text)::numeric, 0) + v_unidades)
    );

    v_subtotal := v_subtotal + (v_precio * v_cantidad);
  end loop;

  for v_req in select key as producto_id, value::numeric as unidades from jsonb_each_text(v_mapa)
  loop
    select * into v_producto from public.productos where id = v_req.producto_id::uuid;
    if v_producto.stock_actual < v_req.unidades then
      raise exception 'Stock insuficiente para "%": disponible % %, solicitado %',
        v_producto.nombre, v_producto.stock_actual, v_producto.unidad, v_req.unidades;
    end if;
  end loop;

  v_subtotal := round(v_subtotal, 2);
  v_total    := round(greatest(v_subtotal - coalesce(p_descuento, 0), 0), 2);
  v_base     := round(v_total / (1 + p_tasa_igv), 2);
  v_igv      := round(v_total - v_base, 2);

  insert into public.ventas (
    cajero_id, cajero_nombre, caja_id, cliente_id, cliente_nombre,
    subtotal, descuento, igv, total, metodo, pago_recibido, vuelto
  ) values (
    auth.uid(), v_nombre, p_caja_id, p_cliente_id, v_cli_nombre,
    v_subtotal, coalesce(p_descuento, 0), v_igv, v_total,
    p_metodo, p_pago_recibido, round(greatest(p_pago_recibido - v_total, 0), 2)
  ) returning * into v_venta;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_producto from public.productos
      where id = (v_item->>'producto_id')::uuid;
    v_cantidad  := (v_item->>'cantidad')::numeric;
    v_modalidad := coalesce(v_item->>'modalidad', 'unidad');
    v_unidades  := case v_modalidad
                     when 'caja' then v_cantidad * coalesce(v_producto.unidades_por_caja, 1)
                     when 'saco' then v_cantidad * coalesce(v_producto.kg_por_saco, 1)
                     else v_cantidad
                   end;
    v_precio    := coalesce((v_item->>'precio_unitario')::numeric, v_producto.precio_venta);
    v_sub       := round(v_precio * v_cantidad, 2);

    insert into public.detalle_ventas (
      venta_id, producto_id, producto_nombre, sku, cantidad, modalidad, unidades, precio_unitario, subtotal
    ) values (
      v_venta.id, v_producto.id, v_producto.nombre, v_producto.sku,
      v_cantidad, v_modalidad, v_unidades, v_precio, v_sub
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
