import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { inicioDelDia } from '@/utils/format'
import type { CajaRegistro } from '@/types/database'

export interface ResumenCierre {
  monto_inicial: number
  total_efectivo: number
  total_yape: number
  total_fiado: number
  total_egresos: number
  esperado_efectivo: number
  ingresado_real: number
  diferencia: number
}

// Clave de localStorage para persistir el ID de caja activa entre recargas
const CAJA_KEY = 'bodeguita_caja_activa_id'

// Convierte de forma segura cualquier valor de BD a número.
// Supabase REST puede devolver columnas NUMERIC/DECIMAL como string;
// sin esta conversión el operador + concatena en lugar de sumar.
const toNum = (v: unknown): number => Number(v ?? 0)

export function useCaja(cajeroId: string | null) {
  const [caja, setCaja] = useState<CajaRegistro | null>(null)
  const [historial, setHistorial] = useState<CajaRegistro[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    if (!cajeroId) {
      setCargando(false)
      return
    }
    setCargando(true)
    try {
      // Sin restricción de fecha: busca cualquier caja abierta del cajero.
      // El filtro por fecha causaba pérdida de estado al recargar cuando había
      // diferencia entre zona horaria local y UTC del servidor.
      const { data: cajaAbierta } = await supabase
        .from('cajas')
        .select('*')
        .eq('cajero_id', cajeroId)
        .eq('estado', 'abierta')
        .order('abierta_en', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cajaAbierta) {
        localStorage.setItem(CAJA_KEY, cajaAbierta.id)
        setCaja(cajaAbierta)
        setCargando(false)
        return
      }

      // Fallback: intenta restaurar desde localStorage si la consulta no encontró nada
      const storedId = localStorage.getItem(CAJA_KEY)
      if (storedId) {
        const { data: cajaPorId } = await supabase
          .from('cajas')
          .select('*')
          .eq('id', storedId)
          .eq('cajero_id', cajeroId)
          .eq('estado', 'abierta')
          .maybeSingle()

        if (cajaPorId) {
          setCaja(cajaPorId)
        } else {
          localStorage.removeItem(CAJA_KEY)
          setCaja(null)
        }
      } else {
        setCaja(null)
      }
    } catch {
      setCaja(null)
    } finally {
      setCargando(false)
    }
  }, [cajeroId])

  const cargarHistorial = useCallback(async () => {
    if (!cajeroId) return
    const { data } = await supabase
      .from('cajas')
      .select('*')
      .eq('cajero_id', cajeroId)
      .order('abierta_en', { ascending: false })
      .limit(30)
    setHistorial(data ?? [])
  }, [cajeroId])

  useEffect(() => {
    cargar()
    cargarHistorial()
  }, [cargar, cargarHistorial])

  async function abrir(montoInicial: number, cajeroNombre: string): Promise<{ caja: CajaRegistro; ventasAdoptadas: number }> {
    const { data, error } = await supabase
      .from('cajas')
      .insert({
        cajero_id: cajeroId,
        cajero_nombre: cajeroNombre,
        monto_inicial: toNum(montoInicial),
        total_efectivo: 0,
        total_yape: 0,
        total_fiado: 0,
        estado: 'abierta',
      })
      .select()
      .single()
    if (error) throw error

    let cajaFinal: CajaRegistro = data
    let ventasAdoptadas = 0

    // Adopta ventas de HOY que quedaron sin caja asignada (caja_id null) —
    // pasa si alguien vendio sin haber aperturado caja antes. Se vinculan a
    // esta caja recien abierta para que el cuadre y el cierre las incluyan.
    // Solo un administrador puede reasignar "caja_id" en ventas (politica
    // RLS ventas_update); si el usuario no es admin este bloque no
    // encuentra permiso, no cambia nada, y no debe impedir abrir la caja.
    try {
      const { data: huerfanas } = await supabase
        .from('ventas')
        .select('id, metodo, total')
        .is('caja_id', null)
        .eq('anulada', false)
        .gte('creado_en', inicioDelDia().toISOString())

      if (huerfanas && huerfanas.length > 0) {
        const ids = huerfanas.map((v) => v.id)
        const { error: errorAdopcion } = await supabase
          .from('ventas')
          .update({ caja_id: data.id })
          .in('id', ids)

        if (!errorAdopcion) {
          ventasAdoptadas = huerfanas.length
          const sumaPorMetodo = (m: string) =>
            huerfanas.filter((v) => v.metodo === m).reduce((s, v) => s + toNum(v.total), 0)

          const { data: cajaActualizada, error: errorTotales } = await supabase
            .from('cajas')
            .update({
              total_efectivo: sumaPorMetodo('efectivo'),
              total_yape:     sumaPorMetodo('yape'),
              total_fiado:    sumaPorMetodo('fiado'),
            })
            .eq('id', data.id)
            .select()
            .single()

          if (!errorTotales && cajaActualizada) cajaFinal = cajaActualizada
        }
      }
    } catch {
      // La adopcion de ventas huerfanas es una mejora "best effort": si falla
      // por lo que sea, la caja igual queda abierta con normalidad.
    }

    localStorage.setItem(CAJA_KEY, cajaFinal.id)
    setCaja(cajaFinal)
    setHistorial((prev) => [cajaFinal, ...prev])
    return { caja: cajaFinal, ventasAdoptadas }
  }

  async function cerrar(montoReal: number): Promise<ResumenCierre> {
    if (!caja) throw new Error('No hay caja abierta')

    // Conversión explícita antes de operar para evitar concatenación de strings
    const montoInicial  = toNum(caja.monto_inicial)
    const totalEfectivo = toNum(caja.total_efectivo)
    const totalYape     = toNum(caja.total_yape)
    const totalFiado    = toNum(caja.total_fiado)
    const totalEgresos  = toNum(caja.total_egresos)
    const montoRealNum  = toNum(montoReal)

    // Efectivo esperado = fondo inicial + ventas en efectivo - salidas de caja en efectivo
    const esperado   = montoInicial + totalEfectivo - totalEgresos
    const diferencia = montoRealNum - esperado

    const { data, error } = await supabase
      .from('cajas')
      .update({
        estado: 'cerrada',
        cerrada_en: new Date().toISOString(),
        monto_real: montoRealNum,
      })
      .eq('id', caja.id)
      .select()
      .single()
    if (error) throw error

    localStorage.removeItem(CAJA_KEY)
    setCaja(null)
    setHistorial((prev) => prev.map((x) => (x.id === data.id ? data : x)))

    return {
      monto_inicial:     montoInicial,
      total_efectivo:    totalEfectivo,
      total_yape:        totalYape,
      total_fiado:       totalFiado,
      total_egresos:     totalEgresos,
      esperado_efectivo: esperado,
      ingresado_real:    montoRealNum,
      diferencia,
    }
  }

  // Incrementa los totales de la caja tras una venta — llamado desde POS.
  // IMPORTANTE: si el RPC `registrar_venta` ya actualiza `cajas` de forma
  // atómica, eliminar la llamada a `incrementar_caja` aquí y conservar solo
  // la actualización optimista de estado local (setCaja) para evitar doble
  // conteo en la base de datos.
  async function sumarVenta(
    cajaId: string,
    metodo: 'efectivo' | 'yape' | 'fiado',
    monto: number,
  ): Promise<void> {
    const campo =
      metodo === 'efectivo'
        ? 'total_efectivo'
        : metodo === 'yape'
        ? 'total_yape'
        : 'total_fiado'

    await supabase.rpc('incrementar_caja', {
      p_caja_id: cajaId,
      p_metodo: metodo,
      p_monto: toNum(monto),
    } as never)

    // Actualización optimista con conversión numérica segura
    setCaja((prev) =>
      prev && prev.id === cajaId
        ? { ...prev, [campo]: toNum(prev[campo as keyof CajaRegistro]) + toNum(monto) }
        : prev,
    )
  }

  // Efectivo en caja = fondo inicial + ventas en efectivo - salidas de caja en efectivo
  const total = caja
    ? toNum(caja.monto_inicial) + toNum(caja.total_efectivo) - toNum(caja.total_egresos)
    : 0

  return {
    caja,
    historial,
    cargando,
    abrir,
    cerrar,
    sumarVenta,
    total,
    recargar: cargar,
    recargarHistorial: cargarHistorial,
  }
}
