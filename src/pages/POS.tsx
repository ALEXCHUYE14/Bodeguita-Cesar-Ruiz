import { useMemo, useState, useCallback, useEffect } from 'react'
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
import { useCarrito } from '@/hooks/useCarrito'
import { useClientes } from '@/hooks/useClientes'
import { useKeyboardScanner } from '@/hooks/useKeyboardScanner'
import { useAuth } from '@/context/AuthContext'
import { useCajaCtx } from '@/context/CajaContext'
import { useCarritoCtx } from '@/context/CarritoContext'
import { supabase } from '@/lib/supabase'
import { Button, Badge } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { CameraScanner } from '@/components/pos/CameraScanner'
import { PaymentModal, type PagoLeg } from '@/components/pos/PaymentModal'
import { Receipt } from '@/components/pos/Receipt'
import { money, cx, cantidad, etiquetaUnidad } from '@/utils/format'
import { BRAND } from '@/config/brand'
import { beepExito, beepError } from '@/utils/beep'
import { resolverPresentacion, presentacionesDisponibles, maxCantidadPresentacion } from '@/utils/presentaciones'
import type { ItemCarrito, ModalidadVenta, Producto, Venta } from '@/types/database'

export function POS() {
  const { productos, categorias, cargando } = useProductos()
  const { clientes, crear: crearCliente } = useClientes()
  const { perfil } = useAuth()
  const nombreDisplay = perfil?.rol === 'administrador' ? BRAND.operador : (perfil?.nombre?.split(' ')[0] ?? 'Cajero')
  const { caja, cargando: cajaCargando, abrir: abrirCaja, reflejarVentaLocal, recargar: recargarCaja } = useCajaCtx()
  const toast = useToast()
  // Vive en un Provider en la raiz de la app (ver App.tsx / CarritoContext),
  // no como estado local de esta pagina: asi el carrito sobrevive si el
  // cajero navega a otra pantalla (Inventario, Clientes...) y vuelve a POS.
  const carrito = useCarritoCtx()

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
  const [granelSel, setGranelSel] = useState<Producto | null>(null)
  const [cantGranel, setCantGranel] = useState('1')
  // Selector de presentacion — se abre cuando un producto tiene 2 o mas
  // formas de venderse (ej. Caja + una presentacion flexible, o varios
  // niveles de empaque) y una tarjeta con 2 botones ya no alcanza.
  const [presentacionSel, setPresentacionSel] = useState<Producto | null>(null)

  // Nadie puede vender sin caja abierta (antes el admin quedaba exento, lo
  // que permitia registrar ventas con caja_id null: no aparecian en ningun
  // cuadre/cierre de caja).
  const necesitaCaja = !cajaCargando && !caja

  // El carrito se restaura de localStorage al instante (ver useCarrito.ts),
  // con los productos tal como estaban guardados — puede estar desactualizado
  // si paso tiempo entre la caida/recarga y volver a abrir la app. En cuanto
  // el catalogo real termina de cargar (o cambia por realtime), se refresca
  // cada item contra el; lo que ya no existe/no tiene stock se quita solo.
  useEffect(() => {
    if (productos.length === 0) return
    const { eliminados, reducidos } = carrito.reconciliar(productos)
    if (eliminados.length > 0) {
      toast.error(`Se quitaron del carrito (ya no disponibles): ${eliminados.join(', ')}`)
    }
    if (reducidos.length > 0) {
      toast.error(`Se ajusto la cantidad en el carrito (stock insuficiente): ${reducidos.join(', ')}`)
    }
    // Solo cuando cambia el catalogo (carga inicial o realtime) — no en cada
    // cambio del carrito, para no recalcular en cada click del cajero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos])

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

  // --- Productos a granel: piden la cantidad exacta (admite decimales) ---
  function abrirGranel(p: Producto) {
    setGranelSel(p)
    setCantGranel('1')
  }

  function confirmarGranel() {
    if (!granelSel) return
    const c = parseFloat(cantGranel) || 0
    if (c <= 0) {
      toast.error('Ingresa una cantidad valida.')
      return
    }
    if (c > granelSel.stock_actual) {
      toast.error(`Stock insuficiente: disponible ${cantidad(granelSel.stock_actual)} ${granelSel.unidad}`)
      return
    }
    carrito.agregar(granelSel, 'unidad', c)
    toast.exito(`+ ${cantidad(c)} ${granelSel.unidad} de ${granelSel.nombre}`)
    setGranelSel(null)
  }

  // --- Productos con 2+ presentaciones: eligen en una hoja en vez de
  // amontonar botones en la tarjeta ---
  function elegirPresentacion(p: Producto, modalidad: ModalidadVenta) {
    if (modalidad === 'unidad' && p.tipo_venta === 'granel') {
      setPresentacionSel(null)
      abrirGranel(p)
      return
    }
    carrito.agregar(p, modalidad)
    const opcion = presentacionesDisponibles(p).find((o) => o.modalidad === modalidad)
    toast.exito(`+ ${opcion?.etiqueta ?? 'Unidad'} de ${p.nombre}`)
    setPresentacionSel(null)
  }

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
      const { ventasAdoptadas, cobrosAdoptados } = await abrirCaja(parseFloat(montoInicial) || 0)
      const partes: string[] = []
      if (ventasAdoptadas > 0) partes.push(`${ventasAdoptadas} venta(s)`)
      if (cobrosAdoptados > 0) partes.push(`${cobrosAdoptados} cobro(s) de deuda`)
      toast.exito(
        partes.length > 0
          ? `Caja abierta. Se vincularon ${partes.join(' y ')} de hoy registrados sin caja abierta.`
          : 'Caja abierta. Ya puedes vender.',
      )
      setAbrirCajaOpen(false)
      setMontoInicial('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al abrir la caja')
    } finally {
      setAbriendoCaja(false)
    }
  }

  async function cobrar(pagos: PagoLeg[], clienteId?: string) {
    // Defensa adicional: si por cualquier motivo se llega aqui sin caja
    // abierta (p.ej. se cerro en otra pestaña mientras se armaba el carrito),
    // no se registra la venta sin caja.
    if (!caja) {
      toast.error('Debes abrir la caja antes de registrar ventas.')
      return
    }
    setProcesando(true)
    try {
      const items = carrito.items.map((i) => ({
        producto_id: i.producto.id,
        cantidad: i.cantidad,
        precio_unitario: precioItem(i),
        // El RPC calcula las unidades reales de stock a descontar en el
        // servidor a partir de la modalidad + unidades_por_caja/kg_por_saco
        // del producto (no confia en un total pre-calculado enviado por el cliente).
        modalidad: i.modalidad,
      }))
      // Un solo metodo o pago mixto (2+ filas) se mandan igual, como un
      // arreglo de "piernas" de pago — el RPC valida que cubran el total y
      // decide si la venta queda como un metodo unico o "mixto".
      const { data, error } = await supabase.rpc('registrar_venta', {
        p_items: items,
        p_descuento: carrito.descuento,
        p_caja_id: caja?.id ?? null,
        p_cliente_id: clienteId ?? null,
        p_pagos: pagos,
      })
      if (error) throw error

      // El propio RPC registrar_venta ya sumo el total a la caja y (si es
      // fiado) a la deuda del cliente, de forma atomica junto con la venta.
      // Con un solo metodo se refleja en el estado local al instante (sin
      // esperar un recargo completo); con pago mixto es mas simple traer los
      // totales reales de la BD que replicar en el cliente como el servidor
      // reparte el vuelto entre las piernas.
      if (caja?.id) {
        if (pagos.length <= 1) {
          reflejarVentaLocal(caja.id, (pagos[0]?.metodo ?? 'efectivo'), carrito.totales.total)
        } else {
          recargarCaja()
        }
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
                onGranel={() => abrirGranel(p)}
                onElegir={() => setPresentacionSel(p)}
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

      {/* Escaner camara — con la lista de productos escaneados en vivo debajo
          (reutiliza CartItems: mismo estado de carrito, mismos controles de
          cantidad/eliminar y mismo calculo de precio que el resto del POS). */}
      <Sheet
        open={camAbierta}
        onClose={() => setCamAbierta(false)}
        title="Escanear producto"
        maxWidth="max-w-md"
        footer={
          !carrito.vacio ? (
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={() => {
                setCamAbierta(false)
                setPagoAbierto(true)
              }}
            >
              Revisar orden · {money(carrito.totales.total)}
            </Button>
          ) : undefined
        }
      >
        <CameraScanner activo={camAbierta} onScan={onScan} />
        <p className="mt-3 text-center text-xs text-ink-400">
          Apunta al codigo de barras o QR del producto.
        </p>

        {!carrito.vacio && (
          <div className="mt-4 border-t border-ink-100 pt-3">
            <div className="mb-1 flex items-center justify-between px-1">
              <h3 className="text-sm font-bold text-ink-900">
                {carrito.totales.unidades} producto{carrito.totales.unidades === 1 ? '' : 's'}
              </h3>
              <button
                onClick={carrito.limpiar}
                className="text-xs font-semibold text-ink-400 hover:text-red-600"
              >
                Vaciar
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <CartItems carrito={carrito} />
            </div>
          </div>
        )}
      </Sheet>

      {/* Cantidad exacta para productos a granel (kg, litros, etc.) */}
      <Sheet
        open={!!granelSel}
        onClose={() => setGranelSel(null)}
        title={granelSel ? granelSel.nombre : 'Cantidad'}
        maxWidth="max-w-sm"
        footer={
          <Button variant="secondary" size="lg" className="w-full" onClick={confirmarGranel}>
            Agregar al carrito
          </Button>
        }
      >
        {granelSel && (
          <div className="space-y-4">
            <p className="text-sm text-ink-500">
              Disponible: <b className="text-ink-800">{cantidad(granelSel.stock_actual)} {granelSel.unidad}</b>
              {' · '}
              {money(granelSel.precio_venta)} / {granelSel.unidad}
            </p>
            <label className="block">
              <span className="label mb-1.5 block">Cantidad en {granelSel.unidad}</span>
              <input
                type="number"
                inputMode="decimal"
                step={0.001}
                min={0}
                autoFocus
                className="input tabular text-xl"
                value={cantGranel}
                onChange={(e) => setCantGranel(e.target.value)}
                placeholder="0.000"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {[0.25, 0.5, 1, 2, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setCantGranel(String(v))}
                  className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-200"
                >
                  {v} {granelSel.unidad}
                </button>
              ))}
            </div>
            {(parseFloat(cantGranel) || 0) > 0 && (
              <div className="flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3 text-white">
                <span className="text-sm text-white/60">Subtotal</span>
                <span className="tabular font-display text-lg font-bold">
                  {money((parseFloat(cantGranel) || 0) * granelSel.precio_venta)}
                </span>
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* Elegir presentacion — cuando un producto tiene 2 o mas formas de
          venderse (Caja + presentaciones flexibles, varios niveles de
          empaque, etc.) */}
      <Sheet
        open={!!presentacionSel}
        onClose={() => setPresentacionSel(null)}
        title={presentacionSel ? presentacionSel.nombre : 'Elegir presentación'}
        maxWidth="max-w-sm"
      >
        {presentacionSel && (
          <ul className="divide-y divide-ink-100">
            {presentacionSel.tipo_venta === 'granel' && (
              <PresentacionFila
                etiqueta={`A granel (${presentacionSel.unidad})`}
                subtexto={`${money(presentacionSel.precio_venta)} / ${presentacionSel.unidad} · disponible ${cantidad(presentacionSel.stock_actual)} ${presentacionSel.unidad}`}
                onClick={() => elegirPresentacion(presentacionSel, 'unidad')}
              />
            )}
            {presentacionSel.tipo_venta !== 'granel' && (
              <PresentacionFila
                etiqueta="Unidad"
                subtexto={`${money(presentacionSel.precio_venta)} · disponible ${cantidad(presentacionSel.stock_actual)}`}
                disabled={presentacionSel.stock_actual <= 0}
                onClick={() => elegirPresentacion(presentacionSel, 'unidad')}
              />
            )}
            {presentacionesDisponibles(presentacionSel).map((o) => (
              <PresentacionFila
                key={o.modalidad}
                etiqueta={o.etiqueta}
                subtexto={`${money(o.precioVenta)} · disponible ${o.disponible}`}
                disabled={o.disponible <= 0}
                onClick={() => elegirPresentacion(presentacionSel, o.modalidad)}
              />
            ))}
          </ul>
        )}
      </Sheet>

      <PaymentModal
        open={pagoAbierto}
        onClose={() => setPagoAbierto(false)}
        total={carrito.totales.total}
        procesando={procesando}
        clientes={clientes}
        onConfirmar={cobrar}
        onCrearCliente={crearCliente}
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

function PresentacionFila({
  etiqueta,
  subtexto,
  disabled,
  onClick,
}: {
  etiqueta: string
  subtexto: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        disabled={disabled}
        className="flex w-full items-center justify-between px-1 py-3 text-left transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="text-sm font-semibold text-ink-800">{etiqueta}</span>
        <span className="tabular text-xs text-ink-400">{subtexto}</span>
      </button>
    </li>
  )
}

function ProductoCard({
  producto,
  onAgregar,
  onGranel,
  onElegir,
}: {
  producto: Producto
  onAgregar: (modalidad: ModalidadVenta) => void
  onGranel: () => void
  onElegir: () => void
}) {
  const agotado = producto.stock_actual <= 0
  const bajo = producto.stock_actual > 0 && producto.stock_actual <= producto.stock_minimo
  const esGranel = producto.tipo_venta === 'granel'
  const opciones = presentacionesDisponibles(producto)
  const etiqStock = `${cantidad(producto.stock_actual)} ${etiquetaUnidad(producto)}`

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
          <Badge tone="warning">{etiqStock}</Badge>
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
          {esGranel && <span className="text-xs font-medium text-ink-400">/{producto.unidad}</span>}
        </p>
        {!agotado && !bajo && (
          <span className="text-[0.65rem] font-medium text-ink-300">{etiqStock}</span>
        )}
      </div>
    </div>
  )

  // 2 o mas formas de venderlo ademas de la base (Caja + una presentacion
  // flexible, varios niveles de empaque...): una tarjeta con 2 botones ya no
  // alcanza, se elige en una hoja aparte.
  if (opciones.length > 1) {
    return (
      <div
        className={cx(
          'group flex flex-col overflow-hidden rounded-xl border border-ink-100 bg-white text-left transition',
          agotado && 'opacity-50',
        )}
      >
        {imgSection}
        {infoSection}
        <div className="border-t border-ink-100 p-1.5">
          <button
            onClick={onElegir}
            disabled={agotado}
            className="w-full rounded-lg bg-accent-100 py-1.5 text-xs font-semibold text-accent-700 transition hover:bg-accent-200 disabled:opacity-40"
          >
            Elegir presentación ({opciones.length + 1})
          </button>
        </div>
      </div>
    )
  }

  if (esGranel && opciones.length === 1) {
    const o = opciones[0]
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
            onClick={onGranel}
            disabled={agotado}
            className="flex-1 rounded-lg bg-ink-100 py-1.5 text-xs font-semibold text-ink-700 transition hover:bg-ink-200 disabled:opacity-40"
          >
            {producto.unidad}
          </button>
          <button
            onClick={() => onAgregar(o.modalidad)}
            disabled={agotado || o.disponible <= 0}
            className="flex-1 rounded-lg bg-accent-100 py-1.5 text-xs font-semibold text-accent-700 transition hover:bg-accent-200 disabled:opacity-40"
          >
            {o.etiqueta}{o.disponible > 0 ? ` (${o.disponible})` : ''}
          </button>
        </div>
      </div>
    )
  }

  if (esGranel) {
    return (
      <button
        onClick={onGranel}
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

  if (opciones.length === 1) {
    const o = opciones[0]
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
            onClick={() => onAgregar(o.modalidad)}
            disabled={agotado || o.disponible <= 0}
            className="flex-1 rounded-lg bg-accent-100 py-1.5 text-xs font-semibold text-accent-700 transition hover:bg-accent-200 disabled:opacity-40"
          >
            {o.etiqueta}{o.disponible > 0 ? ` (${o.disponible})` : ''}
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
  return resolverPresentacion(item.producto, item.modalidad).precioVenta
}

function maxDisp(item: ItemCarrito): number {
  return maxCantidadPresentacion(item.producto, item.modalidad)
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
        const etiquetaPresentacion = resolverPresentacion(i.producto, i.modalidad).etiqueta
        // Solo se pide cantidad fraccionada (kg) cuando es granel vendido
        // "suelto" (modalidad 'unidad'); por saco es una cantidad entera.
        const esKgFraccionado = i.producto.tipo_venta === 'granel' && i.modalidad === 'unidad'
        return (
          <li
            key={`${i.producto.id}::${i.modalidad}`}
            className="flex items-center gap-2 rounded-xl p-2 hover:bg-ink-50"
          >
            {/* Thumbnail — mismo patron de fallback que Inventario.tsx/ProductoCard */}
            <div className="size-10 shrink-0 overflow-hidden rounded-lg border border-ink-100 bg-ink-50">
              {i.producto.image_url ? (
                <img
                  src={i.producto.image_url}
                  alt={i.producto.nombre}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: i.producto.categorias?.color ?? '#d4d4d0' }}
                  />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-800">{i.producto.nombre}</p>
              <p className="tabular text-xs text-ink-400">
                {etiquetaPresentacion && (
                  <span className="mr-1 rounded bg-accent-100 px-1 py-0.5 text-[0.6rem] font-bold uppercase text-accent-700">
                    {etiquetaPresentacion}
                  </span>
                )}
                {money(precio)} c/{etiquetaPresentacion ?? (esKgFraccionado ? i.producto.unidad : 'u')}
              </p>
            </div>
            {esKgFraccionado ? (
              <CantidadGranelInput item={i} cambiarCantidad={carrito.cambiarCantidad} />
            ) : (
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
            )}
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

// Input de cantidad para productos a granel: mantiene su propio texto mientras
// se escribe (para no borrar el item del carrito al pasar por "0" al tipear,
// ej. "0.75") y solo confirma la cantidad final al perder el foco / Enter.
function CantidadGranelInput({
  item,
  cambiarCantidad,
}: {
  item: ItemCarrito
  cambiarCantidad: CarritoCtx['cambiarCantidad']
}) {
  const [valor, setValor] = useState(String(item.cantidad))

  useEffect(() => {
    setValor(String(item.cantidad))
  }, [item.cantidad])

  function confirmar() {
    cambiarCantidad(item.producto.id, item.modalidad, parseFloat(valor) || 0)
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      step={0.001}
      min={0}
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="input tabular w-20 py-1 text-center text-sm"
    />
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
