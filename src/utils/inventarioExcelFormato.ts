// Lógica PURA de armado/lectura del .xlsx de inventario — sin import de
// Supabase ni de APIs de navegador (File/URL.createObjectURL), para poder
// probarla en Node (ver prueba E2E) ademas de en el navegador. El wrapper
// que sí toca Supabase y dispara la descarga vive en inventarioExcel.ts.
import type { Producto, ProductoPresentacion } from '@/types/database'

export const COLUMNAS_INVENTARIO = [
  'SKU',
  'Nombre',
  'Categoría',
  'Tipo de venta',
  'Unidad',
  'Precio compra',
  'Precio venta',
  'Precio venta caja',
  'Stock actual',
  'Stock mínimo',
  'Tiene caja',
  'Unidades por caja',
  'Tiene saco',
  'Kg por saco',
  'Precio venta saco',
  'Presentaciones',
  'Vence',
  'Activo',
] as const

/** Columnas (0-based) que se fuerzan a texto explícito al exportar — ver nota en construirLibroInventario(). */
export const COLUMNAS_TEXTO_FORZADO = [0, 15, 16] // SKU, Presentaciones, Vence

export interface FilaInventarioImport {
  sku: string | null
  nombre: string | null
  categoria: string | null
  tipo_venta: string | null
  unidad: string | null
  precio_compra: number | null
  precio_venta: number | null
  precio_venta_caja: number | null
  stock_actual: number | null
  stock_minimo: number | null
  tiene_caja: string | null
  unidades_por_caja: number | null
  tiene_saco: string | null
  kg_por_saco: number | null
  precio_venta_saco: number | null
  presentaciones: string | null
  fecha_vencimiento: string | null
  activo: string | null
}

export interface ResultadoImportacionFila {
  fila: number
  sku: string
  accion: 'creado' | 'actualizado' | 'error'
  mensaje: string
}

// ── Saneamiento (un solo caracter de control en una celda deja el .xlsx
// corrupto y Excel lo rechaza con "Excel encontró un problema...") ────────
// eslint-disable-next-line no-control-regex
const CARACTERES_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

export function limpiarTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor).replace(CARACTERES_CONTROL, '')
}

export function numSeguro(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor))
  return Number.isFinite(n) ? n : 0
}

/** Presentaciones -> el mismo JSON (solo los campos relevantes) que espera importar_inventario(). Vacio = sin presentaciones -> celda vacia. */
export function serializarPresentaciones(filas: ProductoPresentacion[] | undefined): string {
  if (!filas || filas.length === 0) return ''
  const limpio = filas.map((p) => ({
    nombre: limpiarTexto(p.nombre),
    factor_unidades: numSeguro(p.factor_unidades),
    precio_compra: p.precio_compra === null ? null : numSeguro(p.precio_compra),
    precio_venta: numSeguro(p.precio_venta),
    es_fraccion: !!p.es_fraccion,
  }))
  return JSON.stringify(limpio)
}

/** Un producto (+ sus presentaciones) -> la fila de celdas tal como va al .xlsx. Compartido por el export real y la prueba E2E. */
export function filaDesdeProducto(p: Producto, presentaciones: ProductoPresentacion[] | undefined): (string | number)[] {
  return [
    limpiarTexto(p.sku),
    limpiarTexto(p.nombre),
    limpiarTexto(p.categorias?.nombre ?? ''),
    p.tipo_venta === 'granel' ? 'Granel' : 'Unidad',
    limpiarTexto(p.unidad),
    numSeguro(p.precio_compra),
    numSeguro(p.precio_venta),
    p.precio_venta_caja === null ? '' : numSeguro(p.precio_venta_caja),
    numSeguro(p.stock_actual),
    numSeguro(p.stock_minimo),
    p.tiene_caja ? 'SI' : 'NO',
    p.unidades_por_caja === null ? '' : numSeguro(p.unidades_por_caja),
    p.tiene_saco ? 'SI' : 'NO',
    p.kg_por_saco === null ? '' : numSeguro(p.kg_por_saco),
    p.precio_venta_saco === null ? '' : numSeguro(p.precio_venta_saco),
    serializarPresentaciones(presentaciones),
    limpiarTexto(p.fecha_vencimiento ?? ''),
    p.activo ? 'SI' : 'NO',
  ]
}

/** Arma el libro (workbook) de SheetJS a partir de filas ya construidas — recibe el modulo xlsx ya cargado (import() dinamico lo resuelve el llamador, ver nota de chunking en inventarioExcel.ts). */
export function construirLibroInventario(
  XLSX: typeof import('xlsx'),
  filasDatos: (string | number)[][],
): import('xlsx').WorkBook {
  const filas: (string | number)[][] = [[...COLUMNAS_INVENTARIO], ...filasDatos]
  const ws = XLSX.utils.aoa_to_sheet(filas)

  // Fuerza SKU, Presentaciones y Vence como celdas de TEXTO explicitas: un
  // SKU numerico largo (codigo de barras) o una fecha sin forzar el tipo,
  // Excel los puede reinterpretar como numero/fecha (notacion cientifica, o
  // corrimiento de dia por zona horaria) y romper el reimport.
  const rango = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let r = rango.s.r + 1; r <= rango.e.r; r++) {
    for (const c of COLUMNAS_TEXTO_FORZADO) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const celdaObj = ws[addr]
      if (celdaObj) celdaObj.t = 's'
    }
  }
  ws['!cols'] = COLUMNAS_INVENTARIO.map((_, i) => ({ wch: i === 1 ? 28 : i === 15 ? 40 : 14 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
  return wb
}

function celda(fila: unknown[], idx: number): unknown {
  const v = fila[idx]
  return v === undefined ? '' : v
}

function celdaTexto(fila: unknown[], idx: number): string | null {
  const t = limpiarTexto(celda(fila, idx)).trim()
  return t === '' ? null : t
}

function celdaNumero(fila: unknown[], idx: number): number | null {
  const v = celda(fila, idx)
  if (v === '' || v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Convierte las filas crudas (array-of-arrays, incluye el encabezado en [0]) en objetos listos para importar_inventario(). Mismo parser que usa el botón Importar Excel y la prueba E2E. */
export function parsearFilasInventario(
  todasLasFilas: unknown[][],
): { filas: FilaInventarioImport[]; avisoFormato: string | null } {
  if (todasLasFilas.length === 0) throw new Error('El archivo esta vacio.')

  const encabezado = (todasLasFilas[0] ?? []).map((c) => String(c ?? '').trim().toLowerCase())
  const esperado = COLUMNAS_INVENTARIO.map((c) => c.toLowerCase())
  let avisoFormato: string | null = null
  if (encabezado.length < esperado.length || encabezado[0] !== esperado[0] || encabezado[1] !== esperado[1]) {
    avisoFormato =
      'El encabezado del archivo no coincide exactamente con la plantilla (Exportar Excel). ' +
      'Se intentará leer igual por posición de columna, pero revisa el resultado con cuidado.'
  }

  const filas: FilaInventarioImport[] = todasLasFilas
    .slice(1)
    .filter((fila) => fila.some((c) => String(c ?? '').trim() !== ''))
    .map((fila) => ({
      sku: celdaTexto(fila, 0),
      nombre: celdaTexto(fila, 1),
      categoria: celdaTexto(fila, 2),
      tipo_venta: celdaTexto(fila, 3),
      unidad: celdaTexto(fila, 4),
      precio_compra: celdaNumero(fila, 5),
      precio_venta: celdaNumero(fila, 6),
      precio_venta_caja: celdaNumero(fila, 7),
      stock_actual: celdaNumero(fila, 8),
      stock_minimo: celdaNumero(fila, 9),
      tiene_caja: celdaTexto(fila, 10),
      unidades_por_caja: celdaNumero(fila, 11),
      tiene_saco: celdaTexto(fila, 12),
      kg_por_saco: celdaNumero(fila, 13),
      precio_venta_saco: celdaNumero(fila, 14),
      presentaciones: celdaTexto(fila, 15),
      fecha_vencimiento: celdaTexto(fila, 16),
      activo: celdaTexto(fila, 17),
    }))

  return { filas, avisoFormato }
}
