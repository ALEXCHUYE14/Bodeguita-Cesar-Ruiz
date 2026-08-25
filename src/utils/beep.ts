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

/** Alias de compatibilidad (usada por useKeyboardScanner) */
export const beepEscaner = beepExito

/**
 * Sonido real de escaner (MP3) — se reproduce al leer un codigo con la
 * camara, imitando el "beep" de un lector de codigo de barras fisico.
 * Se reutiliza una unica instancia de Audio para no crear objetos nuevos
 * en cada lectura (la camara puede escanear varias veces por minuto).
 */
let audioScannerCam: HTMLAudioElement | null = null

export function reproducirSonidoEscaner(): void {
  try {
    if (!audioScannerCam) {
      audioScannerCam = new Audio('/audio/scanner.mp3')
      audioScannerCam.volume = 0.6
    }
    // Reinicia por si la lectura anterior aun no termino de sonar
    // (evita que una lectura rapida siguiente quede sin sonido).
    audioScannerCam.currentTime = 0
    void audioScannerCam.play().catch(() => {
      // Autoplay bloqueado por el navegador u otro fallo: silenciar.
    })
  } catch {
    // Silenciar errores (navegador sin soporte de Audio, etc.)
  }
}
