// Resuelve una "modalidad" de venta/compra/ajuste (legacy 'unidad'/'caja'/
// 'saco', o el id de una fila de producto_presentaciones) contra un producto
// concreto: cuántas unidades base representa, a qué precio y con qué
// etiqueta mostrarla. Punto único usado por el carrito (POS), el ticket
// (Receipt/Ventas), Compras y los ajustes de stock — evita que cada pantalla
// reimplemente esta conversión por su cuenta y se desincronicen entre sí
// (la misma clase de bug que antes existía en el backend, ver
// supabase/schema.sql: resolver_presentacion()).
//
// El servidor (registrar_venta / registrar_compra) SIEMPRE recalcula estos
// valores de forma independiente antes de tocar el stock — lo de aquí es
// solo para que la UI muestre precios/cantidades correctos y coherentes;
// nunca es la fuente de verdad del stock.
import type { ModalidadVenta, Producto } from '@/types/database'

export interface PresentacionResuelta {
  /** Etiqueta corta para mostrar en UI ("Caja", "Saco", o el nombre de la presentación). null = unidad simple. */
  etiqueta: string | null
  /** Unidades base (stock_actual) que representa UNA de esta presentación. */
  factor: number
  /** Precio de venta de una unidad de esta presentación. */
  precioVenta: number
  /** Precio de compra configurado para esta presentación, si existe. */
  precioCompra: number | null
  /** true si es una presentación marcada como fracción (solo informativo). */
  esFraccion: boolean
}

const BASE: PresentacionResuelta = {
  etiqueta: null,
  factor: 1,
  precioVenta: 0,
  precioCompra: null,
  esFraccion: false,
}

/** Resuelve una modalidad contra un producto. Nunca lanza: ante datos desconocidos cae a "unidad". */
export function resolverPresentacion(producto: Producto, modalidad: ModalidadVenta): PresentacionResuelta {
  if (!modalidad || modalidad === 'unidad') {
    return { ...BASE, precioVenta: producto.precio_venta, precioCompra: producto.precio_compra }
  }
  if (modalidad === 'caja') {
    return {
      etiqueta: 'Caja',
      factor: producto.unidades_por_caja ?? 1,
      precioVenta: producto.precio_venta_caja ?? producto.precio_venta,
      precioCompra: null,
      esFraccion: false,
    }
  }
  if (modalidad === 'saco') {
    return {
      etiqueta: 'Saco',
      factor: producto.kg_por_saco ?? 1,
      precioVenta: producto.precio_venta_saco ?? producto.precio_venta,
      precioCompra: null,
      esFraccion: false,
    }
  }
  const fila = (producto.presentaciones ?? []).find((p) => p.id === modalidad && p.activo)
  if (fila) {
    return {
      etiqueta: fila.nombre,
      factor: fila.factor_unidades,
      precioVenta: fila.precio_venta,
      precioCompra: fila.precio_compra,
      esFraccion: fila.es_fraccion,
    }
  }
  // Presentacion eliminada/desconocida (ej. se borro mientras estaba en un
  // carrito abierto en otro dispositivo): no debe romper la pantalla, cae a
  // precio de unidad. El servidor la rechazara igualmente al confirmar.
  return { ...BASE, precioVenta: producto.precio_venta, precioCompra: producto.precio_compra }
}

export interface OpcionPresentacion {
  modalidad: ModalidadVenta
  etiqueta: string
  factor: number
  precioVenta: number
  precioCompra: number | null
  esFraccion: boolean
  /** Cuántas de esta presentación hay disponibles con el stock actual. */
  disponible: number
}

/** Presentaciones adicionales a "unidad" que se pueden vender/comprar de este producto (caja, saco y flexibles), ordenadas para mostrar. */
export function presentacionesDisponibles(producto: Producto): OpcionPresentacion[] {
  const lista: OpcionPresentacion[] = []
  if (producto.tiene_caja) {
    const factor = producto.unidades_por_caja ?? 1
    lista.push({
      modalidad: 'caja',
      etiqueta: 'Caja',
      factor,
      precioVenta: producto.precio_venta_caja ?? producto.precio_venta,
      precioCompra: null,
      esFraccion: false,
      disponible: Math.floor(producto.stock_actual / factor),
    })
  }
  if (producto.tiene_saco) {
    const factor = producto.kg_por_saco ?? 1
    lista.push({
      modalidad: 'saco',
      etiqueta: 'Saco',
      factor,
      precioVenta: producto.precio_venta_saco ?? producto.precio_venta,
      precioCompra: null,
      esFraccion: false,
      disponible: Math.floor(producto.stock_actual / factor),
    })
  }
  for (const p of producto.presentaciones ?? []) {
    if (!p.activo) continue
    lista.push({
      modalidad: p.id,
      etiqueta: p.nombre,
      factor: p.factor_unidades,
      precioVenta: p.precio_venta,
      precioCompra: p.precio_compra,
      esFraccion: p.es_fraccion,
      disponible: Math.floor(producto.stock_actual / p.factor_unidades),
    })
  }
  return lista.sort((a, b) => a.factor - b.factor)
}

/** Máximo de "cantidad" vendible/agregable de esta modalidad dado el stock actual. */
export function maxCantidadPresentacion(producto: Producto, modalidad: ModalidadVenta): number {
  if (!modalidad || modalidad === 'unidad') return producto.stock_actual
  return Math.floor(producto.stock_actual / resolverPresentacion(producto, modalidad).factor)
}
