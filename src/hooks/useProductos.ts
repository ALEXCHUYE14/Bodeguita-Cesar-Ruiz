import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Categoria, Producto, ProductoPresentacion } from '@/types/database'

/** Agrupa las presentaciones por producto_id, ya ordenadas (orden asc, luego factor asc). */
function agruparPresentaciones(filas: ProductoPresentacion[]): Map<string, ProductoPresentacion[]> {
  const grupos = new Map<string, ProductoPresentacion[]>()
  for (const fila of filas) {
    const arr = grupos.get(fila.producto_id)
    if (arr) arr.push(fila)
    else grupos.set(fila.producto_id, [fila])
  }
  return grupos
}

export function useProductos() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const [prodRes, catRes, presRes] = await Promise.all([
      supabase
        .from('productos')
        .select('*, categorias(*)')
        .eq('activo', true)
        .order('nombre'),
      supabase.from('categorias').select('*').order('nombre'),
      supabase
        .from('producto_presentaciones')
        .select('*')
        .eq('activo', true)
        .order('orden')
        .order('factor_unidades'),
    ])
    const grupos = agruparPresentaciones(presRes.data ?? [])
    setProductos((prodRes.data ?? []).map((p) => ({ ...p, presentaciones: grupos.get(p.id) ?? [] })))
    setCategorias(catRes.data ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()

    // Realtime: cualquier cambio de stock/producto se refleja al instante.
    // Las presentaciones (catálogo, editado solo por el admin) no son
    // realtime — se refrescan junto con el resto al llamar recargar().
    const canal = supabase
      .channel('rt-productos')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'productos' },
        (payload) => {
          setProductos((prev) => {
            if (payload.eventType === 'DELETE') {
              return prev.filter((p) => p.id !== (payload.old as Producto).id)
            }
            const nuevo = payload.new as Producto
            if (!nuevo.activo) return prev.filter((p) => p.id !== nuevo.id)
            const existe = prev.some((p) => p.id === nuevo.id)
            // Conserva la categoria y las presentaciones embebidas (no vienen
            // en el payload de realtime, que solo trae columnas de productos)
            const previo = prev.find((p) => p.id === nuevo.id)
            const fusion = {
              ...nuevo,
              categorias: previo?.categorias ?? null,
              presentaciones: previo?.presentaciones ?? [],
            }
            return existe
              ? prev.map((p) => (p.id === nuevo.id ? fusion : p))
              : [...prev, fusion].sort((a, b) => a.nombre.localeCompare(b.nombre))
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [cargar])

  return { productos, categorias, cargando, recargar: cargar }
}
