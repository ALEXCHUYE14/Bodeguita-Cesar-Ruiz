import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Wallet, TrendingDown, Filter, X } from 'lucide-react'
import { useEgresos, ETIQUETA_CATEGORIA_EGRESO, ETIQUETA_METODO_EGRESO } from '@/hooks/useEgresos'
import { useAuth } from '@/context/AuthContext'
import { useCajaCtx } from '@/context/CajaContext'
import { Button, Card, Badge } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { money, fechaHora, fechaCorta, cx, ymd } from '@/utils/format'
import { descargarCSV } from '@/utils/csv'
import type { CategoriaEgreso, MetodoEgreso } from '@/types/database'

const CATEGORIAS: CategoriaEgreso[] = [
  'alquiler', 'servicios', 'sueldos', 'transporte', 'insumos', 'impuestos', 'mantenimiento', 'otro',
]
const METODOS: MetodoEgreso[] = ['efectivo', 'yape', 'transferencia', 'tarjeta']

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

export function Egresos() {
  const { esAdmin } = useAuth()
  const { caja } = useCajaCtx()
  const toast = useToast()

  // useRef: evita recrear estas fechas (y por lo tanto recargar en bucle) en cada render
  const desdeRef = useRef(inicioMes())
  const hastaRef = useRef(finHoy())
  const [rango, setRango] = useState({ desde: desdeRef.current, hasta: hastaRef.current })
  const { egresos, cargando, registrar, eliminar, total } = useEgresos(rango.desde, rango.hasta)

  const [formOpen, setFormOpen] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [filtrosOpen, setFiltrosOpen] = useState(false)
  const [categoriaFiltro, setCategoriaFiltro] = useState<CategoriaEgreso | ''>('')
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [eliminando, setEliminando] = useState(false)

  const [f, setF] = useState({
    concepto: '',
    categoria: 'otro' as CategoriaEgreso,
    monto: '',
    metodo: 'efectivo' as MetodoEgreso,
    notas: '',
  })

  const filtrados = useMemo(
    () => (categoriaFiltro ? egresos.filter((e) => e.categoria === categoriaFiltro) : egresos),
    [egresos, categoriaFiltro],
  )

  const totalFiltrado = filtrados.reduce((s, e) => s + e.monto, 0)

  const resumenPorCategoria = useMemo(() => {
    const mapa = new Map<CategoriaEgreso, number>()
    egresos.forEach((e) => mapa.set(e.categoria, (mapa.get(e.categoria) ?? 0) + e.monto))
    return [...mapa.entries()].sort((a, b) => b[1] - a[1])
  }, [egresos])

  function resetForm() {
    setF({ concepto: '', categoria: 'otro', monto: '', metodo: 'efectivo', notas: '' })
  }

  async function guardar() {
    if (!f.concepto.trim()) {
      toast.error('Describe en que se gasto el dinero.')
      return
    }
    const monto = parseFloat(f.monto)
    if (!monto || monto <= 0) {
      toast.error('Ingresa un monto valido.')
      return
    }
    setGuardando(true)
    try {
      await registrar({
        concepto: f.concepto.trim(),
        categoria: f.categoria,
        monto,
        metodo: f.metodo,
        // Si hay una caja abierta, todo egreso queda vinculado a ella (no solo
        // los registrados desde "Salida de caja"), para que el efectivo
        // esperado del cierre siempre refleje la realidad del turno.
        caja_id: caja?.id ?? null,
        notas: f.notas.trim() || null,
      })
      toast.exito(
        caja?.id && f.metodo === 'efectivo'
          ? 'Egreso registrado y descontado de la caja activa'
          : 'Egreso registrado',
      )
      setFormOpen(false)
      resetForm()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar el egreso')
    } finally {
      setGuardando(false)
    }
  }

  async function confirmarEliminar() {
    if (!confirmando) return
    setEliminando(true)
    try {
      await eliminar(confirmando)
      toast.exito('Egreso eliminado')
      setConfirmando(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setEliminando(false)
    }
  }

  function aplicarRango(desde: Date, hasta: Date) {
    setRango({ desde, hasta })
  }

  function exportarCSV() {
    const filas: (string | number)[][] = [
      ['Reporte de egresos', `${ymd(rango.desde)} a ${ymd(rango.hasta)}`],
      [],
      ['Fecha', 'Concepto', 'Categoria', 'Metodo', 'Monto', 'Registrado por', 'Notas'],
      ...filtrados.map((e) => [
        fechaCorta(e.fecha + 'T00:00:00'),
        e.concepto,
        ETIQUETA_CATEGORIA_EGRESO[e.categoria],
        ETIQUETA_METODO_EGRESO[e.metodo],
        e.monto.toFixed(2),
        e.usuario_nombre ?? '',
        e.notas ?? '',
      ]),
      [],
      ['Total', '', '', '', totalFiltrado.toFixed(2), '', ''],
    ]
    descargarCSV(`egresos_${ymd(rango.desde)}_a_${ymd(rango.hasta)}.csv`, filas)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Egresos</h1>
          <p className="text-sm text-ink-400">
            Alquiler, servicios, sueldos y demas gastos del negocio
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportarCSV} disabled={filtrados.length === 0}>
            <TrendingDown className="size-4" /> <span className="hidden sm:inline">Descargar</span>
          </Button>
          {esAdmin && (
            <Button variant="primary" onClick={() => { resetForm(); setFormOpen(true) }}>
              <Plus className="size-[18px]" />
              <span className="hidden sm:inline">Registrar egreso</span>
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2 rounded-2xl border border-red-100 bg-red-50 p-4 lg:col-span-1">
          <div className="mb-2 grid size-8 place-items-center rounded-lg bg-red-100">
            <Wallet className="size-[18px] text-red-600" />
          </div>
          <p className="tabular font-display text-xl font-bold text-red-700">{money(total)}</p>
          <p className="text-xs font-medium text-red-400">Total del periodo</p>
        </div>
        {resumenPorCategoria.slice(0, 3).map(([cat, monto]) => (
          <div key={cat} className="card p-4">
            <p className="tabular font-display text-xl font-bold text-ink-900">{money(monto)}</p>
            <p className="text-xs font-medium text-ink-400">{ETIQUETA_CATEGORIA_EGRESO[cat]}</p>
          </div>
        ))}
      </div>

      {/* Filtros rapidos */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { l: 'Este mes', f: () => ({ desde: inicioMes(), hasta: finHoy() }) },
          {
            l: 'Mes pasado',
            f: () => {
              const d = new Date()
              d.setMonth(d.getMonth() - 1, 1)
              d.setHours(0, 0, 0, 0)
              const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
              return { desde: d, hasta: fin }
            },
          },
          {
            l: 'Ult. 7 dias',
            f: () => {
              const d = new Date()
              d.setDate(d.getDate() - 7)
              return { desde: d, hasta: finHoy() }
            },
          },
        ].map((r) => (
          <button
            key={r.l}
            onClick={() => { const x = r.f(); aplicarRango(x.desde, x.hasta) }}
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-50"
          >
            {r.l}
          </button>
        ))}
        <button
          onClick={() => setFiltrosOpen(true)}
          className={cx(
            'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold',
            categoriaFiltro
              ? 'border-accent-300 bg-accent-50 text-accent-700'
              : 'border-ink-200 text-ink-600 hover:bg-ink-50',
          )}
        >
          <Filter className="size-3.5" />
          {categoriaFiltro ? ETIQUETA_CATEGORIA_EGRESO[categoriaFiltro] : 'Categoria'}
        </button>
      </div>

      {/* Listado */}
      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-ink-100 px-4 py-2.5 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-400 lg:grid">
          <span>Concepto</span>
          <span className="w-32 text-center">Categoria</span>
          <span className="w-24 text-center">Metodo</span>
          <span className="w-28 text-right">Monto</span>
          <span className="w-16 text-right">{esAdmin ? 'Accion' : ''}</span>
        </div>

        {cargando ? (
          <SkeletonList />
        ) : filtrados.length === 0 ? (
          <div className="grid place-items-center gap-2 py-16 text-center">
            <Wallet className="size-8 text-ink-300" />
            <p className="text-sm font-medium text-ink-500">Sin egresos en este periodo</p>
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {filtrados.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:gap-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">{e.concepto}</p>
                  <p className="text-xs text-ink-400">
                    {fechaHora(e.creado_en)} · {e.usuario_nombre ?? '—'}
                    {e.caja_id && ' · Salida de caja'}
                  </p>
                </div>
                <div className="hidden w-32 justify-center lg:flex">
                  <Badge tone="neutral">{ETIQUETA_CATEGORIA_EGRESO[e.categoria]}</Badge>
                </div>
                <span className="hidden w-24 text-center text-sm text-ink-500 lg:block">
                  {ETIQUETA_METODO_EGRESO[e.metodo]}
                </span>
                <span className="tabular hidden w-28 text-right text-sm font-bold text-red-700 lg:block">
                  {money(e.monto)}
                </span>
                <div className="hidden w-16 justify-end lg:flex">
                  {esAdmin && (
                    <button
                      onClick={() => setConfirmando(e.id)}
                      className="grid size-8 place-items-center rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>

                {/* Movil */}
                <div className="flex flex-col items-end gap-1 lg:hidden">
                  <span className="tabular text-sm font-bold text-red-700">{money(e.monto)}</span>
                  <Badge tone="neutral">{ETIQUETA_CATEGORIA_EGRESO[e.categoria]}</Badge>
                  {esAdmin && (
                    <button
                      onClick={() => setConfirmando(e.id)}
                      className="text-xs font-semibold text-red-500"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Sheet: registrar egreso */}
      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Registrar egreso"
        maxWidth="max-w-md"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button variant="secondary" className="flex-1" loading={guardando} onClick={guardar}>
              Registrar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Campo label="Concepto *">
            <input
              className="input"
              value={f.concepto}
              onChange={(e) => setF((p) => ({ ...p, concepto: e.target.value }))}
              placeholder="Alquiler del local - marzo"
              autoFocus
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Categoria">
              <select
                className="input"
                value={f.categoria}
                onChange={(e) => setF((p) => ({ ...p, categoria: e.target.value as CategoriaEgreso }))}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>{ETIQUETA_CATEGORIA_EGRESO[c]}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Metodo de pago">
              <select
                className="input"
                value={f.metodo}
                onChange={(e) => setF((p) => ({ ...p, metodo: e.target.value as MetodoEgreso }))}
              >
                {METODOS.map((m) => (
                  <option key={m} value={m}>{ETIQUETA_METODO_EGRESO[m]}</option>
                ))}
              </select>
            </Campo>
          </div>
          <Campo label="Monto (S/) *">
            <input
              type="number"
              min={0}
              step={0.01}
              className="input tabular text-lg"
              value={f.monto}
              onChange={(e) => setF((p) => ({ ...p, monto: e.target.value }))}
              placeholder="0.00"
            />
          </Campo>
          <Campo label="Notas (opcional)">
            <input
              className="input"
              value={f.notas}
              onChange={(e) => setF((p) => ({ ...p, notas: e.target.value }))}
              placeholder="Detalle adicional..."
            />
          </Campo>
          <p
            className={cx(
              'rounded-lg px-3 py-2 text-xs',
              caja ? 'bg-accent-50 text-accent-700' : 'bg-ink-50 text-ink-400',
            )}
          >
            {caja
              ? 'Hay una caja abierta: este egreso se vinculará a ese turno y, si se paga en efectivo, se descontará del efectivo esperado al cerrar.'
              : 'No hay caja abierta ahora mismo: este egreso quedará registrado, pero no se descontará de ningún cuadre de caja.'}
          </p>
        </div>
      </Sheet>

      {/* Sheet: filtro de categoria */}
      <Sheet
        open={filtrosOpen}
        onClose={() => setFiltrosOpen(false)}
        title="Filtrar por categoria"
        maxWidth="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setCategoriaFiltro(''); setFiltrosOpen(false) }}>
              <X className="size-4" /> Limpiar
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => setFiltrosOpen(false)}>
              Aplicar
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          {CATEGORIAS.map((c) => (
            <button
              key={c}
              onClick={() => setCategoriaFiltro(c)}
              className={cx(
                'rounded-lg border px-3 py-1.5 text-xs font-semibold',
                categoriaFiltro === c
                  ? 'border-accent-400 bg-accent-50 text-accent-700'
                  : 'border-ink-200 text-ink-600 hover:bg-ink-50',
              )}
            >
              {ETIQUETA_CATEGORIA_EGRESO[c]}
            </button>
          ))}
        </div>
      </Sheet>

      {/* Sheet: confirmar eliminacion */}
      <Sheet
        open={!!confirmando}
        onClose={() => setConfirmando(null)}
        title="Eliminar egreso"
        maxWidth="max-w-sm"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmando(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              className="flex-1 !bg-red-600 hover:!bg-red-700"
              loading={eliminando}
              onClick={confirmarEliminar}
            >
              Si, eliminar
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-600">
          Si este egreso estaba ligado a una caja y se pago en efectivo, el efectivo esperado de
          ese turno se recalculara automaticamente.
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

function SkeletonList() {
  return (
    <ul className="divide-y divide-ink-100">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="size-9 animate-pulse rounded-xl bg-ink-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-48 animate-pulse rounded bg-ink-100" />
            <div className="h-3 w-24 animate-pulse rounded bg-ink-100" />
          </div>
        </li>
      ))}
    </ul>
  )
}
