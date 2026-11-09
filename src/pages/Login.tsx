import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Lock, LogIn, Mail, MessageCircle, Check, AlertCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { BRAND } from '@/config/brand'
import { useNegocio } from '@/config/negocio'

/**
 * Ticket de ejemplo para el panel de marca — usa nombres de productos reales
 * del catalogo (ver Inventario) para que el mockup se sienta del negocio real
 * y no como un relleno generico. Puramente decorativo: no toca ningun dato.
 */
const TICKET_DEMO = [
  { cant: '1x', nombre: 'Aruba 1L', monto: '3.50' },
  { cant: '2x', nombre: 'Papi Ricas', monto: '2.00' },
  { cant: '1x', nombre: 'Agua San Mateo', monto: '1.50' },
]
const TICKET_TOTAL = '7.00'

export function Login() {
  const { signIn } = useAuth()
  const { nombre: nombreNegocio } = useNegocio()
  const WA_SOPORTE = `https://wa.me/${BRAND.whatsappSoporte}?text=Hola,%20tengo%20problemas%20para%20acceder%20al%20sistema%20de%20${encodeURIComponent(nombreNegocio)}.`
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPass, setVerPass] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [reintentando, setReintentando] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setReintentando(false)
    setCargando(true)
    const { error } = await signIn(email.trim(), password, () => setReintentando(true))
    setCargando(false)
    setReintentando(false)
    if (error) setError(error)
  }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* ════════════════════════════════════════════════════════════════════
          PANEL DE MARCA — solo desktop (≥1024px). En vez de una foto de
          stock con texto superpuesto, el elemento central es un ticket de
          venta en miniatura: es literalmente lo que este sistema hace, con
          productos reales del catalogo — no un generico "hero" de marketing.
      ════════════════════════════════════════════════════════════════════ */}
      <aside
        aria-hidden="true"
        className="relative isolate hidden w-1/2 shrink-0 overflow-hidden bg-gradient-to-br from-[#0f5024] via-[#1a1512] to-[#5c0f0f] lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12"
      >
        {/* "isolate" arriba es lo que faltaba: sin el, este <aside> no forma
            su propio contexto de apilamiento, y el z-index negativo de la
            imagen de abajo la mandaba detras del PROPIO FONDO DEGRADADO del
            panel (no solo detras del texto) — por eso era invisible sin
            importar la opacidad. Con "isolate", el degradado pasa a ser la
            base de ese contexto y la imagen con -z-10 queda correctamente
            por encima de el, debajo del contenido normal.

            Los 3 colores del degradado (verde→neutro oscuro→rojo) salen de
            muestrear los pixeles reales de tienda-marca.png (ver
            scripts/process_logo.py), no son un verde/rojo inventados — por
            eso combinan con el logo en vez de competir con el. El paso
            intermedio casi negro evita que verde y rojo se mezclen en un
            marron sucio en la transicion (complementarios puros si se
            mezclan directo), y mantiene el contraste para el texto blanco
            en cualquier punto del degradado. */}

        {/* Imagen de la tienda como marca de agua, anclada a la esquina
            vacia inferior izquierda (no al centro del panel, donde ya estan
            el titulo y el ticket). Un <img> con ancho fijo da control
            exacto del tamano/posicion — un background-size:cover centrado
            quedaba demasiado chico y transparente ahi para notarse.

            Usa tienda-marca.png (derivado de tienda.png, ver
            scripts/process_logo.py de referencia) en vez del archivo
            original: tienda.png tiene el fondo pintado de blanco opaco, no
            transparente — usado tal cual se veia como una tarjeta blanca
            rotada encima del ticket. tienda-marca.png le quita ese blanco
            de fondo con flood-fill desde las esquinas (conservando el texto
            blanco QUE ESTA DENTRO del logo, como "COMERCIAL", porque no
            esta conectado al fondo) y recorta el sobrante transparente.

            A color completo (sin desaturar): el degradado de atras ya sale
            de sus propios colores (ver nota de arriba), asi que combinan en
            vez de chocar. Si el archivo no carga, el "onError" lo oculta
            solo y el panel se ve igual de bien con el degradado de base.

            Cuando haya una FOTO real del local (no el logo), avisa para
            cambiar esta referencia a esa foto directamente — con una foto
            real no hace falta el recorte de transparencia, cover alcanza. */}
        <img
          src="/img/tienda-marca.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute bottom-24 left-0 -z-10 w-[22rem] -rotate-2 object-contain opacity-95 drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />

        {/* Identidad */}
        <div className="flex items-center gap-3.5">
          <img
            src="/img/logo.png"
            alt=""
            className="size-12 rounded-xl bg-white object-contain p-1.5 shadow-pop"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
          <span className="font-display text-lg font-bold tracking-tight text-white">
            {nombreNegocio}
          </span>
        </div>

        {/* Mensaje + ticket — en flujo normal (nunca se superponen, pase lo
            que pase con el alto/ancho de la ventana). */}
        <div className="flex-1">
          <div className="mt-10 max-w-sm">
            <h1 className="font-display text-[2.75rem] font-extrabold leading-[1.05] tracking-tight text-white">
              Tu negocio,
              <br />
              bajo control.
            </h1>
            <p className="mt-4 text-[0.95rem] leading-relaxed text-white/55">
              Ventas, inventario y caja en un mismo lugar — pensado para el
              ritmo de la tienda, no de una oficina.
            </p>
          </div>

          {/* Ticket mockup */}
          <div className="ml-auto mt-8 w-64 -rotate-2 rounded-2xl bg-white p-5 shadow-pop">
            <div className="flex items-center justify-between">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-400">
                Comprobante
              </p>
              <span className="flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-[0.65rem] font-bold text-accent-700">
                <Check className="size-3" strokeWidth={3} /> Pagado
              </span>
            </div>
            <div className="mt-3 space-y-1.5 border-t border-dashed border-ink-200 pt-3">
              {TICKET_DEMO.map((l) => (
                <div key={l.nombre} className="flex justify-between gap-2 text-[0.8rem] text-ink-600">
                  <span className="min-w-0 truncate">
                    {l.cant} {l.nombre}
                  </span>
                  <span className="tabular shrink-0 text-ink-900">S/ {l.monto}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between border-t border-ink-100 pt-3">
              <span className="text-sm font-bold text-ink-900">Total</span>
              <span className="tabular text-sm font-bold text-ink-900">S/ {TICKET_TOTAL}</span>
            </div>
          </div>
        </div>

        {/* pie decorativo */}
        <p className="text-xs font-medium text-white/30">
          Sistema de gestión y punto de venta
        </p>
      </aside>

      {/* ════════════════════════════════════════════════════════════════════
          PANEL DE ACCESO — siempre visible. Mismo fondo con textura (bg-grain)
          que el resto de la app (ver AppShell) para que el login se sienta
          parte del mismo sistema, no una pagina aparte.
      ════════════════════════════════════════════════════════════════════ */}
      <div className="flex min-h-dvh flex-1 flex-col bg-ink-50 bg-grain">
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-10">
          <div className="w-full max-w-[25rem]">

            {/* Marca compacta — solo cuando el panel de la izquierda esta oculto */}
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <img
                src="/img/logo.png"
                alt=""
                className="size-11 shrink-0 rounded-xl border border-ink-100 bg-white object-contain p-1 shadow-soft"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
              <span className="font-display text-base font-bold tracking-tight text-ink-900">
                {nombreNegocio}
              </span>
            </div>

            <div className="animate-fade-up rounded-2xl border border-ink-100 bg-white p-7 shadow-pop sm:p-8">
              <div className="mb-6">
                <h1 className="font-display text-xl font-bold tracking-tight text-ink-900">
                  Inicia sesión
                </h1>
                <p className="mt-1 text-sm text-ink-400">
                  Ingresa tus credenciales para continuar
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label htmlFor="login-email" className="label mb-1.5 block">
                    Correo electrónico
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
                    <input
                      id="login-email"
                      type="email"
                      className="input pl-10 text-base"
                      placeholder="tucorreo@ejemplo.com"
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="login-password" className="label mb-1.5 block">
                    Contraseña
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
                    <input
                      id="login-password"
                      type={verPass ? 'text' : 'password'}
                      className="input pl-10 pr-11 text-base"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setVerPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600"
                      aria-label={verPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {verPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 animate-fade-up">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" size="lg" loading={cargando} className="w-full">
                  <LogIn className="size-4" />
                  Ingresar al sistema
                </Button>

                {reintentando && (
                  <p className="text-center text-xs text-ink-400 animate-fade-up">
                    El servidor está reactivándose, esto puede tardar unos segundos…
                  </p>
                )}
              </form>
            </div>

            {/* Soporte */}
            <div className="mt-6 text-center">
              <p className="mb-2 text-xs text-ink-400">¿Problemas para acceder?</p>
              <a
                href={WA_SOPORTE}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent-100 bg-accent-50 px-4 py-2 text-xs font-semibold text-accent-700 transition-colors hover:bg-accent-100"
              >
                <MessageCircle className="size-3.5" />
                Contactar soporte por WhatsApp
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
