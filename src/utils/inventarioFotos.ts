// Respaldo/restauración masiva de fotos de producto en .zip — comparte el
// mismo mecanismo de subida que el formulario de producto (compresión +
// cacheControl largo, ver useProductoImagen.ts), solo que orquestado en
// lote con concurrencia acotada.
//
// jszip se importa SIEMPRE con import() dinámico dentro de las funciones
// que lo usan (ver nota equivalente en inventarioExcel.ts).
import { supabase } from '@/lib/supabase'

const CONCURRENCIA = 6

/** Corre `fn` sobre `items` con a lo sumo `limite` tareas en vuelo a la vez — nunca todas en paralelo de golpe (satura la conexión y dispara el egress de Supabase). */
async function conPool<T, R>(items: T[], limite: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length)
  let siguiente = 0
  async function trabajador() {
    for (;;) {
      const i = siguiente++
      if (i >= items.length) return
      resultados[i] = await fn(items[i], i)
    }
  }
  const nTrabajadores = Math.max(1, Math.min(limite, items.length))
  await Promise.all(Array.from({ length: nTrabajadores }, trabajador))
  return resultados
}

/** SKU -> nombre de archivo seguro (sin caracteres que rompan un .zip o el sistema de archivos). */
function nombreArchivoSeguro(sku: string): string {
  return sku.trim().replace(/[\\/:*?"<>|]/g, '_') || 'sin-sku'
}

function baseSinExtension(nombreArchivo: string): string {
  // Solo el nombre (sin ruta de carpetas dentro del zip) y sin la extension.
  const base = nombreArchivo.split('/').pop() ?? nombreArchivo
  return base.replace(/\.[^.]+$/, '')
}

function extensionDesde(url: string, contentType: string | null): string {
  const deUrl = url.split('?')[0].split('.').pop()
  if (deUrl && /^[a-z0-9]{2,4}$/i.test(deUrl)) return deUrl.toLowerCase()
  if (contentType?.includes('png')) return 'png'
  if (contentType?.includes('webp')) return 'webp'
  return 'jpg'
}

export interface ErrorPorArchivo {
  nombre: string
  mensaje: string
}

export interface ResultadoDescargaFotos {
  incluidas: number
  sinFoto: number
  errores: ErrorPorArchivo[]
}

/**
 * Descarga un .zip con la foto de cada producto que tenga una (SKU.ext),
 * incluye productos inactivos (es un respaldo completo del catálogo, no
 * solo el que está en venta). Los productos sin foto no son un error, solo
 * se excluyen y se informa cuántos fueron.
 */
export async function descargarFotosZip(): Promise<ResultadoDescargaFotos> {
  const { data, error } = await supabase
    .from('productos')
    .select('id, sku, nombre, image_url')
    .order('sku')
  if (error) throw error

  const productos = data ?? []
  const conFoto = productos.filter((p) => !!p.image_url)
  const sinFoto = productos.length - conFoto.length

  if (conFoto.length === 0) {
    return { incluidas: 0, sinFoto, errores: [] }
  }

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const errores: ErrorPorArchivo[] = []

  await conPool(conFoto, CONCURRENCIA, async (p) => {
    try {
      const resp = await fetch(p.image_url as string)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const blob = await resp.blob()
      const ext = extensionDesde(p.image_url as string, resp.headers.get('content-type'))
      zip.file(`${nombreArchivoSeguro(p.sku)}.${ext}`, blob)
    } catch (e) {
      errores.push({ nombre: p.sku, mensaje: e instanceof Error ? e.message : 'No se pudo descargar' })
    }
  })

  const incluidas = conFoto.length - errores.length
  if (incluidas > 0) {
    const contenido = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
    const url = URL.createObjectURL(contenido)
    const a = document.createElement('a')
    a.href = url
    a.download = `fotos_inventario_${new Date().toISOString().slice(0, 10)}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return { incluidas, sinFoto, errores }
}

export interface ArchivoFotoCandidato {
  /** Nombre del archivo sin extension — se compara contra el SKU, sin importar mayusculas. */
  nombreBase: string
  archivo: File
}

const EXT_IMAGEN = /\.(jpe?g|png|webp|gif|bmp)$/i

/** Acepta .zip o imagenes sueltas (o ambos mezclados) y devuelve la lista plana de candidatos a subir. */
export async function leerArchivosFotos(files: FileList | File[]): Promise<ArchivoFotoCandidato[]> {
  const lista = Array.from(files)
  const resultado: ArchivoFotoCandidato[] = []

  for (const f of lista) {
    if (/\.zip$/i.test(f.name)) {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(f)
      for (const [nombre, entry] of Object.entries(zip.files)) {
        if (entry.dir || !EXT_IMAGEN.test(nombre)) continue
        const blob = await entry.async('blob')
        const base = baseSinExtension(nombre)
        const tipo = nombre.toLowerCase().endsWith('.png')
          ? 'image/png'
          : nombre.toLowerCase().endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg'
        resultado.push({ nombreBase: base, archivo: new File([blob], nombre, { type: tipo }) })
      }
    } else if (f.type.startsWith('image/') || EXT_IMAGEN.test(f.name)) {
      resultado.push({ nombreBase: baseSinExtension(f.name), archivo: f })
    }
  }
  return resultado
}

export { conPool, CONCURRENCIA }
