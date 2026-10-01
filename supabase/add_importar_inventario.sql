-- ============================================================================
--  IMPORTAR/EXPORTAR INVENTARIO EN EXCEL (alta/actualizacion masiva)
--
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query. Idempotente y
--  seguro — solo agrega una funcion nueva, no toca datos existentes.
--
--  Que agrega: importar_inventario(p_filas jsonb) — RPC que recibe el
--  contenido del .xlsx exportado por Inventario > Exportar Excel (ya
--  convertido a un arreglo de objetos JSON por el frontend) y da de
--  alta/actualiza productos en bloque, solo administrador. Cada fila se
--  procesa en su propio bloque BEGIN/EXCEPTION (un SAVEPOINT implicito en
--  PL/pgSQL): una fila con datos invalidos se reporta como error de esa
--  fila sin bloquear ni revertir las demas. El stock nunca se pisa en
--  silencio — si cambia, pasa por ajustar_stock() y queda su movimiento en
--  el kardex, igual que un ajuste manual.
--
--  Requiere haber corrido antes supabase/add_presentaciones.sql (usa
--  resolver_presentacion/producto_presentaciones y su trigger de validacion).
-- ============================================================================

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
  -- Guarda si el producto ya existia apenas se sabe (ver nota junto al
  -- "select ... for update" de abajo) — NUNCA se usa "if found" para esto
  -- mas adelante en la fila: FOUND es una variable global de la funcion que
  -- cualquier otro select/insert/for posterior (la busqueda de categoria, el
  -- loop de validacion de presentaciones) pisa sin avisar, y entonces "if
  -- found" terminaria preguntando por el resultado de ESE otro comando, no
  -- por si el producto existia.
  v_producto_existia    boolean;
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
      v_producto_existia := found; -- capturado YA, antes de que otro comando pise FOUND

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

      if v_producto_existia then
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
        -- El cast ::numeric explicito es necesario: productos.stock_actual
        -- es "double precision" y ajustar_stock espera "numeric" — restar
        -- numeric - double precision da double precision, y Postgres no lo
        -- castea solo de vuelta a numeric al resolver la llamada (sale
        -- "function ajustar_stock(uuid, double precision, ...) does not
        -- exist" aunque la funcion si existe, con otro tipo en ese parametro).
        if v_stock_actual is not null and v_stock_actual <> v_existente.stock_actual then
          perform public.ajustar_stock(
            v_producto_id,
            (v_stock_actual - v_existente.stock_actual)::numeric,
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

