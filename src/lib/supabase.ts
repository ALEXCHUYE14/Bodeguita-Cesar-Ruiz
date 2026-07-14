import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const urlRaw: string = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const anonKey: string = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

// Valida que la URL tenga formato correcto (ej. "https://xxxx.supabase.co").
// Si esta mal escrita en las variables de entorno de Vercel (falta "https://",
// tiene espacios, comillas pegadas, etc.), "createClient" lanza una excepcion
// SINCRONA al cargar este modulo — es decir, antes de que React llegue a
// montar la app, por lo que ningun ErrorBoundary la puede atrapar y la
// pantalla queda en blanco sin ningun aviso. Por eso se valida aqui primero.
function esUrlValida(u: string): boolean {
  try {
    new URL(u)
    return true
  } catch {
    return false
  }
}

const url = esUrlValida(urlRaw) ? urlRaw : ''

if (!url || !anonKey) {
  console.error(
    '[Comercial Ruiz] Faltan o son invalidas VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Configura estas variables en el panel de Vercel (Settings → Environment Variables) ' +
      'y vuelve a desplegar.',
  )
}

// Fallback seguro: si faltan o son invalidas, se usa un cliente con URL
// placeholder que fallara en las llamadas de red (error visible en pantalla
// al iniciar sesion) en lugar de crashear el modulo y dejar la app en blanco.
export const supabase = createClient<Database>(
  url || 'https://placeholder.invalid',
  anonKey || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  },
)
