import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Merma, MotivoMerma } from '@/types/database'

export function useMermas(desde: Date, hasta: Date) {
  const [mermas, setMermas] = useState<Merma[]>([])
  const [cargando, setCargando] = useState(true)

  // Use getTime() (primitive) so Date objects are compared by value, not reference.
  // Without this, inline new Date() calls in the parent cause infinite re-renders.
  const desdeMs = desde.getTime()
  const hastaMs = hasta.getTime()

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('mermas')
      .select('*')
      .gte('creado_en', new Date(desdeMs).toISOString())
      .lte('creado_en', new Date(hastaMs).toISOString())
      .order('creado_en', { ascending: false })
    setMermas(data ?? [])
    setCargando(false)
  }, [desdeMs, hastaMs])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function registrar(m: {
    producto_id: string | null
    producto_nombre: string
    cantidad: number
    costo_unitario: number
    motivo: MotivoMerma
    descripcion: string | null
  }): Promise<Merma> {
    const payload = {
      ...m,
      costo_total: parseFloat((m.cantidad * m.costo_unitario).toFixed(2)),
    }
    const { data, error } = await supabase.from('mermas').insert(payload).select().single()
    if (error) throw error

    if (m.producto_id && m.cantidad > 0) {
      await supabase.rpc('ajustar_stock', {
        p_producto_id: m.producto_id,
        p_cantidad: m.cantidad,
        p_tipo: 'salida',
        p_motivo: `Merma: ${ETIQUETA_MOTIVO[m.motivo]}`,
      })
    }

    setMermas((prev) => [data, ...prev])
    return data
  }

  const costoTotal = mermas.reduce((s, m) => s + m.costo_total, 0)

  return { mermas, cargando, cargar, registrar, costoTotal }
}

export const ETIQUETA_MOTIVO: Record<MotivoMerma, string> = {
  vencido: 'Producto vencido',
  danado: 'Producto dañado',
  consumo_interno: 'Consumo interno',
  otro: 'Otro motivo',
}
