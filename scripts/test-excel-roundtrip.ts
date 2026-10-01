// Prueba E2E: exporta un inventario de muestra (con presentaciones, sin
// presentaciones, con y sin foto) con la MISMA función que usa el botón
// "Exportar Excel" (construirLibroInventario, en inventarioExcelFormato.ts)
// y lo vuelve a leer con la MISMA función que usa "Importar Excel"
// (parsearFilasInventario) — confirma que cada columna vuelve exactamente
// igual, sin pérdida ni desfase.
//
// No depende de Supabase ni del navegador (por eso la lógica de armado y
// parseo vive separada en inventarioExcelFormato.ts, sin esos imports) —
// corre en Node puro:
//
//   node scripts/test-excel-roundtrip.ts
//
// Node 20+ soporta ejecutar .ts directo (strip de tipos nativo); los
// "import type" de @/types/database se borran en ese paso y nunca se
// resuelven en tiempo de ejecución, así que el alias "@/" no hace falta
// aquí — los imports de valores (xlsx, inventarioExcelFormato) son rutas
// relativas normales.

import * as XLSX from 'xlsx'
import {
  filaDesdeProducto,
  construirLibroInventario,
  parsearFilasInventario,
  limpiarTexto,
  type FilaInventarioImport,
} from '../src/utils/inventarioExcelFormato.ts'
import type { Producto, ProductoPresentacion } from '../src/types/database.ts'

let fallos = 0
let pruebas = 0

function assert(cond: boolean, mensaje: string): void {
  pruebas++
  if (!cond) {
    fallos++
    console.error(`✗ FALLO: ${mensaje}`)
  }
}

function assertEq(actual: unknown, esperado: unknown, mensaje: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(esperado)
  assert(a === e, `${mensaje}\n    esperado: ${e}\n    actual:   ${a}`)
}

// ── Datos de muestra ────────────────────────────────────────────────────

function producto(parcial: Partial<Producto>): Producto {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    sku: 'SKU',
    nombre: 'Producto',
    categoria_id: null,
    precio_compra: 0,
    precio_venta: 0,
    precio_venta_caja: null,
    stock_actual: 0,
    stock_minimo: 5,
    unidad: 'unidad',
    activo: true,
    image_url: null,
    fecha_vencimiento: null,
    tiene_caja: false,
    unidades_por_caja: null,
    tipo_venta: 'unidad',
    tiene_saco: false,
    kg_por_saco: null,
    precio_venta_saco: null,
    creado_en: '2026-01-01T00:00:00Z',
    actualizado_en: '2026-01-01T00:00:00Z',
    categorias: null,
    presentaciones: [],
    ...parcial,
  }
}

function presentacion(parcial: Partial<ProductoPresentacion>): ProductoPresentacion {
  return {
    id: 'pres-' + Math.random().toString(36).slice(2),
    producto_id: '',
    nombre: 'Caja',
    factor_unidades: 12,
    precio_compra: null,
    precio_venta: 0,
    es_fraccion: false,
    orden: 0,
    activo: true,
    creado_en: '2026-01-01T00:00:00Z',
    actualizado_en: '2026-01-01T00:00:00Z',
    ...parcial,
  }
}

// A) Producto por unidad, CON presentaciones, CON foto, con categoria y vencimiento.
const productoA = producto({
  sku: '7501055300464', // numerico-como-texto: el caso que rompe si Excel lo reinterpreta como numero
  nombre: 'Coca Cola 500ml (ñoño, "acentuado")',
  categoria_id: 'cat-1',
  categorias: { id: 'cat-1', nombre: 'Bebidas', color: '#059669', creado_en: '2026-01-01T00:00:00Z' },
  precio_compra: 1.8,
  precio_venta: 3,
  precio_venta_caja: 32.5,
  stock_actual: 48,
  stock_minimo: 12,
  unidad: 'unidad',
  tiene_caja: true,
  unidades_por_caja: 12,
  tipo_venta: 'unidad',
  fecha_vencimiento: '2026-12-31',
  image_url: 'https://ejemplo.supabase.co/storage/v1/object/public/product-images/id-A.jpg',
  activo: true,
})
const presentacionesA: ProductoPresentacion[] = [
  presentacion({ nombre: 'Caja', factor_unidades: 12, precio_venta: 32.5, precio_compra: 20 }),
  presentacion({ nombre: 'Media Caja', factor_unidades: 6, precio_venta: 17, precio_compra: null, es_fraccion: true }),
]

// B) Producto a granel, SIN presentaciones, SIN foto, SIN categoria.
const productoB = producto({
  sku: 'ARROZ-GRANEL-01',
  nombre: 'Arroz a granel',
  precio_compra: 3.2,
  precio_venta: 4.5,
  stock_actual: 125.5,
  stock_minimo: 20,
  unidad: 'kg',
  tipo_venta: 'granel',
  tiene_saco: true,
  kg_por_saco: 50,
  precio_venta_saco: 210,
  image_url: null,
  activo: true,
})

// C) Producto inactivo, valores en 0/limite, sin presentaciones, sin foto.
const productoC = producto({
  sku: 'DESCONTINUADO-01',
  nombre: 'Producto descontinuado',
  precio_compra: 0,
  precio_venta: 0,
  stock_actual: 0,
  stock_minimo: 0,
  activo: false,
  image_url: null,
})

const productos = [productoA, productoB, productoC]
const presentacionesPorProducto = new Map<string, ProductoPresentacion[]>([[productoA.id, presentacionesA]])

// ── Exporta (misma función que el botón "Exportar Excel") ────────────────
const filasDatos = productos.map((p) => filaDesdeProducto(p, presentacionesPorProducto.get(p.id)))
const wb = construirLibroInventario(XLSX, filasDatos)
const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer

console.log(`Libro generado: ${buffer.length} bytes`)

// ── Vuelve a leer (misma función que el botón "Importar Excel") ──────────
const wb2 = XLSX.read(buffer, { type: 'buffer', cellDates: false })
const ws2 = wb2.Sheets[wb2.SheetNames[0]]
const todas = XLSX.utils.sheet_to_json<unknown[]>(ws2, { header: 1, defval: '', raw: true })
const { filas: parseadas, avisoFormato } = parsearFilasInventario(todas)

assert(avisoFormato === null, `no deberia haber aviso de formato al reimportar el propio export (obtuvo: ${avisoFormato})`)
assertEq(parseadas.length, productos.length, 'cantidad de filas parseadas debe ser igual a la cantidad exportada')

// ── Compara cada producto contra su fila reimportada, campo por campo ────
function esperada(p: Producto, pres: ProductoPresentacion[] | undefined): FilaInventarioImport {
  return {
    sku: p.sku,
    nombre: p.nombre,
    categoria: p.categorias?.nombre ?? null,
    tipo_venta: p.tipo_venta === 'granel' ? 'Granel' : 'Unidad',
    unidad: p.unidad,
    precio_compra: p.precio_compra,
    precio_venta: p.precio_venta,
    precio_venta_caja: p.precio_venta_caja,
    stock_actual: p.stock_actual,
    stock_minimo: p.stock_minimo,
    tiene_caja: p.tiene_caja ? 'SI' : 'NO',
    unidades_por_caja: p.unidades_por_caja,
    tiene_saco: p.tiene_saco ? 'SI' : 'NO',
    kg_por_saco: p.kg_por_saco,
    precio_venta_saco: p.precio_venta_saco,
    presentaciones:
      pres && pres.length > 0
        ? JSON.stringify(
            pres.map((x) => ({
              nombre: x.nombre,
              factor_unidades: x.factor_unidades,
              precio_compra: x.precio_compra,
              precio_venta: x.precio_venta,
              es_fraccion: x.es_fraccion,
            })),
          )
        : null,
    fecha_vencimiento: p.fecha_vencimiento,
    activo: p.activo ? 'SI' : 'NO',
  }
}

productos.forEach((p, i) => {
  const esp = esperada(p, presentacionesPorProducto.get(p.id))
  const act = parseadas[i]

  assertEq(act.sku, esp.sku, `[${p.sku}] SKU debe volver exacto (sin notacion cientifica/redondeo)`)
  assertEq(act.nombre, esp.nombre, `[${p.sku}] nombre debe volver exacto (acentos/ñ/comillas incluidos)`)
  assertEq(act.categoria, esp.categoria, `[${p.sku}] categoria`)
  assertEq(act.tipo_venta, esp.tipo_venta, `[${p.sku}] tipo_venta`)
  assertEq(act.unidad, esp.unidad, `[${p.sku}] unidad`)
  assertEq(act.precio_compra, esp.precio_compra, `[${p.sku}] precio_compra`)
  assertEq(act.precio_venta, esp.precio_venta, `[${p.sku}] precio_venta`)
  assertEq(act.precio_venta_caja, esp.precio_venta_caja, `[${p.sku}] precio_venta_caja`)
  assertEq(act.stock_actual, esp.stock_actual, `[${p.sku}] stock_actual`)
  assertEq(act.stock_minimo, esp.stock_minimo, `[${p.sku}] stock_minimo`)
  assertEq(act.tiene_caja, esp.tiene_caja, `[${p.sku}] tiene_caja`)
  assertEq(act.unidades_por_caja, esp.unidades_por_caja, `[${p.sku}] unidades_por_caja`)
  assertEq(act.tiene_saco, esp.tiene_saco, `[${p.sku}] tiene_saco`)
  assertEq(act.kg_por_saco, esp.kg_por_saco, `[${p.sku}] kg_por_saco`)
  assertEq(act.precio_venta_saco, esp.precio_venta_saco, `[${p.sku}] precio_venta_saco`)
  assertEq(act.fecha_vencimiento, esp.fecha_vencimiento, `[${p.sku}] fecha_vencimiento`)
  assertEq(act.activo, esp.activo, `[${p.sku}] activo`)

  // Presentaciones: compara como estructura (orden de llaves no importa), no como texto literal.
  const presAct = act.presentaciones ? JSON.parse(act.presentaciones) : null
  const presEsp = esp.presentaciones ? JSON.parse(esp.presentaciones) : null
  assertEq(presAct, presEsp, `[${p.sku}] presentaciones (estructura)`)
})

// ── Caso aparte: celdas vacias deben volver como null (nunca "0" ni "NaN"),
//    y numeros no finitos se limpian a 0 ANTES de exportar (nunca llegan a
//    la celda como NaN/Infinity). ─────────────────────────────────────────
const productoRaro = producto({
  sku: 'RARO-01',
  nombre: 'Producto con numeros invalidos',
  precio_compra: NaN,
  precio_venta: Infinity,
  stock_actual: -Infinity,
})
const filaRara = filaDesdeProducto(productoRaro, undefined)
assertEq(filaRara[5], 0, 'NaN en precio_compra se exporta como 0, no como NaN')
assertEq(filaRara[6], 0, 'Infinity en precio_venta se exporta como 0, no como Infinity')
assertEq(filaRara[8], 0, '-Infinity en stock_actual se exporta como 0, no como -Infinity')

// Un producto SIN presentaciones debe volver con presentaciones = null (celda vacia), nunca "[]".
const filaSinPres = esperada(productoB, undefined)
assertEq(filaSinPres.presentaciones, null, 'producto sin presentaciones exporta celda vacia (null), nunca "[]"')

// ── Caso aparte: caracteres de control se limpian antes de escribir ──────
const nombreConControl = 'Nombre\x00Malo\x07Con\x1FControl'
assertEq(limpiarTexto(nombreConControl), 'NombreMaloConControl', 'limpiarTexto() quita caracteres de control 0x00-0x1F/0x7F')
assertEq(limpiarTexto('Con\ttab\ny salto\rde linea'), 'Con\ttab\ny salto\rde linea', 'limpiarTexto() CONSERVA tab/LF/CR')

// ── Resultado ──────────────────────────────────────────────────────────
console.log(`\n${pruebas - fallos}/${pruebas} aserciones pasaron.`)
if (fallos > 0) {
  console.error(`\n${fallos} FALLO(S).`)
  process.exit(1)
} else {
  console.log('\nTODO OK: el roundtrip exportar -> reimportar preserva cada columna exactamente.')
}
