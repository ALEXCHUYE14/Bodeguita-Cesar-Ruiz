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
  /** Rol intermedio: puede ver reportes (Rentabilidad, Compras, Mermas,
   *  Clientes, Proveedores, Resumen) pero no crear/editar/eliminar nada. */
  esSupervisor: boolean
  /** true para administrador o supervisor — util para gatear paginas de solo lectura. */
  puedeVerReportes: boolean
  /** `onReintentando` (opcional) se invoca si el primer intento agota su
   *  plazo y se pasa a un segundo intento con mas margen — util para que la
   *  pantalla de login muestre "Reintentando..." en vez de parecer colgada. */
  signIn: (
    email: string,
    password: string,
    onReintentando?: () => void,
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

// Marca especifica para distinguir "se agoto el plazo de espera" de
// cualquier otro error real de supabase-js (credenciales invalidas, etc.).
class TimeoutError extends Error {}

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

  async function signIn(
    email: string,
    password: string,
    onReintentando?: () => void,
  ) {
    const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL || ''
    if (!supabaseUrl) {
      return { error: 'Sistema no configurado. Contacta al administrador.' }
    }

    // Proyectos Supabase en plan gratuito "duermen" tras un tiempo sin uso: el
    // primer pedido tras la inactividad puede tardar bastante mas de lo normal
    // en responder mientras el servidor se reactiva (medido en la practica:
    // hasta 20-30s), y luego vuelve a responder rapido. Por eso el primer
    // intento usa un plazo corto y, si se agota, se reintenta una sola vez con
    // mas margen antes de darle al usuario un error — evita que un simple
    // arranque en frio del servidor se vea como "no puedo ingresar".
    async function intentar(ms: number) {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new TimeoutError()), ms),
      )
      return Promise.race([supabase.auth.signInWithPassword({ email, password }), timeout])
    }

    try {
      let resultado
      try {
        resultado = await intentar(15000)
      } catch (e) {
        if (!(e instanceof TimeoutError)) throw e
        onReintentando?.()
        resultado = await intentar(25000)
      }
      const { error } = resultado
      if (error) {
        const msg =
          error.message === 'Invalid login credentials'
            ? 'Correo o contraseña incorrectos.'
            : error.message
        return { error: msg }
      }
      return { error: null }
    } catch (e) {
      if (e instanceof TimeoutError) {
        return {
          error:
            'El servidor está tardando en responder (puede estar reactivándose tras un tiempo sin uso). Intenta nuevamente en unos segundos.',
        }
      }
      return { error: e instanceof Error ? e.message : 'Error de conexión.' }
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setPerfil(null)
  }

  const esAdmin = perfil?.rol === 'administrador'
  const esSupervisor = perfil?.rol === 'supervisor'

  const value: AuthState = {
    session,
    perfil,
    cargando,
    esAdmin,
    esSupervisor,
    puedeVerReportes: esAdmin || esSupervisor,
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
