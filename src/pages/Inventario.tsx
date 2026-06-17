import { useMemo, useState } from 'react'
import {
  Plus,
  Search,
  Pencil,
  PackagePlus,
  History,
  AlertTriangle,
  PackageX,
  Trash2,
} from 'lucide-react'
import { useProductos } from '@/hooks/useProductos'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { Card, Badge, Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { ProductForm } from '@/components/inventory/ProductForm'
import { StockAdjust } from '@/components/inventory/StockAdjust'
import { money, cx, fechaHora } from '@/utils/format'
import type { MovimientoInventario, Producto } from '@/types/database'

export function Inventario() {
  const { productos, categorias, recargar } = useProductos()
  const { esAdmin } = useAuth()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [soloBajo, setSoloBajo] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editando, setEditando] = useState<Producto | null>(null)
  const [ajuste, setAjuste] = useState<Producto | null>(null)
  const [kardex, setKardex] = useState<Producto | null>(null)
  const [eliminarConfirm, setEliminarConfirm] = useState<Producto | null>(null)
  const [eliminando, setEliminando] = useState(false)

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    return productos.filter((p) => {
      const mq = !t || p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)
      const mb = !soloBajo || p.stock_actual <= p.stock_minimo
      return mq && mb
    })
  }, [productos, q, soloBajo])

  const totalValorizado = productos.reduce(
    (s, p) => s + p.precio_compra * p.stock_actual,
    0,
  )
  const cantBajo = productos.filter((p) => p.stock_actual <= p.stock_minimo).length

  function abrirNuevo() {
    setEditando(null)
    setFormOpen(true)
  }
  function abrirEditar(p: Producto) {
    setEditando(p)
    setFormOpen(true)
  }

  async function confirmarEliminar() {
    if (!eliminarConfirm) return
    setEliminando(true)
    try {
      const { error } = await supabase
        .from('productos')
        .update({ activo: false })
        .eq('id', eliminarConfirm.id)
      if (error) throw error
      toast.exito(`"${eliminarConfirm.nombre}" eliminado del inventario`)
      setEliminarConfirm(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setEliminando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Inventario</h1>
          <p className="text-sm text-ink-400">
            {productos.length} productos · valorizado {money(totalValorizado)}
          </p>
        </div>
        {esAdmin && (
          <Button variant="primary" onClick={abrirNuevo}>
            <Plus className="size-[18px]" /> <span className="hidden sm:inline">Nuevo producto</span>
          </Button>
        )}
      </div>

      {/* Controles */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-ink-300" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre o SKU..."
            className="input pl-10"
          />
        </div>
        <button
          onClick={() => setSoloBajo((v) => !v)}
          className={cx(
            'flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition',
            soloBajo
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-ink-200 text-ink-500 hover:border-ink-300',
          )}
        >
          <AlertTriangle className="size-4" />
          Stock bajo {cantBajo > 0 && `(${cantBajo})`}
        </button>
      </div>

      {/* Tabla / lista */}
      <Card className="overflow-hidden">
        {/* Cabecera (desktop) */}
        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-ink-100 px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400 lg:grid">
          <span>Producto</span>
          <span className="w-24 text-right">Compra</span>
          <span className="w-24 text-right">Venta</span>
          <span className="w-24 text-center">Stock</span>
          <span className="w-28 text-right">Acciones</span>
        </div>

        {filtrados.length === 0 ? (
          <div className="grid place-items-center py-16 text-center text-ink-300">
            <PackageX className="mb-2 size-8" />
            <p className="text-sm font-medium">No hay productos para mostrar</p>
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {filtrados.map((p) => {
              const bajo = p.stock_actual <= p.stock_minimo
              const agotado = p.stock_actual <= 0
              return (
                <li
                  key={p.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {/* Thumbnail */}
                    <div className="size-9 shrink-0 overflow-hidden rounded-lg border border-ink-100 bg-ink-50">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.nombre}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center">
                          <span
                            className="size-2.5 rounded-full"
                            style={{ background: p.categorias?.color ?? '#d4d4d0' }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-800">{p.nombre}</p>
                      <p className="tabular text-xs text-ink-400">
                        {p.sku} · {p.categorias?.nombre ?? 'Sin categoría'}
                      </p>
                    </div>
                  </div>

                  <span className="tabular hidden w-24 text-right text-sm text-ink-500 lg:block">
                    {money(p.precio_compra)}
                  </span>
                  <span className="tabular hidden w-24 text-right text-sm font-semibold text-ink-900 lg:block">
                    {money(p.precio_venta)}
                  </span>

                  <div className="lg:w-24 lg:text-center">
                    {agotado ? (
                      <Badge tone="danger">Agotado</Badge>
                    ) : bajo ? (
                      <Badge tone="warning">{p.stock_actual} u.</Badge>
                    ) : (
                      <span className="tabular text-sm font-semibold text-ink-700">
                        {p.stock_actual} u.
                      </span>
                    )}
                  </div>

                  <div className="hidden w-28 items-center justify-end gap-1 lg:flex">
                    <IconBtn title="Movimiento" onClick={() => setAjuste(p)}>
                      <PackagePlus className="size-[18px]" />
                    </IconBtn>
                    <IconBtn title="Kardex" onClick={() => setKardex(p)}>
                      <History className="size-[18px]" />
                    </IconBtn>
                    {esAdmin && (
                      <IconBtn title="Editar" onClick={() => abrirEditar(p)}>
                        <Pencil className="size-[18px]" />
                      </IconBtn>
                    )}
                    {esAdmin && (
                      <IconBtn title="Eliminar" onClick={() => setEliminarConfirm(p)}>
                        <Trash2 className="size-[18px] text-red-400" />
                      </IconBtn>
                    )}
                  </div>

                  {/* Acciones movil */}
                  <div className="col-span-2 flex gap-1.5 lg:hidden">
                    <button
                      onClick={() => setAjuste(p)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink-100 py-1.5 text-xs font-semibold text-ink-600"
                    >
                      <PackagePlus className="size-4" /> Stock
                    </button>
                    <button
                      onClick={() => setKardex(p)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink-100 py-1.5 text-xs font-semibold text-ink-600"
                    >
                      <History className="size-4" /> Kardex
                    </button>
                    {esAdmin && (
                      <button
                        onClick={() => abrirEditar(p)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink-100 py-1.5 text-xs font-semibold text-ink-600"
                      >
                        <Pencil className="size-4" /> Editar
                      </button>
                    )}
                    {esAdmin && (
                      <button
                        onClick={() => setEliminarConfirm(p)}
                        className="flex items-center justify-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Confirmación eliminar producto */}
      <Sheet
        open={!!eliminarConfirm}
        onClose={() => setEliminarConfirm(null)}
        title="Eliminar producto"
        maxWidth="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEliminarConfirm(null)}>
              Cancelar
            </Button>
            <Button
              className="flex-1 bg-red-600 text-white hover:bg-red-700"
              loading={eliminando}
              onClick={confirmarEliminar}
            >
              Eliminar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-600">
            ¿Eliminar <b className="text-ink-900">{eliminarConfirm?.nombre}</b>? Dejará de aparecer
            en el inventario y en el punto de venta.
          </p>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            El historial de ventas no se modifica.
          </p>
        </div>
      </Sheet>

      <ProductForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        producto={editando}
        categorias={categorias}
        onGuardado={recargar}
      />
      <StockAdjust
        open={!!ajuste}
        onClose={() => setAjuste(null)}
        producto={ajuste}
        onListo={recargar}
      />
      <KardexSheet producto={kardex} onClose={() => setKardex(null)} />
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-800 focusable"
    >
      {children}
    </button>
  )
}

function KardexSheet({ producto, onClose }: { producto: Producto | null; onClose: () => void }) {
  const [movs, setMovs] = useState<MovimientoInventario[]>([])
  const [cargando, setCargando] = useState(false)

  useMemo(() => {
    if (!producto) return
    setCargando(true)
    supabase
      .from('movimientos_inventario')
      .select('*')
      .eq('producto_id', producto.id)
      .order('creado_en', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setMovs(data ?? [])
        setCargando(false)
      })
  }, [producto])

  const etiquetas: Record<string, { txt: string; tone: 'success' | 'danger' | 'warning' | 'info' }> = {
    entrada: { txt: 'Entrada', tone: 'success' },
    venta: { txt: 'Venta', tone: 'info' },
    salida: { txt: 'Salida', tone: 'danger' },
    ajuste: { txt: 'Ajuste', tone: 'warning' },
    devolucion: { txt: 'Devolucion', tone: 'success' },
  }

  return (
    <Sheet
      open={!!producto}
      onClose={onClose}
      title={producto ? `Kardex · ${producto.nombre}` : ''}
      maxWidth="max-w-lg"
    >
      {cargando ? (
        <p className="py-8 text-center text-sm text-ink-400">Cargando movimientos...</p>
      ) : movs.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-400">Sin movimientos registrados.</p>
      ) : (
        <ul className="space-y-1.5">
          {movs.map((m) => {
            const e = etiquetas[m.tipo] ?? { txt: m.tipo, tone: 'info' as const }
            return (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-ink-100 px-3 py-2.5"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={e.tone}>{e.txt}</Badge>
                    {m.motivo && <span className="text-xs text-ink-400">{m.motivo}</span>}
                  </div>
                  <p className="mt-1 text-xs text-ink-400">{fechaHora(m.creado_en)}</p>
                </div>
                <div className="text-right">
                  <p
                    className={cx(
                      'tabular font-display text-sm font-bold',
                      m.cantidad >= 0 ? 'text-accent-700' : 'text-red-600',
                    )}
                  >
                    {m.cantidad >= 0 ? '+' : ''}
                    {m.cantidad}
                  </p>
                  <p className="tabular text-xs text-ink-400">→ {m.stock_nuevo}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}
