import { useEffect, useRef } from 'react'

/**
 * Captura lectores QR/codigo de barras fisicos que emulan teclado.
 * Estos dispositivos "tipean" el codigo muy rapido y terminan con Enter.
 * Diferenciamos del tipeo humano midiendo el intervalo entre teclas.
 */
export function useKeyboardScanner(
  onScan: (codigo: string) => void,
  opciones: { minLength?: number; maxIntervaloMs?: number } = {},
) {
  const { minLength = 3, maxIntervaloMs = 35 } = opciones
  const buffer = useRef('')
  const ultimaTecla = useRef(0)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignora si el foco esta en un input de texto editable manualmente
      const target = e.target as HTMLElement
      const enCampo =
        target?.tagName === 'INPUT' &&
        (target as HTMLInputElement).dataset.scanner !== 'true'
      if (enCampo || target?.tagName === 'TEXTAREA') return

      const ahora = Date.now()
      const intervalo = ahora - ultimaTecla.current

      // Si pasa demasiado tiempo entre teclas, es tipeo humano: reinicia.
      if (intervalo > maxIntervaloMs) buffer.current = ''
      ultimaTecla.current = ahora

      if (e.key === 'Enter') {
        const codigo = buffer.current.trim()
        buffer.current = ''
        if (codigo.length >= minLength) {
          e.preventDefault()
          onScan(codigo)
        }
        return
      }

      // Solo caracteres imprimibles de longitud 1
      if (e.key.length === 1) {
        buffer.current += e.key
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onScan, minLength, maxIntervaloMs])
}
