-- ============================================================================
--  REDUCIR CACHED EGRESS / CERRAR AVISO DE LISTADO PUBLICO DEL BUCKET
--
--  Ejecutar en: Supabase Dashboard > SQL Editor > New query. Idempotente y
--  seguro — no borra archivos ni cambia si las fotos se siguen viendo
--  publicamente.
--
--  Que hace: restringe la politica de SELECT sobre storage.objects del
--  bucket "product-images" a usuarios autenticados. El bucket sigue siendo
--  publico para SERVIR archivos (eso pasa por /storage/v1/object/public/...,
--  una ruta que Supabase Storage sirve sin pasar por RLS) — esta politica
--  solo controlaba poder LISTAR el contenido del bucket via la API de
--  Storage, algo que el frontend nunca hace (ver src/hooks/useProductoImagen.ts:
--  solo sube/borra por nombre de archivo conocido). Cierra el aviso del
--  Advisor "Los clientes pueden listar todos los archivos en este bucket".
--
--  Complementa (no reemplaza) los cambios ya hechos en el codigo para bajar
--  Cached Egress: cacheControl de 1 año al subir fotos (useProductoImagen.ts)
--  y una regla CacheFirst para /storage/v1/object/public en el service
--  worker de la PWA (vite.config.ts) — esos dos no requieren SQL.
-- ============================================================================

drop policy if exists product_images_select on storage.objects;
create policy product_images_select on storage.objects for select
  to authenticated using (bucket_id = 'product-images');
