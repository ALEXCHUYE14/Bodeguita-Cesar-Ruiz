// Prepara una imagen subida por el usuario (p. ej. el QR de Yape) para
// guardarla como data URL dentro de la fila de configuración: la reduce a un
// tamaño razonable y la pasa por un canvas, así una captura de pantalla de
// varios MB queda en unas decenas de KB y nunca supera el límite de la base.

const MAX_ARCHIVO_BYTES = 8 * 1024 * 1024
// Debe ser <= al CHECK de supabase/add_configuracion_negocio.sql (600 000 caracteres).
const MAX_DATA_URL = 550_000

function cargarImagen(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new Error('No se pudo leer la imagen. Usa un archivo PNG o JPG.'))
    img.src = url
  })
}

/** Devuelve la imagen como data URL (PNG, o JPG si el PNG pesa demasiado), con lado mayor <= `maxLado`. */
export async function imagenADataUrl(file: File, maxLado = 640): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo debe ser una imagen (PNG o JPG).')
  }
  if (file.size > MAX_ARCHIVO_BYTES) {
    throw new Error('La imagen pesa más de 8 MB. Usa una más liviana.')
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await cargarImagen(url)
    const ancho = img.naturalWidth
    const alto = img.naturalHeight
    if (!ancho || !alto) throw new Error('La imagen está vacía o dañada.')

    // Nunca se agranda (un QR pequeño y nítido se queda como está).
    const escala = Math.min(1, maxLado / Math.max(ancho, alto))
    const w = Math.max(1, Math.round(ancho * escala))
    const h = Math.max(1, Math.round(alto * escala))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Tu navegador no pudo procesar la imagen.')
    // Fondo blanco: un PNG transparente se vería negro sobre modo oscuro/impresión.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)

    let salida = canvas.toDataURL('image/png')
    if (salida.length > MAX_DATA_URL / 2) {
      const jpg = canvas.toDataURL('image/jpeg', 0.92)
      if (jpg.length < salida.length) salida = jpg
    }
    if (salida.length > MAX_DATA_URL) {
      throw new Error('La imagen es demasiado pesada. Recorta solo el código QR y vuelve a intentar.')
    }
    return salida
  } finally {
    URL.revokeObjectURL(url)
  }
}
