import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Proveedor } from '@/types/database'

export function useProveedores() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('proveedores')
      .select('*')
      .eq('activo', true)
      .order('nombre')
    setProveedores(data ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function crear(
    p: Pick<Proveedor, 'nombre' | 'ruc' | 'telefono' | 'email' | 'direccion'>,
  ): Promise<Proveedor> {
    const { data, error } = await supabase
      .from('proveedores')
      .insert(p)
      .select()
      .single()
    if (error) throw error
    setProveedores((prev) =>
      [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    )
    return data
  }

  async function actualizar(
    id: string,
    p: Pick<Proveedor, 'nombre' | 'ruc' | 'telefono' | 'email' | 'direccion'>,
  ): Promise<Proveedor> {
    const { data, error } = await supabase
      .from('proveedores')
      .update(p)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setProveedores((prev) => prev.map((x) => (x.id === id ? data : x)))
    return data
  }

  async function eliminar(id: string): Promise<void> {
    const { error } = await supabase
      .from('proveedores')
      .update({ activo: false })
      .eq('id', id)
    if (error) throw error
    setProveedores((prev) => prev.filter((x) => x.id !== id))
  }

  return { proveedores, cargando, cargar, crear, actualizar, eliminar }
}
