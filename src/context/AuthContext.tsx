import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Perfil } from '@/types/database'

interface AuthState {
  session: Session | null
  perfil: Perfil | null
  cargando: boolean
  esAdmin: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [cargando, setCargando] = useState(true)

  async function cargarPerfil(userId: string) {
    const { data } = await supabase
      .from('perfiles')
      .select('*')
      .eq('id', userId)
      .single()
    setPerfil(data ?? null)
  }

  useEffect(() => {
    let activo = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!activo) return
      setSession(data.session)
      if (data.session?.user) await cargarPerfil(data.session.user.id)
      setCargando(false)
    }).catch(() => {
      if (activo) setCargando(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s)
      if (s?.user) {
        await cargarPerfil(s.user.id)
      } else {
        setPerfil(null)
      }
    })

    return () => {
      activo = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL || ''
    if (!supabaseUrl) {
      return { error: 'Sistema no configurado. Contacta al administrador.' }
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Tiempo de espera agotado. Verifica tu conexión a internet.')), 12000),
    )

    try {
      const { error } = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        timeout,
      ])
      if (error) {
        const msg =
          error.message === 'Invalid login credentials'
            ? 'Correo o contraseña incorrectos.'
            : error.message
        return { error: msg }
      }
      return { error: null }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Error de conexión.' }
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setPerfil(null)
  }

  const value: AuthState = {
    session,
    perfil,
    cargando,
    esAdmin: perfil?.rol === 'administrador',
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
