import { useMemo, useState, useCallback } from 'react'
import type { ItemCarrito, ModalidadVenta, Producto } from '@/types/database'

const TASA_IGV = 0.18

function itemKey(productoId: string, modalidad: ModalidadVenta) {
  return `${productoId}::${modalidad}`
}

function precioItem(item: ItemCarrito): number {
  if (item.modalidad === 'caja') {
    return item.producto.precio_venta_caja ?? item.producto.precio_venta
  }
  return item.producto.precio_venta
}

function maxCantidad(producto: Producto, modalidad: ModalidadVenta): number {
  if (modalidad === 'caja') {
    return Math.floor(producto.stock_actual / (producto.unidades_por_caja ?? 1))
  }
  return producto.stock_actual
}

/** Unidades reales de stock a descontar para un item del carrito */
export function unidadesReales(item: ItemCarrito): number {
  if (item.modalidad === 'caja') {
    return item.cantidad * (item.producto.unidades_por_caja ?? 1)
  }
  return item.cantidad
}

export function useCarrito() {
  const [items, setItems] = useState<ItemCarrito[]>([])
  const [descuento, setDescuento] = useState(0)

  const agregar = useCallback(
    (producto: Producto, modalidad: ModalidadVenta = 'unidad', cantidad = 1) => {
      setItems((prev) => {
        const key = itemKey(producto.id, modalidad)
        const idx = prev.findIndex(
          (i) => itemKey(i.producto.id, i.modalidad) === key,
        )
        const max = maxCantidad(producto, modalidad)
        if (max <= 0) return prev
        if (idx >= 0) {
          const copia = [...prev]
          const nuevaCant = Math.min(copia[idx].cantidad + cantidad, max)
          copia[idx] = { ...copia[idx], cantidad: nuevaCant } as ItemCarrito
          return copia
        }
        return [
          ...prev,
          { producto, cantidad: Math.min(cantidad, max), modalidad },
        ]
      })
    },
    [],
  )

  const cambiarCantidad = useCallback(
    (productoId: string, modalidad: ModalidadVenta, cantidad: number) => {
      setItems((prev) =>
        prev
          .map((i) =>
            i.producto.id === productoId && i.modalidad === modalidad
              ? {
                  ...i,
                  cantidad: Math.max(
                    0,
                    Math.min(cantidad, maxCantidad(i.producto, modalidad)),
                  ),
                }
              : i,
          )
          .filter((i) => i.cantidad > 0),
      )
    },
    [],
  )

  const quitar = useCallback(
    (productoId: string, modalidad: ModalidadVenta) => {
      setItems((prev) =>
        prev.filter(
          (i) => !(i.producto.id === productoId && i.modalidad === modalidad),
        ),
      )
    },
    [],
  )

  const limpiar = useCallback(() => {
    setItems([])
    setDescuento(0)
  }, [])

  const totales = useMemo(() => {
    const subtotal = items.reduce(
      (s, i) => s + precioItem(i) * i.cantidad,
      0,
    )
    const desc = Math.min(descuento, subtotal)
    const total = Math.max(subtotal - desc, 0)
    const base = total / (1 + TASA_IGV)
    const igv = total - base
    const unidades = items.reduce((s, i) => s + i.cantidad, 0)
    return {
      subtotal: round(subtotal),
      descuento: round(desc),
      igv: round(igv),
      total: round(total),
      unidades,
    }
  }, [items, descuento])

  return {
    items,
    descuento,
    setDescuento,
    agregar,
    cambiarCantidad,
    quitar,
    limpiar,
    totales,
    vacio: items.length === 0,
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100
}
