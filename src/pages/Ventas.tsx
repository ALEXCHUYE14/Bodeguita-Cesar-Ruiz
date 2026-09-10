import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search,
  Printer,
  Receipt as ReceiptIcon,
  Filter,
  X,
  Ban,
  ChevronDown,
  Download,
  MessageCircle,
  Bluetooth,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/config/brand'
import { useAuth } from '@/context/AuthContext'
import { useCajaCtx } from '@/context/CajaContext'
import { Card, Badge, Button, Spinner } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import {
  money,
  fechaHora,
  fechaCorta,
  horaCorta,
  ETIQUETA_PAGO,
  ymd,
  cx,
  cantidad,
} from '@/utils/format'
import { descargarCSV } from '@/utils/csv'
import {
  imprimirTicket,
  abrirTicketPorWhatsApp,
  type LineaTicket,
  type DatosTicket,
} from '@/utils/imprimirTicket'
import { imprimirPorBluetooth, bluetoothDisponible } from '@/utils/bluetoothPrint'
import type { DetalleVenta, MetodoPago, Perfil, Venta } from '@/types/database'

// ── Rangos de fecha alineados a calendario (semana/quincena/mes) ─────────────
function inicioSemana(d: Date): Date {
  // Lunes como inicio de semana
  const x = new Date(d)
  const dia = x.getDay() // 0=domingo..6=sabado
  const diff = dia === 0 ? 6 : dia - 1
  x.setDate(x.getDate() - diff)
  return x
}
function inicioQuincena(d: Date): Date {
  const x = new Date(d)
  x.setDate(d.getDate() <= 15 ? 1 : 16)
  return x
}
function finQuincena(d: Date): Date {
  const x = new Date(d)
  if (d.getDate() <= 15) x.setDate(15)
  else x.setMonth(x.getMonth() + 1, 0) // ultimo dia del mes
  return x
}
function inicioMesCal(d: Date): Date {
  const x = new Date(d)
  x.setDate(1)
  return x
}
function finMesCal(d: Date): Date {
  const x = new Date(d)
  x.setMonth(x.getMonth() + 1, 0)
  return x
}

const TONO_PAGO: Record<MetodoPago, 'neutral' | 'success' | 'info' | 'warning'> = {
  efectivo: 'success',
  yape: 'info',
  fiado: 'warning',
}

/* ─────────────────────────────────────────────────────────────────────────
   Reporte de ventas por método de pago y rango de fechas.
   ─────────────────────────────────────────────────────────────────────────
   Modulo de SOLO LECTURA: hace una unica consulta liviana (solo columnas
   "metodo" y "total", filtrada por fecha) y suma en el cliente. No toca
   ninguna tabla ni RPC de escritura, no depende de los filtros de la lista
   de ventas de mas abajo (tiene su propio rango Desde/Hasta) y no altera
   ningun estado que use el resto de la pagina — es 100% aditivo.
───────────────────────────────────────────────────────────────────────── */

interface FilaMetodo {
  metodo: string
  total: number
  count: number
}

// Colores por metodo, en la misma paleta que ya usa esta pagina (ver
// TONO_PAGO / Badge). Un metodo que no este aqui (ej. si algun dia se
// habilita tarjeta/plin/transferencia en el POS) cae en el estilo neutral
// por defecto — nunca rompe la vista, solo se ve gris.
const ESTILO_METODO: Record<string, { bg: string; text: string }> = {
  efectivo: { bg: 'bg-accent-50', text: 'text-accent-700' },
  yape: { bg: 'bg-blue-50', text: 'text-blue-700' },
  fiado: { bg: 'bg-amber-50', text: 'text-amber-700' },
  tarjeta: { bg: 'bg-purple-50', text: 'text-purple-700' },
  plin: { bg: 'bg-sky-50', text: 'text-sky-700' },
  transferencia: { bg: 'bg-indigo-50', text: 'text-indigo-700' },
}
const ESTILO_METODO_NEUTRAL = { bg: 'bg-ink-100', text: 'text-ink-700' }

function ReporteMetodoPago() {
  const toast = useToast()
  const hoyR = ymd(new Date())
  const [desde, setDesde] = useState(() => ymd(inicioMesCal(new Date())))
  const [hasta, setHasta] = useState(hoyR)
  const [cargando, setCargando] = useState(true)
  const [filas, setFilas] = useState<FilaMetodo[]>([])

  const cargar = useCallback(async () => {
    setCargando(true)
    // Consulta minima: solo 2 columnas, filtrada por el rango de fechas
    // (idx_ventas_fecha ya existe en la tabla) y por "no anulada" — el resto
    // (suma total, suma por metodo, conteo) se calcula en el cliente. No hay
    // forma de que esto bloquee o ralentice la BD: es un SELECT liviano,
    // igual de eficiente que el resto de reportes de la app (Rentabilidad,
    // historial de Ventas).
    const { data, error } = await supabase
      .from('ventas')
      .select('metodo, total')
      .eq('anulada', false)
      .gte('creado_en', `${desde}T00:00:00`)
      .lte('creado_en', `${hasta}T23:59:59.999`)
      .limit(20000)

    if (error) {
      toast.error('No se pudo cargar el reporte por método de pago')
      setFilas([])
      setCargando(false)
      return
    }

    const mapa = new Map<string, FilaMetodo>()
    ;(data ?? []).forEach((v) => {
      const prev = mapa.get(v.metodo) ?? { metodo: v.metodo, total: 0, count: 0 }
      prev.total += Number(v.total)
      prev.count += 1
      mapa.set(v.metodo, prev)
    })
    setFilas([...mapa.values()].sort((a, b) => b.total - a.total))
    setCargando(false)
  }, [desde, hasta, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const totalGeneral = filas.reduce((s, f) => s + f.total, 0)
  const totalTransacciones = filas.reduce((s, f) => s + f.count, 0)

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-ink-900">
            Reporte por método de pago
          </h2>
          <p className="text-xs text-ink-400">Total vendido en el rango, desglosado por método</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="label mb-1 block text-[0.65rem]">Desde</label>
            <input
              type="date"
              className="input py-1.5 text-sm"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div>
            <label className="label mb-1 block text-[0.65rem]">Hasta</label>
            <input
              type="date"
              className="input py-1.5 text-sm"
              value={hasta}
              min={desde}
              max={hoyR}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
        </div>
      </div>

      {cargando ? (
        <div className="grid place-items-center py-10">
          <Spinner className="size-5 text-ink-400" />
        </div>
      ) : filas.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-400">Sin ventas en este periodo</p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between rounded-xl bg-ink-900 px-4 py-3 text-white">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-white/50">
                Total general
              </p>
              <p className="tabular font-display text-2xl font-bold">{money(totalGeneral)}</p>
            </div>
            <p className="text-xs text-white/60">
              {totalTransacciones} venta{totalTransacciones === 1 ? '' : 's'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {filas.map((f) => {
              const estilo = ESTILO_METODO[f.metodo] ?? ESTILO_METODO_NEUTRAL
              const pct = totalGeneral > 0 ? (f.total / totalGeneral) * 100 : 0
              return (
                <div key={f.metodo} className={cx('rounded-xl p-3', estilo.bg)}>
                  <p className={cx('text-xs font-semibold uppercase tracking-wide', estilo.text)}>
                    {ETIQUETA_PAGO[f.metodo] ?? f.metodo}
                  </p>
                  <p className={cx('mt-1 tabular font-display text-lg font-bold', estilo.text)}>
                    {money(f.total)}
                  </p>
                  <p className="text-[0.7rem] text-ink-400">
                    {f.count} venta{f.count === 1 ? '' : 's'} · {pct.toFixed(1)}%
                  </p>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
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
  const [limiteAlcanzado, setLimiteAlcanzado] = useState(false)

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
      // 3000 (antes 300): con reportes por quincena/mes un tope bajo
      // truncaba silenciosamente el resumen y el CSV exportado.
      .limit(3000)

    if (metodo) query = query.eq('metodo', metodo)
    if (esAdmin && cajeroId) query = query.eq('cajero_id', cajeroId)

    const { data, error } = await query
    if (error) toast.error('No se pudo cargar el historial')
    setVentas(data ?? [])
    setLimiteAlcanzado((data ?? []).length >= 3000)
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

  // ── Resumen agrupado por día (para ver ventas por dia/semana/quincena/mes:
  // el agrupamiento es siempre por dia; la vista de semana/quincena/mes surge
  // de elegir un rango de fechas mas amplio con los atajos de abajo) ─────────
  const resumenPorDia = useMemo(() => {
    const mapa = new Map<string, { count: number; total: number; anuladas: number }>()
    filtradas.forEach((v) => {
      const dia = v.creado_en.slice(0, 10)
      const prev = mapa.get(dia) ?? { count: 0, total: 0, anuladas: 0 }
      if (v.anulada) {
        prev.anuladas += 1
      } else {
        prev.count += 1
        prev.total += Number(v.total)
      }
      mapa.set(dia, prev)
    })
    return [...mapa.entries()]
      .map(([dia, r]) => ({ dia, ...r }))
      .sort((a, b) => (a.dia < b.dia ? 1 : -1))
  }, [filtradas])

  function exportarCSV() {
    const filas: (string | number)[][] = [
      [`Reporte de ventas — ${BRAND.nombre}`],
      [`Periodo: ${fechaCorta(`${desde}T00:00:00`)} al ${fechaCorta(`${hasta}T00:00:00`)}`],
      [`Generado: ${fechaHora(new Date().toISOString())}`],
      [],
      ['RESUMEN POR DIA'],
      ['Fecha', 'Transacciones', 'Anuladas', 'Total vendido'],
      ...resumenPorDia.map((r) => [fechaCorta(`${r.dia}T00:00:00`), r.count, r.anuladas, r.total.toFixed(2)]),
      [],
      ['DETALLE DE VENTAS'],
      ['Comprobante', 'Fecha', 'Hora', 'Cajero', 'Metodo', 'Cliente', 'Total', 'Anulada'],
      ...filtradas.map((v) => [
        v.numero,
        fechaCorta(v.creado_en),
        horaCorta(v.creado_en),
        v.cajero_nombre ?? '',
        ETIQUETA_PAGO[v.metodo] ?? v.metodo,
        v.cliente_nombre ?? '',
        Number(v.total).toFixed(2),
        v.anulada ? 'Si' : 'No',
      ]),
    ]
    descargarCSV(`ventas_${desde}_a_${hasta}.csv`, filas)
    toast.exito('Reporte descargado')
  }

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
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportarCSV}
            disabled={filtradas.length === 0}
          >
            <Download className="size-4" /> <span className="hidden sm:inline">Descargar</span>
          </Button>
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
      </div>

      {/* Reporte por método de pago — rango de fechas propio, independiente
          de los filtros de la lista de abajo (ver ReporteMetodoPago). */}
      <ReporteMetodoPago />

      {limiteAlcanzado && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700">
          Este periodo tiene más de 3000 ventas — se muestran y exportan solo las primeras 3000.
          Reduce el rango de fechas para ver el total exacto.
        </div>
      )}

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

      {/* ── Ventas por día (aparece al elegir un rango de mas de un dia:
          semana, quincena, mes o un rango personalizado) ── */}
      {resumenPorDia.length > 1 && (
        <Card className="overflow-hidden">
          <div className="border-b border-ink-100 px-4 py-2.5">
            <h3 className="text-sm font-bold text-ink-900">Ventas por día</h3>
          </div>
          <ul className="divide-y divide-ink-100">
            {resumenPorDia.map((r) => (
              <li key={r.dia} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-ink-800">
                    {fechaCorta(`${r.dia}T00:00:00`)}
                  </p>
                  <p className="text-xs text-ink-400">
                    {r.count} venta{r.count === 1 ? '' : 's'}
                    {r.anuladas > 0 && ` · ${r.anuladas} anulada${r.anuladas === 1 ? '' : 's'}`}
                  </p>
                </div>
                <p className="tabular font-display text-sm font-bold text-ink-900">
                  {money(r.total)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

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

          <div>
            <label className="label mb-1.5 block">Periodo (alineado al calendario)</label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { l: 'Esta semana', ini: inicioSemana, fin: () => new Date() },
                { l: 'Esta quincena', ini: inicioQuincena, fin: finQuincena },
                { l: 'Este mes', ini: inicioMesCal, fin: finMesCal },
              ].map((r) => (
                <button
                  key={r.l}
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-50"
                  onClick={() => {
                    const hoyDate = new Date()
                    const finCalculado = r.fin(hoyDate)
                    // El fin de quincena/mes puede caer en el futuro respecto
                    // a hoy (ej. mitad de mes) — se limita a hoy para no
                    // superar el "max" del input de fecha ni buscar ventas
                    // que aun no existen.
                    setDesde(ymd(r.ini(hoyDate)))
                    setHasta(ymd(finCalculado > hoyDate ? hoyDate : finCalculado))
                  }}
                >
                  {r.l}
                </button>
              ))}
            </div>
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

// A diferencia del ticket recien cobrado (Receipt.tsx), aqui solo tenemos el
// registro historico "aplanado" (detalle_ventas), sin el producto completo —
// por eso no se puede mostrar "0.750 kg" con certeza (no sabemos la unidad de
// medida), pero si se distingue caja/saco.
function lineaDesdeDetalle(d: DetalleVenta): LineaTicket {
  return {
    etiquetaCantidad: `${cantidad(d.cantidad)}x`,
    nombre: d.producto_nombre,
    etiquetaModalidad: d.modalidad === 'caja' ? 'Caja' : d.modalidad === 'saco' ? 'Saco' : undefined,
    monto: Number(d.subtotal),
  }
}

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
  const [waAbierto, setWaAbierto] = useState(false)
  const [telWA, setTelWA] = useState('')
  const [btImprimiendo, setBtImprimiendo] = useState(false)

  useEffect(() => {
    if (!venta) return
    setCargando(true)
    setWaAbierto(false)
    setTelWA('')
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

  // Un solo objeto de datos para imprimir y para WhatsApp: evita que el
  // texto enviado se desincronice del ticket impreso.
  function datosTicket(): DatosTicket | null {
    if (!venta) return null
    return {
      numero: venta.numero,
      fecha: venta.creado_en,
      cajero: venta.cajero_nombre,
      lineas: detalle.map(lineaDesdeDetalle),
      subtotal: venta.subtotal,
      descuento: venta.descuento,
      igv: venta.igv,
      total: venta.total,
      metodoPagoEtiqueta: ETIQUETA_PAGO[venta.metodo] ?? venta.metodo,
      pagoRecibido: venta.pago_recibido,
      vuelto: venta.metodo === 'efectivo' ? venta.vuelto : 0,
      clienteNombre: venta.cliente_nombre,
      anulada: venta.anulada,
    }
  }

  function imprimir() {
    const datos = datosTicket()
    if (datos) imprimirTicket(datos)
  }

  async function imprimirBT() {
    const datos = datosTicket()
    if (!datos) return
    setBtImprimiendo(true)
    try {
      await imprimirPorBluetooth(datos)
      toast.exito('Ticket enviado a la impresora Bluetooth')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo imprimir por Bluetooth')
    } finally {
      setBtImprimiendo(false)
    }
  }

  function enviarWhatsApp() {
    const datos = datosTicket()
    if (!datos) return
    const tel = telWA.replace(/\D/g, '')
    if (tel.length < 6) {
      toast.error('Ingresa un número de WhatsApp válido.')
      return
    }
    abrirTicketPorWhatsApp(tel, datos)
    setWaAbierto(false)
    setTelWA('')
  }

  if (!venta) return null

  return (
    <Sheet
      open={!!venta}
      onClose={onClose}
      maxWidth="max-w-sm"
      footer={
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={imprimir} disabled={cargando}>
              <Printer className="size-4" /> Imprimir
            </Button>
            {bluetoothDisponible() && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={imprimirBT}
                disabled={cargando}
                loading={btImprimiendo}
              >
                <Bluetooth className="size-4" /> Bluetooth
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {esAdmin && !venta.anulada && (
              <Button variant="danger" className="flex-1" onClick={anular} loading={anulando}>
                <Ban className="size-4" /> Anular
              </Button>
            )}
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Cerrar
            </Button>
          </div>
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
        className="rounded-xl border border-dashed border-ink-200 p-4 font-sans text-sm"
      >
        <div className="mb-3 text-center">
          <p className="font-display text-base font-bold">{BRAND.nombre.toUpperCase()}</p>
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
                  {cantidad(d.cantidad)}x {d.producto_nombre}
                  {(d.modalidad === 'caja' || d.modalidad === 'saco') && (
                    <span className="ml-1 rounded bg-accent-100 px-1 py-0.5 text-[0.6rem] font-bold uppercase text-accent-700">
                      {d.modalidad === 'caja' ? 'Caja' : 'Saco'}
                    </span>
                  )}
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

      {/* Enviar ticket por WhatsApp */}
      <div className="mt-3">
        {!waAbierto ? (
          <button
            onClick={() => setWaAbierto(true)}
            disabled={cargando}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-200 py-2.5 text-sm font-semibold text-ink-600 transition hover:border-ink-300 disabled:opacity-40"
          >
            <MessageCircle className="size-4" /> Enviar ticket por WhatsApp
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              type="tel"
              inputMode="numeric"
              autoFocus
              className="input flex-1"
              placeholder="Número de WhatsApp (ej. 987654321)"
              value={telWA}
              onChange={(e) => setTelWA(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && enviarWhatsApp()}
            />
            <Button variant="secondary" onClick={enviarWhatsApp}>
              <MessageCircle className="size-4" /> Enviar
            </Button>
          </div>
        )}
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
