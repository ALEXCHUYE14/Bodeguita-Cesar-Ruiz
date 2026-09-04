import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useCarrito } from '@/hooks/useCarrito'
import { useAuth } from '@/context/AuthContext'

// Antes el carrito vivia como estado local DENTRO de POS.tsx (useCarrito()
// llamado directo en el componente de la pagina). Eso significa que al
// navegar a otra pantalla (Inventario, Clientes, etc.) React desmonta POS
// por completo y el carrito se perdia — el cajero volvia a "Punto de venta"
// y encontraba todo vacio, aunque solo se haya ido a mirar otra pantalla un
// momento.
//
// Moviendolo a un Provider en la raiz de la app (ver App.tsx), el estado del
// carrito vive fuera de POS y sobrevive a cualquier cambio de ruta dentro de
// la aplicacion — solo se reinicia si se recarga la pagina por completo o se
// cierra sesion, que es el comportamiento esperado (evita vender con
// precios/stock potencialmente desactualizados tras un reinicio completo).
type CarritoState = ReturnType<typeof useCarrito>

const CarritoContext = createContext<CarritoState | undefined>(undefined)

export function CarritoProvider({ children }: { children: ReactNode }) {
  const carrito = useCarrito()

  // Vacia el carrito cada vez que cambia el usuario autenticado (logout, o
  // un cajero distinto inicia sesion en el mismo dispositivo/pestaña sin
  // recargar la pagina). Sin esto, al vivir el carrito en un Provider por
  // encima de las rutas (para sobrevivir la navegacion entre pantallas), el
  // carrito de un cajero quedaria visible para el siguiente que inicie
  // sesion — justo lo que este Provider NO debe permitir.
  const { session } = useAuth()
  const cajeroId = session?.user?.id ?? null
  useEffect(() => {
    carrito.limpiar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cajeroId])

  return <CarritoContext.Provider value={carrito}>{children}</CarritoContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCarritoCtx(): CarritoState {
  const ctx = useContext(CarritoContext)
  if (!ctx) throw new Error('useCarritoCtx debe usarse dentro de <CarritoProvider>')
  return ctx
}
