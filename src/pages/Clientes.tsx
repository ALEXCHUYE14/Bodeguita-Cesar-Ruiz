import { useMemo, useState } from 'react'
import {
  Plus,
  User,
  Phone,
  MapPin,
  Pencil,
  Trash2,
  CreditCard,
  History,
  ArrowDownLeft,
  MessageCircle,
  Copy,
} from 'lucide-react'
import { useClientes } from '@/hooks/useClientes'
import { Button, Card, Badge } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { money, fechaHora, cx } from '@/utils/format'
import type { ClienteCredito, PagoCredito } from '@/types/database'

const VACIO = { nombre: '', telefono: '', direccion: '', limite_credito: '100' }

export function Clientes() {
  const { clientes, cargando, crear, actualizar, eliminar, registrarAbono, obtenerPagos } =
    useClientes()
  const toast = useToast()

  const [formOpen, setFormOpen] = useState(false)
  const [editando, setEditando] = useState<ClienteCredito | null>(null)
  const [abonoCliente, setAbonoCliente] = useState<ClienteCredito | null>(null)
  const [historialCliente, setHistorialCliente] = useState<ClienteCredito | null>(null)
  const [pagos, setPagos] = useState<PagoCredito[]>([])
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [whatsappCliente, setWhatsappCliente] = useState<ClienteCredito | null>(null)
  const [f, setF] = useState(VACIO)
  const [montoAbono, setMontoAbono] = useState('')
  const [notaAbono, setNotaAbono] = useState('')

  const totalDeuda = useMemo(
    () => clientes.reduce((s, c) => s + c.deuda_actual, 0),
    [clientes],
  )

  function abrirNuevo() {
    setEditando(null)
    setF(VACIO)
    setFormOpen(true)
  }

  function abrirEditar(c: ClienteCredito) {
    setEditando(c)
    setF({
      nombre: c.nombre,
      telefono: c.telefono ?? '',
      direccion: c.direccion ?? '',
      limite_credito: String(c.limite_credito),
    })
    setFormOpen(true)
  }

  async function guardar() {
    if (!f.nombre.trim()) {
      toast.error('El nombre es obligatorio.')
      return
    }
    const limite = parseFloat(f.limite_credito) || 0
    if (limite <= 0) {
      toast.error('El límite de crédito debe ser mayor a 0.')
      return
    }
    setGuardando(true)
    try {
      const payload = {
        nombre: f.nombre.trim(),
        telefono: f.telefono.trim() || null,
        direccion: f.direccion.trim() || null,
        limite_credito: limite,
      }
      if (editando) {
        await actualizar(editando.id, payload)
        toast.exito('Cliente actualizado')
      } else {
        await crear(payload)
        toast.exito('Cliente registrado')
      }
      setFormOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  async function confirmarAbono() {
    if (!abonoCliente) return
    const monto = parseFloat(montoAbono)
    if (!monto || monto <= 0) {
      toast.error('Ingresa un monto válido.')
      return
    }
    if (monto > abonoCliente.deuda_actual) {
      toast.error(`El abono no puede superar la deuda de ${money(abonoCliente.deuda_actual)}.`)
      return
    }
    setGuardando(true)
    try {
      await registrarAbono(abonoCliente.id, monto, notaAbono.trim() || null)
      toast.exito(`Abono de ${money(monto)} registrado`)
      setAbonoCliente(null)
      setMontoAbono('')
      setNotaAbono('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar abono')
    } finally {
      setGuardando(false)
    }
  }

  async function abrirHistorial(c: ClienteCredito) {
    setHistorialCliente(c)
    setPagos([])
    const data = await obtenerPagos(c.id)
    setPagos(data)
  }

  function mensajeDeuda(c: ClienteCredito): string {
    return `Hola ${c.nombre}, le recordamos que tiene una deuda pendiente de *${money(c.deuda_actual)}* en *Bodeguita Juli*. Le pedimos amablemente que se acerque a cancelarla. ¡Muchas gracias! 🙏`
  }

  function abrirWhatsApp(c: ClienteCredito) {
    const msg = mensajeDeuda(c)
    if (c.telefono) {
      const tel = c.telefono.replace(/\D/g, '')
      window.open(`https://wa.me/51${tel}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer')
    } else {
      setWhatsappCliente(c)
    }
  }

  async function copiarMensaje(c: ClienteCredito) {
    await navigator.clipboard.writeText(mensajeDeuda(c))
    toast.exito('Mensaje copiado al portapapeles')
    setWhatsappCliente(null)
  }

  async function borrar(id: string) {
    try {
      await eliminar(id)
      toast.exito('Cliente eliminado')
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
          <h1 className="font-display text-2xl font-bold text-ink-900">Clientes con fiado</h1>
          <p className="text-sm text-ink-400">
            {clientes.length} cliente(s) ·{' '}
            <span className="font-semibold text-red-600">
              Deuda total: {money(totalDeuda)}
            </span>
          </p>
        </div>
        <Button variant="primary" onClick={abrirNuevo}>
          <Plus className="size-[18px]" />
          <span className="hidden sm:inline">Nuevo cliente</span>
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-ink-100 px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400 lg:grid">
          <span>Cliente</span>
          <span className="w-28 text-right">Límite</span>
          <span className="w-36">Deuda actual</span>
          <span className="w-24 text-center">Estado</span>
          <span className="w-32 text-right">Acciones</span>
        </div>

        {cargando ? (
          <SkeletonList />
        ) : clientes.length === 0 ? (
          <EmptyState onNuevo={abrirNuevo} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {clientes.map((c) => {
              const pct = c.limite_credito > 0 ? (c.deuda_actual / c.limite_credito) * 100 : 0
              const critico = pct >= 90
              const advertencia = pct >= 60
              return (
                <li
                  key={c.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3.5 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:gap-4"
                >
                  {/* Info principal */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-100">
                      <User className="size-[18px] text-ink-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900">{c.nombre}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {c.telefono && (
                          <span className="flex items-center gap-1 text-xs text-ink-400">
                            <Phone className="size-3" /> {c.telefono}
                          </span>
                        )}
                        {c.direccion && (
                          <span className="flex items-center gap-1 text-xs text-ink-400">
                            <MapPin className="size-3" /> {c.direccion}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Límite */}
                  <span className="tabular hidden w-28 text-right text-sm text-ink-500 lg:block">
                    {money(c.limite_credito)}
                  </span>

                  {/* Deuda con barra de progreso */}
                  <div className="hidden w-36 lg:block">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={cx('font-bold tabular', critico ? 'text-red-700' : advertencia ? 'text-amber-700' : 'text-ink-700')}>
                        {money(c.deuda_actual)}
                      </span>
                      <span className="text-ink-400">{Math.round(pct)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className={cx(
                          'h-full rounded-full transition-all',
                          critico ? 'bg-red-500' : advertencia ? 'bg-amber-400' : 'bg-accent-500',
                        )}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Estado */}
                  <div className="hidden w-24 justify-center lg:flex">
                    {c.deuda_actual === 0 ? (
                      <Badge tone="success">Al día</Badge>
                    ) : critico ? (
                      <Badge tone="danger">Crítico</Badge>
                    ) : advertencia ? (
                      <Badge tone="warning">Moderado</Badge>
                    ) : (
                      <Badge tone="info">Activo</Badge>
                    )}
                  </div>

                  {/* Acciones desktop */}
                  <div className="hidden w-32 items-center justify-end gap-1 lg:flex">
                    {c.deuda_actual > 0 && (
                      <IconBtn title="Mensaje WhatsApp" onClick={() => abrirWhatsApp(c)}>
                        <MessageCircle className="size-4 text-green-600" />
                      </IconBtn>
                    )}
                    {c.deuda_actual > 0 && (
                      <IconBtn title="Registrar abono" onClick={() => { setAbonoCliente(c); setMontoAbono(''); setNotaAbono('') }}>
                        <ArrowDownLeft className="size-4" />
                      </IconBtn>
                    )}
                    <IconBtn title="Historial" onClick={() => abrirHistorial(c)}>
                      <History className="size-4" />
                    </IconBtn>
                    <IconBtn title="Editar" onClick={() => abrirEditar(c)}>
                      <Pencil className="size-4" />
                    </IconBtn>
                    <IconBtn title="Eliminar" onClick={() => setConfirmando(c.id)} danger>
                      <Trash2 className="size-4" />
                    </IconBtn>
                  </div>

                  {/* Acciones móvil */}
                  <div className="flex flex-col items-end gap-1.5 lg:hidden">
                    <div className="flex items-center gap-1.5">
                      <span className={cx('tabular text-sm font-bold', critico ? 'text-red-700' : 'text-ink-700')}>
                        {money(c.deuda_actual)}
                      </span>
                      <span className="text-xs text-ink-400">/ {money(c.limite_credito)}</span>
                    </div>
                    <div className="flex gap-1.5">
                      {c.deuda_actual > 0 && (
                        <button
                          onClick={() => abrirWhatsApp(c)}
                          className="flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-semibold text-green-700"
                        >
                          <MessageCircle className="size-3.5" /> WA
                        </button>
                      )}
                      {c.deuda_actual > 0 && (
                        <button
                          onClick={() => { setAbonoCliente(c); setMontoAbono(''); setNotaAbono('') }}
                          className="flex items-center gap-1 rounded-lg bg-accent-50 px-2.5 py-1.5 text-xs font-semibold text-accent-700"
                        >
                          <ArrowDownLeft className="size-3.5" /> Abonar
                        </button>
                      )}
                      <button
                        onClick={() => abrirHistorial(c)}
                        className="flex items-center gap-1 rounded-lg bg-ink-100 px-2.5 py-1.5 text-xs font-semibold text-ink-600"
                      >
                        <History className="size-3.5" />
                      </button>
                      <button
                        onClick={() => abrirEditar(c)}
                        className="flex items-center gap-1 rounded-lg bg-ink-100 px-2.5 py-1.5 text-xs font-semibold text-ink-600"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Sheet: formulario de cliente */}
      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editando ? 'Editar cliente' : 'Nuevo cliente con fiado'}
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
          <Campo label="Nombre completo *">
            <input
              className="input"
              value={f.nombre}
              onChange={(e) => setF((p) => ({ ...p, nombre: e.target.value }))}
              placeholder="Juan Pérez"
              autoFocus
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Teléfono">
              <input
                className="input"
                value={f.telefono}
                onChange={(e) => setF((p) => ({ ...p, telefono: e.target.value }))}
                placeholder="999 888 777"
              />
            </Campo>
            <Campo label="Límite de crédito (S/) *">
              <input
                type="number"
                min={1}
                step={0.01}
                className="input tabular"
                value={f.limite_credito}
                onChange={(e) => setF((p) => ({ ...p, limite_credito: e.target.value }))}
                placeholder="100.00"
              />
            </Campo>
          </div>
          <Campo label="Dirección / Referencia">
            <input
              className="input"
              value={f.direccion}
              onChange={(e) => setF((p) => ({ ...p, direccion: e.target.value }))}
              placeholder="Jr. Los Pinos 123, Mz. A Lt. 5"
            />
          </Campo>
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3 text-xs text-blue-700">
            <CreditCard className="mb-1 size-4 text-blue-500" />
            <p className="font-semibold">
              El sistema bloqueará ventas al fiado cuando la deuda supere el límite asignado.
            </p>
          </div>
        </div>
      </Sheet>

      {/* Sheet: registrar abono */}
      <Sheet
        open={!!abonoCliente}
        onClose={() => setAbonoCliente(null)}
        title={abonoCliente ? `Abono — ${abonoCliente.nombre}` : 'Abono'}
        maxWidth="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAbonoCliente(null)}>
              Cancelar
            </Button>
            <Button variant="secondary" className="flex-1" loading={guardando} onClick={confirmarAbono}>
              Registrar abono
            </Button>
          </div>
        }
      >
        {abonoCliente && (
          <div className="space-y-4">
            <div className="rounded-xl bg-ink-50 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-500">Deuda actual</span>
                <span className="tabular font-bold text-red-700">{money(abonoCliente.deuda_actual)}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-ink-500">Límite</span>
                <span className="tabular text-ink-700">{money(abonoCliente.limite_credito)}</span>
              </div>
            </div>
            <Campo label="Monto del abono (S/) *">
              <input
                type="number"
                min={0.01}
                step={0.01}
                max={abonoCliente.deuda_actual}
                className="input tabular text-lg"
                value={montoAbono}
                onChange={(e) => setMontoAbono(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </Campo>
            <div className="flex flex-wrap gap-2">
              {[abonoCliente.deuda_actual, Math.ceil(abonoCliente.deuda_actual / 2), 10, 20, 50]
                .filter((v, i, a) => v > 0 && a.indexOf(v) === i && v <= abonoCliente.deuda_actual)
                .sort((a, b) => a - b)
                .map((v) => (
                  <button
                    key={v}
                    onClick={() => setMontoAbono(v.toFixed(2))}
                    className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-200"
                  >
                    {v === abonoCliente.deuda_actual ? 'Total' : money(v)}
                  </button>
                ))}
            </div>
            <Campo label="Nota (opcional)">
              <input
                className="input"
                value={notaAbono}
                onChange={(e) => setNotaAbono(e.target.value)}
                placeholder="Pago con efectivo..."
              />
            </Campo>
          </div>
        )}
      </Sheet>

      {/* Sheet: historial de pagos */}
      <Sheet
        open={!!historialCliente}
        onClose={() => setHistorialCliente(null)}
        title={historialCliente ? `Historial — ${historialCliente.nombre}` : 'Historial'}
        maxWidth="max-w-md"
      >
        {pagos.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-400">Sin pagos registrados.</p>
        ) : (
          <ul className="space-y-1.5">
            {pagos.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-ink-100 px-3.5 py-2.5"
              >
                <div>
                  {p.nota && <p className="text-sm font-semibold text-ink-800">{p.nota}</p>}
                  <p className="text-xs text-ink-400">{fechaHora(p.creado_en)}</p>
                </div>
                <span className="tabular font-display text-sm font-bold text-accent-700">
                  + {money(p.monto)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      {/* Sheet: mensaje WhatsApp (solo cuando cliente sin teléfono) */}
      <Sheet
        open={!!whatsappCliente}
        onClose={() => setWhatsappCliente(null)}
        title="Mensaje de deuda"
        maxWidth="max-w-sm"
        footer={
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => whatsappCliente && copiarMensaje(whatsappCliente)}
          >
            <Copy className="size-4" /> Copiar mensaje
          </Button>
        }
      >
        {whatsappCliente && (
          <div className="space-y-3">
            <p className="text-xs text-ink-400">
              Este cliente no tiene teléfono registrado. Copia el mensaje y envíalo manualmente.
            </p>
            <div className="rounded-xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm leading-relaxed text-ink-700">
              {mensajeDeuda(whatsappCliente)}
            </div>
          </div>
        )}
      </Sheet>

      {/* Sheet: confirmar eliminación */}
      <Sheet
        open={!!confirmando}
        onClose={() => setConfirmando(null)}
        title="Eliminar cliente"
        maxWidth="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmando(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              className="flex-1 !bg-red-600"
              onClick={() => confirmando && borrar(confirmando)}
            >
              Sí, eliminar
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-600">
          Se desactivará el cliente. Si tiene deuda pendiente, esta quedará registrada pero no
          podrá recibir más crédito.
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
  children, onClick, title, danger,
}: {
  children: React.ReactNode; onClick: () => void; title: string; danger?: boolean
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
            <div className="h-3.5 w-40 animate-pulse rounded bg-ink-100" />
            <div className="h-3 w-24 animate-pulse rounded bg-ink-100" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function EmptyState({ onNuevo }: { onNuevo: () => void }) {
  return (
    <div className="grid place-items-center py-16 text-center">
      <User className="mb-3 size-8 text-ink-300" />
      <p className="text-sm font-medium text-ink-500">No hay clientes con fiado</p>
      <p className="mb-4 mt-1 text-xs text-ink-300">Registra clientes de confianza para ventas al crédito</p>
      <Button variant="outline" size="sm" onClick={onNuevo}>
        <Plus className="size-4" /> Nuevo cliente
      </Button>
    </div>
  )
}
