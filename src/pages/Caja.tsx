import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DollarSign,
  Lock,
  LockOpen,
  Smartphone,
  HandCoins,
  CheckCircle2,
  AlertTriangle,
  FileDown,
  LogOut,
  Filter,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCajaCtx } from '@/context/CajaContext'
import { useAuth } from '@/context/AuthContext'
import { BRAND } from '@/config/brand'
import { Button, Card, Badge } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { money, fechaHora, horaCorta, ymd, ETIQUETA_PAGO, cx } from '@/utils/format'
import type { ResumenCierre } from '@/hooks/useCaja'
import type { CajaRegistro } from '@/types/database'

// Constante fuera del componente — evita recreación del array en cada render
const RAPIDOS_INICIAL = [50, 100, 150, 200, 300, 500]

// Conversión numérica segura — Supabase puede devolver NUMERIC como string
const toNum = (v: unknown): number => Number(v ?? 0)

// ─── Generador de reporte PDF de cierre de caja ───────────────────────────────

async function generarReportePDF(cajaData: CajaRegistro, montoRealContado: number): Promise<void> {
  const w = window.open('', '_blank', 'width=960,height=780,menubar=no,toolbar=no')
  if (!w) {
    throw new Error(
      'El navegador bloqueó la ventana del PDF. Habilita los popups para este sitio e intenta nuevamente.',
    )
  }

  w.document.write(
    '<html><body style="font-family:sans-serif;display:grid;place-items:center;min-height:100vh;background:#f8f8f7;"><p style="font-size:1.1rem;color:#666;">Generando reporte PDF...</p></body></html>',
  )

  try {
    const { data: ventasData, error } = await supabase
      .from('ventas')
      .select('*')
      .eq('caja_id', cajaData.id)
      .order('creado_en', { ascending: true })

    if (error) throw error

    const ventas = ventasData ?? []
    const ventasValidas  = ventas.filter((v) => !v.anulada)
    const ventasAnuladas = ventas.filter((v) => v.anulada)

    // toNum() antes de reduce previene concatenación si Supabase devolvió strings
    const totalEfectivo = ventasValidas.filter((v) => v.metodo === 'efectivo').reduce((s, v) => s + toNum(v.total), 0)
    const totalYape     = ventasValidas.filter((v) => v.metodo === 'yape').reduce((s, v) => s + toNum(v.total), 0)
    const totalFiado    = ventasValidas.filter((v) => v.metodo === 'fiado').reduce((s, v) => s + toNum(v.total), 0)
    const totalGeneral  = ventasValidas.reduce((s, v) => s + toNum(v.total), 0)

    const montoInicial      = toNum(cajaData.monto_inicial)
    const totalEfectivoCaja = toNum(cajaData.total_efectivo)
    const esperadoEfectivo  = montoInicial + totalEfectivoCaja
    const diferencia        = toNum(montoRealContado) - esperadoEfectivo

    const diferenciaColor = diferencia >= 0 ? '#065f46' : '#991b1b'
    const diferenciaFondo = diferencia >= 0 ? '#ecfdf5' : '#fef2f2'
    const diferenciaBorde = diferencia >= 0 ? '#a7f3d0' : '#fecaca'

    const logoUrl = `${window.location.origin}/img/logo.jpeg`
    const ahora   = new Date().toISOString()

    const filasVentas =
      ventasValidas.length > 0
        ? ventasValidas
            .map(
              (v) => `
          <tr>
            <td class="center">#${String(v.numero).padStart(4, '0')}</td>
            <td class="center">${horaCorta(v.creado_en)}</td>
            <td class="center"><span class="badge badge-${v.metodo}">${ETIQUETA_PAGO[v.metodo] ?? v.metodo}</span></td>
            <td>${v.cliente_nombre ? `<span style="color:#92400e;">${v.cliente_nombre}</span>` : '<span style="color:#aaa;">—</span>'}</td>
            <td class="right money">${money(toNum(v.total))}</td>
          </tr>`,
            )
            .join('')
        : `<tr><td colspan="5" style="text-align:center;padding:16px;color:#aaa;">Sin ventas registradas en este turno</td></tr>`

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Cierre de Caja — Bodeguita Juli</title>
  <style>
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Helvetica Neue',Arial,sans-serif; font-size:10pt; color:#1a1a1a; background:#fff; padding:18mm 16mm 20mm; }
    .header { display:flex; align-items:center; justify-content:space-between; border-bottom:2.5px solid #0e0e0d; padding-bottom:6mm; margin-bottom:8mm; }
    .header-left { display:flex; align-items:center; gap:12px; }
    .logo { height:54px; width:auto; border-radius:8px; object-fit:contain; }
    .store-name { font-size:18pt; font-weight:900; letter-spacing:-0.5px; color:#0e0e0d; line-height:1.2; }
    .store-sub { font-size:8.5pt; color:#888; margin-top:2px; }
    .report-info { text-align:right; }
    .report-title { font-size:13pt; font-weight:800; color:#0e0e0d; }
    .report-meta { font-size:8.5pt; color:#666; margin-top:3px; line-height:1.7; }
    .section { margin-bottom:8mm; }
    .section-title { font-size:10.5pt; font-weight:800; color:#0e0e0d; text-transform:uppercase; letter-spacing:0.6px; border-bottom:1px solid #e5e5e5; padding-bottom:2.5mm; margin-bottom:4mm; }
    .info-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:4mm; }
    .info-card { background:#f8f8f7; border:1px solid #e5e5e5; border-radius:6px; padding:3.5mm; }
    .info-label { font-size:7.5pt; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:1.5mm; }
    .info-value { font-size:10pt; font-weight:700; color:#0e0e0d; }
    table { width:100%; border-collapse:collapse; font-size:9pt; }
    thead th { background:#0e0e0d; color:#fff; padding:3mm 4mm; font-weight:700; text-align:left; font-size:8.5pt; letter-spacing:0.3px; }
    thead th.center { text-align:center; }
    thead th.right { text-align:right; }
    tbody tr:nth-child(even) { background:#fafafa; }
    tbody td { padding:2.5mm 4mm; border-bottom:1px solid #eee; vertical-align:middle; }
    tbody td.center { text-align:center; }
    tbody td.right { text-align:right; }
    tbody td.money { font-weight:700; }
    tfoot td { padding:3mm 4mm; font-weight:800; font-size:10pt; background:#f0f0ef; border-top:2px solid #0e0e0d; }
    tfoot td.right { text-align:right; color:#0e0e0d; }
    .badge { display:inline-block; padding:1px 6px; border-radius:4px; font-size:7.5pt; font-weight:700; }
    .badge-efectivo { background:#ecfdf5; color:#065f46; }
    .badge-yape { background:#eff6ff; color:#1d4ed8; }
    .badge-fiado { background:#fffbeb; color:#92400e; }
    .summary-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:4mm; margin-bottom:4mm; }
    .summary-card { border-radius:8px; padding:4mm; border:1px solid; }
    .summary-card.efectivo { background:#ecfdf5; border-color:#a7f3d0; }
    .summary-card.yape { background:#eff6ff; border-color:#bfdbfe; }
    .summary-card.fiado { background:#fffbeb; border-color:#fde68a; }
    .summary-label { font-size:7.5pt; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; opacity:0.65; margin-bottom:1.5mm; }
    .summary-value { font-size:13pt; font-weight:900; }
    .summary-card.efectivo .summary-value { color:#065f46; }
    .summary-card.yape .summary-value { color:#1d4ed8; }
    .summary-card.fiado .summary-value { color:#92400e; }
    .total-card { background:#0e0e0d; color:#fff; border-radius:8px; padding:4mm 5mm; display:flex; justify-content:space-between; align-items:center; margin-bottom:3mm; }
    .total-label { font-size:9pt; font-weight:700; opacity:0.7; }
    .total-value { font-size:16pt; font-weight:900; }
    .balance-card { border-radius:8px; padding:4mm 5mm; display:flex; justify-content:space-between; align-items:center; background:${diferenciaFondo}; border:1.5px solid ${diferenciaBorde}; }
    .balance-desc { font-size:8.5pt; color:#666; }
    .balance-desc b { color:#1a1a1a; }
    .balance-value { font-size:15pt; font-weight:900; color:${diferenciaColor}; }
    .footer { margin-top:10mm; border-top:1px solid #e5e5e5; padding-top:4mm; text-align:center; font-size:8pt; color:#aaa; line-height:1.7; }
    @page { size:A4; margin:0; }
    @media print { body { padding:14mm 13mm 16mm; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <img src="${logoUrl}" class="logo" alt="Bodeguita Juli" onerror="this.style.display='none'"/>
      <div>
        <div class="store-name">BODEGUITA JULI</div>
        <div class="store-sub">Sistema de Gestion Comercial · Reporte Interno</div>
      </div>
    </div>
    <div class="report-info">
      <div class="report-title">Reporte de Cierre de Caja</div>
      <div class="report-meta">Cajero: <b>${cajaData.cajero_nombre ?? '—'}</b><br/>Generado: ${fechaHora(ahora)}</div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Información de la Sesión</div>
    <div class="info-grid">
      <div class="info-card"><div class="info-label">Apertura</div><div class="info-value">${fechaHora(cajaData.abierta_en)}</div></div>
      <div class="info-card"><div class="info-label">Cierre</div><div class="info-value">${fechaHora(ahora)}</div></div>
      <div class="info-card"><div class="info-label">Fondo Inicial</div><div class="info-value">${money(montoInicial)}</div></div>
      <div class="info-card"><div class="info-label">Transacciones</div><div class="info-value">${ventasValidas.length} válidas${ventasAnuladas.length > 0 ? ` · ${ventasAnuladas.length} anuladas` : ''}</div></div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Detalle de Ventas del Turno</div>
    <table>
      <thead><tr><th class="center">Ticket</th><th class="center">Hora</th><th class="center">Método</th><th>Cliente</th><th class="right">Total</th></tr></thead>
      <tbody>${filasVentas}</tbody>
      ${ventasValidas.length > 0 ? `<tfoot><tr><td colspan="4"><b>TOTAL VENDIDO (${ventasValidas.length} ventas válidas)</b></td><td class="right">${money(totalGeneral)}</td></tr></tfoot>` : ''}
    </table>
  </div>
  <div class="section">
    <div class="section-title">Resumen Financiero del Día</div>
    <div class="summary-grid">
      <div class="summary-card efectivo"><div class="summary-label">Efectivo</div><div class="summary-value">${money(totalEfectivo)}</div></div>
      <div class="summary-card yape"><div class="summary-label">Yape</div><div class="summary-value">${money(totalYape)}</div></div>
      <div class="summary-card fiado"><div class="summary-label">Fiado</div><div class="summary-value">${money(totalFiado)}</div></div>
    </div>
    <div class="total-card"><span class="total-label">TOTAL VENDIDO (Efectivo + Yape + Fiado)</span><span class="total-value">${money(totalGeneral)}</span></div>
    <div class="balance-card">
      <div class="balance-desc">Efectivo esperado: <b>${money(esperadoEfectivo)}</b> &nbsp;·&nbsp; Contado: <b>${money(toNum(montoRealContado))}</b> &nbsp;·&nbsp; <b>${diferencia >= 0 ? 'Sobrante' : 'Faltante'}</b></div>
      <div class="balance-value">${diferencia >= 0 ? '+' : ''}${money(diferencia)}</div>
    </div>
  </div>
  <div class="footer">Bodeguita Juli &nbsp;·&nbsp; Reporte generado el ${fechaHora(ahora)} &nbsp;·&nbsp; Documento de uso interno</div>
</body>
</html>`

    w.document.open()
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => { w.print() }, 600)
  } catch (err) {
    w.close()
    throw err
  }
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function Caja() {
  const { perfil, esAdmin, signOut } = useAuth()
  const { caja, historial, cargando, abrir, cerrar, recargarHistorial } = useCajaCtx()
  const navigate = useNavigate()
  const toast    = useToast()

  // ── Estado: apertura y cierre ────────────────────────────────────────────────
  const [abrirOpen,    setAbrirOpen]    = useState(false)
  const [cerrarOpen,   setCerrarOpen]   = useState(false)
  const [resumenOpen,  setResumenOpen]  = useState(false)
  const [montoInicial, setMontoInicial] = useState('')
  const [montoReal,    setMontoReal]    = useState('')
  const [procesando,   setProcesando]   = useState(false)
  const [generandoPDF, setGenerandoPDF] = useState(false)
  const [resumen,      setResumen]      = useState<ResumenCierre | null>(null)

  // ── Estado: filtros del historial ────────────────────────────────────────────
  const hoy = useMemo(() => ymd(new Date()), [])
  const [histDesde,       setHistDesde]       = useState('')
  const [histHasta,       setHistHasta]       = useState('')
  const [filtrosHistOpen, setFiltrosHistOpen] = useState(false)

  // ── Estado: limpiar historial ────────────────────────────────────────────────
  const [limpiarHistOpen, setLimpiarHistOpen] = useState(false)
  const [limpiandoHist,   setLimpiandoHist]   = useState(false)

  // Fecha para el encabezado — calculada una sola vez por montaje
  const fechaDisplay = useMemo(
    () => new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }),
    [],
  )

  const nombreDisplay =
    perfil?.rol === 'administrador'
      ? BRAND.operador
      : (perfil?.nombre?.split(' ')[0] ?? 'Cajero')

  // ── Historial filtrado por fechas ────────────────────────────────────────────
  const historialFiltrado = useMemo(() => {
    if (!histDesde && !histHasta) return historial
    return historial.filter((h: CajaRegistro) => {
      const fecha = h.abierta_en.slice(0, 10)
      if (histDesde && fecha < histDesde) return false
      if (histHasta && fecha > histHasta) return false
      return true
    })
  }, [historial, histDesde, histHasta])

  const filtrosHistActivos = (histDesde ? 1 : 0) + (histHasta ? 1 : 0)

  // ── Cajas cerradas disponibles para limpiar ──────────────────────────────────
  const cajasParaLimpiar = useMemo(
    () => historial.filter((h: CajaRegistro) => h.estado === 'cerrada'),
    [historial],
  )

  function limpiarEstadoLocal() {
    setMontoReal('')
    setMontoInicial('')
    // localStorage.removeItem ya fue llamado dentro de useCaja.cerrar()
  }

  // ── Apertura de caja ─────────────────────────────────────────────────────────
  async function confirmarApertura() {
    const monto = parseFloat(montoInicial) || 0
    if (monto < 0) {
      toast.error('El monto inicial no puede ser negativo.')
      return
    }
    setProcesando(true)
    try {
      await abrir(monto)
      toast.exito('Caja abierta correctamente')
      setAbrirOpen(false)
      setMontoInicial('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al abrir la caja')
    } finally {
      setProcesando(false)
    }
  }

  // ── Cierre de caja ───────────────────────────────────────────────────────────
  async function confirmarCierre() {
    const monto = parseFloat(montoReal)
    if (isNaN(monto) || monto < 0) {
      toast.error('Ingresa el monto real contado.')
      return
    }
    if (!caja) return

    setProcesando(true)
    try {
      setGenerandoPDF(true)
      try {
        await generarReportePDF(caja, monto)
      } catch (pdfErr) {
        const msg = pdfErr instanceof Error ? pdfErr.message : 'Error desconocido'
        toast.error(`PDF no generado — cierre cancelado para proteger los datos. (${msg})`)
        return
      } finally {
        setGenerandoPDF(false)
      }

      const r = await cerrar(monto)
      setResumen(r)
      limpiarEstadoLocal()
      setCerrarOpen(false)
      setResumenOpen(true)
      toast.exito('Caja cerrada correctamente. Reporte PDF generado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cerrar la caja')
    } finally {
      setProcesando(false)
    }
  }

  // ── Limpiar historial de cajas cerradas ──────────────────────────────────────
  async function confirmarLimpiarHistorial() {
    if (cajasParaLimpiar.length === 0) {
      toast.exito('No hay registros cerrados para limpiar.')
      setLimpiarHistOpen(false)
      return
    }
    setLimpiandoHist(true)
    try {
      const ids = cajasParaLimpiar.map((h: CajaRegistro) => h.id)
      // Preserva datos de ventas: desvincula caja_id antes de borrar registros
      await supabase.from('ventas').update({ caja_id: null }).in('caja_id', ids)
      const { error } = await supabase.from('cajas').delete().in('id', ids)
      if (error) throw error
      toast.exito(`${ids.length} registro(s) de caja eliminado(s)`)
      setLimpiarHistOpen(false)
      recargarHistorial()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al limpiar el historial')
    } finally {
      setLimpiandoHist(false)
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-ink-400">
        Verificando estado de caja...
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── Encabezado ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Control de caja</h1>
          <p className="text-sm text-ink-400">
            {nombreDisplay} · {fechaDisplay}
          </p>
        </div>
        {!caja ? (
          <Button variant="primary" onClick={() => setAbrirOpen(true)}>
            <LockOpen className="size-[18px]" /> Abrir caja
          </Button>
        ) : (
          <Button
            variant="outline"
            className="border-red-200 text-red-700 hover:bg-red-50"
            onClick={() => { setMontoReal(''); setCerrarOpen(true) }}
          >
            <Lock className="size-[18px]" /> Cerrar caja
          </Button>
        )}
      </div>

      {/* ── KPIs de la caja activa ── */}
      {caja ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">

          {/* Tarjeta "Caja Abierta" */}
          <div className="col-span-2 lg:col-span-1 card p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-accent-500" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                Caja abierta
              </span>
            </div>
            <p className="tabular font-display text-2xl font-bold text-ink-900">
              {money(toNum(caja.total_efectivo) + toNum(caja.total_yape))}
            </p>
            <p className="mt-1 text-xs text-ink-400">
              Efectivo + Yape · desde {horaCorta(caja.abierta_en)}
            </p>
          </div>

          <KpiCaja
            icon={DollarSign}
            label="Efectivo"
            valor={money(toNum(caja.total_efectivo))}
            color="text-accent-700"
            bg="bg-accent-50"
          />
          <KpiCaja
            icon={Smartphone}
            label="Yape"
            valor={money(toNum(caja.total_yape))}
            color="text-blue-700"
            bg="bg-blue-50"
          />
          <KpiCaja
            icon={HandCoins}
            label="Fiado"
            valor={money(toNum(caja.total_fiado))}
            color="text-amber-700"
            bg="bg-amber-50"
            className="col-span-2 lg:col-span-1"
          />
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-ink-200 p-10 text-center">
          <Lock className="mx-auto mb-3 size-8 text-ink-300" />
          <p className="text-base font-semibold text-ink-600">Caja cerrada</p>
          <p className="mt-1 text-sm text-ink-400">
            Abre la caja para comenzar a registrar ventas en el POS.
          </p>
          <Button className="mt-5" variant="primary" onClick={() => setAbrirOpen(true)}>
            <LockOpen className="size-4" /> Abrir caja ahora
          </Button>
        </div>
      )}

      {/* ── Historial de cajas ── */}
      {historial.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
            <h3 className="font-display font-bold text-ink-900">Historial de cajas</h3>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="relative"
                onClick={() => setFiltrosHistOpen(true)}
              >
                <Filter className="size-4" /> Filtros
                {filtrosHistActivos > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-accent-600 text-[0.65rem] font-bold text-white">
                    {filtrosHistActivos}
                  </span>
                )}
              </Button>
              {esAdmin && cajasParaLimpiar.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-200 text-red-600 hover:bg-red-50"
                  onClick={() => setLimpiarHistOpen(true)}
                >
                  <Trash2 className="size-4" /> Limpiar
                </Button>
              )}
            </div>
          </div>

          {historialFiltrado.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-400">
              Sin registros para el periodo seleccionado.
              <button
                onClick={() => { setHistDesde(''); setHistHasta('') }}
                className="ml-2 text-accent-600 underline"
              >
                Ver todos
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {historialFiltrado.map((h: CajaRegistro) => {
                // Conversión explícita para evitar suma de strings
                const hMonto    = toNum(h.monto_inicial)
                const hEfectivo = toNum(h.total_efectivo)
                const hYape     = toNum(h.total_yape)
                const hReal     = toNum(h.monto_real)
                const esperado  = hMonto + hEfectivo

                return (
                  <li key={h.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={cx(
                          'grid size-8 place-items-center rounded-lg',
                          h.estado === 'abierta' ? 'bg-accent-100' : 'bg-ink-100',
                        )}
                      >
                        {h.estado === 'abierta' ? (
                          <LockOpen className="size-4 text-accent-700" />
                        ) : (
                          <Lock className="size-4 text-ink-500" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-ink-900">
                          {h.cajero_nombre ?? 'Cajero'}
                        </p>
                        <p className="text-xs text-ink-400">
                          {fechaHora(h.abierta_en)}
                          {h.cerrada_en && ` → ${horaCorta(h.cerrada_en)}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-sm font-bold text-ink-900">
                        {money(hMonto + hEfectivo + hYape)}
                      </p>
                      <div className="mt-0.5">
                        {h.estado === 'abierta' ? (
                          <Badge tone="success">Abierta</Badge>
                        ) : h.monto_real !== null ? (
                          <Badge tone={hReal >= esperado ? 'success' : 'danger'}>
                            {hReal >= esperado ? 'Cuadrado' : 'Descuadre'}
                          </Badge>
                        ) : (
                          <Badge tone="info">Cerrada</Badge>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          Sheet: abrir caja
      ══════════════════════════════════════════════════════════════════════════ */}
      <Sheet
        open={abrirOpen}
        onClose={() => setAbrirOpen(false)}
        title="Abrir caja"
        maxWidth="max-w-sm"
        footer={
          <Button variant="secondary" size="lg" className="w-full" loading={procesando} onClick={confirmarApertura}>
            <LockOpen className="size-5" /> Confirmar apertura
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
            Ingresa el efectivo con el que inicias el turno (fondo de caja).
          </div>
          <label className="block">
            <span className="label mb-1.5 block">Monto inicial en caja (S/)</span>
            <input
              type="number"
              min={0}
              step={0.01}
              className="input tabular text-xl"
              value={montoInicial}
              onChange={(e) => setMontoInicial(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setMontoInicial('0')}
              className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-200"
            >
              Sin fondo (S/0)
            </button>
            {RAPIDOS_INICIAL.map((v) => (
              <button
                key={v}
                onClick={() => setMontoInicial(String(v))}
                className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-200"
              >
                S/ {v}
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      {/* ══════════════════════════════════════════════════════════════════════════
          Sheet: cerrar caja
      ══════════════════════════════════════════════════════════════════════════ */}
      <Sheet
        open={cerrarOpen}
        onClose={() => !procesando && setCerrarOpen(false)}
        title="Cerrar caja"
        maxWidth="max-w-sm"
        footer={
          <Button
            variant="primary"
            size="lg"
            className="w-full !bg-red-600 hover:!bg-red-700"
            loading={procesando}
            onClick={confirmarCierre}
          >
            {generandoPDF ? (
              <><FileDown className="size-5 animate-bounce" /> Generando PDF...</>
            ) : (
              <><Lock className="size-5" /> Cerrar y generar reporte PDF</>
            )}
          </Button>
        }
      >
        {caja && (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
              <FileDown className="mt-0.5 size-4 shrink-0" />
              <span>
                Al confirmar, se generará y descargará automáticamente un{' '}
                <strong>reporte PDF</strong> con todas las ventas del turno.
              </span>
            </div>
            <div className="rounded-xl bg-ink-50 p-4 text-sm space-y-1.5">
              <InfoRow k="Fondo inicial"    v={money(toNum(caja.monto_inicial))} />
              <InfoRow k="Ventas efectivo"  v={money(toNum(caja.total_efectivo))} />
              <div className="border-t border-ink-200 pt-1.5">
                <InfoRow
                  k="Efectivo esperado"
                  v={money(toNum(caja.monto_inicial) + toNum(caja.total_efectivo))}
                  bold
                />
              </div>
              <InfoRow k="Ventas Yape"  v={money(toNum(caja.total_yape))} />
              <InfoRow k="Ventas Fiado" v={money(toNum(caja.total_fiado))} />
            </div>
            <label className="block">
              <span className="label mb-1.5 block">¿Cuánto efectivo hay en caja? (S/)</span>
              <input
                type="number"
                min={0}
                step={0.01}
                className="input tabular text-xl"
                value={montoReal}
                onChange={(e) => setMontoReal(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </label>
            {montoReal !== '' && !isNaN(parseFloat(montoReal)) && (
              <DifCard
                esperado={toNum(caja.monto_inicial) + toNum(caja.total_efectivo)}
                real={parseFloat(montoReal)}
              />
            )}
          </div>
        )}
      </Sheet>

      {/* ══════════════════════════════════════════════════════════════════════════
          Sheet: resumen del arqueo
      ══════════════════════════════════════════════════════════════════════════ */}
      <Sheet
        open={resumenOpen}
        onClose={() => setResumenOpen(false)}
        title="Resumen del arqueo"
        maxWidth="max-w-sm"
        footer={
          <Button
            variant="primary"
            size="lg"
            className="w-full !bg-ink-900 hover:!bg-ink-700"
            onClick={async () => {
              setResumenOpen(false)
              await signOut()
              navigate('/login', { replace: true })
            }}
          >
            <LogOut className="size-5" /> Cerrar sesión e ir al inicio
          </Button>
        }
      >
        {resumen && (
          <div className="space-y-4">
            <div className="flex flex-col items-center text-center pb-2">
              <div className="mb-2 grid size-12 place-items-center rounded-full bg-accent-100">
                <CheckCircle2 className="size-6 text-accent-700" />
              </div>
              <p className="font-display text-base font-bold text-ink-900">Caja cerrada correctamente</p>
              <p className="text-xs text-ink-400 mt-0.5">El reporte PDF fue generado y enviado al navegador</p>
            </div>
            <div className="rounded-xl bg-ink-50 p-4 text-sm space-y-1.5">
              <InfoRow k="Fondo inicial"      v={money(resumen.monto_inicial)} />
              <InfoRow k="Ventas efectivo"    v={money(resumen.total_efectivo)} />
              <div className="border-t border-ink-200 pt-1.5">
                <InfoRow k="Efectivo esperado" v={money(resumen.esperado_efectivo)} bold />
              </div>
              <InfoRow k="Efectivo contado" v={money(resumen.ingresado_real)} bold />
              <InfoRow k="Ventas Yape"      v={money(resumen.total_yape)} />
              <InfoRow k="Ventas Fiado"     v={money(resumen.total_fiado)} />
            </div>
            <DifCard esperado={resumen.esperado_efectivo} real={resumen.ingresado_real} />
            {resumen.diferencia !== 0 && (
              <p className="rounded-xl bg-amber-50 px-3.5 py-3 text-xs text-amber-700">
                <AlertTriangle className="mb-1 inline size-3.5" />{' '}
                {resumen.diferencia < 0
                  ? `Falta S/ ${Math.abs(resumen.diferencia).toFixed(2)} en la caja.`
                  : `Hay S/ ${resumen.diferencia.toFixed(2)} de sobra.`}
              </p>
            )}
            <div className="rounded-xl bg-accent-50 px-3.5 py-3 text-xs text-accent-700">
              Los datos han sido archivados en la base de datos para auditoría. El panel está listo
              para el siguiente turno.
            </div>
          </div>
        )}
      </Sheet>

      {/* ══════════════════════════════════════════════════════════════════════════
          Sheet: filtros del historial
      ══════════════════════════════════════════════════════════════════════════ */}
      <Sheet
        open={filtrosHistOpen}
        onClose={() => setFiltrosHistOpen(false)}
        title="Filtrar historial"
        maxWidth="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => { setHistDesde(''); setHistHasta('') }}
            >
              <X className="size-4" /> Limpiar
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => setFiltrosHistOpen(false)}>
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
                value={histDesde}
                max={histHasta || hoy}
                onChange={(e) => setHistDesde(e.target.value)}
              />
            </div>
            <div>
              <label className="label mb-1.5 block">Hasta</label>
              <input
                type="date"
                className="input"
                value={histHasta}
                min={histDesde}
                max={hoy}
                onChange={(e) => setHistHasta(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { l: 'Hoy',         d: 0 },
              { l: 'Ayer',        d: 1 },
              { l: 'Últ. 7 días', d: 7 },
              { l: 'Últ. 30 días',d: 30 },
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
                  setHistDesde(ymd(ini))
                  setHistHasta(ymd(fin))
                }}
              >
                {r.l}
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      {/* ══════════════════════════════════════════════════════════════════════════
          Sheet: confirmar limpiar historial
      ══════════════════════════════════════════════════════════════════════════ */}
      <Sheet
        open={limpiarHistOpen}
        onClose={() => !limpiandoHist && setLimpiarHistOpen(false)}
        title="Limpiar historial de cajas"
        maxWidth="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={limpiandoHist}
              onClick={() => setLimpiarHistOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={limpiandoHist}
              onClick={confirmarLimpiarHistorial}
            >
              <Trash2 className="size-4" /> Eliminar registros
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-semibold">Esta acción es irreversible.</p>
            <p className="mt-1">
              Se eliminarán <strong>{cajasParaLimpiar.length}</strong> registro(s) de cajas cerradas.
              Los datos de ventas asociadas se conservarán intactos.
            </p>
          </div>
          <div className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
            <p className="font-medium text-ink-800 mb-1">¿Qué se elimina?</p>
            <ul className="space-y-0.5 list-disc list-inside text-ink-500">
              <li>Registros de sesiones de caja cerradas</li>
              <li>Montos iniciales y totales de cada turno</li>
            </ul>
            <p className="mt-2 font-medium text-accent-700">
              ✓ Las ventas y reportes se conservan
            </p>
          </div>
        </div>
      </Sheet>

    </div>
  )
}

// ─── Subcomponentes ────────────────────────────────────────────────────────────

function KpiCaja({ icon: Icon, label, valor, color, bg, className = '' }: {
  icon: typeof DollarSign; label: string; valor: string; color: string; bg: string; className?: string
}) {
  return (
    <div className={cx('card p-4', className)}>
      <div className={cx('mb-3 grid size-8 place-items-center rounded-lg', bg)}>
        <Icon className={cx('size-[18px]', color)} />
      </div>
      <p className={cx('tabular font-display text-xl font-bold', color)}>{valor}</p>
      <p className="text-xs font-medium text-ink-400">{label}</p>
    </div>
  )
}

function InfoRow({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={bold ? 'font-semibold text-ink-800' : 'text-ink-500'}>{k}</span>
      <span className={cx('tabular', bold ? 'font-bold text-ink-900' : 'text-ink-700')}>{v}</span>
    </div>
  )
}

function DifCard({ esperado, real }: { esperado: number; real: number }) {
  const diff = real - esperado
  const ok   = Math.abs(diff) < 0.01
  return (
    <div className={cx(
      'flex items-center justify-between rounded-xl px-4 py-3',
      ok ? 'bg-accent-50' : diff < 0 ? 'bg-red-50' : 'bg-amber-50',
    )}>
      <span className={cx('text-sm font-semibold', ok ? 'text-accent-700' : diff < 0 ? 'text-red-700' : 'text-amber-700')}>
        {ok ? 'Cuadrado ✓' : diff < 0 ? 'Faltante' : 'Sobrante'}
      </span>
      <span className={cx('tabular font-display text-xl font-bold', ok ? 'text-accent-700' : diff < 0 ? 'text-red-700' : 'text-amber-700')}>
        {ok ? '—' : `${diff > 0 ? '+' : ''}${money(diff)}`}
      </span>
    </div>
  )
}
