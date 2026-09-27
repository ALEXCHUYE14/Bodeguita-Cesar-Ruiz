import { useMemo, useState, useCallback, useEffect } from 'react'
import type { ItemCarrito, ModalidadVenta, Producto } from '@/types/database'
import { resolverPresentacion, maxCantidadPresentacion } from '@/utils/presentaciones'

const TASA_IGV = 0.18

// Persistencia del carrito activo: si el navegador se recarga, se cierra o
// se cuelga a mitad de una venta, los productos ya seleccionados no se
// pierden — quedan guardados hasta que la venta se complete (limpiar() se
// llama tras cobrar) o el cajero lo vacie a mano. Se guarda el snapshot
// COMPLETO del producto (no solo su id) para que el carrito se pueda pintar
// de inmediato al recargar, sin esperar a que useProductos() termine de
// cargar; POS.tsx luego "refresca" esos snapshots contra el catalogo real en
// cuanto lo tiene (ver reconciliar()), para no vender con precio/stock
// desactualizado.
const CARRITO_KEY = 'pos-carrito-activo-v1'

interface CarritoGuardado {
  items: ItemCarrito[]
  descuento: number
}

function leerCarritoGuardado(): CarritoGuardado {
  try {
    const raw = localStorage.getItem(CARRITO_KEY)
    if (!raw) return { items: [], descuento: 0 }
    const data = JSON.parse(raw) as Partial<CarritoGuardado>
    if (!Array.isArray(data.items)) return { items: [], descuento: 0 }
    // Descarta filas corruptas (localStorage editado a mano, version vieja, etc.)
    // en vez de romper el carrito entero por una sola fila invalida.
    const items = data.items.filter(
      (i): i is ItemCarrito =>
        !!i && typeof i === 'object' && !!i.producto && typeof i.producto.id === 'string' &&
        typeof i.cantidad === 'number' && i.cantidad > 0,
    )
    return { items, descuento: Number(data.descuento) || 0 }
  } catch {
    return { items: [], descuento: 0 }
  }
}

function itemKey(productoId: string, modalidad: ModalidadVenta) {
  return `${productoId}::${modalidad}`
}

function precioItem(item: ItemCarrito): number {
  return resolverPresentacion(item.producto, item.modalidad).precioVenta
}

function maxCantidad(producto: Producto, modalidad: ModalidadVenta): number {
  return maxCantidadPresentacion(producto, modalidad)
}

export function useCarrito() {
  const [items, setItems] = useState<ItemCarrito[]>(() => leerCarritoGuardado().items)
  const [descuento, setDescuento] = useState<number>(() => leerCarritoGuardado().descuento)

  // Persiste automaticamente cualquier cambio.
  useEffect(() => {
    try {
      if (items.length === 0) localStorage.removeItem(CARRITO_KEY)
      else localStorage.setItem(CARRITO_KEY, JSON.stringify({ items, descuento }))
    } catch {
      // localStorage lleno/bloqueado (modo privado, cuota, etc.): el carrito
      // sigue funcionando en memoria, solo no sobrevive una recarga.
    }
  }, [items, descuento])

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

  // Refresca cada item del carrito contra la lista de productos VIGENTE (la
  // que trae useProductos, siempre al dia por carga inicial/realtime) — un
  // producto desactivado/eliminado se quita solo, uno con menos stock que
  // antes recorta su cantidad, y precios/imagen quedan actualizados. Se
  // llama desde POS.tsx cada vez que el catalogo cambia; devuelve los
  // nombres quitados/recortados para que la pantalla avise con un toast.
  const reconciliar = useCallback(
    (productosFrescos: Producto[]) => {
      // Lee "items" directo del closure (no via el callback de setItems) a
      // proposito: en StrictMode, React puede invocar dos veces la funcion
      // que se le pasa a setItems, y aqui se hacen efectos (push a los
      // arreglos de abajo) que no deben duplicarse.
      if (productosFrescos.length === 0) return { eliminados: [] as string[], reducidos: [] as string[] }
      const mapa = new Map(productosFrescos.map((p) => [p.id, p]))
      const eliminados: string[] = []
      const reducidos: string[] = []
      const nuevos: ItemCarrito[] = []
      for (const item of items) {
        const fresco = mapa.get(item.producto.id)
        if (!fresco || !fresco.activo) {
          eliminados.push(item.producto.nombre)
          continue
        }
        const max = maxCantidadPresentacion(fresco, item.modalidad)
        if (max <= 0) {
          eliminados.push(fresco.nombre)
          continue
        }
        const cantidadAjustada = Math.min(item.cantidad, max)
        if (cantidadAjustada < item.cantidad) reducidos.push(fresco.nombre)
        nuevos.push({ ...item, producto: fresco, cantidad: cantidadAjustada })
      }
      setItems(nuevos)
      return { eliminados, reducidos }
    },
    [items],
  )

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
    reconciliar,
    totales,
    vacio: items.length === 0,
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100
}
