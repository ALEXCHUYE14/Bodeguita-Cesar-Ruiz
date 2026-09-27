import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Compra, DetalleCompra, EstadoCompra, ModalidadVenta } from '@/types/database'

export interface ItemCompra {
  producto_id: string | null
  producto_nombre: string
  cantidad: number
  precio_unitario: number
  /** 'unidad' (por defecto), 'caja', 'saco', o el id de una presentación flexible. */
  modalidad?: ModalidadVenta
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

  // Una sola llamada RPC transaccional (cabecera + detalle + stock + kardex,
  // todo o nada) — ver registrar_compra() en supabase/schema.sql. Antes esto
  // eran 3 pasos sueltos desde el cliente sin ninguna transaccion que los
  // uniera, y el insert directo a detalle_compras ya fallaba porque esa
  // tabla nunca tuvo una politica RLS de escritura para el cliente.
  async function crear(
    cabecera: {
      numero: string | null
      proveedor_id: string | null
      proveedor_nombre: string | null
      fecha_compra: string
      estado: EstadoCompra
      notas: string | null
    },
    items: ItemCompra[],
  ): Promise<Compra> {
    const { data, error } = await supabase.rpc('registrar_compra', {
      p_items: items.map((i) => ({
        producto_id: i.producto_id,
        producto_nombre: i.producto_nombre,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
        modalidad: i.modalidad ?? 'unidad',
      })),
      p_numero: cabecera.numero,
      p_proveedor_id: cabecera.proveedor_id,
      p_proveedor_nombre: cabecera.proveedor_nombre,
      p_fecha_compra: cabecera.fecha_compra,
      p_estado: cabecera.estado,
      p_notas: cabecera.notas,
    })
    if (error) throw error
    const compra = data as unknown as Compra
    setCompras((prev) => [compra, ...prev])
    return compra
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
