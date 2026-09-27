import { useEffect, useMemo, useState } from 'react'
import { Search, Trash2, Plus, Save } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { supabase } from '@/lib/supabase'
import { useProductos } from '@/hooks/useProductos'
import { money, cx } from '@/utils/format'
import type { DetalleVenta, Venta } from '@/types/database'

const TASA_IGV = 0.18

interface LineaEdicion {
  producto_id: string | null
  producto_nombre: string
  cantidad: number
  modalidad: string
  precio_unitario: number
  /** Solo informativo — no se puede cambiar la presentacion en una edicion, para mantener el alcance simple y predecible. */
  presentacion_nombre: string | null
}

function lineaDesdeDetalle(d: DetalleVenta): LineaEdicion {
  return {
    producto_id: d.producto_id,
    producto_nombre: d.producto_nombre,
    cantidad: d.cantidad,
    modalidad: d.modalidad,
    precio_unitario: d.precio_unitario,
    presentacion_nombre: d.presentacion_nombre,
  }
}

interface Props {
  open: boolean
  onClose: () => void
  venta: Venta
  detalle: DetalleVenta[]
  onEditada: () => void
}

/**
 * Reemplaza los productos de una venta ya registrada sin anularla — quitar
 * un producto, agregar uno nuevo, o cambiar cantidades. El total, IGV y
 * vuelto se recalculan solos; la caja y la deuda del cliente (si la venta
 * era fiado) se ajustan por la diferencia en el servidor (ver RPC
 * editar_venta en supabase/schema.sql), reescalando proporcionalmente los
 * pagos originales — nunca hay que volver a cobrarle al cliente.
 */
export function EditarVenta({ open, onClose, venta, detalle, onEditada }: Props) {
  const toast = useToast()
  const { productos } = useProductos()
  const [lineas, setLineas] = useState<LineaEdicion[]>([])
  const [motivo, setMotivo] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (open) {
      setLineas(detalle.map(lineaDesdeDetalle))
      setMotivo('')
      setBusqueda('')
    }
    // Solo al abrir — si se editan las lineas despues, no queremos que un
    // cambio en "detalle" (ej. por el propio guardado) pise el borrador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const totales = useMemo(() => {
    const subtotal = lineas.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0)
    const descuento = Math.min(venta.descuento, subtotal)
    const total = Math.max(subtotal - descuento, 0)
    const base = total / (1 + TASA_IGV)
    const igv = total - base
    return { subtotal, descuento, total, igv }
  }, [lineas, venta.descuento])

  const prodsFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return []
    return productos
      .filter((p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 8)
  }, [productos, busqueda])

  function agregarProducto(id: string) {
    const prod = productos.find((p) => p.id === id)
    if (!prod) return
    setLineas((prev) => {
      const existente = prev.find((l) => l.producto_id === id && l.modalidad === 'unidad')
      if (existente) {
        return prev.map((l) =>
          l === existente ? { ...l, cantidad: l.cantidad + 1 } : l,
        )
      }
      return [
        ...prev,
        {
          producto_id: prod.id,
          producto_nombre: prod.nombre,
          cantidad: 1,
          modalidad: 'unidad',
          precio_unitario: prod.precio_venta,
          presentacion_nombre: null,
        },
      ]
    })
    setBusqueda('')
  }

  function cambiarCantidad(idx: number, val: string) {
    const n = parseFloat(val)
    setLineas((prev) => prev.map((l, i) => (i === idx ? { ...l, cantidad: Number.isFinite(n) ? n : 0 } : l)))
  }

  function quitarLinea(idx: number) {
    setLineas((prev) => prev.filter((_, i) => i !== idx))
  }

  async function guardar() {
    const validas = lineas.filter((l) => l.cantidad > 0)
    if (validas.length === 0) {
      toast.error('La venta debe tener al menos un producto.')
      return
    }
    if (!motivo.trim()) {
      toast.error('Indica el motivo de la edición.')
      return
    }
    setGuardando(true)
    try {
      const { error } = await supabase.rpc('editar_venta', {
        p_venta_id: venta.id,
        p_items: validas.map((l) => ({
          producto_id: l.producto_id,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          modalidad: l.modalidad,
        })),
        p_motivo: motivo.trim(),
      })
      if (error) throw error
      toast.exito(`Comprobante #${venta.numero} actualizado`)
      onEditada()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar la edición')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Editar comprobante #${venta.numero}`}
      maxWidth="max-w-lg"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button variant="secondary" className="flex-1" loading={guardando} onClick={guardar}>
            <Save className="size-4" /> Guardar cambios
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700">
          Al guardar se repone el stock de los productos quitados y se descuenta el de los nuevos. La
          caja {venta.caja_id ? 'y' : '(sin caja asociada) y'} la deuda del cliente (si era fiado) se
          ajustan automáticamente por la diferencia.
        </div>

        {/* Buscador de productos */}
        <div>
          <span className="label mb-1.5 block">Agregar producto</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
            <input
              className="input pl-9"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o SKU..."
            />
          </div>
          {prodsFiltrados.length > 0 && (
            <ul className="mt-1.5 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
              {prodsFiltrados.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => agregarProducto(p.id)}
                    className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-ink-50"
                  >
                    <span className="text-sm font-semibold text-ink-800">{p.nombre}</span>
                    <span className="tabular text-xs text-ink-400">{money(p.precio_venta)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Lineas */}
        <div className="overflow-hidden rounded-xl border border-ink-200">
          <div className="grid grid-cols-[1fr_70px_80px_32px] gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400">
            <span>Producto</span>
            <span className="text-center">Cant.</span>
            <span className="text-right">Subtotal</span>
            <span />
          </div>
          <ul className="divide-y divide-ink-100">
            {lineas.map((l, idx) => (
              <li key={idx} className="grid grid-cols-[1fr_70px_80px_32px] items-center gap-2 px-3 py-2">
                <span className="min-w-0 truncate text-sm font-semibold text-ink-800">
                  {l.producto_nombre}
                  {l.presentacion_nombre && (
                    <span className="ml-1 rounded bg-accent-100 px-1 py-0.5 text-[0.55rem] font-bold uppercase text-accent-700">
                      {l.presentacion_nombre}
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.001}
                  className="input tabular py-1 text-center text-sm"
                  value={l.cantidad}
                  onChange={(e) => cambiarCantidad(idx, e.target.value)}
                />
                <span className="tabular text-right text-sm font-bold text-ink-900">
                  {money(l.cantidad * l.precio_unitario)}
                </span>
                <button
                  onClick={() => quitarLinea(idx)}
                  className="grid size-7 place-items-center rounded-md text-ink-300 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
            {lineas.length === 0 && (
              <li className="flex items-center justify-center gap-1.5 py-6 text-sm text-ink-400">
                <Plus className="size-3.5" /> Agrega al menos un producto
              </li>
            )}
          </ul>
        </div>

        {/* Totales */}
        <div className="space-y-1 rounded-xl bg-ink-50 p-3.5 text-sm">
          <div className="flex justify-between text-ink-500">
            <span>Subtotal</span>
            <span className="tabular">{money(totales.subtotal)}</span>
          </div>
          {totales.descuento > 0 && (
            <div className="flex justify-between text-ink-500">
              <span>Descuento</span>
              <span className="tabular">- {money(totales.descuento)}</span>
            </div>
          )}
          <div className="flex justify-between text-ink-400 text-xs">
            <span>IGV incluido (18%)</span>
            <span className="tabular">{money(totales.igv)}</span>
          </div>
          <div
            className={cx(
              'flex justify-between border-t border-ink-200 pt-1.5 font-display text-base font-bold',
              totales.total !== venta.total ? 'text-accent-700' : 'text-ink-900',
            )}
          >
            <span>Nuevo total</span>
            <span className="tabular">{money(totales.total)}</span>
          </div>
          {totales.total !== venta.total && (
            <p className="text-right text-xs text-ink-400">
              Total anterior: {money(venta.total)} ({totales.total > venta.total ? '+' : ''}
              {money(totales.total - venta.total)})
            </p>
          )}
        </div>

        <label className="block">
          <span className="label mb-1.5 block">Motivo de la edición *</span>
          <input
            className="input"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej. Cliente cambió de producto"
          />
        </label>
      </div>
    </Sheet>
  )
}
