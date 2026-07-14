import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { BRAND } from '@/config/brand'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Sin esto, cualquier error de render en producción deja la pantalla en
 * blanco (React desmonta el árbol sin avisar). Con esto se muestra una
 * pantalla de recuperación con el motivo del error y un botón para recargar.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="grid min-h-dvh place-items-center bg-ink-50 px-6">
        <div className="w-full max-w-sm rounded-2xl border border-ink-100 bg-white p-6 text-center shadow-card">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-red-50">
            <AlertTriangle className="size-6 text-red-500" />
          </div>
          <h1 className="font-display text-lg font-bold text-ink-900">
            Algo salió mal
          </h1>
          <p className="mt-1.5 text-sm text-ink-500">
            {BRAND.nombre} encontró un error inesperado. Recarga la página; si
            el problema continúa, contacta a soporte.
          </p>
          <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-left text-xs text-ink-400">
            {error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800"
          >
            <RefreshCw className="size-4" />
            Recargar
          </button>
        </div>
      </div>
    )
  }
}
