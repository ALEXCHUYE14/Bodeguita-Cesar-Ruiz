import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CategoriaEgreso, Egreso, MetodoEgreso } from '@/types/database'

export const ETIQUETA_CATEGORIA_EGRESO: Record<CategoriaEgreso, string> = {
  alquiler: 'Alquiler',
  servicios: 'Servicios (luz, agua, internet)',
  sueldos: 'Sueldos',
  transporte: 'Transporte',
  insumos: 'Insumos / materiales',
  impuestos: 'Impuestos',
  mantenimiento: 'Mantenimiento',
  otro: 'Otro',
}

export const ETIQUETA_METODO_EGRESO: Record<MetodoEgreso, string> = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
}

export function useEgresos(desde: Date, hasta: Date) {
  const [egresos, setEgresos] = useState<Egreso[]>([])
  const [cargando, setCargando] = useState(true)

  // Se comparan por valor (primitivo), no por referencia — evita recargas
  // infinitas si el llamador pasa un `new Date()` inline en cada render.
  const desdeMs = desde.getTime()
  const hastaMs = hasta.getTime()

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase
      .from('egresos')
      .select('*')
      .gte('fecha', new Date(desdeMs).toISOString().slice(0, 10))
      .lte('fecha', new Date(hastaMs).toISOString().slice(0, 10))
      .order('creado_en', { ascending: false })
      .limit(1000)
    if (!error) setEgresos(data ?? [])
    setCargando(false)
  }, [desdeMs, hastaMs])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function registrar(datos: {
    concepto: string
    categoria: CategoriaEgreso
    monto: number
    metodo: MetodoEgreso
    caja_id?: string | null
    notas?: string | null
  }): Promise<Egreso> {
    const { data, error } = await supabase.rpc('registrar_egreso', {
      p_concepto: datos.concepto,
      p_categoria: datos.categoria,
      p_monto: datos.monto,
      p_metodo: datos.metodo,
      p_caja_id: datos.caja_id ?? null,
      p_notas: datos.notas ?? null,
    })
    if (error) throw error
    const egreso = data as Egreso
    setEgresos((prev) => [egreso, ...prev])
    return egreso
  }

  async function eliminar(id: string): Promise<void> {
    const { error } = await supabase.rpc('eliminar_egreso', { p_id: id })
    if (error) throw error
    setEgresos((prev) => prev.filter((e) => e.id !== id))
  }

  const total = egresos.reduce((s, e) => s + e.monto, 0)

  return { egresos, cargando, cargar, registrar, eliminar, total }
}
