import { useMemo, useState, useCallback } from 'react'
import {
  Search,
  ScanLine,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  X,
  Camera,
  Tag,
  LockOpen,
} from 'lucide-react'
import { useProductos } from '@/hooks/useProductos'
import { useCarrito, unidadesReales } from '@/hooks/useCarrito'
import { useClientes } from '@/hooks/useClientes'
import { useKeyboardScanner } from '@/hooks/useKeyboardScanner'
import { useAuth } from '@/context/AuthContext'
import { useCajaCtx } from '@/context/CajaContext'
import { supabase } from '@/lib/supabase'
import { Button, Badge } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { CameraScanner } from '@/components/pos/CameraScanner'
import { PaymentModal } from '@/components/pos/PaymentModal'
import { Receipt } from '@/components/pos/Receipt'
import { money, cx } from '@/utils/format'
import { BRAND } from '@/config/brand'
import { beepExito, beepError } from '@/utils/beep'
import type { ItemCarrito, MetodoPago, ModalidadVenta, Producto, Venta } from '@/types/database'

export function POS() {
  const { productos, categorias, cargando } = useProductos()
  const { clientes } = useClientes()
  const { perfil, esAdmin } = useAuth()
  const nombreDisplay = perfil?.rol === 'administrador' ? BRAND.operador : (perfil?.nombre?.split(' ')[0] ?? 'Cajero')
  const { caja, cargando: cajaCargando, abrir: abrirCaja, sumarVenta } = useCajaCtx()
  const toast = useToast()
  const carrito = useCarrito()

  const [busqueda, setBusqueda] = useState('')
  const [catSel, setCatSel] = useState<string | null>(null)
  const [camAbierta, setCamAbierta] = useState(false)
  const [carritoMovil, setCarritoMovil] = useState(false)
  const [pagoAbierto, setPagoAbierto] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [ventaHecha, setVentaHecha] = useState<Venta | null>(null)
  const [itemsTicket, setItemsTicket] = useState<ItemCarrito[]>([])
  const [abrirCajaOpen, setAbrirCajaOpen] = useState(false)
  const [montoInicial, setMontoInicial] = useState('')
  const [abriendoCaja, setAbriendoCaja] = useState(false)

  // Cajero sin caja abierta debe abrir una antes de vender
  const necesitaCaja = !esAdmin && !cajaCargando && !caja

  // --- Manejo de escaneo (camara o lector fisico) ---
  const onScan = useCallback(
    (codigo: string) => {
      const prod = productos.find((p) => p.sku === codigo.trim())
      if (!prod) {
        beepError()
        toast.error(`Código no encontrado: ${codigo}`)
        return
      }
      if (prod.stock_actual <= 0) {
        beepError()
        toast.error(`Sin stock: ${prod.nombre}`)
        return
      }
      beepExito()
      carrito.agregar(prod, 'unidad')
      toast.exito(`+ ${prod.nombre}`)
    },
    [productos, carrito, toast],
  )

  // Lector fisico siempre activo (emulacion teclado) en desktop
  useKeyboardScanner(onScan)

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return productos.filter((p) => {
      const matchCat = !catSel || p.categoria_id === catSel
      const matchQ =
        !q || p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      return matchCat && matchQ
    })
  }, [productos, busqueda, catSel])

  async function confirmarAbrirCaja() {
    setAbriendoCaja(true)
    try {
      await abrirCaja(parseFloat(montoInicial) || 0)
      toast.exito('Caja abierta. Ya puedes vender.')
      setAbrirCajaOpen(false)
      setMontoInicial('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al abrir la caja')
    } finally {
      setAbriendoCaja(false)
    }
  }

  async function cobrar(metodo: MetodoPago, pagoRecibido: number, clienteId?: string) {
    setProcesando(true)
    try {
      const items = carrito.items.map((i) => ({
        producto_id: i.producto.id,
        cantidad: i.cantidad,
        precio_unitario:
          i.modalidad === 'caja'
            ? (i.producto.precio_venta_caja ?? i.producto.precio_venta)
            : i.producto.precio_venta,
        unidades_a_descontar: unidadesReales(i),
      }))
      const { data, error } = await supabase.rpc('registrar_venta', {
        p_items: items,
        p_metodo: metodo,
        p_descuento: carrito.descuento,
        p_pago_recibido: pagoRecibido,
        p_caja_id: caja?.id ?? null,
        p_cliente_id: clienteId ?? null,
      })
      if (error) throw error

      // Actualizar totales de la caja
      if (caja?.id) {
        await sumarVenta(caja.id, metodo, carrito.totales.total)
      }

      // Actualizar deuda del cliente si la venta es al fiado
      if (metodo === 'fiado' && clienteId) {
        await supabase.rpc('registrar_cargo_fiado', {
          p_cliente_id: clienteId,
          p_monto: carrito.totales.total,
        })
      }

      setItemsTicket(carrito.items)
      setVentaHecha(data as unknown as Venta)
      carrito.limpiar()
      setPagoAbierto(false)
      setCarritoMovil(false)
      toast.exito('Venta registrada correctamente')
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'No se pudo registrar la venta'
      toast.error(msg)
    } finally {
      setProcesando(false)
    }
  }

  // Banner de caja cerrada — bloquea ventas para cajero
  if (necesitaCaja) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 grid size-16 place-items-center rounded-2xl bg-amber-100">
          <LockOpen className="size-8 text-amber-600" />
        </div>
        <h2 className="font-display text-xl font-bold text-ink-900">Caja cerrada</h2>
        <p className="mt-1 max-w-xs text-sm text-ink-400">
          Debes abrir la caja con el monto inicial antes de registrar ventas.
        </p>
        <Button className="mt-6" variant="primary" onClick={() => setAbrirCajaOpen(true)}>
          <LockOpen className="size-4" /> Abrir caja ahora
        </Button>

        <Sheet
          open={abrirCajaOpen}
          onClose={() => setAbrirCajaOpen(false)}
          title="Abrir caja"
          maxWidth="max-w-sm"
          footer={
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              loading={abriendoCaja}
              onClick={confirmarAbrirCaja}
            >
              <LockOpen className="size-5" /> Confirmar apertura
            </Button>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Ingresa el efectivo con el que inicias el turno (fondo de caja).
            </p>
            <label className="block">
              <span className="label mb-1.5 block">Monto inicial en caja (S/)</span>
              <input
                type="number"
                min={0}
                step={0.01}
                className="input tabular text-xl"
                value={montoInicial}
                onChange={(e) => setMontoInicial(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {[0, 50, 100, 150, 200].map((v) => (
                <button
                  key={v}
                  onClick={() => setMontoInicial(String(v))}
                  className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-200"
                >
                  {v === 0 ? 'Sin fondo' : `S/ ${v}`}
                </button>
              ))}
            </div>
          </div>
        </Sheet>
      </div>
    )
  }

  return (
    <div className="lg:grid lg:grid-cols-[1fr_22rem] lg:gap-6">
      {/* ---------------- Catalogo ---------------- */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink-900">Punto de venta</h1>
            <p className="text-sm text-ink-400">
              Hola, {nombreDisplay} · escanea o busca
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden"
            onClick={() => setCamAbierta(true)}
          >
            <Camera className="size-4" /> Escanear
          </Button>
        </div>

        {/* Buscador + scan desktop */}
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-ink-300" />
            <input
              data-scanner="true"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto o SKU..."
              className="input pl-10"
            />
          </div>
          <Button
            variant="outline"
            className="hidden lg:inline-flex"
            onClick={() => setCamAbierta(true)}
          >
            <ScanLine className="size-[18px]" /> Camara
          </Button>
        </div>

        {/* Filtro de categorias */}
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
          <Chip activo={!catSel} onClick={() => setCatSel(null)}>
            Todo
          </Chip>
          {categorias.map((c) => (
            <Chip key={c.id} activo={catSel === c.id} onClick={() => setCatSel(c.id)}>
              {c.nombre}
            </Chip>
          ))}
        </div>

        {/* Grilla de productos */}
        {cargando ? (
          <GridSkeleton />
        ) : filtrados.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-ink-200 py-16 text-center">
            <Tag className="mb-2 size-7 text-ink-300" />
            <p className="text-sm font-medium text-ink-500">Sin resultados</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {filtrados.map((p) => (
              <ProductoCard
                key={p.id}
                producto={p}
                onAgregar={(modalidad) => carrito.agregar(p, modalidad)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ---------------- Carrito desktop ---------------- */}
      <aside className="hidden lg:block">
        <div className="sticky top-8">
          <CartPanel carrito={carrito} onCobrar={() => setPagoAbierto(true)} />
        </div>
      </aside>

      {/* ---------------- FAB carrito (movil) ---------------- */}
      {!carrito.vacio && (
        <button
          onClick={() => setCarritoMovil(true)}
          className="fixed bottom-20 right-4 z-30 flex items-center gap-2.5 rounded-full bg-ink-900 px-5 py-3.5 text-white shadow-pop animate-scale-in lg:hidden"
        >
          <ShoppingCart className="size-5" />
          <span className="font-display font-bold">{money(carrito.totales.total)}</span>
          <span className="grid size-6 place-items-center rounded-full bg-accent-500 text-xs font-bold">
            {carrito.totales.unidades}
          </span>
        </button>
      )}

      {/* Carrito movil como bottom sheet */}
      <Sheet
        open={carritoMovil}
        onClose={() => setCarritoMovil(false)}
        title="Carrito"
        maxWidth="max-w-md"
        footer={
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={carrito.vacio}
            onClick={() => {
              setCarritoMovil(false)
              setPagoAbierto(true)
            }}
          >
            Cobrar · {money(carrito.totales.total)}
          </Button>
        }
      >
        <CartItems carrito={carrito} />
      </Sheet>

      {/* Escaner camara */}
      <Sheet open={camAbierta} onClose={() => setCamAbierta(false)} title="Escanear producto" maxWidth="max-w-md">
        <CameraScanner activo={camAbierta} onScan={onScan} />
        <p className="mt-3 text-center text-xs text-ink-400">
          Apunta al codigo de barras o QR del producto.
        </p>
      </Sheet>

      <PaymentModal
        open={pagoAbierto}
        onClose={() => setPagoAbierto(false)}
        total={carrito.totales.total}
        procesando={procesando}
        clientes={clientes}
        onConfirmar={cobrar}
      />

      {ventaHecha && (
        <Receipt
          open
          onClose={() => setVentaHecha(null)}
          venta={ventaHecha}
          items={itemsTicket}
        />
      )}
    </div>
  )
}

/* ----------------------- Subcomponentes ----------------------- */

function Chip({
  children,
  activo,
  onClick,
}: {
  children: React.ReactNode
  activo: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition focusable',
        activo ? 'bg-ink-900 text-white' : 'bg-white text-ink-500 border border-ink-200 hover:border-ink-300',
      )}
    >
      {children}
    </button>
  )
}

function ProductoCard({
  producto,
  onAgregar,
}: {
  producto: Producto
  onAgregar: (modalidad: ModalidadVenta) => void
}) {
  const agotado = producto.stock_actual <= 0
  const bajo = producto.stock_actual > 0 && producto.stock_actual <= producto.stock_minimo
  const cajaDisp = producto.tiene_caja
    ? Math.floor(producto.stock_actual / (producto.unidades_por_caja ?? 1))
    : 0

  const imgSection = (
    <div className="relative aspect-square w-full overflow-hidden bg-ink-50">
      {producto.image_url ? (
        <img
          src={producto.image_url}
          alt={producto.nombre}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition group-hover:scale-[1.03]"
        />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <span
            className="size-5 rounded-full opacity-60"
            style={{ background: producto.categorias?.color ?? '#d4d4d0' }}
          />
        </div>
      )}
      <div className="absolute bottom-1.5 right-1.5">
        {agotado ? (
          <Badge tone="danger">Agotado</Badge>
        ) : bajo ? (
          <Badge tone="warning">{producto.stock_actual} u.</Badge>
        ) : null}
      </div>
    </div>
  )

  const infoSection = (
    <div className="p-2.5">
      <p className="line-clamp-2 text-xs font-semibold leading-snug text-ink-800">
        {producto.nombre}
      </p>
      <div className="mt-1 flex items-center justify-between gap-1">
        <p className="tabular font-display text-base font-bold text-ink-900">
          {money(producto.precio_venta)}
        </p>
        {!agotado && !bajo && (
          <span className="text-[0.65rem] font-medium text-ink-300">
            {producto.stock_actual} u.
          </span>
        )}
      </div>
    </div>
  )

  if (producto.tiene_caja) {
    return (
      <div
        className={cx(
          'group flex flex-col overflow-hidden rounded-xl border border-ink-100 bg-white text-left transition',
          agotado && 'opacity-50',
        )}
      >
        {imgSection}
        {infoSection}
        <div className="flex gap-1 border-t border-ink-100 p-1.5">
          <button
            onClick={() => onAgregar('unidad')}
            disabled={agotado}
            className="flex-1 rounded-lg bg-ink-100 py-1.5 text-xs font-semibold text-ink-700 transition hover:bg-ink-200 disabled:opacity-40"
          >
            Unidad
          </button>
          <button
            onClick={() => onAgregar('caja')}
            disabled={agotado || cajaDisp <= 0}
            className="flex-1 rounded-lg bg-accent-100 py-1.5 text-xs font-semibold text-accent-700 transition hover:bg-accent-200 disabled:opacity-40"
          >
            Caja{cajaDisp > 0 ? ` (${cajaDisp})` : ''}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => onAgregar('unidad')}
      disabled={agotado}
      className={cx(
        'group flex flex-col overflow-hidden rounded-xl border border-ink-100 bg-white text-left transition focusable',
        'hover:border-ink-300 hover:shadow-card active:scale-[0.98]',
        agotado && 'cursor-not-allowed opacity-50',
      )}
    >
      {imgSection}
      {infoSection}
    </button>
  )
}

type CarritoCtx = ReturnType<typeof useCarrito>

function CartPanel({ carrito, onCobrar }: { carrito: CarritoCtx; onCobrar: () => void }) {
  return (
    <div className="card flex max-h-[calc(100vh-5rem)] flex-col">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-ink-100">
        <h2 className="font-display font-bold text-ink-900">Carrito</h2>
        {!carrito.vacio && (
          <button
            onClick={carrito.limpiar}
            className="text-xs font-semibold text-ink-400 hover:text-red-600"
          >
            Vaciar
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <CartItems carrito={carrito} />
      </div>
      <div className="border-t border-ink-100 px-4 py-3">
        <Totales carrito={carrito} />
        <Button
          variant="secondary"
          size="lg"
          className="mt-3 w-full"
          disabled={carrito.vacio}
          onClick={onCobrar}
        >
          Cobrar · {money(carrito.totales.total)}
        </Button>
      </div>
    </div>
  )
}

function precioItem(item: ItemCarrito): number {
  return item.modalidad === 'caja'
    ? (item.producto.precio_venta_caja ?? item.producto.precio_venta)
    : item.producto.precio_venta
}

function maxDisp(item: ItemCarrito): number {
  return item.modalidad === 'caja'
    ? Math.floor(item.producto.stock_actual / (item.producto.unidades_por_caja ?? 1))
    : item.producto.stock_actual
}

function CartItems({ carrito }: { carrito: CarritoCtx }) {
  if (carrito.vacio) {
    return (
      <div className="grid place-items-center px-4 py-12 text-center text-ink-300">
        <ShoppingCart className="mb-2 size-8" />
        <p className="text-sm font-medium">El carrito esta vacio</p>
        <p className="text-xs">Escanea o toca un producto</p>
      </div>
    )
  }
  return (
    <ul className="space-y-1">
      {carrito.items.map((i) => {
        const precio = precioItem(i)
        const max = maxDisp(i)
        const esCaja = i.modalidad === 'caja'
        return (
          <li
            key={`${i.producto.id}::${i.modalidad}`}
            className="flex items-center gap-2 rounded-xl p-2 hover:bg-ink-50"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-800">{i.producto.nombre}</p>
              <p className="tabular text-xs text-ink-400">
                {esCaja && (
                  <span className="mr-1 rounded bg-accent-100 px-1 py-0.5 text-[0.6rem] font-bold uppercase text-accent-700">
                    Caja
                  </span>
                )}
                {money(precio)} c/{esCaja ? 'caja' : 'u'}
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-ink-100 p-0.5">
              <button
                onClick={() => carrito.cambiarCantidad(i.producto.id, i.modalidad, i.cantidad - 1)}
                className="grid size-7 place-items-center rounded-md text-ink-600 hover:bg-white"
              >
                <Minus className="size-3.5" />
              </button>
              <span className="tabular w-6 text-center text-sm font-bold">{i.cantidad}</span>
              <button
                onClick={() => carrito.cambiarCantidad(i.producto.id, i.modalidad, i.cantidad + 1)}
                disabled={i.cantidad >= max}
                className="grid size-7 place-items-center rounded-md text-ink-600 hover:bg-white disabled:opacity-30"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <p className="tabular w-16 shrink-0 text-right text-sm font-bold text-ink-900">
              {money(precio * i.cantidad)}
            </p>
            <button
              onClick={() => carrito.quitar(i.producto.id, i.modalidad)}
              className="grid size-7 place-items-center rounded-md text-ink-300 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Totales({ carrito }: { carrito: CarritoCtx }) {
  const { totales } = carrito
  const [editar, setEditar] = useState(false)
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex justify-between text-ink-500">
        <span>Subtotal</span>
        <span className="tabular">{money(totales.subtotal)}</span>
      </div>
      <div className="flex items-center justify-between text-ink-500">
        <button onClick={() => setEditar((v) => !v)} className="flex items-center gap-1 hover:text-ink-800">
          Descuento {editar ? <X className="size-3" /> : <Plus className="size-3" />}
        </button>
        {editar ? (
          <input
            type="number"
            autoFocus
            value={carrito.descuento || ''}
            onChange={(e) => carrito.setDescuento(parseFloat(e.target.value) || 0)}
            className="tabular w-20 rounded-md border border-ink-200 px-2 py-0.5 text-right text-sm"
            placeholder="0.00"
          />
        ) : (
          <span className="tabular">- {money(totales.descuento)}</span>
        )}
      </div>
      <div className="flex justify-between text-ink-400 text-xs">
        <span>IGV incluido (18%)</span>
        <span className="tabular">{money(totales.igv)}</span>
      </div>
      <div className="flex justify-between border-t border-ink-100 pt-2 font-display text-lg font-bold text-ink-900">
        <span>Total</span>
        <span className="tabular">{money(totales.total)}</span>
      </div>
    </div>
  )
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-xl border border-ink-100 bg-white">
          <div className="aspect-square w-full bg-ink-100/70" />
          <div className="p-2.5 space-y-1.5">
            <div className="h-3 w-3/4 rounded bg-ink-100" />
            <div className="h-4 w-1/2 rounded bg-ink-100" />
          </div>
        </div>
      ))}
    </div>
  )
}
