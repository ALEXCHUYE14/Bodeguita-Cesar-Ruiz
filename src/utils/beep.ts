/**
 * Feedback auditivo del escáner — Web Audio API, sin archivos externos.
 *
 * beepExito : 1000 Hz / 100 ms — lectura exitosa (caja registradora real)
 * beepError : 250 Hz  / 200 ms — código no encontrado en inventario
 */

function crearBeep(hz: number, duracion: number, volumen = 0.2): void {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return

    const ctx  = new AudioCtx()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.type = 'sine'
    osc.frequency.setValueAtTime(hz, ctx.currentTime)

    // Volumen inicial → caída exponencial suave (sin chasquidos)
    gain.gain.setValueAtTime(volumen, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duracion)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duracion)
    osc.onended = () => ctx.close()
  } catch {
    // Silenciar errores de autoplay/contexto cerrado
  }
}

/** Pitido de éxito: 1000 Hz, 100 ms — emula caja registradora POS real */
export function beepExito(): void {
  crearBeep(1000, 0.1, 0.2)
}

/** Pitido de error: 250 Hz, 200 ms — código no encontrado en inventario */
export function beepError(): void {
  crearBeep(250, 0.2, 0.25)
}

/** Alias de compatibilidad (usada por CameraScanner y useKeyboardScanner) */
export const beepEscaner = beepExito
