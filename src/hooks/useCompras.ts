import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Compra, DetalleCompra, EstadoCompra } from '@/types/database'

export interface ItemCompra {
  producto_id: string | null
  producto_nombre: string
  cantidad: number
  precio_unitario: number
}

export function useCompras() {
  const [compras, setCompras] = useState<Compra[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('compras')
      .select('*, proveedores(*)')
      .order('creado_en', { ascending: false })
      .limit(150)
    setCompras(data ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function crear(
    cabecera: {
      numero: string | null
      proveedor_id: string | null
      proveedor_nombre: string | null
      fecha_compra: string
      estado: EstadoCompra
      notas: string | null
      total: number
    },
    items: ItemCompra[],
  ): Promise<Compra> {
    const { data: c, error: eC } = await supabase
      .from('compras')
      .insert(cabecera)
      .select('*, proveedores(*)')
      .single()
    if (eC) throw eC

    if (items.length > 0) {
      const detalles: Omit<DetalleCompra, 'id'>[] = items.map((i) => ({
        compra_id: c.id,
        producto_id: i.producto_id,
        producto_nombre: i.producto_nombre,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
        subtotal: i.cantidad * i.precio_unitario,
      }))
      const { error: eD } = await supabase.from('detalle_compras').insert(detalles)
      if (eD) throw eD

      // Ingresar stock por cada item con producto vinculado
      for (const i of items) {
        if (i.producto_id) {
          await supabase.rpc('ajustar_stock', {
            p_producto_id: i.producto_id,
            p_cantidad: i.cantidad,
            p_tipo: 'entrada',
            p_motivo: `Compra ${cabecera.numero ? '#' + cabecera.numero : c.id.slice(0, 8)}`,
          })
        }
      }
    }

    setCompras((prev) => [c, ...prev])
    return c
  }

  async function cambiarEstado(id: string, estado: EstadoCompra): Promise<void> {
    const { data, error } = await supabase
      .from('compras')
      .update({ estado })
      .eq('id', id)
      .select('*, proveedores(*)')
      .single()
    if (error) throw error
    setCompras((prev) => prev.map((x) => (x.id === id ? data : x)))
  }

  async function obtenerDetalles(compra_id: string): Promise<DetalleCompra[]> {
    const { data, error } = await supabase
      .from('detalle_compras')
      .select('*')
      .eq('compra_id', compra_id)
      .order('producto_nombre')
    if (error) throw error
    return data ?? []
  }

  return { compras, cargando, cargar, crear, cambiarEstado, obtenerDetalles }
}
