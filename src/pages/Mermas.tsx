import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Search, AlertTriangle, TrendingDown } from 'lucide-react'
import { useMermas, ETIQUETA_MOTIVO } from '@/hooks/useMermas'
import { useProductos } from '@/hooks/useProductos'
import { Button, Card, Badge } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { money, fechaHora, cx } from '@/utils/format'
import type { MotivoMerma } from '@/types/database'

const MOTIVOS: MotivoMerma[] = ['vencido', 'danado', 'consumo_interno', 'otro']

const TONO_MOTIVO: Record<MotivoMerma, 'danger' | 'warning' | 'info' | 'success'> = {
  vencido: 'danger',
  danado: 'warning',
  consumo_interno: 'info',
  otro: 'success',
}

function inicioMes(): Date {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

function finHoy(): Date {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

export function Mermas() {
  // useRef ensures these Date objects are created only once — avoids infinite re-render
  // that would occur if inicioMes()/finHoy() were called inline (new object each render).
  const desdeRef = useRef(inicioMes())
  const hastaRef = useRef(finHoy())
  const { mermas, cargando, registrar, costoTotal } = useMermas(desdeRef.current, hastaRef.current)
  const { productos } = useProductos()
  const toast = useToast()

  const [formOpen, setFormOpen] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [busqProd, setBusqProd] = useState('')
  const [f, setF] = useState({
    producto_id: null as string | null,
    producto_nombre: '',
    cantidad: '1',
    costo_unitario: '0',
    motivo: 'vencido' as MotivoMerma,
    descripcion: '',
  })

  const prodsFiltrados = useMemo(() => {
    const q = busqProd.trim().toLowerCase()
    if (!q) return []
    return productos
      .filter((p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 8)
  }, [productos, busqProd])

  function seleccionarProducto(nombre: string, id: string, costo: number) {
    setF((p) => ({ ...p, producto_id: id, producto_nombre: nombre, costo_unitario: String(costo) }))
    setBusqProd('')
  }

  function usarNombreLibre() {
    setF((p) => ({ ...p, producto_id: null, producto_nombre: busqProd.trim() }))
    setBusqProd('')
  }

  function resetForm() {
    setF({ producto_id: null, producto_nombre: '', cantidad: '1', costo_unitario: '0', motivo: 'vencido', descripcion: '' })
    setBusqProd('')
  }

  async function guardar() {
    if (!f.producto_nombre.trim()) {
      toast.error('Selecciona o escribe el nombre del producto.')
      return
    }
    const cantidad = parseInt(f.cantidad) || 0
    if (cantidad <= 0) {
      toast.error('La cantidad debe ser mayor a 0.')
      return
    }
    setGuardando(true)
    try {
      await registrar({
        producto_id: f.producto_id,
        producto_nombre: f.producto_nombre.trim(),
        cantidad,
        costo_unitario: parseFloat(f.costo_unitario) || 0,
        motivo: f.motivo,
        descripcion: f.descripcion.trim() || null,
      })
      toast.exito('Merma registrada y stock descontado')
      setFormOpen(false)
      resetForm()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar la merma')
    } finally {
      setGuardando(false)
    }
  }

  // Agrupado por motivo para el resumen
  const resumenMotivo = useMemo(() => {
    const mapa = new Map<MotivoMerma, { cantidad: number; costo: number }>()
    MOTIVOS.forEach((m) => mapa.set(m, { cantidad: 0, costo: 0 }))
    mermas.forEach((m) => {
      const prev = mapa.get(m.motivo)!
      mapa.set(m.motivo, { cantidad: prev.cantidad + m.cantidad, costo: prev.costo + m.costo_total })
    })
    return mapa
  }, [mermas])

  const costoEstimadoMes = parseFloat(f.cantidad || '0') * parseFloat(f.costo_unitario || '0')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Mermas</h1>
          <p className="text-sm text-ink-400">
            Productos dañados, vencidos o consumidos internamente — mes actual
          </p>
        </div>
        <Button variant="primary" onClick={() => { resetForm(); setFormOpen(true) }}>
          <Plus className="size-[18px]" />
          <span className="hidden sm:inline">Registrar merma</span>
        </Button>
      </div>

      {/* KPIs del mes */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
          <div className="mb-2 grid size-8 place-items-center rounded-lg bg-red-100">
            <TrendingDown className="size-[18px] text-red-600" />
          </div>
          <p className="tabular font-display text-xl font-bold text-red-700">{money(costoTotal)}</p>
          <p className="text-xs font-medium text-red-400">Pérdida total (mes)</p>
        </div>
        {MOTIVOS.map((motivo) => {
          const r = resumenMotivo.get(motivo)!
          return (
            <div key={motivo} className="card p-4">
              <div className="mb-2">
                <Badge tone={TONO_MOTIVO[motivo]}>{ETIQUETA_MOTIVO[motivo]}</Badge>
              </div>
              <p className="tabular font-display text-xl font-bold text-ink-900">
                {money(r.costo)}
              </p>
              <p className="text-xs font-medium text-ink-400">{r.cantidad} unidades</p>
            </div>
          )
        })}
      </div>

      {/* Tabla de mermas */}
      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-ink-100 px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400 lg:grid">
          <span>Producto</span>
          <span className="w-28 text-center">Motivo</span>
          <span className="w-20 text-center">Cantidad</span>
          <span className="w-28 text-right">Costo total</span>
          <span className="w-40">Fecha</span>
        </div>

        {cargando ? (
          <SkeletonList />
        ) : mermas.length === 0 ? (
          <div className="grid place-items-center py-16 text-center">
            <Trash2 className="mb-3 size-8 text-ink-300" />
            <p className="text-sm font-medium text-ink-500">Sin mermas registradas este mes</p>
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {mermas.map((m) => (
              <li
                key={m.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3.5 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-red-50">
                    <AlertTriangle className="size-[18px] text-red-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {m.producto_nombre}
                    </p>
                    {m.descripcion && (
                      <p className="truncate text-xs text-ink-400">{m.descripcion}</p>
                    )}
                  </div>
                </div>

                <div className="hidden w-28 justify-center lg:flex">
                  <Badge tone={TONO_MOTIVO[m.motivo]}>{ETIQUETA_MOTIVO[m.motivo]}</Badge>
                </div>
                <span className="tabular hidden w-20 text-center text-sm font-semibold text-ink-700 lg:block">
                  {m.cantidad} u.
                </span>
                <span className="tabular hidden w-28 text-right text-sm font-bold text-red-700 lg:block">
                  {money(m.costo_total)}
                </span>
                <span className="hidden w-40 text-xs text-ink-400 lg:block">
                  {fechaHora(m.creado_en)}
                </span>

                {/* Movil */}
                <div className="flex flex-col items-end gap-1 text-right lg:hidden">
                  <Badge tone={TONO_MOTIVO[m.motivo]}>{ETIQUETA_MOTIVO[m.motivo]}</Badge>
                  <span className="tabular text-sm font-bold text-red-700">
                    {m.cantidad} u. · {money(m.costo_total)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Sheet: registrar merma */}
      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Registrar merma"
        maxWidth="max-w-md"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-red-700">
              Costo estimado: {money(costoEstimadoMes)}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button variant="secondary" loading={guardando} onClick={guardar}>
                Registrar
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          {/* Buscar producto */}
          <div>
            <span className="label mb-1.5 block">Producto *</span>
            {f.producto_nombre ? (
              <div className="flex items-center justify-between rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5">
                <span className="text-sm font-semibold text-ink-800">{f.producto_nombre}</span>
                <button
                  onClick={() => setF((p) => ({ ...p, producto_id: null, producto_nombre: '' }))}
                  className="text-xs text-ink-400 hover:text-red-600"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
                <input
                  className="input pl-9"
                  value={busqProd}
                  onChange={(e) => setBusqProd(e.target.value)}
                  placeholder="Buscar producto del inventario..."
                  autoFocus
                />
                {(prodsFiltrados.length > 0 || busqProd.trim()) && (
                  <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
                    {prodsFiltrados.map((p) => (
                      <li key={p.id}>
                        <button
                          onClick={() => seleccionarProducto(p.nombre, p.id, p.precio_compra)}
                          className="flex w-full items-center justify-between px-3.5 py-2.5 hover:bg-ink-50"
                        >
                          <span className="text-sm font-semibold text-ink-800">{p.nombre}</span>
                          <span className="tabular text-xs text-ink-400">
                            Costo: {money(p.precio_compra)}
                          </span>
                        </button>
                      </li>
                    ))}
                    {busqProd.trim() && (
                      <li className="border-t border-ink-100">
                        <button
                          onClick={usarNombreLibre}
                          className="flex w-full items-center gap-2 px-3.5 py-2.5 hover:bg-ink-50"
                        >
                          <Plus className="size-4 text-ink-400" />
                          <span className="text-sm text-ink-500">
                            Usar "<b>{busqProd}</b>" sin vincular
                          </span>
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Campo label="Cantidad">
              <input
                type="number"
                min={1}
                className="input tabular"
                value={f.cantidad}
                onChange={(e) => setF((p) => ({ ...p, cantidad: e.target.value }))}
                placeholder="1"
              />
            </Campo>
            <Campo label="Costo unitario (S/)">
              <input
                type="number"
                min={0}
                step={0.01}
                className="input tabular"
                value={f.costo_unitario}
                onChange={(e) => setF((p) => ({ ...p, costo_unitario: e.target.value }))}
                placeholder="0.00"
              />
            </Campo>
          </div>

          <Campo label="Motivo">
            <select
              className="input"
              value={f.motivo}
              onChange={(e) => setF((p) => ({ ...p, motivo: e.target.value as MotivoMerma }))}
            >
              {MOTIVOS.map((m) => (
                <option key={m} value={m}>
                  {ETIQUETA_MOTIVO[m]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Descripción (opcional)">
            <input
              className="input"
              value={f.descripcion}
              onChange={(e) => setF((p) => ({ ...p, descripcion: e.target.value }))}
              placeholder="Lote vencido en feb 2026..."
            />
          </Campo>

          <div className={cx(
            'rounded-xl border px-3.5 py-3 text-sm',
            'border-amber-200 bg-amber-50 text-amber-800',
          )}>
            <AlertTriangle className="mb-1 size-4 text-amber-500" />
            <p className="font-semibold">El stock del producto se descontará automáticamente.</p>
            <p className="mt-0.5 text-xs text-amber-600">
              Solo para productos vinculados al inventario.
            </p>
          </div>
        </div>
      </Sheet>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

function SkeletonList() {
  return (
    <ul className="divide-y divide-ink-100">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="size-9 animate-pulse rounded-xl bg-ink-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-48 animate-pulse rounded bg-ink-100" />
            <div className="h-3 w-24 animate-pulse rounded bg-ink-100" />
          </div>
        </li>
      ))}
    </ul>
  )
}
