import { useState } from 'react'
import { Layers, Plus, Trash2, ChevronDown, ChevronUp, Divide } from 'lucide-react'
import { cx } from '@/utils/format'
import type { TipoVenta } from '@/types/database'

/**
 * Fila en edicion de una presentacion (empaquetado multinivel / venta
 * fraccionada). `id` solo existe si ya estaba guardada en la base — su
 * ausencia es lo que distingue "hay que insertarla" de "hay que actualizarla"
 * al guardar el producto (ver ProductForm.tsx).
 */
export interface FilaPresentacion {
  id?: string
  nombre: string
  factorUnidades: string
  precioCompra: string
  precioVenta: string
  esFraccion: boolean
}

export function filaVacia(): FilaPresentacion {
  return { nombre: '', factorUnidades: '', precioCompra: '', precioVenta: '', esFraccion: false }
}

/** Valida una fila igual que lo hara la base de datos (ver validar_presentacion en supabase/schema.sql), para avisar antes de guardar en vez de despues. */
export function errorFilaPresentacion(fila: FilaPresentacion, tipoVenta: TipoVenta): string | null {
  const nombre = fila.nombre.trim()
  if (!nombre) return 'Falta el nombre.'
  if (nombre.length > 40) return 'El nombre es muy largo (máx. 40 caracteres).'
  const factor = parseFloat(fila.factorUnidades)
  if (!Number.isFinite(factor) || factor <= 0) return `"${nombre}": la equivalencia debe ser mayor a 0.`
  if (tipoVenta === 'unidad' && factor !== Math.trunc(factor)) {
    return `"${nombre}": debe equivaler a un número entero de unidades (no se venden piezas fraccionadas).`
  }
  const precioVenta = parseFloat(fila.precioVenta)
  if (!Number.isFinite(precioVenta) || precioVenta < 0) return `"${nombre}": el precio de venta no es válido.`
  if (fila.precioCompra.trim() !== '') {
    const precioCompra = parseFloat(fila.precioCompra)
    if (!Number.isFinite(precioCompra) || precioCompra < 0) return `"${nombre}": el precio de compra no es válido.`
  }
  return null
}

/** Nombres duplicados (la base los rechaza con un unique por producto). */
export function nombreDuplicado(filas: FilaPresentacion[]): string | null {
  const vistos = new Set<string>()
  for (const f of filas) {
    const clave = f.nombre.trim().toLowerCase()
    if (!clave) continue
    if (vistos.has(clave)) return f.nombre.trim()
    vistos.add(clave)
  }
  return null
}

interface Props {
  filas: FilaPresentacion[]
  onChange: (filas: FilaPresentacion[]) => void
  tipoVenta: TipoVenta
  unidad: string
}

export function PresentacionesEditor({ filas, onChange, tipoVenta, unidad }: Props) {
  const [abierto, setAbierto] = useState(filas.length > 0)

  function set(idx: number, cambios: Partial<FilaPresentacion>) {
    onChange(filas.map((f, i) => (i === idx ? { ...f, ...cambios } : f)))
  }

  function agregar() {
    onChange([...filas, filaVacia()])
    setAbierto(true)
  }

  function agregarMitad(idx: number) {
    const base = filas[idx]
    const factor = parseFloat(base.factorUnidades)
    const precio = parseFloat(base.precioVenta)
    const nombreBase = base.nombre.trim() || 'presentación'
    onChange([
      ...filas,
      {
        nombre: `Media ${nombreBase}`,
        factorUnidades: Number.isFinite(factor) ? String(factor / 2) : '',
        precioCompra: '',
        precioVenta: Number.isFinite(precio) ? (Math.round((precio / 2) * 100) / 100).toFixed(2) : '',
        esFraccion: true,
      },
    ])
    setAbierto(true)
  }

  function quitar(idx: number) {
    onChange(filas.filter((_, i) => i !== idx))
  }

  return (
    <div className="rounded-xl border border-ink-100 p-3">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
            <Layers className="size-4 text-ink-400" />
            Presentaciones adicionales (opcional)
            {filas.length > 0 && (
              <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-ink-500">
                {filas.length}
              </span>
            )}
          </p>
          <p className="text-xs text-ink-400">
            Para empaques con varios niveles (Paquete, Bolsa...) o ventas fraccionadas (Media Caja...)
          </p>
        </div>
        {abierto ? (
          <ChevronUp className="size-4 shrink-0 text-ink-400" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-ink-400" />
        )}
      </button>

      {abierto && (
        <div className="mt-3 space-y-3">
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
            "Equivale a" siempre se expresa en <b>{unidad}</b> (la unidad base del producto). Ej.: si 1
            Paquete trae 5 Bolsas de 10 {unidad} cada una, crea "Bolsa" = 10 y "Paquete" = 50.
          </p>

          {filas.map((fila, idx) => (
            <div key={idx} className="rounded-lg border border-ink-100 p-2.5">
              <div className="flex items-start gap-2">
                <input
                  className="input flex-1"
                  value={fila.nombre}
                  onChange={(e) => set(idx, { nombre: e.target.value })}
                  placeholder="Ej. Paquete, Bolsa, Media Caja..."
                />
                <button
                  type="button"
                  title="Agregar la mitad de esta presentación"
                  onClick={() => agregarMitad(idx)}
                  disabled={!fila.nombre.trim() || !fila.factorUnidades}
                  className="grid size-9 shrink-0 place-items-center rounded-lg border border-ink-200 text-ink-500 transition hover:border-ink-300 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Divide className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => quitar(idx)}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="label mb-1 block text-[0.65rem]">Equivale a ({unidad})</span>
                  <input
                    type="number"
                    min={0}
                    step={tipoVenta === 'unidad' ? 1 : 0.001}
                    className="input tabular py-1.5 text-sm"
                    value={fila.factorUnidades}
                    onChange={(e) => set(idx, { factorUnidades: e.target.value })}
                    placeholder="50"
                  />
                </label>
                <label className="block">
                  <span className="label mb-1 block text-[0.65rem]">Precio compra</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="input tabular py-1.5 text-sm"
                    value={fila.precioCompra}
                    onChange={(e) => set(idx, { precioCompra: e.target.value })}
                    placeholder="Opcional"
                  />
                </label>
                <label className="block">
                  <span className="label mb-1 block text-[0.65rem]">Precio venta</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="input tabular py-1.5 text-sm"
                    value={fila.precioVenta}
                    onChange={(e) => set(idx, { precioVenta: e.target.value })}
                    placeholder="0.00"
                  />
                </label>
              </div>
              <label className="mt-2 flex items-center gap-1.5 text-xs text-ink-500">
                <input
                  type="checkbox"
                  checked={fila.esFraccion}
                  onChange={(e) => set(idx, { esFraccion: e.target.checked })}
                  className={cx('size-3.5 accent-accent-600')}
                />
                Es una fracción (ej. Media Caja) — solo para mostrarla distinta, no cambia el cálculo
              </label>
            </div>
          ))}

          <button
            type="button"
            onClick={agregar}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-200 py-2 text-xs font-semibold text-ink-500 hover:border-ink-300 hover:text-ink-700"
          >
            <Plus className="size-3.5" /> Agregar presentación
          </button>
        </div>
      )}
    </div>
  )
}
