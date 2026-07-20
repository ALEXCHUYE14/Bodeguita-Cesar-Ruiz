import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, TrendingUp, AlertTriangle, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, Spinner, Button } from '@/components/ui/Button'
import { money, fechaCorta, ymd, cx } from '@/utils/format'
import { descargarCSV } from '@/utils/csv'

interface FilaRentabilidad {
  key: string
  nombre: string
  cantidad: number
  totalVendido: number
  costoTotal: number
  margen: number
  margenPct: number
  sinCosto: boolean
}

type Orden = 'margen' | 'vendido' | 'cantidad' | 'margenPct'

export function Rentabilidad() {
  const hoy = ymd(new Date())
  const [desde, setDesde] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return ymd(d)
  })
  const [hasta, setHasta] = useState(hoy)
  const [cargando, setCargando] = useState(true)
  const [filas, setFilas] = useState<FilaRentabilidad[]>([])
  const [orden, setOrden] = useState<Orden>('margen')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      // Costo actual de cada producto (incluye inactivos: un producto
      // descontinuado igual debe poder aparecer en reportes de periodos pasados).
      const { data: productos } = await supabase
        .from('productos')
        .select('id, precio_compra')
      const costoPorProducto = new Map<string, number>(
        (productos ?? []).map((p) => [p.id, Number(p.precio_compra)]),
      )

      // Filtra por fecha/anulada a traves del join embebido (evita pasar miles
      // de IDs de ventas en un solo .in(), que rompe con periodos largos).
      const { data, error } = await supabase
        .from('detalle_ventas')
        .select('producto_id, producto_nombre, cantidad, unidades, subtotal, ventas!inner(creado_en,anulada)')
        .eq('ventas.anulada', false)
        .gte('ventas.creado_en', `${desde}T00:00:00`)
        .lte('ventas.creado_en', `${hasta}T23:59:59.999`)
        .limit(20000)

      if (error) throw error

      const mapa = new Map<string, FilaRentabilidad>()
      ;(data ?? []).forEach((d) => {
        const key = d.producto_id ?? `sin-id:${d.producto_nombre}`
        const costoUnit = d.producto_id ? costoPorProducto.get(d.producto_id) : undefined
        const unidadesReales = Number(d.unidades ?? d.cantidad)
        const costo = costoUnit !== undefined ? unidadesReales * costoUnit : 0
        const prev = mapa.get(key) ?? {
          key,
          nombre: d.producto_nombre,
          cantidad: 0,
          totalVendido: 0,
          costoTotal: 0,
          margen: 0,
          margenPct: 0,
          sinCosto: costoUnit === undefined,
        }
        prev.cantidad += Number(d.cantidad)
        prev.totalVendido += Number(d.subtotal)
        prev.costoTotal += costo
        if (costoUnit === undefined) prev.sinCosto = true
        mapa.set(key, prev)
      })

      const resultado = [...mapa.values()].map((f) => ({
        ...f,
        margen: f.totalVendido - f.costoTotal,
        margenPct: f.totalVendido > 0 ? ((f.totalVendido - f.costoTotal) / f.totalVendido) * 100 : 0,
      }))
      setFilas(resultado)
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  useEffect(() => {
    cargar()
  }, [cargar])

  const filasOrdenadas = useMemo(() => {
    const copia = [...filas]
    copia.sort((a, b) => {
      if (orden === 'vendido') return b.totalVendido - a.totalVendido
      if (orden === 'cantidad') return b.cantidad - a.cantidad
      if (orden === 'margenPct') return b.margenPct - a.margenPct
      return b.margen - a.margen
    })
    return copia
  }, [filas, orden])

  const totales = useMemo(
    () =>
      filas.reduce(
        (acc, f) => ({
          vendido: acc.vendido + f.totalVendido,
          costo: acc.costo + f.costoTotal,
          margen: acc.margen + f.margen,
        }),
        { vendido: 0, costo: 0, margen: 0 },
      ),
    [filas],
  )
  const margenPctGlobal = totales.vendido > 0 ? (totales.margen / totales.vendido) * 100 : 0
  const hayProductosSinCosto = filas.some((f) => f.sinCosto)

  function exportarCSV() {
    const rows: (string | number)[][] = [
      [`Reporte de rentabilidad — ${fechaCorta(`${desde}T00:00:00`)} al ${fechaCorta(`${hasta}T00:00:00`)}`],
      [],
      ['Producto', 'Cantidad vendida', 'Total vendido', 'Costo estimado', 'Margen', 'Margen %'],
      ...filasOrdenadas.map((f) => [
        f.nombre,
        f.cantidad,
        f.totalVendido.toFixed(2),
        f.costoTotal.toFixed(2),
        f.margen.toFixed(2),
        f.margenPct.toFixed(1),
      ]),
      [],
      ['TOTAL', '', totales.vendido.toFixed(2), totales.costo.toFixed(2), totales.margen.toFixed(2), margenPctGlobal.toFixed(1)],
    ]
    descargarCSV(`rentabilidad_${desde}_a_${hasta}.csv`, rows)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Rentabilidad</h1>
          <p className="text-sm text-ink-400">Margen por producto (venta - costo de compra)</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportarCSV} disabled={filas.length === 0}>
          <Download className="size-4" /> <span className="hidden sm:inline">Descargar</span>
        </Button>
      </div>

      {/* Filtro de fechas */}
      <Card className="flex flex-wrap items-end gap-3 p-4">
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
        <div className="flex flex-wrap gap-1.5">
          {[
            { l: 'Este mes', f: () => { const d = new Date(); d.setDate(1); return d } },
            { l: 'Mes pasado', f: () => { const d = new Date(); d.setMonth(d.getMonth() - 1, 1); return d } },
            { l: 'Ult. 30 dias', f: () => { const d = new Date(); d.setDate(d.getDate() - 30); return d } },
          ].map((r) => (
            <button
              key={r.l}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-50"
              onClick={() => {
                if (r.l === 'Mes pasado') {
                  const d = r.f()
                  const finMes = new Date(d.getFullYear(), d.getMonth() + 1, 0)
                  setDesde(ymd(d))
                  setHasta(ymd(finMes))
                } else {
                  setDesde(ymd(r.f()))
                  setHasta(hoy)
                }
              }}
            >
              {r.l}
            </button>
          ))}
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="label">Total vendido</p>
          <p className="mt-1 font-display text-xl font-bold tabular text-ink-900">{money(totales.vendido)}</p>
        </Card>
        <Card className="p-4">
          <p className="label">Costo estimado</p>
          <p className="mt-1 font-display text-xl font-bold tabular text-ink-900">{money(totales.costo)}</p>
        </Card>
        <Card className="p-4">
          <p className="label">Margen bruto</p>
          <p className={cx('mt-1 font-display text-xl font-bold tabular', totales.margen >= 0 ? 'text-accent-700' : 'text-red-700')}>
            {money(totales.margen)}
          </p>
          <p className="text-xs text-ink-400">{margenPctGlobal.toFixed(1)}% de margen</p>
        </Card>
      </div>

      {hayProductosSinCosto && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Algunos productos vendidos en este periodo ya no existen en el inventario o no tienen
            precio de compra registrado — su margen se muestra como "—" porque no se puede calcular
            el costo con certeza.
          </span>
        </div>
      )}

      <div className="rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-700">
        El costo se calcula con el <b>precio de compra actual</b> de cada producto, no con el precio
        historico al momento de cada venta. Si cambiaste precios de compra recientemente, el margen
        de periodos antiguos es una aproximacion.
      </div>

      {/* Tabla */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-2.5">
          <h3 className="text-sm font-bold text-ink-900">Por producto</h3>
          <div className="relative">
            <select
              className="input appearance-none py-1.5 pr-8 text-xs"
              value={orden}
              onChange={(e) => setOrden(e.target.value as Orden)}
            >
              <option value="margen">Ordenar: Margen (S/)</option>
              <option value="margenPct">Ordenar: Margen (%)</option>
              <option value="vendido">Ordenar: Total vendido</option>
              <option value="cantidad">Ordenar: Cantidad</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
          </div>
        </div>

        {cargando ? (
          <div className="grid place-items-center py-16">
            <Spinner className="size-6 text-ink-400" />
          </div>
        ) : filasOrdenadas.length === 0 ? (
          <div className="grid place-items-center gap-2 py-16 text-center">
            <TrendingUp className="size-8 text-ink-300" />
            <p className="text-sm text-ink-400">Sin ventas en este periodo</p>
          </div>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-ink-100 text-left text-ink-400">
                  <th className="px-4 py-2.5 font-semibold">Producto</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Cantidad</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Vendido</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Costo</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Margen</th>
                  <th className="px-4 py-2.5 text-right font-semibold">%</th>
                </tr>
              </thead>
              <tbody>
                {filasOrdenadas.map((f) => (
                  <tr key={f.key} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/60">
                    <td className="px-4 py-2.5 font-semibold text-ink-900">{f.nombre}</td>
                    <td className="tabular px-4 py-2.5 text-right text-ink-600">{f.cantidad}</td>
                    <td className="tabular px-4 py-2.5 text-right text-ink-700">{money(f.totalVendido)}</td>
                    <td className="tabular px-4 py-2.5 text-right text-ink-500">
                      {f.sinCosto ? '—' : money(f.costoTotal)}
                    </td>
                    <td
                      className={cx(
                        'tabular px-4 py-2.5 text-right font-semibold',
                        f.sinCosto ? 'text-ink-400' : f.margen >= 0 ? 'text-accent-700' : 'text-red-700',
                      )}
                    >
                      {f.sinCosto ? '—' : money(f.margen)}
                    </td>
                    <td
                      className={cx(
                        'tabular px-4 py-2.5 text-right font-semibold',
                        f.sinCosto ? 'text-ink-400' : f.margenPct >= 0 ? 'text-accent-700' : 'text-red-700',
                      )}
                    >
                      {f.sinCosto ? '—' : `${f.margenPct.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Cards movil */}
            <ul className="divide-y divide-ink-100 md:hidden">
              {filasOrdenadas.map((f) => (
                <li key={f.key} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-ink-900">{f.nombre}</p>
                    <p
                      className={cx(
                        'tabular shrink-0 text-sm font-bold',
                        f.sinCosto ? 'text-ink-400' : f.margen >= 0 ? 'text-accent-700' : 'text-red-700',
                      )}
                    >
                      {f.sinCosto ? '—' : money(f.margen)}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {f.cantidad} vendidas · {money(f.totalVendido)} vendido
                    {!f.sinCosto && ` · ${f.margenPct.toFixed(1)}% margen`}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}
