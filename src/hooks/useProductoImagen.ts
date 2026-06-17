import { useState } from 'react'
import { supabase } from '@/lib/supabase'

const BUCKET = 'product-images'
const MAX_LADO_PX = 800   // lado máximo de la imagen final
const CALIDAD_JPG = 0.82  // calidad JPEG (0-1), 0.82 = buena calidad, ~80KB por foto

/**
 * Comprime una imagen usando Canvas API antes de subirla.
 * Reduce fotos de cámara de 5-15MB a ~80-150KB sin pérdida visual notable.
 */
function comprimirImagen(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      // Calcular dimensiones manteniendo proporción
      let { width, height } = img
      if (width > MAX_LADO_PX || height > MAX_LADO_PX) {
        if (width >= height) {
          height = Math.round((height * MAX_LADO_PX) / width)
          width = MAX_LADO_PX
        } else {
          width = Math.round((width * MAX_LADO_PX) / height)
          height = MAX_LADO_PX
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas no disponible')); return }

      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('No se pudo comprimir la imagen'))
        },
        'image/jpeg',
        CALIDAD_JPG,
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen'))
    }

    img.src = url
  })
}

export function useProductoImagen() {
  const [subiendo, setSubiendo] = useState(false)

  async function subir(file: File, productoId: string): Promise<string> {
    setSubiendo(true)
    try {
      // Comprimir antes de subir — convierte cualquier foto a JPEG optimizado
      const blob = await comprimirImagen(file)
      const path = `${productoId}.jpg`

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })

      if (error) throw new Error(error.message)

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      return `${data.publicUrl}?t=${Date.now()}`
    } finally {
      setSubiendo(false)
    }
  }

  async function eliminar(productoId: string) {
    await supabase.storage.from(BUCKET).remove([`${productoId}.jpg`])
  }

  return { subiendo, subir, eliminar }
}
