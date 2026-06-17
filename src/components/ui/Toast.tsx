import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cx } from '@/utils/format'

type Tipo = 'success' | 'error' | 'info'
interface Toast {
  id: number
  tipo: Tipo
  mensaje: string
}

interface ToastApi {
  exito: (m: string) => void
  error: (m: string) => void
  info: (m: string) => void
}

const ToastContext = createContext<ToastApi | undefined>(undefined)

const iconos = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
}
const colores: Record<Tipo, string> = {
  success: 'border-accent-200 bg-accent-50 text-accent-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((tipo: Tipo, mensaje: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tipo, mensaje }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      exito: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:translate-x-0">
        {toasts.map((t) => {
          const Icon = iconos[t.tipo]
          return (
            <div
              key={t.id}
              className={cx(
                'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-pop animate-fade-up',
                colores[t.tipo],
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <p className="flex-1 text-sm font-medium leading-snug">{t.mensaje}</p>
              <button
                onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                className="text-current/60 hover:text-current"
              >
                <X className="size-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
