import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts'
import {
  TrendingUp,
  Receipt,
  Wallet,
  AlertTriangle,
  Activity,
  ArrowUpRight,
  TrendingDown,
  CalendarClock,
} from 'lucide-react'
import { useVentasRealtime } from '@/hooks/useVentasRealtime'
import { useProductos } from '@/hooks/useProductos'
import { useMermas } from '@/hooks/useMermas'
import { supabase } from '@/lib/supabase'
import { Card, Badge } from '@/components/ui/Button'
import { money, numero, horaCorta, cx, ETIQUETA_PAGO } from '@/utils/format'
import type { DetalleVenta } from '@/types/database'

function inicioMes(): Date {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

function finHoy(): Date {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

function diasHasta(fecha: string): number {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const vence = new Date(fecha + 'T00:00:00')
  return Math.round((vence.getTime() - hoy.getTime()) / 86400000)
}

export function Dashboard() {
  const { ventas, cargando } = useVentasRealtime()
  const { productos } = useProductos()
  const desdeRef = useRef(inicioMes())
  const hastaRef = useRef(finHoy())
  const { costoTotal: costMermasMes } = useMermas(desdeRef.current, hastaRef.current)
  const [topProductos, setTopProductos] = useState<{ nombre: string; cantidad: number }[]>([])
  const [pulso, setPulso] = useState(false)

  // Productos proximos a vencer (dentro de 30 dias, con fecha_vencimiento definida)
  const proximosVencer = useMemo(() => {
    return productos
      .filter((p) => {
        if (!p.fecha_vencimiento || !p.activo) return false
        const dias = diasHasta(p.fecha_vencimiento)
        return dias >= 0 && dias <= 30
      })
      .sort((a, b) => {
        const da = diasHasta(a.fecha_vencimiento!)
        const db = diasHasta(b.fecha_vencimiento!)
        return da - db
      })
  }, [productos])

  // Pulso visual cuando entra una venta nueva
  useEffect(() => {
    if (ventas.length === 0) return
    setPulso(true)
    const t = setTimeout(() => setPulso(false), 1500)
    return () => clearTimeout(t)
  }, [ventas.length])

  // Top productos del dia (agrega desde detalle_ventas de las ventas de hoy)
  useEffect(() => {
    async function cargarTop() {
      const ids = ventas.map((v) => v.id)
      if (ids.length === 0) {
        setTopProductos([])
        return
      }
      const { data } = await supabase
        .from('detalle_ventas')
        .select('producto_nombre, cantidad, venta_id')
        .in('venta_id', ids)
      const mapa = new Map<string, number>()
      ;(data as DetalleVenta[] | null)?.forEach((d) => {
        mapa.set(d.producto_nombre, (mapa.get(d.producto_nombre) ?? 0) + d.cantidad)
      })
      setTopProductos(
        [...mapa.entries()]
          .map(([nombre, cantidad]) => ({ nombre, cantidad }))
          .sort((a, b) => b.cantidad - a.cantidad)
          .slice(0, 6),
      )
    }
    cargarTop()
  }, [ventas])

  const kpis = useMemo(() => {
    const totalVendido = ventas.reduce((s, v) => s + v.total, 0)
    const ticketProm = ventas.length ? totalVendido / ventas.length : 0
    const efectivo = ventas
      .filter((v) => v.metodo === 'efectivo')
      .reduce((s, v) => s + v.total, 0)
    return { totalVendido, transacciones: ventas.length, ticketProm, efectivo }
  }, [ventas])

  // Ventas por hora del dia
  const porHora = useMemo(() => {
    const horas = Array.from({ length: 14 }, (_, i) => i + 8) // 8am - 9pm
    const base = horas.map((h) => ({ hora: `${h}h`, total: 0 }))
    ventas.forEach((v) => {
      const h = new Date(v.creado_en).getHours()
      const idx = horas.indexOf(h)
      if (idx >= 0) base[idx].total += v.total
    })
    return base
  }, [ventas])

  const porMetodo = useMemo(() => {
    const mapa = new Map<string, number>()
    ventas.forEach((v) => mapa.set(v.metodo, (mapa.get(v.metodo) ?? 0) + v.total))
    return [...mapa.entries()].map(([metodo, total]) => ({
      metodo: ETIQUETA_PAGO[metodo] ?? metodo,
      total,
    }))
  }, [ventas])

  const stockBajo = productos.filter(
    (p) => p.stock_actual <= p.stock_minimo,
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Resumen del dia</h1>
          <p className="text-sm text-ink-400">
            {new Date().toLocaleDateString('es-PE', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </div>
        <Badge tone="success" className="gap-1.5">
          <span className="relative flex size-2">
            <span
              className={cx(
                'absolute inline-flex size-full rounded-full bg-accent-500',
                pulso && 'animate-pulse-ring',
              )}
            />
            <span className="relative inline-flex size-2 rounded-full bg-accent-500" />
          </span>
          En vivo
        </Badge>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={TrendingUp}
          label="Vendido hoy"
          valor={money(kpis.totalVendido)}
          destacado
          pulso={pulso}
        />
        <Kpi icon={Receipt} label="Transacciones" valor={numero.format(kpis.transacciones)} />
        <Kpi icon={Activity} label="Ticket promedio" valor={money(kpis.ticketProm)} />
        <Kpi icon={Wallet} label="En efectivo" valor={money(kpis.efectivo)} />
      </div>

      {/* KPI mermas del mes */}
      {costMermasMes > 0 && (
        <div className="flex items-center gap-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-100">
            <TrendingDown className="size-5 text-red-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-800">Pérdida por mermas este mes</p>
            <p className="text-xs text-red-500">
              Descuenta directamente de la utilidad neta del período
            </p>
          </div>
          <p className="tabular font-display text-xl font-bold text-red-700">
            {money(costMermasMes)}
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Ventas por hora */}
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display font-bold text-ink-900">Ventas por hora</h3>
            <ArrowUpRight className="size-4 text-ink-300" />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={porHora} margin={{ left: -18, right: 4, top: 4 }}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#059669" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e7e4" vertical={false} />
                <XAxis
                  dataKey="hora"
                  tick={{ fontSize: 11, fill: '#88887e' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 11, fill: '#88887e' }} axisLine={false} tickLine={false} />
                <Tooltip content={<TipChart />} />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#059669"
                  strokeWidth={2.5}
                  fill="url(#grad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Por metodo de pago */}
        <Card className="p-4">
          <h3 className="mb-3 font-display font-bold text-ink-900">Por metodo de pago</h3>
          {porMetodo.length === 0 ? (
            <EmptyMini />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porMetodo} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="metodo"
                    tick={{ fontSize: 11, fill: '#56564f' }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                  />
                  <Tooltip content={<TipChart />} cursor={{ fill: '#f6f6f5' }} />
                  <Bar dataKey="total" radius={[0, 6, 6, 0]} barSize={18}>
                    {porMetodo.map((_, i) => (
                      <Cell key={i} fill={['#0e0e0d', '#059669', '#0ea5e9', '#f59e0b', '#6366f1'][i % 5]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Alertas de vencimiento */}
        {proximosVencer.length > 0 && (
          <Card className="p-4 lg:col-span-2">
            <div className="mb-3 flex items-center gap-2">
              <CalendarClock className="size-5 text-amber-500" />
              <h3 className="font-display font-bold text-ink-900">Próximos a vencer</h3>
              <Badge tone="warning">{proximosVencer.length}</Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {proximosVencer.map((p) => {
                const dias = diasHasta(p.fecha_vencimiento!)
                const urgente = dias <= 7
                const pronto = dias <= 15
                return (
                  <div
                    key={p.id}
                    className={cx(
                      'flex items-center justify-between rounded-xl border px-3.5 py-2.5',
                      urgente
                        ? 'border-red-200 bg-red-50'
                        : pronto
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-ink-200 bg-ink-50',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900">{p.nombre}</p>
                      <p className="text-xs text-ink-400">{p.stock_actual} u. en stock</p>
                    </div>
                    <div className="ml-3 shrink-0 text-right">
                      <p
                        className={cx(
                          'font-display text-sm font-bold',
                          urgente ? 'text-red-700' : pronto ? 'text-amber-700' : 'text-ink-600',
                        )}
                      >
                        {dias === 0 ? 'Hoy' : dias === 1 ? '1 día' : `${dias} días`}
                      </p>
                      <p className="text-[0.65rem] text-ink-400">
                        {new Date(p.fecha_vencimiento! + 'T00:00:00').toLocaleDateString('es-PE', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {/* Top productos */}
        <Card className="p-4">
          <h3 className="mb-3 font-display font-bold text-ink-900">Mas vendidos hoy</h3>
          {topProductos.length === 0 ? (
            <EmptyMini />
          ) : (
            <ul className="space-y-2.5">
              {topProductos.map((p, i) => {
                const max = topProductos[0].cantidad
                return (
                  <li key={p.nombre} className="flex items-center gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-ink-100 text-xs font-bold text-ink-500">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink-800">{p.nombre}</span>
                        <span className="tabular shrink-0 text-sm font-bold text-ink-900">{p.cantidad}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <div
                          className="h-full rounded-full bg-accent-500"
                          style={{ width: `${(p.cantidad / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* Alertas de stock */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-display font-bold text-ink-900">Reposicion</h3>
            {stockBajo.length > 0 && <Badge tone="warning">{stockBajo.length}</Badge>}
          </div>
          {stockBajo.length === 0 ? (
            <div className="grid place-items-center py-8 text-center text-ink-300">
              <p className="text-sm font-medium">Todo el stock esta sano ✓</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {stockBajo.slice(0, 6).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-lg bg-amber-50/60 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-amber-500" />
                    <span className="text-sm font-semibold text-ink-800">{p.nombre}</span>
                  </div>
                  <span className="tabular text-sm font-bold text-amber-700">
                    {p.stock_actual} / {p.stock_minimo}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Ultimas transacciones */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-100">
          <h3 className="font-display font-bold text-ink-900">Ultimas ventas</h3>
        </div>
        {cargando ? (
          <div className="p-4 text-sm text-ink-400">Cargando...</div>
        ) : ventas.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-400">Aun no hay ventas hoy.</div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {ventas.slice(0, 8).map((v) => (
              <li key={v.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-lg bg-ink-100 text-xs font-bold text-ink-500">
                    #{v.numero}
                  </span>
                  <div className="leading-tight">
                    <p className="text-sm font-semibold text-ink-800">{v.cajero_nombre ?? 'Cajero'}</p>
                    <p className="text-xs text-ink-400">
                      {horaCorta(v.creado_en)} · {ETIQUETA_PAGO[v.metodo]}
                    </p>
                  </div>
                </div>
                <span className="tabular font-display font-bold text-ink-900">{money(v.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Kpi({
  icon: Icon,
  label,
  valor,
  destacado,
  pulso,
}: {
  icon: typeof TrendingUp
  label: string
  valor: string
  destacado?: boolean
  pulso?: boolean
}) {
  return (
    <div
      className={cx(
        'card rounded-2xl border p-4 transition',
        destacado && pulso && 'ring-2 ring-accent-400 ring-offset-1',
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className={cx(
            'grid size-8 place-items-center rounded-lg',
            destacado ? 'bg-accent-100' : 'bg-ink-100',
          )}
        >
          <Icon className={cx('size-[18px]', destacado ? 'text-accent-600' : 'text-ink-500')} />
        </span>
      </div>
      <p className="tabular font-display text-xl font-bold text-ink-900">{valor}</p>
      <p className="text-xs font-medium text-ink-400">{label}</p>
    </div>
  )
}

function TipChart({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-ink-100 bg-white px-3 py-2 shadow-pop">
      {label && <p className="mb-0.5 text-xs font-semibold text-ink-400">{label}</p>}
      <p className="tabular text-sm font-bold text-ink-900">{money(payload[0].value)}</p>
    </div>
  )
}

function EmptyMini() {
  return (
    <div className="grid h-40 place-items-center text-center text-ink-300">
      <p className="text-sm font-medium">Sin datos todavia</p>
    </div>
  )
}
