import { useEffect, useState } from 'react'
import { Bluetooth, Printer, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Card, Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import {
  bluetoothDisponible,
  useImpresoraBluetooth,
  conectarImpresora,
  desconectarImpresora,
  reconectarImpresoraGuardada,
  imprimirPruebaBluetooth,
  autoImprimirActivo,
  fijarAutoImprimir,
} from '@/utils/bluetoothPrint'
import { cx } from '@/utils/format'

/** Ajustes > Impresora Bluetooth: vincular una vez, reconexión automática y prueba. */
export function ImpresoraBluetooth() {
  const toast = useToast()
  const impresora = useImpresoraBluetooth()
  const disponible = bluetoothDisponible()
  const [auto, setAuto] = useState(autoImprimirActivo)
  const [ocupado, setOcupado] = useState<'conectar' | 'probar' | null>(null)

  // Al abrir Configuración, si ya había una impresora vinculada, se reconecta sola.
  useEffect(() => {
    void reconectarImpresoraGuardada()
  }, [])

  const conectada = impresora.estado === 'conectada'
  const conectando = impresora.estado === 'conectando' || ocupado === 'conectar'

  async function conectar() {
    setOcupado('conectar')
    try {
      await conectarImpresora()
      toast.exito('Impresora conectada')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo conectar con la impresora')
    } finally {
      setOcupado(null)
    }
  }

  async function cambiar() {
    // Olvida la actual y abre el selector de inmediato (mismo gesto del usuario).
    desconectarImpresora()
    await conectar()
  }

  async function probar() {
    setOcupado('probar')
    try {
      await imprimirPruebaBluetooth()
      toast.exito('Ticket de prueba enviado')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo imprimir')
    } finally {
      setOcupado(null)
    }
  }

  function alternarAuto(valor: boolean) {
    fijarAutoImprimir(valor)
    setAuto(valor)
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-ink-100 px-5 py-4">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-900">
          <Bluetooth className="size-[18px]" /> Impresora Bluetooth
        </h2>
        <p className="mt-0.5 text-sm text-ink-400">
          Vincula tu impresora térmica una vez y los tickets salen directo, sin diálogos.
        </p>
      </div>

      <div className="space-y-4 p-5">
        {!disponible ? (
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Este navegador no permite conectar impresoras Bluetooth (Safari en iPhone/iPad/Mac no
              lo soporta). Usa Chrome o Edge en Android o PC, o imprime con el diálogo del sistema
              más abajo.
            </span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-900">
                  {impresora.nombre ?? 'Sin impresora vinculada'}
                </p>
                <p
                  className={cx(
                    'mt-0.5 flex items-center gap-1.5 text-xs font-medium',
                    conectada ? 'text-accent-700' : 'text-ink-400',
                  )}
                >
                  {conectada ? (
                    <>
                      <CheckCircle2 className="size-3.5" /> Conectada
                    </>
                  ) : conectando ? (
                    'Conectando…'
                  ) : impresora.nombre ? (
                    'Desconectada — enciéndela y toca Reconectar'
                  ) : (
                    'Toca Conectar y elige tu impresora'
                  )}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {!conectada && (
                  <Button variant="secondary" size="sm" loading={conectando} onClick={conectar}>
                    <Bluetooth className="size-4" /> {impresora.nombre ? 'Reconectar' : 'Conectar'}
                  </Button>
                )}
                {conectada && (
                  <Button variant="outline" size="sm" loading={ocupado === 'probar'} onClick={probar}>
                    <Printer className="size-4" /> Imprimir prueba
                  </Button>
                )}
                {impresora.nombre && (
                  <>
                    <Button variant="ghost" size="sm" disabled={conectando} onClick={cambiar}>
                      Cambiar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={conectando}
                      onClick={desconectarImpresora}
                    >
                      Olvidar
                    </Button>
                  </>
                )}
              </div>
            </div>

            {impresora.error && !conectada && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{impresora.error}</span>
              </div>
            )}

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-100 px-4 py-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-accent-600"
                checked={auto}
                onChange={(e) => alternarAuto(e.target.checked)}
              />
              <span className="text-sm">
                <span className="block font-semibold text-ink-800">Imprimir al cobrar</span>
                <span className="text-ink-400">
                  Envía el ticket a esta impresora en cuanto se registra la venta. Se guarda solo
                  para este dispositivo.
                </span>
              </span>
            </label>

            <p className="text-xs text-ink-400">
              Requiere una impresora térmica Bluetooth de bajo consumo (BLE). Enciéndela y déjala
              cerca del dispositivo. Si no aparece al conectar, prueba primero con el diálogo del
              sistema (abajo).
            </p>
          </>
        )}
      </div>
    </Card>
  )
}
