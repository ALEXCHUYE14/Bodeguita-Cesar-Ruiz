import { money, fechaHora } from '@/utils/format'
import { BRAND } from '@/config/brand'
import type { DatosTicket } from '@/utils/imprimirTicket'

// ─── Impresión térmica directa por Bluetooth (Web Bluetooth + ESC/POS) ──────
//
// Alternativa a imprimirTicket() (que abre el dialogo de impresion del
// sistema operativo) para mandar el ticket DIRECTO a una impresora termica
// por Bluetooth, sin ese dialogo. Limitaciones reales, no evitables:
//
//  - Solo funciona en Chrome/Edge (Android o PC). Safari (iPhone/iPad/Mac) no
//    implementa Web Bluetooth — ahi bluetoothDisponible() da false y el
//    llamador debe ofrecer "Imprimir ticket" (dialogo del sistema) en su lugar.
//  - Solo funciona con impresoras Bluetooth LOW ENERGY (BLE). Muchas
//    impresoras termicas economicas usan Bluetooth CLASICO (perfil SPP), que
//    el navegador no puede ver ni usar — eso no se puede detectar de
//    antemano: el error solo aparece al intentar conectar, con un mensaje
//    que indica volver al metodo por dialogo.
//  - Se probaron los 3 perfiles de servicio/caracteristica BLE mas comunes
//    entre impresoras termicas genericas (58mm/80mm) del mercado. Si la
//    impresora usa un cuarto protocolo distinto, fallara igual de forma
//    controlada (mensaje claro, sin romper el resto de la app).

interface PerfilImpresora {
  servicio: string
  caracteristica: string
}

const PERFILES_CONOCIDOS: PerfilImpresora[] = [
  // "Printer Service" generico — el mas comun en impresoras BLE clonadas.
  { servicio: '000018f0-0000-1000-8000-00805f9b34fb', caracteristica: '00002af1-0000-1000-8000-00805f9b34fb' },
  // Nordic UART Service — usado por varios modulos BLE-UART genericos.
  { servicio: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', caracteristica: '6e400002-b5a3-f393-e0a9-e50e24dcca9e' },
  // Emulacion de puerto serie BLE (chips CC254x / HM-10 y clones).
  { servicio: '49535343-fe7d-4ae5-8fa9-9fafd205e455', caracteristica: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
]

const TODOS_LOS_SERVICIOS = PERFILES_CONOCIDOS.map((p) => p.servicio)

// Recuerda el ultimo dispositivo elegido en esta pestaña/sesion para no
// pedir "elegir dispositivo" en cada ticket — Web Bluetooth solo exige el
// selector (con gesto del usuario) para el primer emparejamiento.
let dispositivoRecordado: BluetoothDevice | null = null

export function bluetoothDisponible(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

/** Descarta el dispositivo recordado — el proximo intento pedira elegir de nuevo. */
export function olvidarImpresoraBluetooth(): void {
  dispositivoRecordado = null
}

// ── Codificación ESC/POS ─────────────────────────────────────────────────

const ESC = 0x1b
const GS = 0x1d

// Muchas impresoras termicas genericas no interpretan UTF-8: usan una pagina
// de codigos de 1 byte y sin esto los acentos salen como simbolos ilegibles.
// Quitarlos es la forma segura de que el texto se lea bien sin depender de
// la pagina de codigos exacta de cada impresora.
function quitarAcentos(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N')
}

function fila(izq: string, der: string, ancho: number): string {
  const i = quitarAcentos(izq)
  const d = quitarAcentos(der)
  if (i.length + d.length + 1 > ancho) {
    const iCorto = i.slice(0, Math.max(0, ancho - d.length - 1))
    return (iCorto + ' '.repeat(ancho - d.length - iCorto.length)) + d
  }
  return i + ' '.repeat(ancho - i.length - d.length) + d
}

/** Arma los bytes ESC/POS del ticket. `ancho` = columnas de texto (32 = seguro para impresoras de 58mm y 80mm). */
function construirEscPos(datos: DatosTicket, ancho = 32): Uint8Array {
  const out: number[] = []
  const cmd = (...bytes: number[]) => out.push(...bytes)
  const linea = (s: string) => {
    const t = quitarAcentos(s)
    for (let i = 0; i < t.length; i++) out.push(t.charCodeAt(i) & 0xff)
    out.push(0x0a)
  }

  cmd(ESC, 0x40) // inicializa la impresora
  cmd(ESC, 0x61, 0x01) // centrado
  cmd(ESC, 0x45, 0x01) // negrita on
  linea(BRAND.nombre.toUpperCase())
  cmd(ESC, 0x45, 0x00) // negrita off
  linea(fechaHora(datos.fecha))
  linea(`Cajero: ${datos.cajero ?? '-'}`)
  linea(`Ticket N ${datos.numero}`)
  cmd(ESC, 0x61, 0x00) // izquierda
  linea('-'.repeat(ancho))

  for (const l of datos.lineas) {
    const nombre = `${l.etiquetaCantidad} ${l.nombre}${l.etiquetaModalidad ? ` [${l.etiquetaModalidad}]` : ''}`
    linea(fila(nombre, money(l.monto), ancho))
  }

  linea('-'.repeat(ancho))
  linea(fila('Subtotal', money(datos.subtotal + datos.descuento), ancho))
  if (datos.descuento > 0) linea(fila('Descuento', '-' + money(datos.descuento), ancho))
  linea(fila('IGV (18%)', money(datos.igv), ancho))
  linea('='.repeat(ancho))
  cmd(ESC, 0x45, 0x01)
  linea(fila('TOTAL', money(datos.total), ancho))
  cmd(ESC, 0x45, 0x00)
  linea('-'.repeat(ancho))
  linea(fila(datos.metodoPagoEtiqueta, money(datos.pagoRecibido), ancho))
  if (datos.vuelto > 0) linea(fila('Vuelto', money(datos.vuelto), ancho))
  if (datos.clienteNombre) linea(fila('Fiado a', datos.clienteNombre, ancho))

  if (datos.anulada) {
    linea('')
    cmd(ESC, 0x61, 0x01)
    linea('*** ANULADO ***')
    cmd(ESC, 0x61, 0x00)
  }

  linea('')
  cmd(ESC, 0x61, 0x01)
  linea('Gracias por su compra!')
  cmd(ESC, 0x61, 0x00)
  linea('')
  linea('')
  linea('')
  cmd(GS, 0x56, 0x01) // corte parcial (si la impresora no tiene cuchilla, se ignora)

  return new Uint8Array(out)
}

// ── Conexión y envío ─────────────────────────────────────────────────────

async function conectarCaracteristica(device: BluetoothDevice): Promise<BluetoothRemoteGATTCharacteristic> {
  if (!device.gatt) {
    throw new Error('Este dispositivo no expone GATT: no parece ser una impresora Bluetooth compatible.')
  }
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect()

  let ultimoError: unknown = null
  for (const perfil of PERFILES_CONOCIDOS) {
    try {
      const servicio = await server.getPrimaryService(perfil.servicio)
      return await servicio.getCharacteristic(perfil.caracteristica)
    } catch (e) {
      ultimoError = e
    }
  }
  const detalle = ultimoError instanceof Error ? ` (${ultimoError.message})` : ''
  throw new Error(
    `No se reconoce esta impresora Bluetooth${detalle}. Puede que no sea una impresora termica BLE, o use un ` +
      'protocolo distinto al soportado. Usa "Imprimir ticket" (diálogo del sistema) como alternativa.',
  )
}

// Envia en trozos chicos: impresoras economicas tienen buffers pequeños y
// pueden perder bytes si se les manda todo de una sola vez.
async function escribirEnPartes(caracteristica: BluetoothRemoteGATTCharacteristic, datos: Uint8Array): Promise<void> {
  const TAMANO_PARTE = 180
  for (let i = 0; i < datos.length; i += TAMANO_PARTE) {
    const parte = datos.slice(i, i + TAMANO_PARTE)
    if (caracteristica.writeValueWithoutResponse) {
      await caracteristica.writeValueWithoutResponse(parte)
    } else {
      await caracteristica.writeValue(parte)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/**
 * Imprime el ticket directo en una impresora térmica Bluetooth (BLE).
 * Debe llamarse desde un gesto directo del usuario (onClick) la primera vez:
 * el navegador exige eso para mostrar el selector de dispositivos.
 */
export async function imprimirPorBluetooth(datos: DatosTicket): Promise<void> {
  if (!bluetoothDisponible()) {
    throw new Error(
      'Este navegador no admite impresión Bluetooth directa (funciona en Chrome/Edge en Android o PC, no en ' +
        'Safari/iPhone/iPad). Usa "Imprimir ticket" como alternativa.',
    )
  }

  let device = dispositivoRecordado
  if (!device) {
    device = await navigator.bluetooth!.requestDevice({
      acceptAllDevices: true,
      optionalServices: TODOS_LOS_SERVICIOS,
    })
  }

  try {
    const caracteristica = await conectarCaracteristica(device)
    const bytes = construirEscPos(datos)
    await escribirEnPartes(caracteristica, bytes)
    // Recien se recuerda si la impresion funciono: asi un dispositivo
    // incompatible nunca queda guardado bloqueando los siguientes intentos.
    dispositivoRecordado = device
  } catch (e) {
    dispositivoRecordado = null
    throw e
  }
}
