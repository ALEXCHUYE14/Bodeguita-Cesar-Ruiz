import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const url: string = import.meta.env.VITE_SUPABASE_URL || ''
const anonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!url || !anonKey) {
  console.error(
    '[Bodeguita Juli] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. ' +
      'Configura estas variables en el panel de Vercel (Settings → Environment Variables).',
  )
}

// Fallback seguro: si faltan las vars, se usa un cliente con URL inválida que
// fallará en las llamadas de red (error visible) en lugar de crashear el módulo.
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
