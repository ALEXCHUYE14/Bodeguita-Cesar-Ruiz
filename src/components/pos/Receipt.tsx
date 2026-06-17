import { Printer, Check } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { money, fechaHora } from '@/utils/format'
import type { ItemCarrito, Venta } from '@/types/database'

const ETIQUETA: Record<string, string> = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  fiado: 'Fiado',
}

function precioItem(item: ItemCarrito): number {
  return item.modalidad === 'caja'
    ? (item.producto.precio_venta_caja ?? item.producto.precio_venta)
    : item.producto.precio_venta
}

interface Props {
  open: boolean
  onClose: () => void
  venta: Venta
  items: ItemCarrito[]
}

export function Receipt({ open, onClose, venta, items }: Props) {
  function imprimir() {
    const lineas = items
      .map((i) => {
        const esCaja = i.modalidad === 'caja'
        const etiq = esCaja ? ' [Caja]' : ''
        const precio = money(precioItem(i) * i.cantidad)
        return `
          <div class="item">
            <div class="item-nombre">${i.cantidad}x ${i.producto.nombre}${etiq}</div>
            <div class="item-precio">${precio}</div>
          </div>`
      })
      .join('')

    const descuentoLine =
      venta.descuento > 0
        ? `<div class="row"><span>Descuento</span><span>- ${money(venta.descuento)}</span></div>`
        : ''

    const vueltoLine =
      venta.metodo === 'efectivo' && venta.vuelto > 0
        ? `<div class="row"><span>Vuelto</span><span>${money(venta.vuelto)}</span></div>`
        : ''

    const clienteLine =
      venta.cliente_nombre
        ? `<div class="row"><span>Fiado a</span><span>${venta.cliente_nombre}</span></div>`
        : ''

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Ticket #${venta.numero}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11pt;
      line-height: 1.6;
      width: 80mm;
      padding: 5mm 4mm 8mm 4mm;
      color: #000000;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }

    /* Encabezado */
    .header {
      text-align: center;
      margin-bottom: 3mm;
    }
    .nombre-negocio {
      font-size: 15pt;
      font-weight: 900;
      letter-spacing: 0.5px;
      line-height: 1.3;
    }
    .sub-header {
      font-size: 10pt;
      margin-top: 1mm;
      line-height: 1.5;
    }
    .ticket-num {
      font-size: 11pt;
      font-weight: bold;
      margin-top: 1mm;
    }

    /* Separadores */
    .sep-dash {
      border: none;
      border-top: 1px dashed #000;
      margin: 3mm 0;
    }
    .sep-solid {
      border: none;
      border-top: 2px solid #000;
      margin: 3mm 0;
    }

    /* Items del carrito */
    .item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 4px;
      margin-bottom: 2mm;
    }
    .item-nombre {
      flex: 1;
      font-size: 10.5pt;
      font-weight: 600;
      word-break: break-word;
      line-height: 1.4;
    }
    .item-precio {
      flex-shrink: 0;
      font-size: 10.5pt;
      font-weight: 700;
      text-align: right;
    }

    /* Filas de resumen */
    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 4px;
      font-size: 10pt;
      line-height: 1.7;
    }
    .row span:first-child {
      flex: 1;
    }
    .row span:last-child {
      flex-shrink: 0;
      text-align: right;
      font-weight: 600;
    }

    /* Fila TOTAL destacada */
    .row-total {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 4px;
      font-size: 15pt;
      font-weight: 900;
      letter-spacing: 0.5px;
      line-height: 1.5;
      margin: 1mm 0;
    }

    /* Metodo de pago */
    .row-pago {
      display: flex;
      justify-content: space-between;
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.7;
    }

    /* Pie */
    .footer {
      text-align: center;
      margin-top: 4mm;
      font-size: 10pt;
      line-height: 1.6;
    }

    @page {
      size: 80mm auto;
      margin: 0;
    }

    @media print {
      body {
        width: 80mm;
      }
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="nombre-negocio">BODEGUITA JULI</div>
    <div class="sub-header">${fechaHora(venta.creado_en)}</div>
    <div class="sub-header">Cajero: ${venta.cajero_nombre ?? '-'}</div>
    <div class="ticket-num">Ticket N° ${venta.numero}</div>
  </div>

  <hr class="sep-solid"/>

  <div class="items">
    ${lineas}
  </div>

  <hr class="sep-dash"/>

  <div class="row"><span>Subtotal</span><span>${money(venta.subtotal + venta.descuento)}</span></div>
  ${descuentoLine}
  <div class="row"><span>IGV (18%)</span><span>${money(venta.igv)}</span></div>

  <hr class="sep-solid"/>

  <div class="row-total">
    <span>TOTAL</span>
    <span>${money(venta.total)}</span>
  </div>

  <hr class="sep-dash"/>

  <div class="row-pago">
    <span>${ETIQUETA[venta.metodo] ?? venta.metodo}</span>
    <span>${money(venta.pago_recibido)}</span>
  </div>
  ${vueltoLine}
  ${clienteLine}

  <hr class="sep-dash"/>

  <div class="footer">
    <div>¡Gracias por su compra!</div>
    <div>Vuelva pronto</div>
  </div>

</body>
</html>`

    const w = window.open('', '_blank', 'width=400,height=700,menubar=no,toolbar=no,scrollbars=no')
    if (!w) {
      window.print()
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => {
      w.print()
      w.close()
    }, 350)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      maxWidth="max-w-sm"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={imprimir}>
            <Printer className="size-4" /> Imprimir ticket
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
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
          <p className="text-sm font-black tracking-wide">BODEGUITA JULI</p>
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
                {i.cantidad}x {i.producto.nombre}
                {i.modalidad === 'caja' && (
                  <span className="ml-1 rounded bg-accent-100 px-1 py-0.5 text-[0.55rem] font-bold uppercase text-accent-700">
                    Caja
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
