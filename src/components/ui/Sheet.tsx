import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from '@/utils/format'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** En desktop centra como modal; en movil sube como bottom sheet */
  maxWidth?: string
  footer?: ReactNode
}

/**
 * Componente adaptativo: en pantallas pequenas se comporta como un
 * "bottom sheet" nativo (sube desde abajo); en desktop es un modal centrado.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
  footer,
}: SheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div
        className="absolute inset-0 bg-ink-950/40 backdrop-blur-[2px] animate-fade-up"
        onClick={onClose}
      />
      <div
        className={cx(
          'relative z-10 w-full bg-white shadow-pop',
          'rounded-t-2xl sm:rounded-2xl',
          'animate-slide-up sm:animate-scale-in',
          'max-h-[92vh] sm:max-h-[88vh] flex flex-col',
          'sm:m-4',
          maxWidth + ' sm:w-full',
        )}
      >
        {/* Handle visual de bottom sheet (solo movil) */}
        <div className="sm:hidden flex justify-center pt-2.5">
          <div className="h-1.5 w-10 rounded-full bg-ink-200" />
        </div>

        {title && (
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-ink-100">
            <h3 className="font-display text-lg font-semibold text-ink-900">{title}</h3>
            <button
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700 focusable"
              aria-label="Cerrar"
            >
              <X className="size-5" />
            </button>
          </div>
        )}

        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>

        {footer && (
          <div className="border-t border-ink-100 px-5 py-3.5 safe-bottom">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
