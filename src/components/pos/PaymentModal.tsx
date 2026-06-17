import { useMemo, useState } from 'react'
import { Banknote, Smartphone, HandCoins, Check, Search } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { money, cx } from '@/utils/format'
import type { ClienteCredito, MetodoPago } from '@/types/database'

interface Props {
  open: boolean
  onClose: () => void
  total: number
  procesando: boolean
  clientes: ClienteCredito[]
  onConfirmar: (metodo: MetodoPago, pagoRecibido: number, clienteId?: string) => void
}

const METODOS: { id: MetodoPago; label: string; icon: typeof Banknote; desc: string }[] = [
  { id: 'efectivo', label: 'Efectivo', icon: Banknote, desc: 'Pago con billetes/monedas' },
  { id: 'yape', label: 'Yape', icon: Smartphone, desc: 'Transferencia instantánea' },
  { id: 'fiado', label: 'Fiado', icon: HandCoins, desc: 'Apuntar a cuenta del cliente' },
]

const RAPIDOS = [10, 20, 50, 100, 200]

export function PaymentModal({ open, onClose, total, procesando, clientes, onConfirmar }: Props) {
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo')
  const [recibido, setRecibido] = useState('')
  const [busqCliente, setBusqCliente] = useState('')
  const [clienteId, setClienteId] = useState<string | null>(null)

  const esEfectivo = metodo === 'efectivo'
  const esFiado = metodo === 'fiado'
  const pago = parseFloat(recibido) || 0
  const vuelto = useMemo(() => Math.max(pago - total, 0), [pago, total])
  const suficienteEfectivo = pago >= total
  const clienteSeleccionado = clientes.find((c) => c.id === clienteId) ?? null

  // Validacion de credito para fiado
  const creditoDisponible = clienteSeleccionado
    ? clienteSeleccionado.limite_credito - clienteSeleccionado.deuda_actual
    : 0
  const superaLimite = esFiado && clienteSeleccionado && total > creditoDisponible
  const sinCliente = esFiado && !clienteSeleccionado

  const puedeConfirmar =
    !sinCliente &&
    !superaLimite &&
    (!esEfectivo || suficienteEfectivo)

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
  }

  function confirmar() {
    const pagoFinal = esEfectivo ? pago : total
    onConfirmar(metodo, pagoFinal, esFiado ? clienteId ?? undefined : undefined)
  }

  function reset() {
    setMetodo('efectivo')
    setRecibido('')
    setBusqCliente('')
    setClienteId(null)
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

        {/* Selección de método */}
        <div>
          <p className="label mb-2">Método de pago</p>
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

        {/* Panel: Efectivo */}
        {esEfectivo && (
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
        {metodo === 'yape' && (
          <div className="animate-fade-up rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <Smartphone className="mb-1 size-4 text-blue-500" />
            <p className="font-semibold">Pago con Yape por {money(total)}</p>
            <p className="mt-0.5 text-xs text-blue-500">
              Confirma que el cliente haya completado la transferencia antes de procesar.
            </p>
          </div>
        )}

        {/* Panel: Fiado */}
        {esFiado && (
          <div className="animate-fade-up space-y-3">
            {clientes.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                No hay clientes con fiado registrados. Ve a{' '}
                <strong>Clientes</strong> para registrar uno.
              </div>
            ) : clienteSeleccionado ? (
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
                    {money(creditoDisponible)}, necesario: {money(total)}.
                  </div>
                )}
                {!superaLimite && (
                  <div className="rounded-xl bg-accent-50 px-3.5 py-2.5 text-sm text-accent-700">
                    Disponible: {money(creditoDisponible)} ·{' '}
                    Tras la venta quedará: {money(clienteSeleccionado.deuda_actual + total)}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <p className="label mb-2">Seleccionar cliente</p>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
                  <input
                    className="input pl-9"
                    value={busqCliente}
                    onChange={(e) => setBusqCliente(e.target.value)}
                    placeholder="Buscar por nombre o teléfono..."
                    autoFocus
                  />
                </div>
                <ul className="max-h-48 overflow-y-auto divide-y divide-ink-100 rounded-xl border border-ink-200">
                  {clientesFiltrados.map((c) => {
                    const pct = c.limite_credito > 0 ? (c.deuda_actual / c.limite_credito) * 100 : 0
                    const bloqueado = c.deuda_actual + total > c.limite_credito
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
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
