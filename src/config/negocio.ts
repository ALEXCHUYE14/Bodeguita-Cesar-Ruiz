import { useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/config/brand'

// Datos del negocio editables desde Configuración (nombre, DNI/RUC, QR de Yape).
//
// Se guardan en Supabase (tabla configuracion_negocio, fila única id = 1) para
// que todos los dispositivos usen los mismos datos, y se cachean en
// localStorage para que la app funcione sin red y el primer render ya tenga el
// nombre correcto. Si la tabla aún no existe o no hay red, se usa el caché y,
// en último caso, BRAND — nunca queda vacío ni rompe la pantalla.
//
// Es un store externo (useSyncExternalStore) en vez de un Context para poder
// leerlo también desde utilidades que no son componentes React
// (imprimirTicket, bluetoothPrint, reporte de caja): getNegocio().

export interface Negocio {
  nombre: string
  /** DNI (8 dígitos) o RUC (11 dígitos) sin espacios; '' = sin configurar. */
  documento: string
  /** Imagen del QR de Yape (data URL) o null. */
  yapeQr: string | null
}

const CLAVE_CACHE = 'negocio-config-v1'

export const NEGOCIO_POR_DEFECTO: Negocio = {
  nombre: BRAND.nombre,
  documento: '',
  yapeQr: null,
}

export const MAX_NOMBRE = 80

// ── Validación (compartida por el formulario y por guardarNegocio) ──────────

/** Devuelve el mensaje de error, o null si el documento es válido (vacío es válido). */
export function validarDocumento(doc: string): string | null {
  if (doc === '') return null
  if (!/^\d+$/.test(doc)) return 'Solo se permiten números.'
  if (doc.length !== 8 && doc.length !== 11) {
    return 'Debe tener 8 dígitos (DNI) u 11 dígitos (RUC).'
  }
  if (doc.length === 11 && !/^(10|15|16|17|20)/.test(doc)) {
    return 'Un RUC válido empieza con 10, 15, 16, 17 o 20.'
  }
  return null
}

/** "RUC" (11 dígitos), "DNI" (8) o null si no hay documento válido. */
export function tipoDocumento(doc: string): 'RUC' | 'DNI' | null {
  if (doc.length === 11) return 'RUC'
  if (doc.length === 8) return 'DNI'
  return null
}

/** "RUC: 20123456789" / "DNI: 12345678" / null — para ticket y vistas previas. */
export function etiquetaDocumento(n: Negocio): string | null {
  const tipo = tipoDocumento(n.documento)
  return tipo ? `${tipo}: ${n.documento}` : null
}

// ── Store ───────────────────────────────────────────────────────────────────

function normalizar(x: Partial<Negocio> | null | undefined): Negocio {
  const nombre = typeof x?.nombre === 'string' ? x.nombre.trim() : ''
  const documento = typeof x?.documento === 'string' ? x.documento.trim() : ''
  const yapeQr =
    typeof x?.yapeQr === 'string' && x.yapeQr.startsWith('data:image/') ? x.yapeQr : null
  return {
    nombre: nombre || NEGOCIO_POR_DEFECTO.nombre,
    documento: validarDocumento(documento) === null ? documento : '',
    yapeQr,
  }
}

function leerCache(): Negocio {
  try {
    const raw = localStorage.getItem(CLAVE_CACHE)
    if (raw) return normalizar(JSON.parse(raw) as Partial<Negocio>)
  } catch {
    // localStorage bloqueado o JSON corrupto: se usan los valores por defecto.
  }
  return NEGOCIO_POR_DEFECTO
}

let actual: Negocio = leerCache()
const oyentes = new Set<() => void>()

function fijar(n: Negocio): void {
  actual = n
  try {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify(n))
  } catch {
    // Sin caché (modo privado o cuota llena): la app sigue funcionando en memoria.
  }
  oyentes.forEach((o) => o())
}

function suscribir(cb: () => void): () => void {
  oyentes.add(cb)
  return () => oyentes.delete(cb)
}

/** Lectura síncrona — para utilidades fuera de React (tickets, PDF, WhatsApp). */
export function getNegocio(): Negocio {
  return actual
}

/** Hook reactivo: el componente se vuelve a renderizar cuando cambian los datos. */
export function useNegocio(): Negocio {
  return useSyncExternalStore(suscribir, getNegocio, getNegocio)
}

/**
 * Trae la configuración desde Supabase y actualiza el store. Nunca lanza:
 * ante cualquier fallo (sin red, tabla inexistente, sin sesión) conserva lo
 * que ya hay en el caché.
 */
export async function cargarNegocio(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('configuracion_negocio')
      .select('nombre, documento, yape_qr')
      .eq('id', 1)
      .maybeSingle()
    if (error) throw error
    if (data) {
      fijar(
        normalizar({
          nombre: data.nombre,
          documento: data.documento ?? '',
          yapeQr: data.yape_qr,
        }),
      )
    }
  } catch (e) {
    console.warn('[negocio] No se pudo cargar la configuración del negocio:', e)
  }
}

/**
 * Guarda en Supabase y, solo si tuvo éxito, actualiza el store. Lanza Error
 * con un mensaje listo para mostrar al usuario.
 */
export async function guardarNegocio(n: Negocio): Promise<void> {
  const nombre = n.nombre.trim()
  const documento = n.documento.trim()
  if (!nombre) throw new Error('El nombre del negocio es obligatorio.')
  if (nombre.length > MAX_NOMBRE) throw new Error(`El nombre no puede superar ${MAX_NOMBRE} caracteres.`)
  const errDoc = validarDocumento(documento)
  if (errDoc) throw new Error(`DNI/RUC: ${errDoc}`)

  const { error } = await supabase.from('configuracion_negocio').upsert({
    id: 1,
    nombre,
    documento,
    yape_qr: n.yapeQr,
  })
  if (error) {
    // 42P01 = tabla inexistente (falta correr el SQL); PGRST205 = idem vía PostgREST.
    if (error.code === '42P01' || error.code === 'PGRST205') {
      throw new Error(
        'Falta crear la tabla de configuración. Ejecuta supabase/add_configuracion_negocio.sql en el SQL Editor de Supabase.',
      )
    }
    if (error.code === '42501') {
      throw new Error('Solo un administrador puede modificar los datos del negocio.')
    }
    throw new Error(error.message || 'No se pudo guardar la configuración.')
  }
  fijar({ nombre, documento, yapeQr: n.yapeQr })
}
