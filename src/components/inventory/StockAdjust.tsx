import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Settings2 } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { supabase } from '@/lib/supabase'
import { cx } from '@/utils/format'
import { presentacionesDisponibles, resolverPresentacion } from '@/utils/presentaciones'
import type { ModalidadVenta, Producto, TipoMovimiento } from '@/types/database'

interface Props {
  open: boolean
  onClose: () => void
  producto: Producto | null
  onListo: () => void
}

export function StockAdjust({ open, onClose, producto, onListo }: Props) {
  const toast = useToast()
  const [tipo, setTipo] = useState<'entrada' | 'salida' | 'ajuste'>('entrada')
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  // Presentacion elegida para entrada/salida (ej. "3 Cajas" en vez de "36
  // unidades") — no aplica a "ajuste", que sigue siendo el conteo fisico
  // absoluto en unidades base.
  const [modalidad, setModalidad] = useState<ModalidadVenta>('unidad')

  useEffect(() => {
    setModalidad('unidad')
  }, [producto?.id, open])

  if (!producto) return null

  const tipos = [
    { id: 'entrada' as const, label: 'Entrada', icon: ArrowDownToLine, signo: 1 },
    { id: 'salida' as const, label: 'Salida', icon: ArrowUpFromLine, signo: -1 },
    { id: 'ajuste' as const, label: 'Ajuste', icon: Settings2, signo: 1 },
  ]
  const opciones = tipo !== 'ajuste' ? presentacionesDisponibles(producto) : []
  const modalidadActiva = tipo === 'ajuste' ? 'unidad' : modalidad
  const resuelto = resolverPresentacion(producto, modalidadActiva)
  // parseFloat (no parseInt) para admitir decimales en productos a granel (ej. 2.5 kg)
  const cantNum = parseFloat(cantidad) || 0
  const unidadesReales = cantNum * resuelto.factor
  const signo = tipos.find((t) => t.id === tipo)!.signo
  const nuevoStock =
    tipo === 'ajuste' ? cantNum : producto.stock_actual + signo * unidadesReales

  async function aplicar() {
    if (cantNum <= 0) {
      toast.error('Ingresa una cantidad valida.')
      return
    }
    setGuardando(true)
    // Para "ajuste" calculamos el delta hacia el valor objetivo (siempre en
    // unidades base); para entrada/salida, el delta ya viene convertido
    // segun la presentacion elegida (ej. "3 Cajas" -> 36 unidades).
    const delta =
      tipo === 'ajuste' ? cantNum - producto!.stock_actual : signo * unidadesReales
    const tipoMov: TipoMovimiento = tipo === 'ajuste' ? 'ajuste' : tipo
    const motivoFinal =
      resuelto.etiqueta && tipo !== 'ajuste'
        ? `${motivo ? motivo + ' — ' : ''}${cantNum} ${resuelto.etiqueta}`
        : motivo || null
    try {
      const { error } = await supabase.rpc('ajustar_stock', {
        p_producto_id: producto!.id,
        p_cantidad: delta,
        p_tipo: tipoMov,
        p_motivo: motivoFinal,
      })
      if (error) throw error
      toast.exito('Stock actualizado')
      setCantidad('')
      setMotivo('')
      onListo()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al ajustar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Movimiento de stock"
      maxWidth="max-w-md"
      footer={
        <Button variant="secondary" className="w-full" loading={guardando} onClick={aplicar}>
          Aplicar movimiento
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-ink-50 px-4 py-3">
          <p className="text-sm font-semibold text-ink-800">{producto.nombre}</p>
          <p className="tabular text-xs text-ink-400">
            Stock actual: {producto.stock_actual} {producto.unidad}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {tipos.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTipo(id)}
              className={cx(
                'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-semibold transition focusable',
                tipo === id
                  ? 'border-accent-500 bg-accent-50 text-accent-700'
                  : 'border-ink-200 text-ink-500 hover:border-ink-300',
              )}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </div>

        {tipo !== 'ajuste' && opciones.length > 0 && (
          <div>
            <span className="label mb-1.5 block">Presentación</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setModalidad('unidad')}
                className={cx(
                  'rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                  modalidad === 'unidad'
                    ? 'border-accent-500 bg-accent-50 text-accent-700'
                    : 'border-ink-200 text-ink-500 hover:border-ink-300',
                )}
              >
                {producto.unidad}
              </button>
              {opciones.map((o) => (
                <button
                  key={o.modalidad}
                  onClick={() => setModalidad(o.modalidad)}
                  className={cx(
                    'rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                    modalidad === o.modalidad
                      ? 'border-accent-500 bg-accent-50 text-accent-700'
                      : 'border-ink-200 text-ink-500 hover:border-ink-300',
                  )}
                >
                  {o.etiqueta}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="block">
          <span className="label mb-1.5 block">
            {tipo === 'ajuste'
              ? 'Stock real (conteo fisico)'
              : `Cantidad${resuelto.etiqueta ? ` (en ${resuelto.etiqueta})` : ''}`}
          </span>
          <input
            type="number"
            inputMode="decimal"
            step={tipo !== 'ajuste' && modalidad !== 'unidad' ? 1 : producto.tipo_venta === 'granel' ? 0.001 : 1}
            autoFocus
            className="input tabular text-lg"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            placeholder="0"
          />
          {tipo !== 'ajuste' && modalidad !== 'unidad' && cantNum > 0 && (
            <p className="tabular mt-1 text-xs text-ink-400">
              = {Math.round(unidadesReales * 1000) / 1000} {producto.unidad}
            </p>
          )}
        </label>

        <label className="block">
          <span className="label mb-1.5 block">Motivo (opcional)</span>
          <input
            className="input"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Compra a proveedor, merma, correccion..."
          />
        </label>

        {cantNum > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3 text-white">
            <span className="text-sm text-white/60">Stock resultante</span>
            <span className="tabular font-display text-lg font-bold">
              {Math.round(Math.max(nuevoStock, 0) * 1000) / 1000} {producto.unidad}
            </span>
          </div>
        )}
      </div>
    </Sheet>
  )
}
