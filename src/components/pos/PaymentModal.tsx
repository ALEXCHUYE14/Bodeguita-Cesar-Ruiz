import { useMemo, useState } from 'react'
import { Banknote, Smartphone, HandCoins, Check, Search, Split, Plus, X, UserPlus } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { money, cx } from '@/utils/format'
import { useNegocio } from '@/config/negocio'
import type { ClienteCredito, MetodoPagoSeleccionable } from '@/types/database'

export interface PagoLeg {
  metodo: MetodoPagoSeleccionable
  monto: number
}

export interface NuevoClienteDatos {
  nombre: string
  telefono: string | null
  direccion: string | null
  limite_credito: number
}

interface Props {
  open: boolean
  onClose: () => void
  total: number
  procesando: boolean
  clientes: ClienteCredito[]
  onConfirmar: (pagos: PagoLeg[], clienteId?: string) => void
  /** Registro rapido de cliente sin salir del cobro (ver requerimiento de "pago fiado"). */
  onCrearCliente: (datos: NuevoClienteDatos) => Promise<ClienteCredito>
}

const METODOS: { id: MetodoPagoSeleccionable; label: string; icon: typeof Banknote; desc: string }[] = [
  { id: 'efectivo', label: 'Efectivo', icon: Banknote, desc: 'Pago con billetes/monedas' },
  { id: 'yape', label: 'Yape', icon: Smartphone, desc: 'Transferencia instantánea' },
  { id: 'fiado', label: 'Fiado', icon: HandCoins, desc: 'Apuntar a cuenta del cliente' },
]

const RAPIDOS = [10, 20, 50, 100, 200]

interface FilaPago {
  metodo: MetodoPagoSeleccionable
  monto: string
}

function filaVacia(metodo: MetodoPagoSeleccionable = 'efectivo'): FilaPago {
  return { metodo, monto: '' }
}

export function PaymentModal({ open, onClose, total, procesando, clientes, onConfirmar, onCrearCliente }: Props) {
  const { yapeQr } = useNegocio()
  const toast = useToast()
  const [metodo, setMetodo] = useState<MetodoPagoSeleccionable>('efectivo')
  const [recibido, setRecibido] = useState('')
  const [busqCliente, setBusqCliente] = useState('')
  const [clienteId, setClienteId] = useState<string | null>(null)

  // Pago mixto (2+ metodos en la misma venta, ej. Efectivo + Yape) — apagado
  // por defecto: la pantalla de un solo metodo (de siempre) no cambia en
  // nada mientras el cajero no lo active.
  const [mixto, setMixto] = useState(false)
  const [filasPago, setFilasPago] = useState<FilaPago[]>([filaVacia('efectivo'), filaVacia('yape')])

  // Registro rapido de cliente nuevo desde el cobro (fiado, mixto o no).
  const [nuevoClienteAbierto, setNuevoClienteAbierto] = useState(false)
  const [ncNombre, setNcNombre] = useState('')
  const [ncTelefono, setNcTelefono] = useState('')
  const [ncLimite, setNcLimite] = useState('100')
  const [creandoCliente, setCreandoCliente] = useState(false)

  const esEfectivo = metodo === 'efectivo'
  const esFiado = metodo === 'fiado'
  const pago = parseFloat(recibido) || 0
  const vuelto = useMemo(() => Math.max(pago - total, 0), [pago, total])
  const suficienteEfectivo = pago >= total
  const clienteSeleccionado = clientes.find((c) => c.id === clienteId) ?? null

  // ── Pago mixto: filas validas (con monto > 0), suma y estado ────────────
  const filasValidas = useMemo(
    () => filasPago.filter((f) => (parseFloat(f.monto) || 0) > 0),
    [filasPago],
  )
  const sumaMixto = filasValidas.reduce((s, f) => s + (parseFloat(f.monto) || 0), 0)
  const faltaMixto = Math.max(total - sumaMixto, 0)
  const vueltoMixto = Math.max(sumaMixto - total, 0)
  const efectivoMixtoTotal = filasValidas
    .filter((f) => f.metodo === 'efectivo')
    .reduce((s, f) => s + (parseFloat(f.monto) || 0), 0)
  const hayFiadoMixto = filasValidas.some((f) => f.metodo === 'fiado')
  const montoFiadoMixto = filasValidas
    .filter((f) => f.metodo === 'fiado')
    .reduce((s, f) => s + (parseFloat(f.monto) || 0), 0)
  // El vuelto solo puede salir de una pierna en efectivo (igual criterio que
  // el servidor) — si sobra dinero y no hay pierna en efectivo suficiente,
  // no se puede confirmar todavia.
  const vueltoMixtoValido = vueltoMixto === 0 || efectivoMixtoTotal >= vueltoMixto

  // Validacion de credito para fiado (single o dentro de un pago mixto)
  const montoFiadoAValidar = mixto ? montoFiadoMixto : total
  const creditoDisponible = clienteSeleccionado
    ? clienteSeleccionado.limite_credito - clienteSeleccionado.deuda_actual
    : 0
  const superaLimite =
    (mixto ? hayFiadoMixto : esFiado) && clienteSeleccionado && montoFiadoAValidar > creditoDisponible
  const sinCliente = (mixto ? hayFiadoMixto : esFiado) && !clienteSeleccionado

  const puedeConfirmar = mixto
    ? filasValidas.length > 0 &&
      sumaMixto >= total &&
      vueltoMixtoValido &&
      !sinCliente &&
      !superaLimite
    : !sinCliente && !superaLimite && (!esEfectivo || suficienteEfectivo)

  const clientesFiltrados = useMemo(() => {
    const q = busqCliente.trim().toLowerCase()
    return q
      ? clientes.filter(
          (c) =>
            c.nombre.toLowerCase().includes(q) ||
            (c.telefono ?? '').includes(q),
        )
      : clientes
  }, [clientes, busqCliente])

  function seleccionar(id: string) {
    setClienteId(id)
    setBusqCliente('')
    setNuevoClienteAbierto(false)
  }

  async function crearClienteRapido() {
    if (!ncNombre.trim()) {
      toast.error('Ingresa el nombre del cliente.')
      return
    }
    const limite = parseFloat(ncLimite) || 0
    if (limite < 0) {
      toast.error('El límite de crédito no puede ser negativo.')
      return
    }
    setCreandoCliente(true)
    try {
      const nuevo = await onCrearCliente({
        nombre: ncNombre.trim(),
        telefono: ncTelefono.trim() || null,
        direccion: null,
        limite_credito: limite,
      })
      toast.exito(`Cliente "${nuevo.nombre}" registrado`)
      seleccionar(nuevo.id)
      setNcNombre('')
      setNcTelefono('')
      setNcLimite('100')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo crear el cliente')
    } finally {
      setCreandoCliente(false)
    }
  }

  // ── Filas de pago mixto ──────────────────────────────────────────────────
  function actualizarFila(idx: number, cambios: Partial<FilaPago>) {
    setFilasPago((prev) => prev.map((f, i) => (i === idx ? { ...f, ...cambios } : f)))
  }
  function agregarFila() {
    setFilasPago((prev) => [...prev, filaVacia(prev.some((f) => f.metodo === 'efectivo') ? 'yape' : 'efectivo')])
  }
  function quitarFila(idx: number) {
    setFilasPago((prev) => prev.filter((_, i) => i !== idx))
  }
  function activarMixto() {
    // Precarga la primera fila con lo que ya se habia elegido, para no
    // perder lo que el cajero ya habia empezado a escribir.
    setFilasPago([
      { metodo, monto: esEfectivo && pago > 0 ? Math.min(pago, total).toFixed(2) : '' },
      filaVacia(metodo === 'yape' ? 'efectivo' : 'yape'),
    ])
    setMixto(true)
  }

  function confirmar() {
    if (mixto) {
      const pagos: PagoLeg[] = filasValidas.map((f) => ({ metodo: f.metodo, monto: parseFloat(f.monto) || 0 }))
      onConfirmar(pagos, hayFiadoMixto ? clienteId ?? undefined : undefined)
      return
    }
    const pagoFinal = esEfectivo ? pago : total
    onConfirmar([{ metodo, monto: pagoFinal }], esFiado ? clienteId ?? undefined : undefined)
  }

  function reset() {
    setMetodo('efectivo')
    setRecibido('')
    setBusqCliente('')
    setClienteId(null)
    setMixto(false)
    setFilasPago([filaVacia('efectivo'), filaVacia('yape')])
    setNuevoClienteAbierto(false)
    setNcNombre('')
    setNcTelefono('')
    setNcLimite('100')
  }

  function handleClose() {
    reset()
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title="Cobrar venta"
      maxWidth="max-w-md"
      footer={
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={!puedeConfirmar}
          loading={procesando}
          onClick={confirmar}
        >
          <Check className="size-5" />
          Confirmar cobro · {money(total)}
        </Button>
      }
    >
      <div className="space-y-5">
        {/* Total */}
        <div className="rounded-2xl bg-ink-900 px-5 py-4 text-white">
          <p className="text-xs font-medium uppercase tracking-wider text-white/50">
            Total a cobrar
          </p>
          <p className="tabular font-display text-3xl font-bold">{money(total)}</p>
        </div>

        {/* Selección de método (oculta en modo pago mixto: ahi cada fila elige el suyo) */}
        {!mixto && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="label">Método de pago</p>
            <button
              onClick={activarMixto}
              className="flex items-center gap-1 text-xs font-semibold text-ink-400 hover:text-accent-700"
            >
              <Split className="size-3.5" /> Dividir el pago
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {METODOS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { setMetodo(id); setClienteId(null); setRecibido('') }}
                className={cx(
                  'flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-semibold transition focusable',
                  metodo === id
                    ? 'border-accent-500 bg-accent-50 text-accent-700'
                    : 'border-ink-200 text-ink-500 hover:border-ink-300',
                )}
              >
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Panel: Pago mixto (2+ metodos) */}
        {mixto && (
          <div className="animate-fade-up space-y-3">
            <div className="flex items-center justify-between">
              <p className="label">Pago dividido entre varios métodos</p>
              <button
                onClick={() => { setMixto(false); setClienteId(null) }}
                className="flex items-center gap-1 text-xs font-semibold text-ink-400 hover:text-ink-700"
              >
                <X className="size-3.5" /> Un solo método
              </button>
            </div>

            <div className="space-y-2">
              {filasPago.map((fila, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    className="input flex-1 py-2 text-sm"
                    value={fila.metodo}
                    onChange={(e) => actualizarFila(idx, { metodo: e.target.value as MetodoPagoSeleccionable })}
                  >
                    {METODOS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.01}
                    className="input tabular w-28 py-2 text-sm"
                    value={fila.monto}
                    onChange={(e) => actualizarFila(idx, { monto: e.target.value })}
                    placeholder="0.00"
                  />
                  <button
                    onClick={() => quitarFila(idx)}
                    disabled={filasPago.length <= 1}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              {filasPago.length < 4 && (
                <button
                  onClick={agregarFila}
                  className="flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-accent-700"
                >
                  <Plus className="size-3.5" /> Agregar otro método
                </button>
              )}
            </div>

            <div
              className={cx(
                'flex items-center justify-between rounded-xl px-4 py-3',
                faltaMixto > 0 ? 'bg-red-50' : vueltoMixto > 0 && !vueltoMixtoValido ? 'bg-red-50' : 'bg-accent-50',
              )}
            >
              <span className="text-sm font-medium text-ink-600">
                {faltaMixto > 0 ? 'Falta' : vueltoMixto > 0 ? 'Vuelto' : 'Cubierto'}
              </span>
              <span
                className={cx(
                  'tabular font-display text-xl font-bold',
                  faltaMixto > 0 || (vueltoMixto > 0 && !vueltoMixtoValido) ? 'text-red-600' : 'text-accent-700',
                )}
              >
                {faltaMixto > 0 ? money(faltaMixto) : vueltoMixto > 0 ? money(vueltoMixto) : money(sumaMixto)}
              </span>
            </div>
            {vueltoMixto > 0 && !vueltoMixtoValido && (
              <p className="text-xs text-red-600">
                El vuelto no puede salir de Yape/Fiado — agrega o aumenta una fila en Efectivo.
              </p>
            )}

            {hayFiadoMixto && (
              <div className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700">
                {money(montoFiadoMixto)} de esta venta quedarán al fiado — selecciona el cliente abajo.
              </div>
            )}
          </div>
        )}

        {/* Panel: Efectivo */}
        {!mixto && esEfectivo && (
          <div className="space-y-3 animate-fade-up">
            <div>
              <p className="label mb-2">¿Con cuánto paga?</p>
              <input
                type="number"
                inputMode="decimal"
                autoFocus
                value={recibido}
                onChange={(e) => setRecibido(e.target.value)}
                placeholder="0.00"
                className="input tabular text-lg"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setRecibido(total.toFixed(2))}
                className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-200"
              >
                Exacto
              </button>
              {RAPIDOS.filter((m) => m >= total).map((m) => (
                <button
                  key={m}
                  onClick={() => setRecibido(String(m))}
                  className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-200"
                >
                  S/ {m}
                </button>
              ))}
            </div>
            {pago > 0 && (
              <div
                className={cx(
                  'flex items-center justify-between rounded-xl px-4 py-3',
                  suficienteEfectivo ? 'bg-accent-50' : 'bg-red-50',
                )}
              >
                <span className="text-sm font-medium text-ink-600">Vuelto</span>
                <span
                  className={cx(
                    'tabular font-display text-xl font-bold',
                    suficienteEfectivo ? 'text-accent-700' : 'text-red-600',
                  )}
                >
                  {suficienteEfectivo ? money(vuelto) : 'Falta ' + money(total - pago)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Panel: Yape */}
        {!mixto && metodo === 'yape' && (
          <div className="animate-fade-up rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <Smartphone className="mb-1 size-4 text-blue-500" />
            <p className="font-semibold">Pago con Yape por {money(total)}</p>
            <p className="mt-0.5 text-xs text-blue-500">
              Confirma que el cliente haya completado la transferencia antes de procesar.
            </p>
            {yapeQr && (
              <div className="mt-3 flex flex-col items-center gap-1.5">
                <img
                  src={yapeQr}
                  alt="Código QR de Yape"
                  className="size-56 max-w-full rounded-xl bg-white object-contain p-2 shadow-sm"
                />
                <p className="text-xs font-medium text-blue-600">
                  El cliente escanea este QR desde su app de Yape
                </p>
              </div>
            )}
          </div>
        )}

        {/* Panel: Fiado (metodo unico, o parte de un pago mixto) */}
        {(esFiado || (mixto && hayFiadoMixto)) && (
          <div className="animate-fade-up space-y-3">
            {clienteSeleccionado ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-ink-800">{clienteSeleccionado.nombre}</p>
                    <p className="text-xs text-ink-400">
                      Deuda: {money(clienteSeleccionado.deuda_actual)} ·{' '}
                      Límite: {money(clienteSeleccionado.limite_credito)}
                    </p>
                  </div>
                  <button
                    onClick={() => setClienteId(null)}
                    className="text-xs text-ink-400 hover:text-red-600"
                  >
                    Cambiar
                  </button>
                </div>
                {superaLimite && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    <strong>Límite de crédito superado.</strong> Disponible:{' '}
                    {money(creditoDisponible)}, necesario: {money(montoFiadoAValidar)}.
                  </div>
                )}
                {!superaLimite && (
                  <div className="rounded-xl bg-accent-50 px-3.5 py-2.5 text-sm text-accent-700">
                    Disponible: {money(creditoDisponible)} ·{' '}
                    Tras la venta quedará: {money(clienteSeleccionado.deuda_actual + montoFiadoAValidar)}
                  </div>
                )}
              </div>
            ) : nuevoClienteAbierto ? (
              <div className="space-y-2.5 rounded-xl border border-ink-200 p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-800">Nuevo cliente</p>
                  <button
                    onClick={() => setNuevoClienteAbierto(false)}
                    className="text-xs text-ink-400 hover:text-ink-700"
                  >
                    Cancelar
                  </button>
                </div>
                <input
                  className="input"
                  value={ncNombre}
                  onChange={(e) => setNcNombre(e.target.value)}
                  placeholder="Nombre completo *"
                  autoFocus
                />
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    inputMode="numeric"
                    value={ncTelefono}
                    onChange={(e) => setNcTelefono(e.target.value)}
                    placeholder="Teléfono (opcional)"
                  />
                  <input
                    className="input tabular w-28"
                    type="number"
                    min={0}
                    step={10}
                    value={ncLimite}
                    onChange={(e) => setNcLimite(e.target.value)}
                    placeholder="Límite S/"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  loading={creandoCliente}
                  onClick={crearClienteRapido}
                >
                  <UserPlus className="size-4" /> Registrar y usar en esta venta
                </Button>
              </div>
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="label">Seleccionar cliente</p>
                  <button
                    onClick={() => setNuevoClienteAbierto(true)}
                    className="flex items-center gap-1 text-xs font-semibold text-accent-700 hover:text-accent-800"
                  >
                    <UserPlus className="size-3.5" /> Nuevo cliente
                  </button>
                </div>
                {clientes.length === 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    No hay clientes con fiado registrados todavía — usa "Nuevo cliente" arriba.
                  </div>
                ) : (
                  <>
                    <div className="relative mb-2">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
                      <input
                        className="input pl-9"
                        value={busqCliente}
                        onChange={(e) => setBusqCliente(e.target.value)}
                        placeholder="Buscar por nombre o teléfono..."
                      />
                    </div>
                    <ul className="max-h-48 overflow-y-auto divide-y divide-ink-100 rounded-xl border border-ink-200">
                      {clientesFiltrados.map((c) => {
                        const pct = c.limite_credito > 0 ? (c.deuda_actual / c.limite_credito) * 100 : 0
                        const bloqueado = c.deuda_actual + montoFiadoAValidar > c.limite_credito
                        return (
                          <li key={c.id}>
                            <button
                              disabled={bloqueado}
                              onClick={() => seleccionar(c.id)}
                              className={cx(
                                'flex w-full items-center justify-between px-3.5 py-2.5 text-left transition',
                                bloqueado
                                  ? 'cursor-not-allowed opacity-40'
                                  : 'hover:bg-ink-50',
                              )}
                            >
                              <div>
                                <p className="text-sm font-semibold text-ink-800">{c.nombre}</p>
                                <p className="text-xs text-ink-400">{c.telefono ?? 'Sin teléfono'}</p>
                              </div>
                              <div className="text-right">
                                <p className="tabular text-xs font-semibold text-ink-700">
                                  {money(c.deuda_actual)} / {money(c.limite_credito)}
                                </p>
                                <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-ink-100">
                                  <div
                                    className={cx(
                                      'h-full rounded-full',
                                      pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-400' : 'bg-accent-500',
                                    )}
                                    style={{ width: `${Math.min(pct, 100)}%` }}
                                  />
                                </div>
                              </div>
                            </button>
                          </li>
                        )
                      })}
                      {clientesFiltrados.length === 0 && (
                        <li className="py-4 text-center text-sm text-ink-400">Sin resultados</li>
                      )}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
