import { useSyncExternalStore } from 'react'
import { money, fechaHora } from '@/utils/format'
import { getNegocio, etiquetaDocumento } from '@/config/negocio'
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

// ── Estado de la conexión (persistente) ──────────────────────────────────
//
// La impresora elegida se recuerda entre sesiones (id + nombre en
// localStorage). Al volver a abrir la app se reconecta sola, sin selector,
// usando navigator.bluetooth.getDevices() cuando el navegador lo permite
// (Chrome/Edge recientes). Si no lo permite, basta con tocar "Conectar" una
// vez por sesion — la app lo avisa con claridad.

export type EstadoConexion = 'desconectada' | 'conectando' | 'conectada'

export interface EstadoImpresora {
  estado: EstadoConexion
  /** Nombre de la impresora recordada (aunque este desconectada en este momento). */
  nombre: string | null
  /** Ultimo error de conexion, para mostrarlo en Configuracion. */
  error: string | null
}

const CLAVE_IMPRESORA = 'impresora-bt-v1'
const CLAVE_AUTO = 'impresora-bt-auto-v1'

interface ImpresoraGuardada {
  id: string
  nombre: string | null
}

function leerGuardada(): ImpresoraGuardada | null {
  try {
    const raw = localStorage.getItem(CLAVE_IMPRESORA)
    if (!raw) return null
    const x = JSON.parse(raw) as Partial<ImpresoraGuardada>
    return typeof x.id === 'string' && x.id ? { id: x.id, nombre: x.nombre ?? null } : null
  } catch {
    return null
  }
}

function escribirGuardada(g: ImpresoraGuardada | null): void {
  try {
    if (g) localStorage.setItem(CLAVE_IMPRESORA, JSON.stringify(g))
    else localStorage.removeItem(CLAVE_IMPRESORA)
  } catch {
    // Sin localStorage: la conexion sigue valiendo durante esta sesion.
  }
}

let dispositivo: BluetoothDevice | null = null
let caracteristicaActiva: BluetoothRemoteGATTCharacteristic | null = null

let snapshot: EstadoImpresora = {
  estado: 'desconectada',
  nombre: leerGuardada()?.nombre ?? null,
  error: null,
}
const oyentes = new Set<() => void>()

function actualizar(parcial: Partial<EstadoImpresora>): void {
  snapshot = { ...snapshot, ...parcial }
  oyentes.forEach((o) => o())
}

function suscribir(cb: () => void): () => void {
  oyentes.add(cb)
  return () => oyentes.delete(cb)
}

function leerSnapshot(): EstadoImpresora {
  return snapshot
}

/** Hook reactivo con el estado de la impresora Bluetooth. */
export function useImpresoraBluetooth(): EstadoImpresora {
  return useSyncExternalStore(suscribir, leerSnapshot, leerSnapshot)
}

export function bluetoothDisponible(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

/** ¿Hay una impresora recordada de una sesion anterior (o de esta)? */
export function hayImpresoraGuardada(): boolean {
  return leerGuardada() !== null
}

/** Impresion automatica al cobrar — preferencia por dispositivo (cada caja/celular decide). */
export function autoImprimirActivo(): boolean {
  try {
    return localStorage.getItem(CLAVE_AUTO) === '1'
  } catch {
    return false
  }
}

export function fijarAutoImprimir(valor: boolean): void {
  try {
    if (valor) localStorage.setItem(CLAVE_AUTO, '1')
    else localStorage.removeItem(CLAVE_AUTO)
  } catch {
    // Ver escribirGuardada().
  }
}

function alDesconectarse(): void {
  caracteristicaActiva = null
  if (snapshot.estado !== 'desconectada') actualizar({ estado: 'desconectada' })
}

function adoptarDispositivo(device: BluetoothDevice): void {
  if (dispositivo && dispositivo !== device) {
    dispositivo.removeEventListener('gattserverdisconnected', alDesconectarse)
  }
  dispositivo = device
  device.removeEventListener('gattserverdisconnected', alDesconectarse)
  device.addEventListener('gattserverdisconnected', alDesconectarse)
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

/** Parte un texto largo en lineas de a lo sumo `ancho` caracteres, cortando por palabras. */
function partirEnLineas(texto: string, ancho: number): string[] {
  const lineas: string[] = []
  let actualLinea = ''
  for (const palabra of quitarAcentos(texto).split(/\s+/).filter(Boolean)) {
    let p = palabra
    while (p.length > ancho) {
      if (actualLinea) {
        lineas.push(actualLinea)
        actualLinea = ''
      }
      lineas.push(p.slice(0, ancho))
      p = p.slice(ancho)
    }
    if (!actualLinea) actualLinea = p
    else if (actualLinea.length + 1 + p.length <= ancho) actualLinea += ' ' + p
    else {
      lineas.push(actualLinea)
      actualLinea = p
    }
  }
  if (actualLinea) lineas.push(actualLinea)
  return lineas.length ? lineas : ['']
}

/** Arma los bytes ESC/POS del ticket. `ancho` = columnas de texto (32 = seguro para impresoras de 58mm y 80mm). */
function construirEscPos(datos: DatosTicket, ancho = 32): Uint8Array {
  const out: number[] = []
  const cmd = (...bytes: number[]) => out.push(...bytes)
  const linea = (s: string) => {
    const t = quitarAcentos(s)
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i)
      // Solo ASCII imprimible: cualquier otro caracter (emoji, simbolos) saldria
      // como basura en la pagina de codigos de la impresora.
      out.push(c >= 0x20 && c <= 0x7e ? c : 0x3f)
    }
    out.push(0x0a)
  }

  const negocio = getNegocio()
  const documento = etiquetaDocumento(negocio)

  cmd(ESC, 0x40) // inicializa la impresora
  cmd(ESC, 0x61, 0x01) // centrado
  cmd(ESC, 0x45, 0x01) // negrita on
  for (const l of partirEnLineas(negocio.nombre.toUpperCase(), ancho)) linea(l)
  cmd(ESC, 0x45, 0x00) // negrita off
  if (documento) linea(documento)
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

async function resolverCaracteristica(device: BluetoothDevice): Promise<BluetoothRemoteGATTCharacteristic> {
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

// Serializa todo lo que toca la impresora (conectar/imprimir): un doble toque
// en "Imprimir" no debe mezclar dos tickets ni abrir dos conexiones a la vez.
let cola: Promise<unknown> = Promise.resolve()
function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  const siguiente = cola.then(tarea, tarea)
  cola = siguiente.catch(() => undefined)
  return siguiente
}

function mensajeError(e: unknown, porDefecto: string): string {
  if (e instanceof DOMException && e.name === 'NotFoundError') {
    return 'No se seleccionó ninguna impresora.'
  }
  return e instanceof Error && e.message ? e.message : porDefecto
}

/** Conecta el dispositivo dado y deja lista la caracteristica de escritura. */
async function establecer(device: BluetoothDevice): Promise<BluetoothRemoteGATTCharacteristic> {
  adoptarDispositivo(device)
  actualizar({ estado: 'conectando', error: null, nombre: device.name ?? snapshot.nombre })
  try {
    const car = await resolverCaracteristica(device)
    caracteristicaActiva = car
    escribirGuardada({ id: device.id, nombre: device.name ?? null })
    actualizar({ estado: 'conectada', nombre: device.name ?? snapshot.nombre, error: null })
    return car
  } catch (e) {
    caracteristicaActiva = null
    try {
      device.gatt?.disconnect()
    } catch {
      // ya estaba desconectado
    }
    actualizar({ estado: 'desconectada', error: mensajeError(e, 'No se pudo conectar con la impresora.') })
    throw e
  }
}

/** Busca entre los dispositivos ya autorizados el que coincide con la impresora recordada. */
async function buscarAutorizada(): Promise<BluetoothDevice | null> {
  const guardada = leerGuardada()
  if (!guardada || !navigator.bluetooth?.getDevices) return null
  try {
    const lista = await navigator.bluetooth.getDevices()
    return lista.find((d) => d.id === guardada.id) ?? null
  } catch {
    return null
  }
}

/**
 * Obtiene una caracteristica lista para escribir, en este orden:
 *  1. la conexion que ya esta abierta,
 *  2. reconectar la impresora recordada (sin selector),
 *  3. abrir el selector del navegador — solo si `permitirSelector` y no hay
 *     ninguna impresora recordada. Requiere gesto directo del usuario.
 */
async function obtenerCaracteristica(permitirSelector: boolean): Promise<BluetoothRemoteGATTCharacteristic> {
  if (caracteristicaActiva && dispositivo?.gatt?.connected) return caracteristicaActiva

  const recordada = dispositivo ?? (await buscarAutorizada())
  if (recordada) {
    try {
      return await establecer(recordada)
    } catch (e) {
      const nombre = recordada.name ?? snapshot.nombre ?? 'la impresora'
      throw new Error(
        `No se pudo conectar con ${nombre}. Verifica que esté encendida y cerca; si sigue fallando, ` +
          `entra a Configuración y vuelve a conectarla. (${mensajeError(e, 'error desconocido')})`,
      )
    }
  }

  if (!permitirSelector) {
    throw new Error(
      hayImpresoraGuardada()
        ? 'Este navegador no puede reconectar la impresora automáticamente. Toca "Bluetooth" en el ticket o conéctala en Configuración.'
        : 'No hay una impresora Bluetooth conectada. Conéctala en Configuración.',
    )
  }

  const elegido = await navigator.bluetooth!.requestDevice({
    acceptAllDevices: true,
    optionalServices: TODOS_LOS_SERVICIOS,
  })
  return establecer(elegido)
}

function exigirBluetooth(): void {
  if (!bluetoothDisponible()) {
    throw new Error(
      'Este navegador no admite impresión Bluetooth directa (funciona en Chrome/Edge en Android o PC, no en ' +
        'Safari/iPhone/iPad). Usa "Imprimir ticket" como alternativa.',
    )
  }
}

/** Escribe en la impresora; si el enlace se cayo, reconecta y reintenta una vez. */
async function enviar(bytes: Uint8Array, permitirSelector: boolean): Promise<void> {
  let car = await obtenerCaracteristica(permitirSelector)
  try {
    await escribirEnPartes(car, bytes)
  } catch {
    // El enlace pudo caerse entre tickets: se reconecta (sin selector) y se reintenta una vez.
    caracteristicaActiva = null
    car = await obtenerCaracteristica(false)
    await escribirEnPartes(car, bytes)
  }
}

/**
 * Abre el selector del navegador y conecta la impresora. Debe llamarse desde
 * un gesto directo del usuario (onClick). Queda recordada para proximas
 * sesiones. Si ya hay una recordada, intenta reconectarla primero.
 */
export function conectarImpresora(): Promise<void> {
  try {
    exigirBluetooth()
  } catch (e) {
    return Promise.reject(e)
  }
  return enCola(async () => {
    try {
      await obtenerCaracteristica(true)
    } catch (e) {
      const mensaje = mensajeError(e, 'No se pudo conectar con la impresora.')
      actualizar({ estado: 'desconectada', error: mensaje })
      throw new Error(mensaje)
    }
  })
}

/**
 * Reconecta en silencio la impresora recordada (sin selector). No lanza:
 * devuelve true si quedo conectada. Pensado para llamarse al abrir la pantalla
 * de Configuracion.
 */
export async function reconectarImpresoraGuardada(): Promise<boolean> {
  if (!bluetoothDisponible() || !hayImpresoraGuardada()) return false
  if (caracteristicaActiva && dispositivo?.gatt?.connected) return true
  try {
    await enCola(() => obtenerCaracteristica(false))
    return true
  } catch {
    return false
  }
}

/** Desconecta y olvida la impresora: la proxima vez habra que elegirla de nuevo. */
export function desconectarImpresora(): void {
  try {
    dispositivo?.gatt?.disconnect()
  } catch {
    // ya estaba desconectada
  }
  if (dispositivo) dispositivo.removeEventListener('gattserverdisconnected', alDesconectarse)
  dispositivo = null
  caracteristicaActiva = null
  escribirGuardada(null)
  actualizar({ estado: 'desconectada', nombre: null, error: null })
}

/**
 * Imprime el ticket directo en la impresora termica Bluetooth (BLE).
 * Con `permitirSelector: true` (por defecto) puede abrir el selector de
 * dispositivos si no hay impresora recordada — en ese caso debe llamarse
 * desde un gesto directo del usuario. La impresion automatica usa `false`.
 */
export function imprimirPorBluetooth(
  datos: DatosTicket,
  opciones: { permitirSelector?: boolean } = {},
): Promise<void> {
  try {
    exigirBluetooth()
  } catch (e) {
    return Promise.reject(e)
  }
  const permitirSelector = opciones.permitirSelector ?? true
  return enCola(() => enviar(construirEscPos(datos), permitirSelector))
}

/** Ticket de prueba para verificar la conexion y ver como sale el encabezado del negocio. */
export function imprimirPruebaBluetooth(): Promise<void> {
  return imprimirPorBluetooth({
    numero: 0,
    fecha: new Date().toISOString(),
    cajero: 'Prueba',
    lineas: [
      { etiquetaCantidad: '1x', nombre: 'Producto de prueba A', monto: 10 },
      { etiquetaCantidad: '2x', nombre: 'Producto de prueba B', monto: 25.5 },
    ],
    subtotal: 30.08,
    descuento: 0,
    igv: 5.42,
    total: 35.5,
    metodoPagoEtiqueta: 'Efectivo',
    pagoRecibido: 40,
    vuelto: 4.5,
  })
}
