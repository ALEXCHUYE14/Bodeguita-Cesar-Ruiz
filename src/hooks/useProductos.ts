import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Categoria, Producto } from '@/types/database'

export function useProductos() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const [prodRes, catRes] = await Promise.all([
      supabase
        .from('productos')
        .select('*, categorias(*)')
        .eq('activo', true)
        .order('nombre'),
      supabase.from('categorias').select('*').order('nombre'),
    ])
    setProductos(prodRes.data ?? [])
    setCategorias(catRes.data ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()

    // Realtime: cualquier cambio de stock/producto se refleja al instante.
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
            // Conserva la categoria embebida si ya la teniamos
            const previo = prev.find((p) => p.id === nuevo.id)
            const fusion = { ...nuevo, categorias: previo?.categorias ?? null }
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
