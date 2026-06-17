import { useMemo, useState } from 'react'
import {
  Plus,
  ShoppingBag,
  ChevronDown,
  Trash2,
  Search,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { useCompras, type ItemCompra } from '@/hooks/useCompras'
import { useProveedores } from '@/hooks/useProveedores'
import { useProductos } from '@/hooks/useProductos'
import { Button, Card, Badge } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { money, fechaCorta, cx, ymd } from '@/utils/format'
import type { Compra, DetalleCompra, EstadoCompra } from '@/types/database'

export function Compras() {
  const { compras, cargando, crear, cambiarEstado, obtenerDetalles } = useCompras()
  const { proveedores } = useProveedores()
  const { productos } = useProductos()
  const toast = useToast()

  const [formOpen, setFormOpen] = useState(false)
  const [detalleOpen, setDetalleOpen] = useState(false)
  const [compraVer, setCompraVer] = useState<Compra | null>(null)
  const [detalles, setDetalles] = useState<DetalleCompra[]>([])
  const [filtroEstado, setFiltroEstado] = useState<EstadoCompra | 'todos'>('todos')
  const [guardando, setGuardando] = useState(false)

  // Estado del formulario de nueva compra
  const [f, setF] = useState({
    numero: '',
    proveedor_id: '',
    fecha_compra: ymd(new Date()),
    estado: 'pendiente' as EstadoCompra,
    notas: '',
  })
  const [items, setItems] = useState<ItemCompra[]>([])
  const [busqProd, setBusqProd] = useState('')

  const filtradas = useMemo(() => {
    if (filtroEstado === 'todos') return compras
    return compras.filter((c) => c.estado === filtroEstado)
  }, [compras, filtroEstado])

  const totalPendiente = useMemo(
    () => compras.filter((c) => c.estado === 'pendiente').reduce((s, c) => s + c.total, 0),
    [compras],
  )

  const prodsFiltrados = useMemo(() => {
    const q = busqProd.trim().toLowerCase()
    if (!q) return []
    return productos
      .filter((p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 8)
  }, [productos, busqProd])

  function agregarItem(nombre: string, prod_id: string | null) {
    const existente = items.find((i) => i.producto_id === prod_id && prod_id !== null)
    if (existente) {
      setItems((prev) =>
        prev.map((i) =>
          i.producto_id === prod_id ? { ...i, cantidad: i.cantidad + 1 } : i,
        ),
      )
    } else {
      const prod = productos.find((p) => p.id === prod_id)
      setItems((prev) => [
        ...prev,
        {
          producto_id: prod_id,
          producto_nombre: nombre,
          cantidad: 1,
          precio_unitario: prod?.precio_compra ?? 0,
        },
      ])
    }
    setBusqProd('')
  }

  function agregarItemLibre() {
    if (!busqProd.trim()) return
    setItems((prev) => [
      ...prev,
      { producto_id: null, producto_nombre: busqProd.trim(), cantidad: 1, precio_unitario: 0 },
    ])
    setBusqProd('')
  }

  function actualizarItem(idx: number, campo: 'cantidad' | 'precio_unitario', val: string) {
    setItems((prev) =>
      prev.map((item, i) =>
        i === idx ? { ...item, [campo]: parseFloat(val) || 0 } : item,
      ),
    )
  }

  function quitarItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const totalCalculado = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)

  function resetForm() {
    setF({ numero: '', proveedor_id: '', fecha_compra: ymd(new Date()), estado: 'pendiente', notas: '' })
    setItems([])
    setBusqProd('')
  }

  async function guardar() {
    if (items.length === 0) {
      toast.error('Agrega al menos un producto a la compra.')
      return
    }
    setGuardando(true)
    try {
      const prov = proveedores.find((p) => p.id === f.proveedor_id)
      await crear(
        {
          numero: f.numero.trim() || null,
          proveedor_id: f.proveedor_id || null,
          proveedor_nombre: prov?.nombre ?? null,
          fecha_compra: f.fecha_compra,
          estado: f.estado,
          notas: f.notas.trim() || null,
          total: parseFloat(totalCalculado.toFixed(2)),
        },
        items,
      )
      toast.exito('Compra registrada y stock actualizado')
      setFormOpen(false)
      resetForm()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar la compra')
    } finally {
      setGuardando(false)
    }
  }

  async function verDetalle(c: Compra) {
    setCompraVer(c)
    setDetalles([])
    setDetalleOpen(true)
    const d = await obtenerDetalles(c.id)
    setDetalles(d)
  }

  async function toggleEstado(c: Compra) {
    const nuevo: EstadoCompra = c.estado === 'pendiente' ? 'pagado' : 'pendiente'
    try {
      await cambiarEstado(c.id, nuevo)
      toast.exito(nuevo === 'pagado' ? 'Marcado como pagado' : 'Marcado como pendiente')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Compras</h1>
          <p className="text-sm text-ink-400">
            {compras.length} registro(s) ·{' '}
            <span className="font-semibold text-amber-600">
              Pendiente: {money(totalPendiente)}
            </span>
          </p>
        </div>
        <Button variant="primary" onClick={() => { resetForm(); setFormOpen(true) }}>
          <Plus className="size-[18px]" />
          <span className="hidden sm:inline">Nueva compra</span>
        </Button>
      </div>

      {/* Filtros de estado */}
      <div className="flex gap-2">
        {(['todos', 'pendiente', 'pagado'] as const).map((e) => (
          <button
            key={e}
            onClick={() => setFiltroEstado(e)}
            className={cx(
              'rounded-full px-3.5 py-1.5 text-sm font-semibold transition',
              filtroEstado === e
                ? 'bg-ink-900 text-white'
                : 'border border-ink-200 text-ink-500 hover:border-ink-300',
            )}
          >
            {e === 'todos' ? 'Todas' : e === 'pendiente' ? 'Pendientes' : 'Pagadas'}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-ink-100 px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400 lg:grid">
          <span>Compra</span>
          <span className="w-32">Fecha</span>
          <span className="w-28 text-right">Total</span>
          <span className="w-24 text-center">Estado</span>
          <span className="w-28 text-right">Acciones</span>
        </div>

        {cargando ? (
          <SkeletonList />
        ) : filtradas.length === 0 ? (
          <EmptyState filtro={filtroEstado} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {filtradas.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3.5 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-100">
                    <ShoppingBag className="size-[18px] text-ink-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {c.proveedor_nombre ?? 'Sin proveedor'}
                      {c.numero && (
                        <span className="ml-1.5 text-xs font-normal text-ink-400">#{c.numero}</span>
                      )}
                    </p>
                    <p className="text-xs text-ink-400">Registrado {fechaCorta(c.creado_en)}</p>
                  </div>
                </div>

                <span className="hidden w-32 text-sm text-ink-500 lg:block">
                  {fechaCorta(c.fecha_compra)}
                </span>
                <span className="tabular hidden w-28 text-right text-sm font-bold text-ink-900 lg:block">
                  {money(c.total)}
                </span>
                <div className="hidden w-24 justify-center lg:flex">
                  <EstadoBadge estado={c.estado} />
                </div>
                <div className="hidden w-28 items-center justify-end gap-1 lg:flex">
                  <button
                    onClick={() => verDetalle(c)}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-500 hover:bg-ink-100"
                  >
                    Ver
                  </button>
                  <button
                    onClick={() => toggleEstado(c)}
                    className={cx(
                      'rounded-lg px-2.5 py-1 text-xs font-semibold transition',
                      c.estado === 'pendiente'
                        ? 'bg-accent-50 text-accent-700 hover:bg-accent-100'
                        : 'bg-ink-100 text-ink-500 hover:bg-ink-200',
                    )}
                  >
                    {c.estado === 'pendiente' ? 'Pagar' : 'Reabrir'}
                  </button>
                </div>

                {/* Movil */}
                <div className="flex flex-col items-end gap-1 lg:hidden">
                  <span className="tabular text-sm font-bold text-ink-900">{money(c.total)}</span>
                  <EstadoBadge estado={c.estado} />
                  <div className="mt-1 flex gap-1.5">
                    <button
                      onClick={() => verDetalle(c)}
                      className="rounded-lg bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-600"
                    >
                      Ver
                    </button>
                    <button
                      onClick={() => toggleEstado(c)}
                      className="rounded-lg bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-700"
                    >
                      {c.estado === 'pendiente' ? 'Pagar' : 'Reabrir'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Sheet: nueva compra */}
      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Registrar compra"
        maxWidth="max-w-2xl"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="font-display text-lg font-bold text-ink-900">
              Total: {money(totalCalculado)}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button variant="secondary" loading={guardando} onClick={guardar}>
                Registrar compra
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Cabecera de la compra */}
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Proveedor" className="col-span-2">
              <select
                className="input"
                value={f.proveedor_id}
                onChange={(e) => setF((p) => ({ ...p, proveedor_id: e.target.value }))}
              >
                <option value="">Sin proveedor</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="N.° de factura / guía">
              <input
                className="input tabular"
                value={f.numero}
                onChange={(e) => setF((p) => ({ ...p, numero: e.target.value }))}
                placeholder="F001-00123"
              />
            </Campo>
            <Campo label="Fecha de compra">
              <input
                type="date"
                className="input"
                value={f.fecha_compra}
                onChange={(e) => setF((p) => ({ ...p, fecha_compra: e.target.value }))}
              />
            </Campo>
            <Campo label="Estado de pago">
              <select
                className="input"
                value={f.estado}
                onChange={(e) => setF((p) => ({ ...p, estado: e.target.value as EstadoCompra }))}
              >
                <option value="pendiente">Pendiente</option>
                <option value="pagado">Pagado</option>
              </select>
            </Campo>
            <Campo label="Notas">
              <input
                className="input"
                value={f.notas}
                onChange={(e) => setF((p) => ({ ...p, notas: e.target.value }))}
                placeholder="Opcional"
              />
            </Campo>
          </div>

          {/* Buscador de productos */}
          <div>
            <span className="label mb-1.5 block">Agregar productos</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
              <input
                className="input pl-9"
                value={busqProd}
                onChange={(e) => setBusqProd(e.target.value)}
                placeholder="Buscar producto del inventario..."
              />
            </div>
            {prodsFiltrados.length > 0 && (
              <ul className="mt-1.5 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
                {prodsFiltrados.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => agregarItem(p.nombre, p.id)}
                      className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-ink-50"
                    >
                      <span className="text-sm font-semibold text-ink-800">{p.nombre}</span>
                      <span className="tabular text-xs text-ink-400">{money(p.precio_compra)}</span>
                    </button>
                  </li>
                ))}
                {busqProd.trim() && (
                  <li className="border-t border-ink-100">
                    <button
                      onClick={agregarItemLibre}
                      className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left hover:bg-ink-50"
                    >
                      <Plus className="size-4 text-ink-400" />
                      <span className="text-sm text-ink-500">
                        Agregar "<b>{busqProd}</b>" sin vincular
                      </span>
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* Lista de items */}
          {items.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-ink-200">
              <div className="grid grid-cols-[1fr_80px_100px_32px] gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400">
                <span>Producto</span>
                <span className="text-center">Cant.</span>
                <span className="text-right">Precio unit.</span>
                <span />
              </div>
              <ul className="divide-y divide-ink-100">
                {items.map((item, idx) => (
                  <li
                    key={idx}
                    className="grid grid-cols-[1fr_80px_100px_32px] items-center gap-2 px-3 py-2"
                  >
                    <span className="truncate text-sm font-semibold text-ink-800">
                      {item.producto_nombre}
                    </span>
                    <input
                      type="number"
                      min={1}
                      className="input tabular py-1 text-center text-sm"
                      value={item.cantidad}
                      onChange={(e) => actualizarItem(idx, 'cantidad', e.target.value)}
                    />
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className="input tabular py-1 text-right text-sm"
                      value={item.precio_unitario}
                      onChange={(e) => actualizarItem(idx, 'precio_unitario', e.target.value)}
                    />
                    <button
                      onClick={() => quitarItem(idx)}
                      className="grid size-7 place-items-center rounded-md text-ink-300 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Sheet>

      {/* Sheet: ver detalle de compra */}
      <Sheet
        open={detalleOpen}
        onClose={() => setDetalleOpen(false)}
        title={
          compraVer
            ? `Compra ${compraVer.numero ? '#' + compraVer.numero : fechaCorta(compraVer.fecha_compra)}`
            : 'Detalle'
        }
        maxWidth="max-w-lg"
      >
        {compraVer && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-ink-50 p-4 text-sm">
              <InfoFila label="Proveedor" val={compraVer.proveedor_nombre ?? '—'} />
              <InfoFila label="Fecha" val={fechaCorta(compraVer.fecha_compra)} />
              <InfoFila label="Estado">
                <EstadoBadge estado={compraVer.estado} />
              </InfoFila>
              <InfoFila label="Total" val={money(compraVer.total)} bold />
              {compraVer.notas && (
                <InfoFila label="Notas" val={compraVer.notas} className="col-span-2" />
              )}
            </div>
            <div>
              <p className="label mb-2 block">Productos</p>
              {detalles.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-400">Cargando detalles...</p>
              ) : (
                <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200">
                  {detalles.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between px-3.5 py-2.5"
                    >
                      <div>
                        <p className="text-sm font-semibold text-ink-800">{d.producto_nombre}</p>
                        <p className="tabular text-xs text-ink-400">
                          {d.cantidad} × {money(d.precio_unitario)}
                        </p>
                      </div>
                      <span className="tabular text-sm font-bold text-ink-900">
                        {money(d.subtotal)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

function EstadoBadge({ estado }: { estado: EstadoCompra }) {
  return estado === 'pagado' ? (
    <Badge tone="success">
      <CheckCircle2 className="size-3" /> Pagado
    </Badge>
  ) : (
    <Badge tone="warning">
      <Clock className="size-3" /> Pendiente
    </Badge>
  )
}

function Campo({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cx('block', className)}>
      <span className="label mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

function InfoFila({
  label,
  val,
  bold,
  children,
  className,
}: {
  label: string
  val?: string
  bold?: boolean
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      {children ?? (
        <p className={cx('mt-0.5 text-sm text-ink-800', bold && 'font-bold')}>{val}</p>
      )}
    </div>
  )
}

function SkeletonList() {
  return (
    <ul className="divide-y divide-ink-100">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="size-9 animate-pulse rounded-xl bg-ink-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-52 animate-pulse rounded bg-ink-100" />
            <div className="h-3 w-32 animate-pulse rounded bg-ink-100" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function EmptyState({ filtro }: { filtro: string }) {
  return (
    <div className="grid place-items-center py-16 text-center">
      <ShoppingBag className="mb-3 size-8 text-ink-300" />
      <p className="text-sm font-medium text-ink-500">
        {filtro === 'todos' ? 'No hay compras registradas' : `No hay compras ${filtro}s`}
      </p>
    </div>
  )
}

// Icono decorativo para el sheet de detalle
function ChevronDown_unused() { return <ChevronDown /> }
void ChevronDown_unused
