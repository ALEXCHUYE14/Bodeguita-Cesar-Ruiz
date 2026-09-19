import { useRef, useState, type ChangeEvent } from 'react'
import { Store, QrCode, Upload, Trash2, Save } from 'lucide-react'
import { Card, Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import {
  useNegocio,
  guardarNegocio,
  validarDocumento,
  tipoDocumento,
  MAX_NOMBRE,
  type Negocio,
} from '@/config/negocio'
import { imagenADataUrl } from '@/utils/imagen'

/** Ajustes > Datos del negocio: nombre, DNI/RUC y QR de Yape. */
export function DatosNegocio() {
  const toast = useToast()
  const negocio = useNegocio()
  // null = sin cambios sin guardar: el formulario muestra lo guardado (y se
  // actualiza solo si llegan datos nuevos del servidor).
  const [borrador, setBorrador] = useState<Negocio | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [procesandoQr, setProcesandoQr] = useState(false)
  const inputQr = useRef<HTMLInputElement>(null)

  const form = borrador ?? negocio
  const errorDoc = validarDocumento(form.documento)
  const nombreVacio = form.nombre.trim() === ''
  const hayCambios =
    borrador !== null &&
    (borrador.nombre.trim() !== negocio.nombre ||
      borrador.documento !== negocio.documento ||
      borrador.yapeQr !== negocio.yapeQr)
  const tipoDoc = tipoDocumento(form.documento)

  function cambiar(parcial: Partial<Negocio>) {
    setBorrador({ ...form, ...parcial })
  }

  async function elegirQr(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    // Permite volver a elegir el mismo archivo después de quitarlo.
    e.target.value = ''
    if (!archivo) return
    setProcesandoQr(true)
    try {
      cambiar({ yapeQr: await imagenADataUrl(archivo) })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar la imagen')
    } finally {
      setProcesandoQr(false)
    }
  }

  async function guardar() {
    if (guardando || nombreVacio || errorDoc) return
    setGuardando(true)
    try {
      await guardarNegocio({ ...form, nombre: form.nombre.trim() })
      setBorrador(null)
      toast.exito('Datos del negocio guardados')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-ink-100 px-5 py-4">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-900">
          <Store className="size-[18px]" /> Datos del negocio
        </h2>
        <p className="mt-0.5 text-sm text-ink-400">
          Aparecen en los tickets impresos, el envío por WhatsApp y los reportes.
        </p>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label mb-1.5 block" htmlFor="neg-nombre">
              Nombre del negocio
            </label>
            <input
              id="neg-nombre"
              className="input"
              value={form.nombre}
              maxLength={MAX_NOMBRE}
              onChange={(e) => cambiar({ nombre: e.target.value })}
              placeholder="Ej. Comercial Ruiz"
            />
            {nombreVacio && <p className="mt-1 text-xs text-red-600">El nombre es obligatorio.</p>}
          </div>

          <div>
            <label className="label mb-1.5 block" htmlFor="neg-doc">
              DNI / RUC del negocio {tipoDoc && <span className="text-ink-400">({tipoDoc})</span>}
            </label>
            <input
              id="neg-doc"
              className="input tabular"
              inputMode="numeric"
              maxLength={11}
              value={form.documento}
              onChange={(e) => cambiar({ documento: e.target.value.replace(/\D/g, '') })}
              placeholder="8 dígitos (DNI) u 11 dígitos (RUC)"
            />
            {errorDoc ? (
              <p className="mt-1 text-xs text-red-600">{errorDoc}</p>
            ) : (
              <p className="mt-1 text-xs text-ink-400">
                Opcional. Se imprime bajo el nombre en el ticket.
              </p>
            )}
          </div>
        </div>

        <div>
          <p className="label mb-1.5">Código QR de Yape</p>
          <div className="flex flex-wrap items-start gap-4">
            <div className="grid size-36 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-ink-200 bg-ink-50">
              {form.yapeQr ? (
                <img
                  src={form.yapeQr}
                  alt="Código QR de Yape"
                  className="size-full bg-white object-contain p-1.5"
                />
              ) : (
                <QrCode className="size-9 text-ink-300" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm text-ink-500">
                Sube la imagen del QR de tu Yape. Se mostrará al cliente cuando elijas Yape como
                método de pago en el punto de venta.
              </p>
              <input
                ref={inputQr}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={elegirQr}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={procesandoQr}
                  onClick={() => inputQr.current?.click()}
                >
                  <Upload className="size-4" /> {form.yapeQr ? 'Cambiar imagen' : 'Subir imagen'}
                </Button>
                {form.yapeQr && (
                  <Button variant="ghost" size="sm" onClick={() => cambiar({ yapeQr: null })}>
                    <Trash2 className="size-4" /> Quitar
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 pt-4">
          {hayCambios && (
            <Button variant="ghost" onClick={() => setBorrador(null)} disabled={guardando}>
              Descartar
            </Button>
          )}
          <Button
            variant="secondary"
            loading={guardando}
            disabled={!hayCambios || nombreVacio || !!errorDoc}
            onClick={guardar}
          >
            <Save className="size-4" /> Guardar cambios
          </Button>
        </div>
      </div>
    </Card>
  )
}
