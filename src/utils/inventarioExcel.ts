// Wrapper de exportarInventarioExcel()/importarInventarioExcel(): toca
// Supabase y el navegador (descarga el archivo / lee un File). La lógica
// pura de armado y parseo del .xlsx vive en inventarioExcelFormato.ts (sin
// dependencias de Supabase ni del navegador), para poder probarla también
// desde Node (ver prueba E2E en scripts/).
//
// xlsx (SheetJS) se importa SIEMPRE con import() dinámico dentro de las
// funciones que lo usan — nunca estático arriba del archivo — para que
// quede en su propio chunk, cargado solo la primera vez que alguien usa
// Exportar/Importar Excel, no sumado al paquete principal (ver
// vite.config.ts: manualChunks + runtimeCaching para este chunk).
import { supabase } from '@/lib/supabase'
import type { Producto, ProductoPresentacion } from '@/types/database'
import {
  filaDesdeProducto,
  construirLibroInventario,
  parsearFilasInventario,
  type FilaInventarioImport,
  type ResultadoImportacionFila,
} from '@/utils/inventarioExcelFormato'

export type { FilaInventarioImport, ResultadoImportacionFila }

// ── Exportar ────────────────────────────────────────────────────────────

/**
 * Exporta TODO el inventario (incluye productos inactivos — es un respaldo
 * completo, no solo el catálogo en venta) a un .xlsx descargable. Trae las
 * presentaciones por separado y las agrupa, igual que useProductos.ts, para
 * no depender de que supabase-js infiera el tipo de un embed PostgREST.
 */
export async function exportarInventarioExcel(): Promise<{ productos: number }> {
  const [prodRes, presRes] = await Promise.all([
    supabase.from('productos').select('*, categorias(*)').order('nombre'),
    supabase.from('producto_presentaciones').select('*').eq('activo', true).order('orden'),
  ])
  if (prodRes.error) throw prodRes.error
  if (presRes.error) throw presRes.error

  const grupos = new Map<string, ProductoPresentacion[]>()
  for (const fila of presRes.data ?? []) {
    const arr = grupos.get(fila.producto_id)
    if (arr) arr.push(fila)
    else grupos.set(fila.producto_id, [fila])
  }

  const productos = (prodRes.data ?? []) as Producto[]
  const filasDatos = productos.map((p) => filaDesdeProducto(p, grupos.get(p.id)))

  const XLSX = await import('xlsx')
  const wb = construirLibroInventario(XLSX, filasDatos)
  const hoy = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `inventario_${hoy}.xlsx`, { compression: true })

  return { productos: productos.length }
}

// ── Importar ────────────────────────────────────────────────────────────

/** Lee un .xlsx (el mismo que genera exportarInventarioExcel, o uno editado) y lo convierte en filas listas para mandarle a importar_inventario(). */
export async function leerArchivoExcelInventario(
  file: File,
): Promise<{ filas: FilaInventarioImport[]; avisoFormato: string | null }> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const nombreHoja = wb.SheetNames[0]
  if (!nombreHoja) throw new Error('El archivo no tiene ninguna hoja.')
  const ws = wb.Sheets[nombreHoja]
  const todas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true })
  return parsearFilasInventario(todas)
}

/** Llama al RPC importar_inventario con el lote ya parseado y devuelve el resultado por fila. */
export async function importarInventarioExcel(
  filas: FilaInventarioImport[],
): Promise<ResultadoImportacionFila[]> {
  if (filas.length === 0) return []
  const { data, error } = await supabase.rpc('importar_inventario', { p_filas: filas })
  if (error) throw error
  return (data ?? []) as unknown as ResultadoImportacionFila[]
}
