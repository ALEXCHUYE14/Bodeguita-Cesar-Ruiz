import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, LogIn, MessageCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { BRAND } from '@/config/brand'

const WA_SOPORTE = `https://wa.me/${BRAND.whatsappSoporte}?text=Hola,%20tengo%20problemas%20para%20acceder%20al%20sistema%20de%20${encodeURIComponent(BRAND.nombre)}.`

/* ─────────────────────────────────────────────────────────────────────────────
   Propiedades CSS de la columna izquierda (imagen de fondo).
   Definidas fuera del componente para que React no las recree en cada render.
   El layout (width/height/display) lo controla el CSS class .login-left-col.
───────────────────────────────────────────────────────────────────────────── */
const leftColBgStyle: React.CSSProperties = {
  backgroundImage: "url('/img/tienda.jpeg')",
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  display: 'block',
  position: 'relative',
  overflow: 'hidden',
}

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPass, setVerPass] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    const { error } = await signIn(email.trim(), password)
    setCargando(false)
    if (error) setError(error)
  }

  return (
    /*
     * Layout Split-Screen:
     *   Desktop (≥769px) → columna izquierda 50vw (imagen) + columna derecha 50vw (formulario)
     *   Móvil   (≤768px) → columna izquierda display:none, formulario ocupa 100%
     */
    <div style={{ display: 'flex', minHeight: '100dvh', flexDirection: 'row' }}>

      {/* ════════════════════════════════════════════════════════════════════════
          COLUMNA IZQUIERDA — Imagen de fondo completa (solo desktop)
          Layout controlado por .login-left-col; background por leftColBgStyle.
          display:block con position:relative para contenido absolutamente posicionado.
      ════════════════════════════════════════════════════════════════════════ */}
      <div aria-hidden="true" className="login-left-col" style={leftColBgStyle}>
        {/* Gradient overlay para contraste del texto */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(14,14,13,0.92) 0%, rgba(14,14,13,0.22) 55%, rgba(14,14,13,0.04) 100%)',
        }} />
        {/* Texto de marca en la parte inferior */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '60px 40px',
          textAlign: 'center',
          color: '#ffffff',
          zIndex: 1,
        }}>
          <h2 style={{
            fontFamily: '"Bricolage Grotesque", sans-serif',
            fontSize: '2.4rem',
            fontWeight: 900,
            letterSpacing: '-0.5px',
            lineHeight: 1.2,
            textShadow: '0 2px 12px rgba(0,0,0,0.4)',
            margin: 0,
          }}>
            {BRAND.nombre}
          </h2>
          <p style={{ marginTop: '10px', fontSize: '1rem', opacity: 0.7, fontWeight: 500 }}>
            Sistema de Gestión y Punto de Venta
          </p>
          <div style={{ width: '48px', height: '1px', background: 'rgba(255,255,255,0.3)', margin: '20px auto' }} />
          <p style={{ fontSize: '0.85rem', opacity: 0.5, fontStyle: 'italic' }}>
            "Cada venta cuenta, cada cliente importa."
          </p>
        </div>
      </div>

      {/*
       * ── Media queries ───────────────────────────────────────────────────────
       *  .login-left-col:
       *    Móvil   (≤768px) → display:none !important  — no ocupa nada de espacio
       *    Desktop (≥769px) → display:block !important, width:50vw, height:100vh
       *
       *  .login-input:
       *    font-size ≥16px para prevenir zoom automático en Safari/iOS al enfocar
       */}
      <style>{`
        .login-left-col {
          display: none !important;
        }
        @media (min-width: 769px) {
          .login-left-col {
            display: block !important;
            width: 50vw;
            min-width: 50vw;
            flex-shrink: 0;
            height: 100vh;
          }
        }
        .login-input { font-size: 16px !important; }
      `}</style>

      {/* ════════════════════════════════════════════════════════════════════════
          COLUMNA DERECHA — Formulario de acceso (siempre visible)
          Dos zonas:
            1. Zona de formulario (flex-1, centrado verticalmente, scroll si falta espacio)
            2. Zona de soporte WhatsApp (altura fija, siempre visible al fondo)
      ════════════════════════════════════════════════════════════════════════ */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        backgroundColor: '#f8f9fa',
      }}>

        {/* ── Zona 1: formulario ── */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1.5rem 1rem',
          overflowY: 'auto',
          minHeight: 0,
        }}>

          {/* Tarjeta profesional del formulario */}
          <div style={{
            width: '100%',
            maxWidth: '400px',
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05), 0 8px 10px -6px rgba(0,0,0,0.05)',
            padding: '2rem',
          }}>

            {/* Logo interno superior — centrado con esquinas redondeadas */}
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <img
                src="/img/logo.jpeg"
                alt={BRAND.nombre}
                style={{
                  maxHeight: '80px',
                  width: 'auto',
                  borderRadius: '12px',
                  display: 'inline-block',
                  objectFit: 'cover',
                }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>

            {/* Encabezado de marca */}
            <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
              <h1 style={{
                fontFamily: '"Bricolage Grotesque", sans-serif',
                fontSize: '1.6rem',
                fontWeight: 800,
                letterSpacing: '-0.3px',
                color: '#0e0e0d',
                margin: '0 0 6px 0',
              }}>
                {BRAND.nombre}
              </h1>
              <p style={{ fontSize: '0.875rem', color: '#888', margin: 0 }}>
                Ingresa tus credenciales para continuar
              </p>
            </div>

            {/* Formulario de acceso */}
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label mb-1.5 block">Correo electrónico</label>
                <input
                  type="email"
                  className="input login-input"
                  style={{ fontSize: '16px' }}
                  placeholder="tucorreo@ejemplo.com"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label mb-1.5 block">Contraseña</label>
                <div className="relative">
                  <input
                    type={verPass ? 'text' : 'password'}
                    className="input pr-11 login-input"
                    style={{ fontSize: '16px' }}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setVerPass((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600 transition-colors"
                    aria-label={verPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {verPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 animate-fade-up">
                  {error}
                </div>
              )}

              <Button type="submit" size="lg" loading={cargando} className="w-full">
                <LogIn className="size-4" />
                Ingresar al sistema
              </Button>
            </form>
          </div>
        </div>

        {/* ── Zona 2: soporte WhatsApp — siempre visible al fondo ── */}
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid #e2e8f0',
          padding: '1.25rem 1.5rem',
          textAlign: 'center',
          backgroundColor: '#f8f9fa',
        }}>
          <p style={{ margin: '0 0 10px', fontSize: '0.75rem', color: '#aaa' }}>
            ¿Problemas para acceder?
          </p>
          <a
            href={WA_SOPORTE}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 20px',
              borderRadius: '10px',
              border: '1px solid #bbf7d0',
              backgroundColor: '#f0fdf4',
              color: '#15803d',
              fontSize: '0.8rem',
              fontWeight: 600,
              textDecoration: 'none',
              transition: 'background-color 0.15s',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#dcfce7'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#f0fdf4'
            }}
          >
            <MessageCircle size={14} />
            Contactar soporte por WhatsApp
          </a>
          <p style={{ marginTop: '12px', fontSize: '0.7rem', color: '#bbb' }}>
            Acceso exclusivo para personal autorizado · {BRAND.nombre}
          </p>
        </div>
      </div>
    </div>
  )
}
