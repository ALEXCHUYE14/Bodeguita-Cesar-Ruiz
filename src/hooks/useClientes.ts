import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ClienteCredito, PagoCredito } from '@/types/database'

// Dias sin ningun pago ni nueva venta al fiado a partir de los cuales se
// considera "vencida" la deuda de un cliente (usado para alertas).
export const DIAS_DEUDA_VENCIDA = 15

// Para cada cliente con deuda, calcula la fecha de su ultimo movimiento de
// credito (el pago mas reciente o la venta al fiado mas reciente, lo que sea
// mas nuevo) y devuelve cuantos dias han pasado desde entonces.
async function calcularDiasSinPago(clienteIds: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>()
  if (clienteIds.length === 0) return mapa

  const [{ data: ventasFiado }, { data: pagos }] = await Promise.all([
    supabase
      .from('ventas')
      .select('cliente_id, creado_en')
      .eq('metodo', 'fiado')
      .in('cliente_id', clienteIds)
      .order('creado_en', { ascending: false }),
    supabase
      .from('pagos_credito')
      .select('cliente_id, creado_en')
      .in('cliente_id', clienteIds)
      .order('creado_en', { ascending: false }),
  ])

  const ultimaFecha = new Map<string, string>()
  // Ambas listas vienen ordenadas desc: el primer registro por cliente ya es
  // el mas reciente de esa lista.
  ;(ventasFiado ?? []).forEach((v) => {
    if (v.cliente_id && !ultimaFecha.has(v.cliente_id)) ultimaFecha.set(v.cliente_id, v.creado_en)
  })
  ;(pagos ?? []).forEach((p) => {
    const prev = ultimaFecha.get(p.cliente_id)
    if (!prev || p.creado_en > prev) ultimaFecha.set(p.cliente_id, p.creado_en)
  })

  const ahora = Date.now()
  clienteIds.forEach((id) => {
    const fecha = ultimaFecha.get(id)
    if (fecha) {
      mapa.set(id, Math.floor((ahora - new Date(fecha).getTime()) / 86400000))
    }
  })
  return mapa
}

export function useClientes() {
  const [clientes, setClientes] = useState<ClienteCredito[]>([])
  const [diasSinPago, setDiasSinPago] = useState<Map<string, number>>(new Map())
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('clientes_credito')
      .select('*')
      .eq('activo', true)
      .order('nombre')
    setClientes(data ?? [])
    setCargando(false)

    const conDeuda = (data ?? []).filter((c) => c.deuda_actual > 0).map((c) => c.id)
    setDiasSinPago(await calcularDiasSinPago(conDeuda))
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function crear(
    c: Pick<ClienteCredito, 'nombre' | 'telefono' | 'direccion' | 'limite_credito'>,
  ): Promise<ClienteCredito> {
    const { data, error } = await supabase
      .from('clientes_credito')
      .insert({ ...c, deuda_actual: 0 })
      .select()
      .single()
    if (error) throw error
    setClientes((prev) =>
      [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    )
    return data
  }

  async function actualizar(
    id: string,
    c: Pick<ClienteCredito, 'nombre' | 'telefono' | 'direccion' | 'limite_credito'>,
  ): Promise<ClienteCredito> {
    const { data, error } = await supabase
      .from('clientes_credito')
      .update(c)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setClientes((prev) => prev.map((x) => (x.id === id ? data : x)))
    return data
  }

  async function eliminar(id: string): Promise<void> {
    const { error } = await supabase
      .from('clientes_credito')
      .update({ activo: false })
      .eq('id', id)
    if (error) throw error
    setClientes((prev) => prev.filter((x) => x.id !== id))
  }

  async function registrarAbono(
    clienteId: string,
    monto: number,
    nota: string | null,
  ): Promise<PagoCredito> {
    const { data, error } = await supabase.rpc('registrar_abono_cliente', {
      p_cliente_id: clienteId,
      p_monto: monto,
      p_nota: nota,
    })
    if (error) throw error
    // Refrescar el cliente afectado
    const { data: clienteActual } = await supabase
      .from('clientes_credito')
      .select('*')
      .eq('id', clienteId)
      .single()
    if (clienteActual) {
      setClientes((prev) =>
        prev.map((x) => (x.id === clienteId ? clienteActual : x)),
      )
    }
    // El abono es un movimiento de credito nuevo: recalcular su antiguedad.
    setDiasSinPago((prev) => new Map(prev).set(clienteId, 0))
    return data
  }

  async function obtenerPagos(clienteId: string): Promise<PagoCredito[]> {
    const { data, error } = await supabase
      .from('pagos_credito')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('creado_en', { ascending: false })
      .limit(50)
    if (error) throw error
    return data ?? []
  }

  return {
    clientes,
    diasSinPago,
    cargando,
    cargar,
    crear,
    actualizar,
    eliminar,
    registrarAbono,
    obtenerPagos,
  }
}
