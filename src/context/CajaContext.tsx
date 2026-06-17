import {
  createContext,
  useContext,
  type ReactNode,
} from 'react'
import { useCaja, type ResumenCierre } from '@/hooks/useCaja'
import { useAuth } from '@/context/AuthContext'
import { BRAND } from '@/config/brand'
import type { CajaRegistro } from '@/types/database'

interface CajaState {
  caja: CajaRegistro | null
  historial: CajaRegistro[]
  cargando: boolean
  abrir: (montoInicial: number) => Promise<CajaRegistro>
  cerrar: (montoReal: number) => Promise<ResumenCierre>
  sumarVenta: (cajaId: string, metodo: 'efectivo' | 'yape' | 'fiado', monto: number) => Promise<void>
  total: number
  recargar: () => void
  recargarHistorial: () => void
}

const CajaContext = createContext<CajaState | undefined>(undefined)

export function CajaProvider({ children }: { children: ReactNode }) {
  // Combinamos el loading de auth con el de caja para evitar un estado
  // falso de "caja cerrada" mientras Supabase restaura la sesión al recargar
  const { session, perfil, cargando: authCargando } = useAuth()
  const cajeroId = session?.user?.id ?? null
  const {
    caja,
    historial,
    cargando: cajaCargando,
    abrir: abrirHook,
    cerrar,
    sumarVenta,
    total,
    recargar,
    recargarHistorial,
  } = useCaja(cajeroId)

  async function abrir(montoInicial: number): Promise<CajaRegistro> {
    const nombre = perfil?.rol === 'administrador'
      ? BRAND.operador
      : (perfil?.nombre?.split(' ')[0] ?? 'Cajero')
    return abrirHook(montoInicial, nombre)
  }

  const value: CajaState = {
    caja,
    historial,
    // Mientras auth siga cargando, la caja también se muestra como "cargando"
    cargando: authCargando || cajaCargando,
    abrir,
    cerrar,
    sumarVenta,
    total,
    recargar,
    recargarHistorial,
  }

  return <CajaContext.Provider value={value}>{children}</CajaContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCajaCtx(): CajaState {
  const ctx = useContext(CajaContext)
  if (!ctx) throw new Error('useCajaCtx debe usarse dentro de <CajaProvider>')
  return ctx
}
