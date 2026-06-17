import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ClienteCredito, PagoCredito } from '@/types/database'

export function useClientes() {
  const [clientes, setClientes] = useState<ClienteCredito[]>([])
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
    cargando,
    cargar,
    crear,
    actualizar,
    eliminar,
    registrarAbono,
    obtenerPagos,
  }
}
