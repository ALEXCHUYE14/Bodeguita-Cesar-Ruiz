import { money, fechaHora } from '@/utils/format'
import { BRAND } from '@/config/brand'

// Impresión de tickets de venta (80mm) — usado tanto justo después de cobrar
// (Receipt.tsx) como al reimprimir desde el historial (Ventas.tsx), para que
// el resultado impreso sea siempre idéntico sin importar desde dónde se pida.

export interface LineaTicket {
  /** "2x" o "0.750 kg", ya formateado por el llamador (cada uno conoce su dato). */
  etiquetaCantidad: string
  nombre: string
  /** "Caja" | "Saco" — se muestra como sufijo. Sin valor = venta por unidad/kg normal. */
  etiquetaModalidad?: string
  /** Subtotal de la línea (precio × cantidad). */
  monto: number
}

export interface DatosTicket {
  numero: number
  fecha: string // ISO
  cajero: string | null
  lineas: LineaTicket[]
  subtotal: number
  descuento: number
  igv: number
  total: number
  metodoPagoEtiqueta: string
  pagoRecibido: number
  vuelto: number
  clienteNombre?: string | null
  anulada?: boolean
}

// Evita que un nombre de producto/cliente con < > & rompa el HTML del ticket.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function imprimirTicket(datos: DatosTicket): void {
  const lineasHtml = datos.lineas
    .map(
      (l) => `
          <div class="item">
            <div class="item-nombre">${esc(l.etiquetaCantidad)} ${esc(l.nombre)}${l.etiquetaModalidad ? ` [${esc(l.etiquetaModalidad)}]` : ''}</div>
            <div class="item-precio">${money(l.monto)}</div>
          </div>`,
    )
    .join('')

  const descuentoLine =
    datos.descuento > 0
      ? `<div class="row"><span>Descuento</span><span>- ${money(datos.descuento)}</span></div>`
      : ''

  const vueltoLine =
    datos.vuelto > 0
      ? `<div class="row"><span>Vuelto</span><span>${money(datos.vuelto)}</span></div>`
      : ''

  const clienteLine = datos.clienteNombre
    ? `<div class="row"><span>Fiado a</span><span>${esc(datos.clienteNombre)}</span></div>`
    : ''

  const anuladaBanner = datos.anulada
    ? `<div class="anulada">*** COMPROBANTE ANULADO ***</div>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Ticket #${datos.numero}</title>
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
      -moz-osx-font-smoothing: grayscale;
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
      font-weight: 600;
      margin-top: 1mm;
      line-height: 1.5;
    }
    .ticket-num {
      font-size: 11pt;
      font-weight: bold;
      margin-top: 1mm;
    }

    /* Banner de anulacion */
    .anulada {
      text-align: center;
      font-size: 11pt;
      font-weight: 900;
      color: #b91c1c;
      border: 1.5px solid #b91c1c;
      border-radius: 2mm;
      padding: 1.5mm;
      margin: 2mm 0;
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
      font-weight: 500;
      line-height: 1.7;
    }
    .row span:first-child {
      flex: 1;
    }
    .row span:last-child {
      flex-shrink: 0;
      text-align: right;
      font-weight: 700;
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
      font-weight: 600;
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
    <div class="nombre-negocio">${esc(BRAND.nombre.toUpperCase())}</div>
    <div class="sub-header">${fechaHora(datos.fecha)}</div>
    <div class="sub-header">Cajero: ${datos.cajero ? esc(datos.cajero) : '-'}</div>
    <div class="ticket-num">Ticket N° ${datos.numero}</div>
  </div>

  ${anuladaBanner}

  <hr class="sep-solid"/>

  <div class="items">
    ${lineasHtml}
  </div>

  <hr class="sep-dash"/>

  <div class="row"><span>Subtotal</span><span>${money(datos.subtotal + datos.descuento)}</span></div>
  ${descuentoLine}
  <div class="row"><span>IGV (18%)</span><span>${money(datos.igv)}</span></div>

  <hr class="sep-solid"/>

  <div class="row-total">
    <span>TOTAL</span>
    <span>${money(datos.total)}</span>
  </div>

  <hr class="sep-dash"/>

  <div class="row-pago">
    <span>${esc(datos.metodoPagoEtiqueta)}</span>
    <span>${money(datos.pagoRecibido)}</span>
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
    // Bloqueado por el navegador: no hay forma de garantizar un ticket
    // aislado y limpio, pero al menos se intenta con lo que haya en pantalla.
    window.print()
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()

  // Cierra la ventana solo cuando el navegador termina con el dialogo de
  // impresion (evento "afterprint"), no antes. Cerrarla justo despues de
  // llamar a print() deja la vista previa en blanco: en navegadores modernos
  // print() no bloquea la ejecucion, asi que el cierre ocurria mientras el
  // navegador todavia estaba renderizando el contenido para imprimir.
  let cerrada = false
  const cerrar = () => {
    if (cerrada) return
    cerrada = true
    w.close()
  }
  w.addEventListener('afterprint', cerrar)
  // Respaldo por si el navegador no dispara "afterprint" (pasa en algunos
  // flujos de impresion a impresoras termicas/Bluetooth).
  setTimeout(cerrar, 60000)

  setTimeout(() => {
    w.print()
  }, 350)
}

// ─── Envío del ticket por WhatsApp ──────────────────────────────────────────
// Comparte los mismos datos que imprimirTicket() (el llamador arma un solo
// DatosTicket y lo usa para ambas acciones), asi que el texto enviado nunca
// puede desincronizarse del ticket impreso.

/** Arma el texto plano (con formato WhatsApp `*negrita*`) del ticket. */
export function mensajeTicketWhatsApp(datos: DatosTicket): string {
  const lineas = datos.lineas
    .map(
      (l) =>
        `• ${l.etiquetaCantidad} ${l.nombre}${l.etiquetaModalidad ? ` [${l.etiquetaModalidad}]` : ''} — ${money(l.monto)}`,
    )
    .join('\n')

  const partes = [
    `*${BRAND.nombre}*`,
    `Ticket N° ${datos.numero} · ${fechaHora(datos.fecha)}`,
    '',
    lineas,
    '',
    `Subtotal: ${money(datos.subtotal + datos.descuento)}`,
  ]
  if (datos.descuento > 0) partes.push(`Descuento: - ${money(datos.descuento)}`)
  partes.push(`IGV (18%): ${money(datos.igv)}`)
  partes.push(`*TOTAL: ${money(datos.total)}*`)
  partes.push('')
  partes.push(`Pago (${datos.metodoPagoEtiqueta}): ${money(datos.pagoRecibido)}`)
  if (datos.vuelto > 0) partes.push(`Vuelto: ${money(datos.vuelto)}`)
  if (datos.clienteNombre) partes.push(`Fiado a: ${datos.clienteNombre}`)
  if (datos.anulada) partes.push('', '*** COMPROBANTE ANULADO ***')
  partes.push('', '¡Gracias por su compra! 🙏')

  return partes.join('\n')
}

/**
 * Abre WhatsApp Web/App con el ticket ya redactado, listo para enviar al
 * numero indicado. `telefono` admite cualquier formato (espacios, guiones):
 * se limpia y se antepone el codigo de pais de Peru (51), igual que el
 * recordatorio de deuda de Clientes.tsx.
 */
export function abrirTicketPorWhatsApp(telefono: string, datos: DatosTicket): void {
  const tel = telefono.replace(/\D/g, '')
  const mensaje = mensajeTicketWhatsApp(datos)
  window.open(`https://wa.me/51${tel}?text=${encodeURIComponent(mensaje)}`, '_blank', 'noopener,noreferrer')
}
