-- ============================================================================
--  PRUEBAS de importar_inventario() contra el esquema REAL del proyecto
--
--  Como correrlas: pega todo este archivo en el SQL Editor de un proyecto
--  de Supabase que YA tenga aplicado supabase/schema.sql (de preferencia un
--  proyecto de prueba/branch, no produccion — aunque el script en si solo
--  crea y borra productos/categorias con prefijo "TEST-", no toca nada mas).
--  NO redefine ni toca ninguna funcion del sistema (auth.uid() se deja
--  intacta): solo usa el mecanismo estandar con el que Supabase ya simula
--  el JWT de una sesion (la variable "request.jwt.claim.sub", que la propia
--  auth.uid() de cualquier proyecto Supabase ya lee).
--
--  Importante: NO crea perfiles/usuarios falsos (perfiles.id tiene foreign
--  key a auth.users — insertar un id inventado ahi falla). En vez de eso,
--  las pruebas #1-#7 "piden prestada" la identidad de un administrador que
--  YA exista en tu tabla perfiles (no lo modifica ni lo borra); la prueba
--  #8 de rechazo usa un uuid al azar que no es de nadie, lo cual basta para
--  que es_admin() de false. Si tu proyecto todavia no tiene NINGUN
--  administrador activo, crea uno primero (ver README) y vuelve a correr.
--
--  Que verifica, en orden (igual a lo pedido en la revision):
--   1. Crear producto nuevo CON presentaciones.
--   2. Crear producto nuevo SIN presentaciones.
--   3. Actualizar un producto sin tocar los campos que llegaron vacios.
--   4. Actualizar generando el ajuste de kardex cuando cambia el stock.
--   5. Categoria creada automaticamente la primera vez y reutilizada la
--      segunda (sin duplicar), sin importar mayusculas/espacios.
--   6. Presentaciones invalidas rechazadas: JSON mal formado, no es un
--      arreglo, sin "nombre", factor <= 0, precio_venta negativo.
--   7. Una fila sin SKU, o sin nombre al crear, no bloquea las demas filas
--      del mismo lote.
--   8. Un usuario no-administrador (y nadie autenticado) es rechazado.
--
--  Cada bloque imprime un RAISE NOTICE 'OK ...' si pasa, o revienta con una
--  excepcion clara si falla (visible en el Output del SQL Editor).
-- ============================================================================

do $$
declare
  v_admin_id    uuid;
  v_no_admin_id uuid := gen_random_uuid(); -- uuid al azar: no coincide con ningun perfil, alcanza para probar el rechazo
  v_resultado   jsonb;
  v_prod        public.productos%rowtype;
  v_cat_id_1    uuid;
  v_cat_id_2    uuid;
  v_mov_count   int;
  v_fila        jsonb;
begin
  -- ── Setup: pide prestado un administrador YA existente (no crea ninguno
  --    nuevo — perfiles.id tiene foreign key a auth.users, asi que un id
  --    inventado no se puede insertar ahi). No se modifica ni se borra.
  select id into v_admin_id from public.perfiles
    where rol = 'administrador' and activo = true
    order by creado_en limit 1;
  if v_admin_id is null then
    raise exception
      'No se encontro ningun administrador activo en perfiles — crea uno (o reactiva uno existente) antes de correr estas pruebas.';
  end if;

  -- ══════════════════════════════════════════════════════════════════════
  -- 8a) Nadie autenticado (sin JWT -> auth.uid() es null) es rechazado.
  -- ══════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', '', false);
  begin
    perform public.importar_inventario('[{"sku":"TEST-NOAUTH","nombre":"X","precio_venta":1}]'::jsonb);
    raise exception 'FALLO #8a: deberia haber rechazado una llamada sin autenticar.';
  exception
    when others then
      if sqlerrm not like 'Solo un administrador%' then
        raise exception 'FALLO #8a: rechazo con mensaje inesperado: %', sqlerrm;
      end if;
  end;
  raise notice 'OK #8a: llamada sin autenticar rechazada.';

  -- ══════════════════════════════════════════════════════════════════════
  -- 8b) Un uuid autenticado que no es administrador tambien es rechazado
  --     (no hace falta que exista en perfiles: es_admin() da false igual
  --     si no hay ninguna fila con ese id, ni revienta por eso).
  -- ══════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claim.sub', v_no_admin_id::text, false);
  begin
    perform public.importar_inventario('[{"sku":"TEST-NOADMIN","nombre":"X","precio_venta":1}]'::jsonb);
    raise exception 'FALLO #8b: deberia haber rechazado a un usuario no-administrador.';
  exception
    when others then
      if sqlerrm not like 'Solo un administrador%' then
        raise exception 'FALLO #8b: rechazo con mensaje inesperado: %', sqlerrm;
      end if;
  end;
  if exists (select 1 from public.productos where sku in ('TEST-NOAUTH', 'TEST-NOADMIN')) then
    raise exception 'FALLO #8: no debio crear ningun producto en los intentos rechazados.';
  end if;
  raise notice 'OK #8b: usuario no-administrador rechazado — ninguna fila sin permiso creo datos.';

  -- A partir de aqui, todas las pruebas corren "como" el administrador prestado.
  perform set_config('request.jwt.claim.sub', v_admin_id::text, false);

  -- ══════════════════════════════════════════════════════════════════════
  -- 1) Crear producto nuevo CON presentaciones validas.
  -- ══════════════════════════════════════════════════════════════════════
  v_resultado := public.importar_inventario(jsonb_build_array(jsonb_build_object(
    'sku', 'TEST-001', 'nombre', 'Producto con presentaciones',
    'categoria', 'Test Categoria A', 'tipo_venta', 'Unidad', 'unidad', 'unidad',
    'precio_compra', 5, 'precio_venta', 8, 'stock_actual', 100, 'stock_minimo', 10,
    'presentaciones', '[{"nombre":"Caja","factor_unidades":12,"precio_venta":90,"precio_compra":55},' ||
                       '{"nombre":"Media Caja","factor_unidades":6,"precio_venta":48,"es_fraccion":true}]'
  )));
  if (v_resultado->0->>'accion') <> 'creado' then
    raise exception 'FALLO #1: esperaba "creado", obtuvo: %', v_resultado;
  end if;
  select * into v_prod from public.productos where sku = 'TEST-001';
  if v_prod.stock_actual <> 100 or v_prod.precio_venta <> 8 then
    raise exception 'FALLO #1: datos del producto no coinciden: %', row_to_json(v_prod);
  end if;
  if (select count(*) from public.producto_presentaciones where producto_id = v_prod.id) <> 2 then
    raise exception 'FALLO #1: deberian haberse creado 2 presentaciones.';
  end if;
  raise notice 'OK #1: producto nuevo con presentaciones creado correctamente.';

  -- ══════════════════════════════════════════════════════════════════════
  -- 2) Crear producto nuevo SIN presentaciones (celda vacia).
  -- ══════════════════════════════════════════════════════════════════════
  v_resultado := public.importar_inventario(jsonb_build_array(jsonb_build_object(
    'sku', 'TEST-002', 'nombre', 'Producto simple', 'precio_venta', 3, 'stock_actual', 20
  )));
  if (v_resultado->0->>'accion') <> 'creado' then
    raise exception 'FALLO #2: esperaba "creado", obtuvo: %', v_resultado;
  end if;
  select * into v_prod from public.productos where sku = 'TEST-002';
  if v_prod.tipo_venta <> 'unidad' or v_prod.unidad <> 'unidad' or v_prod.stock_minimo <> 5
     or v_prod.activo <> true or v_prod.tiene_caja <> false then
    raise exception 'FALLO #2: los defaults de columna no se aplicaron: %', row_to_json(v_prod);
  end if;
  if (select count(*) from public.producto_presentaciones where producto_id = v_prod.id) <> 0 then
    raise exception 'FALLO #2: no deberia tener presentaciones.';
  end if;
  raise notice 'OK #2: producto nuevo sin presentaciones usa los defaults de columna.';

  -- ══════════════════════════════════════════════════════════════════════
  -- 3) Actualizar SIN tocar los campos que llegaron vacios.
  -- ══════════════════════════════════════════════════════════════════════
  v_resultado := public.importar_inventario(jsonb_build_array(jsonb_build_object(
    'sku', 'TEST-002', 'precio_venta', 3.5
    -- nombre, categoria, stock, etc. NO vienen -> no deben tocarse
  )));
  if (v_resultado->0->>'accion') <> 'actualizado' then
    raise exception 'FALLO #3: esperaba "actualizado", obtuvo: %', v_resultado;
  end if;
  select * into v_prod from public.productos where sku = 'TEST-002';
  if v_prod.nombre <> 'Producto simple' then
    raise exception 'FALLO #3: el nombre se toco sin venir en la fila: %', v_prod.nombre;
  end if;
  if v_prod.stock_actual <> 20 then
    raise exception 'FALLO #3: el stock se toco sin venir en la fila: %', v_prod.stock_actual;
  end if;
  if v_prod.precio_venta <> 3.5 then
    raise exception 'FALLO #3: el precio_venta SI debia actualizarse: %', v_prod.precio_venta;
  end if;
  raise notice 'OK #3: actualizacion parcial respeta las celdas vacias.';

  -- ══════════════════════════════════════════════════════════════════════
  -- 4) Actualizar generando el ajuste de kardex cuando cambia el stock.
  -- ══════════════════════════════════════════════════════════════════════
  select count(*) into v_mov_count from public.movimientos_inventario where producto_id = v_prod.id;
  v_resultado := public.importar_inventario(jsonb_build_array(jsonb_build_object(
    'sku', 'TEST-002', 'stock_actual', 35
  )));
  if (v_resultado->0->>'accion') <> 'actualizado' then
    raise exception 'FALLO #4: esperaba "actualizado", obtuvo: %', v_resultado;
  end if;
  select * into v_prod from public.productos where sku = 'TEST-002';
  if v_prod.stock_actual <> 35 then
    raise exception 'FALLO #4: el stock no quedo en 35: %', v_prod.stock_actual;
  end if;
  if (select count(*) from public.movimientos_inventario where producto_id = v_prod.id) <> v_mov_count + 1 then
    raise exception 'FALLO #4: no se genero el movimiento de kardex.';
  end if;
  if not exists (
    select 1 from public.movimientos_inventario
    where producto_id = v_prod.id and tipo = 'ajuste' and cantidad = 15 -- 35 - 20
    order by creado_en desc limit 1
  ) then
    raise exception 'FALLO #4: el movimiento de kardex no tiene tipo=ajuste/cantidad=15.';
  end if;
  raise notice 'OK #4: el cambio de stock quedo registrado como ajuste en el kardex.';

  -- No debe generar un segundo movimiento si se manda el MISMO stock otra vez.
  select count(*) into v_mov_count from public.movimientos_inventario where producto_id = v_prod.id;
  perform public.importar_inventario(jsonb_build_array(jsonb_build_object('sku', 'TEST-002', 'stock_actual', 35)));
  if (select count(*) from public.movimientos_inventario where producto_id = v_prod.id) <> v_mov_count then
    raise exception 'FALLO #4b: reimportar el mismo stock no debia generar otro movimiento.';
  end if;
  raise notice 'OK #4b: reimportar el mismo stock no duplica el movimiento de kardex.';

  -- ══════════════════════════════════════════════════════════════════════
  -- 5) Categoria creada automaticamente y reutilizada (sin importar
  --    mayusculas/espacios).
  -- ══════════════════════════════════════════════════════════════════════
  select id into v_cat_id_1 from public.categorias where nombre = 'Test Categoria A';
  if v_cat_id_1 is null then
    raise exception 'FALLO #5: la categoria del producto #1 no se creo.';
  end if;
  perform public.importar_inventario(jsonb_build_array(jsonb_build_object(
    'sku', 'TEST-003', 'nombre', 'Otro producto', 'categoria', '  test categoria a  ', 'precio_venta', 1
  )));
  select categoria_id into v_cat_id_2 from public.productos where sku = 'TEST-003';
  if v_cat_id_2 is distinct from v_cat_id_1 then
    raise exception 'FALLO #5: deberia haber reusado la categoria existente (sin distinguir mayus/espacios).';
  end if;
  if (select count(*) from public.categorias where lower(btrim(nombre)) = 'test categoria a') <> 1 then
    raise exception 'FALLO #5: la categoria quedo duplicada.';
  end if;
  raise notice 'OK #5: categoria creada una vez y reutilizada despues.';

  -- ══════════════════════════════════════════════════════════════════════
  -- 6) Presentaciones invalidas: cada una rechaza SOLO esa fila.
  -- ══════════════════════════════════════════════════════════════════════
  v_resultado := public.importar_inventario(jsonb_build_array(
    jsonb_build_object('sku', 'TEST-BADJSON',  'nombre', 'X', 'precio_venta', 1, 'presentaciones', '{no es json valido'),
    jsonb_build_object('sku', 'TEST-NOARRAY',  'nombre', 'X', 'precio_venta', 1, 'presentaciones', '{"nombre":"Caja"}'),
    jsonb_build_object('sku', 'TEST-NONOMBRE', 'nombre', 'X', 'precio_venta', 1, 'presentaciones', '[{"factor_unidades":10,"precio_venta":5}]'),
    jsonb_build_object('sku', 'TEST-FACTOR0',  'nombre', 'X', 'precio_venta', 1, 'presentaciones', '[{"nombre":"Caja","factor_unidades":0,"precio_venta":5}]'),
    jsonb_build_object('sku', 'TEST-PRECIONEG','nombre', 'X', 'precio_venta', 1, 'presentaciones', '[{"nombre":"Caja","factor_unidades":10,"precio_venta":-1}]')
  ));
  for v_fila in select * from jsonb_array_elements(v_resultado)
  loop
    if (v_fila->>'accion') <> 'error' then
      raise exception 'FALLO #6: fila % deberia haber sido rechazada: %', v_fila->>'sku', v_fila;
    end if;
    if exists (select 1 from public.productos where sku = v_fila->>'sku') then
      raise exception 'FALLO #6: fila % NO deberia haber creado el producto.', v_fila->>'sku';
    end if;
  end loop;
  raise notice 'OK #6: las 5 variantes de presentaciones invalidas se rechazaron sin crear nada (%).',
    (select string_agg(f->>'mensaje', ' | ') from jsonb_array_elements(v_resultado) f);

  -- ══════════════════════════════════════════════════════════════════════
  -- 7) Una fila mala no bloquea las demas del mismo lote.
  -- ══════════════════════════════════════════════════════════════════════
  v_resultado := public.importar_inventario(jsonb_build_array(
    jsonb_build_object('sku', '', 'nombre', 'Sin SKU'),                              -- error: falta SKU
    jsonb_build_object('sku', 'TEST-SINNOMBRE', 'precio_venta', 1),                  -- error: nuevo sin nombre
    jsonb_build_object('sku', 'TEST-004', 'nombre', 'Si valido', 'precio_venta', 2)  -- ok
  ));
  if (v_resultado->0->>'accion') <> 'error' or (v_resultado->1->>'accion') <> 'error' then
    raise exception 'FALLO #7: las filas 1 y 2 debian reportarse como error: %', v_resultado;
  end if;
  if (v_resultado->2->>'accion') <> 'creado' then
    raise exception 'FALLO #7: la fila 3 (valida) debia procesarse igual: %', v_resultado;
  end if;
  if not exists (select 1 from public.productos where sku = 'TEST-004') then
    raise exception 'FALLO #7: el producto de la fila valida no se creo.';
  end if;
  raise notice 'OK #7: filas invalidas no bloquean las demas filas del lote.';

  raise notice '════════════════════════════════════════════════';
  raise notice 'TODAS LAS PRUEBAS DE importar_inventario() PASARON';
  raise notice '════════════════════════════════════════════════';
end $$;

-- ── Limpieza: borra todo lo que crearon las pruebas y restaura la sesion ──
-- (no hay perfiles que borrar: el admin usado era prestado, nunca se tocó)
delete from public.producto_presentaciones where producto_id in (
  select id from public.productos where sku like 'TEST-%'
);
delete from public.movimientos_inventario where producto_id in (
  select id from public.productos where sku like 'TEST-%'
);
delete from public.productos where sku like 'TEST-%';
delete from public.categorias where lower(btrim(nombre)) = 'test categoria a';
select set_config('request.jwt.claim.sub', '', false);
