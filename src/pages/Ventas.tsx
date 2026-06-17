import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search,
  Printer,
  Receipt as ReceiptIcon,
  Filter,
  X,
  Ban,
  ChevronDown,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useCajaCtx } from '@/context/CajaContext'
import { Card, Badge, Button, Spinner } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import {
  money,
  fechaHora,
  horaCorta,
  ETIQUETA_PAGO,
  ymd,
  cx,
} from '@/utils/format'
import type { DetalleVenta, MetodoPago, Perfil, Venta } from '@/types/database'

const TONO_PAGO: Record<MetodoPago, 'neutral' | 'success' | 'info' | 'warning'> = {
  efectivo: 'success',
  yape: 'info',
  fiado: 'warning',
}

export function Ventas() {
  const { esAdmin } = useAuth()
  const { caja } = useCajaCtx()
  const toast = useToast()

  const hoy = ymd(new Date())
  const [desde, setDesde] = useState(hoy)
  const [hasta, setHasta] = useState(hoy)
  const [metodo, setMetodo] = useState<MetodoPago | ''>('')
  const [cajeroId, setCajeroId] = useState('')
  const [q, setQ] = useState('')

  const [cajeros, setCajeros] = useState<Perfil[]>([])
  const [ventas, setVentas] = useState<Venta[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtrosOpen, setFiltrosOpen] = useState(false)
  const [ticket, setTicket] = useState<Venta | null>(null)

  // Lista de cajeros para el filtro (solo admin)
  useEffect(() => {
    if (!esAdmin) return
    supabase
      .from('perfiles')
      .select('*')
      .order('nombre')
      .then(({ data }) => setCajeros(data ?? []))
  }, [esAdmin])

  const cargar = useCallback(async () => {
    setCargando(true)
    let query = supabase
      .from('ventas')
      .select('*')
      .gte('creado_en', `${desde}T00:00:00`)
      .lte('creado_en', `${hasta}T23:59:59.999`)
      .order('numero', { ascending: false })
      .limit(300)

    if (metodo) query = query.eq('metodo', metodo)
    if (esAdmin && cajeroId) query = query.eq('cajero_id', cajeroId)

    const { data, error } = await query
    if (error) toast.error('No se pudo cargar el historial')
    setVentas(data ?? [])
    setCargando(false)
  }, [desde, hasta, metodo, cajeroId, esAdmin, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return ventas
    return ventas.filter(
      (v) =>
        String(v.numero).includes(t) ||
        (v.cajero_nombre ?? '').toLowerCase().includes(t),
    )
  }, [ventas, q])

  // ── Resumen con integración de caja activa ────────────────────────────────
  // Cuando el filtro apunta a "hoy" y hay una caja abierta hoy, se usan los
  // totales EN VIVO del contexto de caja. Esto garantiza que cualquier venta
  // recién registrada en el POS aparezca aquí sin necesidad de recargar.
  // Para cualquier otro rango de fechas, se usa la suma de la consulta a BD.
  const resumen = useMemo(() => {
    const validas = filtradas.filter((v: Venta) => !v.anulada)
    const totalDB = validas.reduce((s: number, v: Venta) => s + Number(v.total), 0)

    // La caja es "de hoy" si fue abierta en la fecha actual
    const cajaEsDeHoy = caja !== null && caja.abierta_en.slice(0, 10) === hoy
    // Solo sincronizamos con caja cuando el filtro está exactamente en hoy
    const filtroEsHoy = desde === hoy && hasta === hoy
    const anuladas    = filtradas.length - validas.length
    // Si hay ventas anuladas los totales de caja no las reflejan — usar BD en ese caso
    const canUseCaja  = cajaEsDeHoy && filtroEsHoy && anuladas === 0
    const usandoCaja  = canUseCaja

    // Conversión explícita a Number para evitar concatenación de texto o NaN
    const efectivoCaja = canUseCaja && caja ? Number(caja.total_efectivo) : null
    const yapeCaja     = canUseCaja && caja ? Number(caja.total_yape)     : null
    const fiadoCaja    = canUseCaja && caja ? Number(caja.total_fiado)    : null

    const total = canUseCaja && efectivoCaja !== null && yapeCaja !== null && fiadoCaja !== null
      ? efectivoCaja + yapeCaja + fiadoCaja
      : totalDB

    return {
      total,
      count: validas.length,
      anuladas,
      usandoCaja,
      efectivoCaja,
      yapeCaja,
      fiadoCaja,
    }
  }, [filtradas, caja, hoy, desde, hasta])

  const filtrosActivos =
    (metodo ? 1 : 0) + (cajeroId ? 1 : 0) + (desde !== hoy || hasta !== hoy ? 1 : 0)

  function limpiarFiltros() {
    setDesde(hoy)
    setHasta(hoy)
    setMetodo('')
    setCajeroId('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Ventas</h1>
          <p className="text-sm text-ink-400">Historial de transacciones y reimpresion</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltrosOpen(true)}
          className="relative"
        >
          <Filter className="size-4" /> Filtros
          {filtrosActivos > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-accent-600 text-[0.65rem] font-bold text-white">
              {filtrosActivos}
            </span>
          )}
        </Button>
      </div>

      {/* ── Métricas del periodo ── */}
      <div className="grid grid-cols-3 gap-3">

        {/* Tarjeta "Recaudado" — sincronizada con caja activa cuando filtro = hoy */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-0.5">
            <p className="label">Recaudado</p>
            {resumen.usandoCaja && (
              <span className="flex items-center gap-1 text-[0.65rem] font-semibold uppercase tracking-wider text-accent-600">
                <span className="relative flex size-1.5 shrink-0">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-500 opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-accent-500" />
                </span>
                En vivo
              </span>
            )}
          </div>
          <p className="mt-1 font-display text-xl font-bold tabular text-ink-900">
            {money(resumen.total)}
          </p>
          {/* Desglose por método cuando datos provienen de caja activa */}
          {resumen.usandoCaja &&
            resumen.efectivoCaja !== null &&
            resumen.yapeCaja !== null &&
            resumen.fiadoCaja !== null && (
            <div className="mt-2 space-y-0.5 border-t border-ink-100 pt-2">
              <div className="flex justify-between text-[0.7rem] text-ink-400">
                <span>Efectivo</span>
                <span className="tabular font-medium text-accent-700">
                  {money(resumen.efectivoCaja)}
                </span>
              </div>
              <div className="flex justify-between text-[0.7rem] text-ink-400">
                <span>Yape</span>
                <span className="tabular font-medium text-blue-600">
                  {money(resumen.yapeCaja)}
                </span>
              </div>
              {resumen.fiadoCaja > 0 && (
                <div className="flex justify-between text-[0.7rem] text-ink-400">
                  <span>Fiado</span>
                  <span className="tabular font-medium text-amber-600">
                    {money(resumen.fiadoCaja)}
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <p className="label">Transacciones</p>
          <p className="mt-1 font-display text-xl font-bold tabular text-ink-900">
            {resumen.count}
          </p>
        </Card>

        <Card className="p-4">
          <p className="label">Anuladas</p>
          <p className="mt-1 font-display text-xl font-bold tabular text-ink-900">
            {resumen.anuladas}
          </p>
        </Card>
      </div>

      {/* Buscador */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
        <input
          className="input pl-10"
          placeholder="Buscar por # de comprobante o cajero"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* Listado */}
      {cargando ? (
        <div className="grid place-items-center py-20 text-ink-400">
          <Spinner className="size-6" />
        </div>
      ) : filtradas.length === 0 ? (
        <Card className="grid place-items-center gap-2 py-16 text-center">
          <ReceiptIcon className="size-8 text-ink-300" />
          <p className="text-sm text-ink-400">No hay ventas en este periodo</p>
        </Card>
      ) : (
        <>
          {/* Tabla desktop */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-ink-400">
                  <th className="px-4 py-3 font-semibold">Comprobante</th>
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Cajero</th>
                  <th className="px-4 py-3 font-semibold">Pago</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtradas.map((v) => (
                  <tr
                    key={v.id}
                    className={cx(
                      'border-b border-ink-50 last:border-0 hover:bg-ink-50/60',
                      v.anulada && 'opacity-50',
                    )}
                  >
                    <td className="px-4 py-3 font-semibold text-ink-900">
                      #{v.numero}
                      {v.anulada && (
                        <Badge tone="danger" className="ml-2">
                          Anulada
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-500">{fechaHora(v.creado_en)}</td>
                    <td className="px-4 py-3 text-ink-700">{v.cajero_nombre ?? '-'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={TONO_PAGO[v.metodo]}>{ETIQUETA_PAGO[v.metodo]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular text-ink-900">
                      {money(Number(v.total))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setTicket(v)}>
                        <Printer className="size-4" /> Ticket
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Cards movil */}
          <div className="space-y-2.5 md:hidden">
            {filtradas.map((v) => (
              <Card
                key={v.id}
                className={cx('p-4', v.anulada && 'opacity-50')}
              >
                <button
                  className="flex w-full items-center justify-between gap-3 text-left"
                  onClick={() => setTicket(v)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-ink-900">#{v.numero}</span>
                      <Badge tone={TONO_PAGO[v.metodo]}>{ETIQUETA_PAGO[v.metodo]}</Badge>
                      {v.anulada && <Badge tone="danger">Anulada</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-400">
                      {horaCorta(v.creado_en)} · {v.cajero_nombre ?? '-'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display font-bold tabular text-ink-900">
                      {money(Number(v.total))}
                    </p>
                    <span className="inline-flex items-center gap-1 text-xs text-accent-600">
                      <Printer className="size-3.5" /> Ticket
                    </span>
                  </div>
                </button>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Sheet de filtros */}
      <Sheet
        open={filtrosOpen}
        onClose={() => setFiltrosOpen(false)}
        title="Filtros"
        maxWidth="max-w-md"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={limpiarFiltros}>
              <X className="size-4" /> Limpiar
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => setFiltrosOpen(false)}>
              Aplicar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-1.5 block">Desde</label>
              <input
                type="date"
                className="input"
                value={desde}
                max={hasta}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div>
              <label className="label mb-1.5 block">Hasta</label>
              <input
                type="date"
                className="input"
                value={hasta}
                min={desde}
                max={hoy}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label mb-1.5 block">Metodo de pago</label>
            <div className="relative">
              <select
                className="input appearance-none pr-9"
                value={metodo}
                onChange={(e) => setMetodo(e.target.value as MetodoPago | '')}
              >
                <option value="">Todos</option>
                {Object.entries(ETIQUETA_PAGO).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            </div>
          </div>

          {esAdmin && (
            <div>
              <label className="label mb-1.5 block">Cajero</label>
              <div className="relative">
                <select
                  className="input appearance-none pr-9"
                  value={cajeroId}
                  onChange={(e) => setCajeroId(e.target.value)}
                >
                  <option value="">Todos</option>
                  {cajeros.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} {c.rol === 'administrador' ? '(admin)' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {[
              { l: 'Hoy', d: 0 },
              { l: 'Ayer', d: 1 },
              { l: 'Ult. 7 dias', d: 7 },
              { l: 'Ult. 30 dias', d: 30 },
            ].map((r) => (
              <button
                key={r.l}
                className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-50"
                onClick={() => {
                  const fin = new Date()
                  const ini = new Date()
                  if (r.d === 1) {
                    ini.setDate(ini.getDate() - 1)
                    fin.setDate(fin.getDate() - 1)
                  } else if (r.d > 1) {
                    ini.setDate(ini.getDate() - r.d)
                  }
                  setDesde(ymd(ini))
                  setHasta(ymd(fin))
                }}
              >
                {r.l}
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      {/* Reimpresion de ticket */}
      <TicketReprint
        venta={ticket}
        esAdmin={esAdmin}
        onClose={() => setTicket(null)}
        onAnulada={() => {
          setTicket(null)
          cargar()
        }}
      />
    </div>
  )
}

/* ─── Reimpresion de ticket desde historial ───────────────────────────────── */
function TicketReprint({
  venta,
  esAdmin,
  onClose,
  onAnulada,
}: {
  venta: Venta | null
  esAdmin: boolean
  onClose: () => void
  onAnulada: () => void
}) {
  const toast = useToast()
  const [detalle, setDetalle] = useState<DetalleVenta[]>([])
  const [cargando, setCargando] = useState(false)
  const [anulando, setAnulando] = useState(false)

  useEffect(() => {
    if (!venta) return
    setCargando(true)
    supabase
      .from('detalle_ventas')
      .select('*')
      .eq('venta_id', venta.id)
      .then(({ data }) => {
        setDetalle(data ?? [])
        setCargando(false)
      })
  }, [venta])

  async function anular() {
    if (!venta) return
    const ok = window.confirm(
      `Anular el comprobante #${venta.numero}? Se devolvera el stock vendido.`,
    )
    if (!ok) return
    setAnulando(true)
    const { error } = await supabase.rpc('anular_venta', { p_venta_id: venta.id })
    setAnulando(false)
    if (error) {
      toast.error(error.message || 'No se pudo anular la venta')
      return
    }
    toast.exito(`Comprobante #${venta.numero} anulado`)
    onAnulada()
  }

  if (!venta) return null

  return (
    <Sheet
      open={!!venta}
      onClose={onClose}
      maxWidth="max-w-sm"
      footer={
        <div className="flex gap-2">
          {esAdmin && !venta.anulada && (
            <Button variant="danger" onClick={anular} loading={anulando}>
              <Ban className="size-4" /> Anular
            </Button>
          )}
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => window.print()}
            disabled={cargando}
          >
            <Printer className="size-4" /> Imprimir
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      <div className="mb-3 text-center">
        <p className="font-display text-lg font-bold text-ink-900">
          Comprobante #{venta.numero}
        </p>
        {venta.anulada && <Badge tone="danger">Anulada</Badge>}
      </div>

      <div
        id="ticket-imprimible"
        className="rounded-xl border border-dashed border-ink-200 p-4 font-sans text-sm"
      >
        <div className="mb-3 text-center">
          <p className="font-display text-base font-bold">BODEGUITA JULI</p>
          <p className="text-xs text-ink-400">{fechaHora(venta.creado_en)}</p>
          <p className="text-xs text-ink-400">Cajero: {venta.cajero_nombre ?? '-'}</p>
          <p className="text-xs text-ink-400">Comprobante #{venta.numero}</p>
        </div>

        {cargando ? (
          <div className="grid place-items-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : (
          <div className="space-y-1 border-y border-ink-100 py-2.5">
            {detalle.map((d) => (
              <div key={d.id} className="flex justify-between gap-2">
                <span className="min-w-0 truncate text-ink-700">
                  {d.cantidad}x {d.producto_nombre}
                </span>
                <span className="tabular shrink-0 text-ink-900">{money(Number(d.subtotal))}</span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1 pt-2.5 text-ink-600">
          <Fila k="Subtotal" v={money(Number(venta.subtotal))} />
          {Number(venta.descuento) > 0 && <Fila k="Descuento" v={'- ' + money(Number(venta.descuento))} />}
          <Fila k="IGV (18%)" v={money(Number(venta.igv))} />
          <div className="flex justify-between border-t border-ink-200 pt-1.5 font-display text-base font-bold text-ink-900">
            <span>TOTAL</span>
            <span className="tabular">{money(Number(venta.total))}</span>
          </div>
          <Fila k={ETIQUETA_PAGO[venta.metodo]} v={money(Number(venta.pago_recibido))} />
          {Number(venta.vuelto) > 0 && <Fila k="Vuelto" v={money(Number(venta.vuelto))} />}
        </div>
        <p className="mt-3 text-center text-xs text-ink-400">¡Gracias por su compra!</p>
      </div>
    </Sheet>
  )
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span>{k}</span>
      <span className="tabular">{v}</span>
    </div>
  )
}
