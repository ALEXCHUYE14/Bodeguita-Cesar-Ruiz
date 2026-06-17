import { useState } from 'react'
import { Plus, Pencil, Trash2, Truck, Phone, Mail, MapPin, Hash } from 'lucide-react'
import { useProveedores } from '@/hooks/useProveedores'
import { Button, Card } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { fechaCorta, cx } from '@/utils/format'
import type { Proveedor } from '@/types/database'

const VACIO = { nombre: '', ruc: '', telefono: '', email: '', direccion: '' }

export function Proveedores() {
  const { proveedores, cargando, crear, actualizar, eliminar } = useProveedores()
  const toast = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [editando, setEditando] = useState<Proveedor | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [f, setF] = useState(VACIO)

  function abrirNuevo() {
    setEditando(null)
    setF(VACIO)
    setFormOpen(true)
  }

  function abrirEditar(p: Proveedor) {
    setEditando(p)
    setF({
      nombre: p.nombre,
      ruc: p.ruc ?? '',
      telefono: p.telefono ?? '',
      email: p.email ?? '',
      direccion: p.direccion ?? '',
    })
    setFormOpen(true)
  }

  function set(k: keyof typeof VACIO, v: string) {
    setF((prev) => ({ ...prev, [k]: v }))
  }

  async function guardar() {
    if (!f.nombre.trim()) {
      toast.error('El nombre del proveedor es obligatorio.')
      return
    }
    setGuardando(true)
    try {
      const payload = {
        nombre: f.nombre.trim(),
        ruc: f.ruc.trim() || null,
        telefono: f.telefono.trim() || null,
        email: f.email.trim() || null,
        direccion: f.direccion.trim() || null,
      }
      if (editando) {
        await actualizar(editando.id, payload)
        toast.exito('Proveedor actualizado')
      } else {
        await crear(payload)
        toast.exito('Proveedor registrado')
      }
      setFormOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  async function borrar(id: string) {
    try {
      await eliminar(id)
      toast.exito('Proveedor eliminado')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setConfirmando(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Proveedores</h1>
          <p className="text-sm text-ink-400">{proveedores.length} proveedor(es) activos</p>
        </div>
        <Button variant="primary" onClick={abrirNuevo}>
          <Plus className="size-[18px]" />
          <span className="hidden sm:inline">Nuevo proveedor</span>
        </Button>
      </div>

      <Card className="overflow-hidden">
        {/* Cabecera tabla desktop */}
        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-ink-100 px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400 lg:grid">
          <span>Proveedor</span>
          <span className="w-32">RUC</span>
          <span className="w-36">Teléfono</span>
          <span className="w-40">Registrado</span>
          <span className="w-20 text-right">Acciones</span>
        </div>

        {cargando ? (
          <SkeletonList />
        ) : proveedores.length === 0 ? (
          <EmptyState onNuevo={abrirNuevo} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {proveedores.map((p) => (
              <li
                key={p.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3.5 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:gap-4"
              >
                {/* Info principal */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-100">
                    <Truck className="size-[18px] text-ink-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">{p.nombre}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      {p.email && (
                        <span className="flex items-center gap-1 text-xs text-ink-400">
                          <Mail className="size-3" /> {p.email}
                        </span>
                      )}
                      {p.direccion && (
                        <span className="flex items-center gap-1 text-xs text-ink-400">
                          <MapPin className="size-3" /> {p.direccion}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Columnas desktop */}
                <span className="hidden w-32 text-sm text-ink-500 lg:block">
                  {p.ruc ? (
                    <span className="flex items-center gap-1">
                      <Hash className="size-3" /> {p.ruc}
                    </span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </span>
                <span className="hidden w-36 text-sm text-ink-500 lg:block">
                  {p.telefono ? (
                    <span className="flex items-center gap-1">
                      <Phone className="size-3" /> {p.telefono}
                    </span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </span>
                <span className="hidden w-40 text-xs text-ink-400 lg:block">
                  {fechaCorta(p.creado_en)}
                </span>

                {/* Acciones desktop */}
                <div className="hidden w-20 items-center justify-end gap-1 lg:flex">
                  <IconBtn title="Editar" onClick={() => abrirEditar(p)}>
                    <Pencil className="size-[16px]" />
                  </IconBtn>
                  <IconBtn
                    title="Eliminar"
                    onClick={() => setConfirmando(p.id)}
                    danger
                  >
                    <Trash2 className="size-[16px]" />
                  </IconBtn>
                </div>

                {/* Acciones movil */}
                <div className="flex gap-1.5 lg:hidden">
                  <button
                    onClick={() => abrirEditar(p)}
                    className="flex items-center gap-1.5 rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-600"
                  >
                    <Pencil className="size-3.5" /> Editar
                  </button>
                  <button
                    onClick={() => setConfirmando(p.id)}
                    className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Sheet: formulario */}
      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editando ? 'Editar proveedor' : 'Nuevo proveedor'}
        maxWidth="max-w-md"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button variant="secondary" className="flex-1" loading={guardando} onClick={guardar}>
              Guardar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Campo label="Nombre del proveedor *">
            <input
              className="input"
              value={f.nombre}
              onChange={(e) => set('nombre', e.target.value)}
              placeholder="Distribuidora Romero S.A.C."
              autoFocus
            />
          </Campo>
          <Campo label="RUC / ID Fiscal">
            <input
              className="input tabular"
              value={f.ruc}
              onChange={(e) => set('ruc', e.target.value)}
              placeholder="20123456789"
              maxLength={11}
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Teléfono">
              <input
                className="input"
                value={f.telefono}
                onChange={(e) => set('telefono', e.target.value)}
                placeholder="999 888 777"
              />
            </Campo>
            <Campo label="Correo">
              <input
                type="email"
                className="input"
                value={f.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="ventas@proveedor.pe"
              />
            </Campo>
          </div>
          <Campo label="Dirección">
            <input
              className="input"
              value={f.direccion}
              onChange={(e) => set('direccion', e.target.value)}
              placeholder="Av. Los Alisos 234, Lima"
            />
          </Campo>
        </div>
      </Sheet>

      {/* Sheet: confirmar eliminacion */}
      <Sheet
        open={!!confirmando}
        onClose={() => setConfirmando(null)}
        title="Eliminar proveedor"
        maxWidth="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmando(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              className="flex-1 !bg-red-600 !hover:bg-red-700"
              onClick={() => confirmando && borrar(confirmando)}
            >
              Sí, eliminar
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-600">
          Esta acción desactivará el proveedor. Las compras registradas no se verán afectadas.
        </p>
      </Sheet>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  danger?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cx(
        'grid size-8 place-items-center rounded-lg transition focusable',
        danger
          ? 'text-ink-300 hover:bg-red-50 hover:text-red-600'
          : 'text-ink-400 hover:bg-ink-100 hover:text-ink-800',
      )}
    >
      {children}
    </button>
  )
}

function SkeletonList() {
  return (
    <ul className="divide-y divide-ink-100">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="size-9 animate-pulse rounded-xl bg-ink-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-48 animate-pulse rounded bg-ink-100" />
            <div className="h-3 w-32 animate-pulse rounded bg-ink-100" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function EmptyState({ onNuevo }: { onNuevo: () => void }) {
  return (
    <div className="grid place-items-center py-16 text-center">
      <Truck className="mb-3 size-8 text-ink-300" />
      <p className="text-sm font-medium text-ink-500">No hay proveedores registrados</p>
      <p className="mb-4 mt-1 text-xs text-ink-300">
        Registra tus distribuidoras para vincularlas a las compras
      </p>
      <Button variant="outline" size="sm" onClick={onNuevo}>
        <Plus className="size-4" /> Agregar proveedor
      </Button>
    </div>
  )
}
