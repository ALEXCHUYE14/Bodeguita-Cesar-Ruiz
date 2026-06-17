import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { CajaProvider } from '@/context/CajaContext'
import { ToastProvider } from '@/components/ui/Toast'
import { AppShell } from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Button'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { POS } from '@/pages/POS'
import { Inventario } from '@/pages/Inventario'
import { Ventas } from '@/pages/Ventas'
import { Clientes } from '@/pages/Clientes'
import { Caja } from '@/pages/Caja'
import { Proveedores } from '@/pages/Proveedores'
import { Compras } from '@/pages/Compras'
import { Mermas } from '@/pages/Mermas'
import { Configuracion } from '@/pages/Configuracion'
import type { ReactNode } from 'react'

function Cargando() {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink-50">
      <Spinner className="size-7 text-ink-400" />
    </div>
  )
}

/** Exige sesion activa. Sin sesion -> Login. */
function Privado({ children }: { children: ReactNode }) {
  const { session, cargando } = useAuth()
  if (cargando) return <Cargando />
  if (!session) return <Navigate to="/login" replace />
  return <AppShell>{children}</AppShell>
}

/** Exige rol administrador. Cajero -> POS. */
function SoloAdmin({ children }: { children: ReactNode }) {
  const { esAdmin, cargando } = useAuth()
  if (cargando) return <Cargando />
  if (!esAdmin) return <Navigate to="/pos" replace />
  return <>{children}</>
}

function Rutas() {
  const { session, cargando } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={
          cargando ? (
            <Cargando />
          ) : session ? (
            <Navigate to="/" replace />
          ) : (
            <Login />
          )
        }
      />

      <Route
        path="/"
        element={
          <Privado>
            <SoloAdmin>
              <Dashboard />
            </SoloAdmin>
          </Privado>
        }
      />
      <Route
        path="/pos"
        element={
          <Privado>
            <POS />
          </Privado>
        }
      />
      <Route
        path="/inventario"
        element={
          <Privado>
            <Inventario />
          </Privado>
        }
      />
      <Route
        path="/ventas"
        element={
          <Privado>
            <Ventas />
          </Privado>
        }
      />
      <Route
        path="/caja"
        element={
          <Privado>
            <Caja />
          </Privado>
        }
      />
      <Route
        path="/clientes"
        element={
          <Privado>
            <SoloAdmin>
              <Clientes />
            </SoloAdmin>
          </Privado>
        }
      />
      <Route
        path="/proveedores"
        element={
          <Privado>
            <SoloAdmin>
              <Proveedores />
            </SoloAdmin>
          </Privado>
        }
      />
      <Route
        path="/compras"
        element={
          <Privado>
            <SoloAdmin>
              <Compras />
            </SoloAdmin>
          </Privado>
        }
      />
      <Route
        path="/mermas"
        element={
          <Privado>
            <SoloAdmin>
              <Mermas />
            </SoloAdmin>
          </Privado>
        }
      />

      <Route
        path="/configuracion"
        element={
          <Privado>
            <SoloAdmin>
              <Configuracion />
            </SoloAdmin>
          </Privado>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CajaProvider>
          <ToastProvider>
            <Rutas />
          </ToastProvider>
        </CajaProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
