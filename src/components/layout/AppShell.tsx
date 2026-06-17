import { type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Store, LogOut } from 'lucide-react'
import { NAV } from './nav'
import { useAuth } from '@/context/AuthContext'
import { BRAND } from '@/config/brand'
import { cx } from '@/utils/format'

export function AppShell({ children }: { children: ReactNode }) {
  const { perfil, esAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const items = NAV.filter((i) => !i.soloAdmin || esAdmin)

  // El admin muestra el operador de marca ("Juli"); los cajeros muestran su primer nombre
  const nombreDisplay =
    perfil?.rol === 'administrador'
      ? BRAND.operador
      : (perfil?.nombre?.split(' ')[0] ?? 'Cajero')
  const inicialDisplay = nombreDisplay.charAt(0).toUpperCase()

  async function salir() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-ink-50 bg-grain">
      {/* ---------- Sidebar (desktop) ---------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-ink-100 bg-white lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid size-9 place-items-center rounded-xl bg-ink-900 text-white">
            <Store className="size-5" />
          </div>
          <div className="leading-tight">
            <p className="font-display text-[0.95rem] font-bold text-ink-900">Bodeguita Juli</p>
            <p className="text-[0.7rem] font-medium text-ink-400">Gestion Comercial</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                  isActive
                    ? 'bg-ink-900 text-white shadow-soft'
                    : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900',
                )
              }
            >
              <Icon className="size-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-100 p-3">
          <div className="flex items-center gap-3 rounded-xl px-3 py-2">
            <div className="grid size-9 place-items-center rounded-full bg-accent-100 font-display text-sm font-bold text-accent-700">
              {inicialDisplay}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold text-ink-900">{nombreDisplay}</p>
              <p className="text-[0.7rem] font-medium capitalize text-ink-400">{perfil?.rol}</p>
            </div>
            <button
              onClick={salir}
              className="grid size-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-red-600 focusable"
              aria-label="Cerrar sesion"
            >
              <LogOut className="size-[18px]" />
            </button>
          </div>
        </div>
      </aside>

      {/* ---------- Topbar (movil) ---------- */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-ink-100 bg-white/85 px-4 py-3 backdrop-blur-md safe-top lg:hidden">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-ink-900 text-white">
            <Store className="size-[18px]" />
          </div>
          <span className="font-display text-base font-bold text-ink-900">Bodeguita Juli</span>
        </div>
        <button
          onClick={salir}
          className="grid size-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 focusable"
          aria-label="Cerrar sesion"
        >
          <LogOut className="size-5" />
        </button>
      </header>

      {/* ---------- Contenido ---------- */}
      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pt-8">
          {children}
        </div>
      </main>

      {/* ---------- Bottom nav (movil) — scroll horizontal si hay muchos items ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-100 bg-white/95 backdrop-blur-lg safe-bottom lg:hidden">
        <div className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 py-2.5 text-[0.65rem] font-semibold transition',
                  isActive ? 'text-accent-600' : 'text-ink-400',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cx(
                      'grid size-9 place-items-center rounded-xl transition',
                      isActive && 'bg-accent-50',
                    )}
                  >
                    <Icon className="size-[20px]" />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
