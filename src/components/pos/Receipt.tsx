import { useState } from 'react'
import { Printer, Check, MessageCircle, Bluetooth } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { money, fechaHora, cantidad } from '@/utils/format'
import {
  imprimirTicket,
  abrirTicketPorWhatsApp,
  type LineaTicket,
  type DatosTicket,
} from '@/utils/imprimirTicket'
import { imprimirPorBluetooth, bluetoothDisponible } from '@/utils/bluetoothPrint'
import { BRAND } from '@/config/brand'
import type { ItemCarrito, Venta } from '@/types/database'

const ETIQUETA: Record<string, string> = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  fiado: 'Fiado',
}

function precioItem(item: ItemCarrito): number {
  if (item.modalidad === 'caja') return item.producto.precio_venta_caja ?? item.producto.precio_venta
  if (item.modalidad === 'saco') return item.producto.precio_venta_saco ?? item.producto.precio_venta
  return item.producto.precio_venta
}

function etiquetaCantidad(item: ItemCarrito): string {
  // El formato "N kg" solo aplica cuando se vendio a granel suelto
  // (modalidad 'unidad'); por caja o por saco es una cantidad entera.
  if (item.producto.tipo_venta === 'granel' && item.modalidad === 'unidad') {
    return `${cantidad(item.cantidad)} ${item.producto.unidad}`
  }
  return `${item.cantidad}x`
}

function lineaDesdeItem(item: ItemCarrito): LineaTicket {
  return {
    etiquetaCantidad: etiquetaCantidad(item),
    nombre: item.producto.nombre,
    etiquetaModalidad: item.modalidad === 'caja' ? 'Caja' : item.modalidad === 'saco' ? 'Saco' : undefined,
    monto: precioItem(item) * item.cantidad,
  }
}

interface Props {
  open: boolean
  onClose: () => void
  venta: Venta
  items: ItemCarrito[]
}

export function Receipt({ open, onClose, venta, items }: Props) {
  const toast = useToast()
  const [waAbierto, setWaAbierto] = useState(false)
  const [telWA, setTelWA] = useState('')
  const [btImprimiendo, setBtImprimiendo] = useState(false)

  // Un solo objeto de datos para imprimir y para WhatsApp: evita que el
  // texto enviado se desincronice del ticket impreso.
  function datosTicket(): DatosTicket {
    return {
      numero: venta.numero,
      fecha: venta.creado_en,
      cajero: venta.cajero_nombre,
      lineas: items.map(lineaDesdeItem),
      subtotal: venta.subtotal,
      descuento: venta.descuento,
      igv: venta.igv,
      total: venta.total,
      metodoPagoEtiqueta: ETIQUETA[venta.metodo] ?? venta.metodo,
      pagoRecibido: venta.pago_recibido,
      vuelto: venta.metodo === 'efectivo' ? venta.vuelto : 0,
      clienteNombre: venta.cliente_nombre,
    }
  }

  function imprimir() {
    imprimirTicket(datosTicket())
  }

  async function imprimirBT() {
    setBtImprimiendo(true)
    try {
      await imprimirPorBluetooth(datosTicket())
      toast.exito('Ticket enviado a la impresora Bluetooth')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo imprimir por Bluetooth')
    } finally {
      setBtImprimiendo(false)
    }
  }

  function enviarWhatsApp() {
    const tel = telWA.replace(/\D/g, '')
    if (tel.length < 6) {
      toast.error('Ingresa un número de WhatsApp válido.')
      return
    }
    abrirTicketPorWhatsApp(tel, datosTicket())
    setWaAbierto(false)
    setTelWA('')
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      maxWidth="max-w-sm"
      footer={
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={imprimir}>
              <Printer className="size-4" /> Imprimir
            </Button>
            {bluetoothDisponible() && (
              <Button variant="outline" className="flex-1" loading={btImprimiendo} onClick={imprimirBT}>
                <Bluetooth className="size-4" /> Bluetooth
              </Button>
            )}
          </div>
          <Button variant="secondary" className="w-full" onClick={onClose}>
            Nueva venta
          </Button>
        </div>
      }
    >
      {/* Confirmación */}
      <div className="mb-4 flex flex-col items-center text-center">
        <div className="mb-2 grid size-12 place-items-center rounded-full bg-accent-100">
          <Check className="size-6 text-accent-700" />
        </div>
        <p className="font-display text-lg font-bold text-ink-900">Venta registrada</p>
        <p className="text-sm text-ink-400">Comprobante #{venta.numero}</p>
      </div>

      {/* Vista previa */}
      <div className="rounded-xl border border-dashed border-ink-200 bg-white p-4 font-mono text-[0.75rem] leading-relaxed">
        {/* Cabecera */}
        <div className="mb-2 text-center">
          <p className="text-sm font-black tracking-wide">{BRAND.nombre.toUpperCase()}</p>
          <p className="text-ink-400 text-[0.7rem]">{fechaHora(venta.creado_en)}</p>
          <p className="text-ink-400 text-[0.7rem]">Cajero: {venta.cajero_nombre ?? '-'}</p>
          <p className="font-bold text-[0.75rem]">Ticket N° {venta.numero}</p>
        </div>

        <hr className="my-2 border-ink-400" />

        {/* Items */}
        <div className="space-y-1">
          {items.map((i) => (
            <div key={`${i.producto.id}::${i.modalidad}`} className="flex justify-between gap-2">
              <span className="min-w-0 break-words font-semibold text-ink-800">
                {etiquetaCantidad(i)} {i.producto.nombre}
                {(i.modalidad === 'caja' || i.modalidad === 'saco') && (
                  <span className="ml-1 rounded bg-accent-100 px-1 py-0.5 text-[0.55rem] font-bold uppercase text-accent-700">
                    {i.modalidad === 'caja' ? 'Caja' : 'Saco'}
                  </span>
                )}
              </span>
              <span className="tabular shrink-0 font-bold">
                {money(precioItem(i) * i.cantidad)}
              </span>
            </div>
          ))}
        </div>

        <hr className="my-2 border-dashed border-ink-300" />

        {/* Subtotales */}
        <div className="space-y-0.5 text-ink-600">
          <PreviewRow k="Subtotal" v={money(venta.subtotal + venta.descuento)} />
          {venta.descuento > 0 && (
            <PreviewRow k="Descuento" v={'- ' + money(venta.descuento)} />
          )}
          <PreviewRow k="IGV (18%)" v={money(venta.igv)} />
        </div>

        <hr className="my-2 border-ink-400" />

        {/* Total */}
        <div className="flex justify-between font-black text-sm text-ink-900">
          <span>TOTAL</span>
          <span className="tabular">{money(venta.total)}</span>
        </div>

        <hr className="my-2 border-dashed border-ink-300" />

        {/* Pago */}
        <div className="space-y-0.5">
          <div className="flex justify-between font-bold text-ink-800">
            <span>{ETIQUETA[venta.metodo] ?? venta.metodo}</span>
            <span className="tabular">{money(venta.pago_recibido)}</span>
          </div>
          {venta.metodo === 'efectivo' && venta.vuelto > 0 && (
            <PreviewRow k="Vuelto" v={money(venta.vuelto)} />
          )}
          {venta.cliente_nombre && (
            <PreviewRow k="Fiado a" v={venta.cliente_nombre} />
          )}
        </div>

        <hr className="my-2 border-dashed border-ink-300" />
        <p className="text-center text-ink-400">¡Gracias por su compra!</p>
      </div>

      {/* Enviar ticket por WhatsApp */}
      <div className="mt-3">
        {!waAbierto ? (
          <button
            onClick={() => setWaAbierto(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-200 py-2.5 text-sm font-semibold text-ink-600 transition hover:border-ink-300"
          >
            <MessageCircle className="size-4" /> Enviar ticket por WhatsApp
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              type="tel"
              inputMode="numeric"
              autoFocus
              className="input flex-1"
              placeholder="Número de WhatsApp (ej. 987654321)"
              value={telWA}
              onChange={(e) => setTelWA(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && enviarWhatsApp()}
            />
            <Button variant="secondary" onClick={enviarWhatsApp}>
              <MessageCircle className="size-4" /> Enviar
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  )
}

function PreviewRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span>{k}</span>
      <span className="tabular font-semibold">{v}</span>
    </div>
  )
}
