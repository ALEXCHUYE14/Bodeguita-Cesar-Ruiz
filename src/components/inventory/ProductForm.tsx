import { useEffect, useRef, useState } from 'react'
import { Camera, Upload, X, ScanLine } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { CameraScanner } from '@/components/pos/CameraScanner'
import { useProductoImagen } from '@/hooks/useProductoImagen'
import { supabase } from '@/lib/supabase'
import { cx } from '@/utils/format'
import { beepExito } from '@/utils/beep'
import type { Categoria, Producto, TipoVenta } from '@/types/database'

const UNIDADES_GRANEL = ['kg', 'g', 'litro', 'ml']

interface Props {
  open: boolean
  onClose: () => void
  producto: Producto | null
  categorias: Categoria[]
  onGuardado: () => void
}

function mensajeDeError(e: unknown): string {
  if (e instanceof Error) {
    const hint = (e as { hint?: string }).hint
    return hint ? `${e.message} (${hint})` : e.message
  }
  return 'Error al guardar'
}

const vacio = {
  sku: '',
  nombre: '',
  categoria_id: '',
  precio_compra: '',
  precio_venta: '',
  stock_actual: '',
  stock_minimo: '5',
  unidad: 'unidad',
  image_url: '',
  unidades_por_caja: '',
  precio_venta_caja: '',
}

export function ProductForm({ open, onClose, producto, categorias, onGuardado }: Props) {
  const toast = useToast()
  const { subiendo, subir } = useProductoImagen()
  const nombreRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState(vacio)
  const [guardando, setGuardando] = useState(false)
  const [scannerSku, setScannerSku] = useState(false)
  const [tieneCaja, setTieneCaja] = useState(false)
  const [tipoVenta, setTipoVenta] = useState<TipoVenta>('unidad')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)

  const esGranel = tipoVenta === 'granel'

  useEffect(() => {
    if (producto) {
      setF({
        sku: producto.sku,
        nombre: producto.nombre,
        categoria_id: producto.categoria_id ?? '',
        precio_compra: String(producto.precio_compra),
        precio_venta: String(producto.precio_venta),
        stock_actual: String(producto.stock_actual),
        stock_minimo: String(producto.stock_minimo),
        unidad: producto.unidad,
        image_url: producto.image_url ?? '',
        unidades_por_caja: String(producto.unidades_por_caja ?? ''),
        precio_venta_caja: String(producto.precio_venta_caja ?? ''),
      })
      setTieneCaja(producto.tiene_caja)
      setTipoVenta(producto.tipo_venta ?? 'unidad')
    } else {
      setF(vacio)
      setTieneCaja(false)
      setTipoVenta('unidad')
    }
    setImageFile(null)
    setImagePreview(null)
    setScannerSku(false)
  }, [producto, open])

  function set<K extends keyof typeof vacio>(k: K, v: string) {
    setF((prev) => ({ ...prev, [k]: v }))
  }

  function elegirTipoVenta(t: TipoVenta) {
    setTipoVenta(t)
    if (t === 'granel') {
      // Un producto a granel no se vende ademas por caja: son dos formas
      // distintas de fraccionar el mismo stock.
      setTieneCaja(false)
      if (!UNIDADES_GRANEL.includes(f.unidad)) set('unidad', 'kg')
    } else if (UNIDADES_GRANEL.includes(f.unidad)) {
      set('unidad', 'unidad')
    }
  }

  function onSkuDetectado(codigo: string) {
    beepExito()
    set('sku', codigo.trim())
    setScannerSku(false)
    if ('vibrate' in navigator) navigator.vibrate([30, 30, 30])
    setTimeout(() => nombreRef.current?.focus(), 120)
  }

  function seleccionarImagen(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Solo se aceptan archivos de imagen.')
      return
    }
    // Sin limite de peso: cualquier foto (incluso 10-15 MB de una camara de
    // celular moderna) se comprime automaticamente a ~80-150KB en subir()
    // (ver useProductoImagen.ts) antes de subirla. Bloquear aqui por tamano
    // del archivo original rechazaba justo las fotos de camara que esa
    // compresion existe para manejar.
    setImageFile(file)
    const prev = imagePreview
    if (prev) URL.revokeObjectURL(prev)
    setImagePreview(URL.createObjectURL(file))
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setArrastrando(false)
    const file = e.dataTransfer.files[0]
    if (file) seleccionarImagen(file)
  }

  async function guardar() {
    if (!f.sku.trim() || !f.nombre.trim()) {
      toast.error('SKU y nombre son obligatorios.')
      return
    }
    setGuardando(true)
    const payload = {
      sku: f.sku.trim(),
      nombre: f.nombre.trim(),
      categoria_id: f.categoria_id || null,
      precio_compra: parseFloat(f.precio_compra) || 0,
      precio_venta: parseFloat(f.precio_venta) || 0,
      // stock_minimo/stock_actual usan parseFloat (no parseInt) para admitir
      // decimales en productos a granel, ej. 0.5 kg.
      stock_minimo: parseFloat(f.stock_minimo) || 0,
      unidad: f.unidad,
      tipo_venta: tipoVenta,
      tiene_caja: esGranel ? false : tieneCaja,
      unidades_por_caja: !esGranel && tieneCaja ? (parseInt(f.unidades_por_caja) || null) : null,
      precio_venta_caja: !esGranel && tieneCaja ? (parseFloat(f.precio_venta_caja) || null) : null,
    }

    // Guarda primero los datos del producto. La foto se sube después y por
    // separado: si falla la subida (ej. bucket de Storage mal configurado),
    // el producto ya guardado no debe perderse ni reportarse como error.
    let productoId: string
    try {
      if (producto) {
        const { error } = await supabase.from('productos').update(payload).eq('id', producto.id)
        if (error) throw error
        productoId = producto.id
      } else {
        const { data, error } = await supabase
          .from('productos')
          .insert({ ...payload, stock_actual: parseFloat(f.stock_actual) || 0 })
          .select('id')
          .single()
        if (error) throw error
        productoId = data.id
      }
    } catch (e) {
      const msg = mensajeDeError(e)
      toast.error(msg.includes('duplicate') ? 'Ese SKU ya existe.' : msg)
      setGuardando(false)
      return
    }

    try {
      if (imageFile) {
        const url = await subir(imageFile, productoId)
        await supabase.from('productos').update({ image_url: url }).eq('id', productoId)
      } else if (producto && f.image_url === '' && producto.image_url) {
        await supabase.from('productos').update({ image_url: null }).eq('id', productoId)
      }
      toast.exito(producto ? 'Producto actualizado' : 'Producto creado')
    } catch (e) {
      toast.error(`Producto guardado, pero la foto no se pudo subir: ${mensajeDeError(e)}`)
    } finally {
      setGuardando(false)
      onGuardado()
      onClose()
    }
  }

  const imagenActual = imagePreview ?? (f.image_url || null)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={producto ? 'Editar producto' : 'Nuevo producto'}
      maxWidth="max-w-lg"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            loading={guardando || subiendo}
            onClick={guardar}
          >
            {subiendo ? 'Subiendo imagen...' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* SKU con escáner de cámara */}
        <div>
          <span className="label mb-1.5 block">SKU / Código de barras</span>
          <div className="flex gap-2">
            <input
              className="input flex-1 font-mono"
              value={f.sku}
              onChange={(e) => set('sku', e.target.value)}
              placeholder="7501055300464"
              readOnly={scannerSku}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScannerSku((v) => !v)}
              className={cx(
                'shrink-0 transition',
                scannerSku && 'border-accent-400 bg-accent-50 text-accent-700',
              )}
            >
              <ScanLine className="size-4" />
              {scannerSku ? 'Cerrar' : 'Escanear'}
            </Button>
          </div>

          {/* Scanner inline — aparece debajo del campo SKU */}
          {scannerSku && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-ink-100">
              <CameraScanner activo={scannerSku} onScan={onSkuDetectado} />
              <p className="py-2 text-center text-xs text-ink-400">
                Apunta al código de barras o QR del producto.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Nombre del producto" className="col-span-2">
            <input
              ref={nombreRef}
              className="input"
              value={f.nombre}
              onChange={(e) => set('nombre', e.target.value)}
              placeholder="Coca Cola 500ml"
            />
          </Campo>

          <Campo label="Categoría">
            <select
              className="input"
              value={f.categoria_id}
              onChange={(e) => set('categoria_id', e.target.value)}
            >
              <option value="">Sin categoría</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Unidad">
            <select
              className="input"
              value={f.unidad}
              onChange={(e) => set('unidad', e.target.value)}
            >
              {(esGranel ? UNIDADES_GRANEL : ['unidad', 'paquete', 'caja', 'docena']).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label={esGranel ? `Precio compra por ${f.unidad} (S/)` : 'Precio compra (S/)'}>
            <input
              type="number"
              min={0}
              step={0.01}
              className="input tabular"
              value={f.precio_compra}
              onChange={(e) => set('precio_compra', e.target.value)}
              placeholder="0.00"
            />
          </Campo>

          <Campo label={esGranel ? `Precio venta por ${f.unidad} (S/)` : 'Precio venta (S/)'}>
            <input
              type="number"
              min={0}
              step={0.01}
              className="input tabular"
              value={f.precio_venta}
              onChange={(e) => set('precio_venta', e.target.value)}
              placeholder="0.00"
            />
          </Campo>

          {!producto && (
            <Campo label={esGranel ? `Stock inicial (en ${f.unidad})` : 'Stock inicial'}>
              <input
                type="number"
                min={0}
                step={esGranel ? 0.001 : 1}
                className="input tabular"
                value={f.stock_actual}
                onChange={(e) => set('stock_actual', e.target.value)}
                placeholder="0"
              />
            </Campo>
          )}

          <Campo
            label={esGranel ? `Stock mínimo (en ${f.unidad})` : 'Stock mínimo (alerta)'}
            className={producto ? 'col-span-2' : ''}
          >
            <input
              type="number"
              min={0}
              step={esGranel ? 0.001 : 1}
              className="input tabular"
              value={f.stock_minimo}
              onChange={(e) => set('stock_minimo', e.target.value)}
              placeholder="5"
            />
          </Campo>
        </div>

        {/* Tipo de venta: por unidad o a granel (peso fraccionado) */}
        <div className="rounded-xl border border-ink-100 p-3">
          <p className="mb-2 text-sm font-semibold text-ink-800">Tipo de venta</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => elegirTipoVenta('unidad')}
              className={cx(
                'rounded-lg border px-3 py-2 text-left text-xs font-semibold transition',
                !esGranel
                  ? 'border-accent-400 bg-accent-50 text-accent-700'
                  : 'border-ink-200 text-ink-500 hover:border-ink-300',
              )}
            >
              Por unidad
              <span className="mt-0.5 block font-normal text-ink-400">
                Piezas enteras, ej. gaseosas, galletas
              </span>
            </button>
            <button
              type="button"
              onClick={() => elegirTipoVenta('granel')}
              className={cx(
                'rounded-lg border px-3 py-2 text-left text-xs font-semibold transition',
                esGranel
                  ? 'border-accent-400 bg-accent-50 text-accent-700'
                  : 'border-ink-200 text-ink-500 hover:border-ink-300',
              )}
            >
              A granel (peso)
              <span className="mt-0.5 block font-normal text-ink-400">
                Fraccionado, ej. kg de un saco de arroz
              </span>
            </button>
          </div>
          {esGranel && (
            <p className="mt-2.5 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
              En el punto de venta se pedirá la cantidad exacta en <b>{f.unidad}</b> (admite
              decimales, ej. 0.750).
            </p>
          )}
        </div>

        {/* Venta por caja (no aplica a productos a granel) */}
        {!esGranel && (
        <div className="rounded-xl border border-ink-100 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink-800">Venta por caja</p>
              <p className="text-xs text-ink-400">
                Permite vender en cajas además de unidades individuales
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={tieneCaja}
              onClick={() => setTieneCaja((v) => !v)}
              className={cx(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                tieneCaja ? 'bg-accent-500' : 'bg-ink-200',
              )}
            >
              <span
                className={cx(
                  'inline-block size-5 rounded-full bg-white shadow transition-transform',
                  tieneCaja ? 'translate-x-5' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>

          {tieneCaja && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Campo label="Unidades por caja">
                <input
                  type="number"
                  min={1}
                  className="input tabular"
                  value={f.unidades_por_caja}
                  onChange={(e) => set('unidades_por_caja', e.target.value)}
                  placeholder="12"
                />
              </Campo>
              <Campo label="Precio caja (S/)">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="input tabular"
                  value={f.precio_venta_caja}
                  onChange={(e) => set('precio_venta_caja', e.target.value)}
                  placeholder="0.00"
                />
              </Campo>
            </div>
          )}
        </div>
        )}

        {/* Foto del producto */}
        <div>
          <span className="label mb-1.5 block">Foto del producto</span>

          {imagenActual ? (
            <div className="group relative overflow-hidden rounded-xl border border-ink-100">
              <img
                src={imagenActual}
                alt="Vista previa"
                className="h-44 w-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 transition group-hover:bg-black/30">
                <label className="hidden cursor-pointer rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-ink-800 hover:bg-white group-hover:block">
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) seleccionarImagen(file)
                    }}
                  />
                  Cambiar foto
                </label>
                <button
                  onClick={() => {
                    setImageFile(null)
                    if (imagePreview) URL.revokeObjectURL(imagePreview)
                    setImagePreview(null)
                    set('image_url', '')
                  }}
                  className="hidden rounded-lg bg-red-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 group-hover:block"
                >
                  <X className="mr-1 inline size-3.5" />
                  Quitar
                </button>
              </div>
            </div>
          ) : (
            <div
              onDrop={onDrop}
              onDragOver={(e) => {
                e.preventDefault()
                setArrastrando(true)
              }}
              onDragLeave={() => setArrastrando(false)}
              className={cx(
                'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-7 text-center transition',
                arrastrando
                  ? 'border-accent-400 bg-accent-50'
                  : 'border-ink-200 bg-ink-50 hover:border-ink-300',
              )}
            >
              <Upload
                className={cx(
                  'mb-2 size-6 transition',
                  arrastrando ? 'text-accent-500' : 'text-ink-300',
                )}
              />
              <p className="text-sm font-medium text-ink-600">
                {arrastrando ? 'Suelta para subir' : 'Arrastra una foto aquí'}
              </p>
              <p className="mt-0.5 text-xs text-ink-400">
                JPG, PNG o WEBP · cualquier peso, se optimiza automáticamente
              </p>
              <div className="mt-3 flex gap-2">
                <label className="cursor-pointer rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 shadow-sm hover:bg-ink-50">
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) seleccionarImagen(file)
                      e.target.value = ''
                    }}
                  />
                  Subir archivo
                </label>
                <label className="cursor-pointer rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 shadow-sm hover:bg-ink-50">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) seleccionarImagen(file)
                      e.target.value = ''
                    }}
                  />
                  <Camera className="mr-1 inline size-3.5" />
                  Tomar foto
                </label>
              </div>
            </div>
          )}
        </div>

        {producto && (
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-400">
            Stock actual:{' '}
            <b className="text-ink-700">{producto.stock_actual} {producto.unidad}</b> ·
            Usa el botón <b className="text-ink-600">Movimiento</b> para modificarlo y mantener el kardex.
          </p>
        )}
      </div>
    </Sheet>
  )
}

function Campo({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={className}>
      <span className="label mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}
