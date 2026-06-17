import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { inicioDelDia, finDelDia } from '@/utils/format'
import type { Venta } from '@/types/database'

/**
 * Suscripcion en tiempo real a las ventas del dia.
 * Cuando el POS registra una venta, el dashboard se actualiza al instante.
 */
export function useVentasRealtime() {
  const [ventas, setVentas] = useState<Venta[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('ventas')
      .select('*')
      .gte('creado_en', inicioDelDia().toISOString())
      .lte('creado_en', finDelDia().toISOString())
      .eq('anulada', false)
      .order('creado_en', { ascending: false })
    setVentas(data ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()

    const canal = supabase
      .channel('rt-ventas')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ventas' },
        (payload) => {
          const v = payload.new as Venta
          // Solo ventas de hoy y no anuladas
          if (new Date(v.creado_en) >= inicioDelDia() && !v.anulada) {
            setVentas((prev) =>
              prev.some((x) => x.id === v.id) ? prev : [v, ...prev],
            )
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'ventas' },
        (payload) => {
          const v = payload.new as Venta
          setVentas((prev) =>
            v.anulada
              ? prev.filter((x) => x.id !== v.id)
              : prev.map((x) => (x.id === v.id ? v : x)),
          )
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [cargar])

  return { ventas, cargando, recargar: cargar }
}
