import { useState } from 'react'
import { Printer, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { Card, Button } from '@/components/ui/Button'
import { BRAND } from '@/config/brand'

export function Configuracion() {
  const [estadoImpresion, setEstadoImpresion] = useState<'idle' | 'ok' | 'error'>('idle')

  function probarImpresion() {
    const w = window.open('', '_blank', 'width=380,height=520,menubar=no,toolbar=no')
    if (!w) {
      setEstadoImpresion('error')
      return
    }

    const ahora = new Date().toLocaleString('es-PE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })

    w.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Prueba de Impresión</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Courier New',Courier,monospace; font-size:12px; width:80mm; padding:4mm; }
    .center { text-align:center; }
    .bold { font-weight:bold; }
    .line { border-top:1px dashed #000; margin:4px 0; }
    .row { display:flex; justify-content:space-between; }
    @media print { body { width:80mm; } }
  </style>
</head>
<body>
  <div class="center bold" style="font-size:14px;margin-bottom:4px;">BODEGUITA JULI</div>
  <div class="center" style="font-size:10px;margin-bottom:8px;">Sistema de Gestión Comercial</div>
  <div class="line"></div>
  <div class="center bold" style="margin:6px 0;">*** TICKET DE PRUEBA ***</div>
  <div class="line"></div>
  <div style="margin:6px 0;">
    <div class="row"><span>Fecha/Hora:</span><span>${ahora}</span></div>
    <div class="row"><span>Sistema:</span><span>${BRAND.nombre}</span></div>
    <div class="row"><span>Estado:</span><span>Operativo</span></div>
  </div>
  <div class="line"></div>
  <div style="margin:6px 0;">
    <div class="row"><span>Producto A</span><span>S/ 10.00</span></div>
    <div class="row"><span>Producto B</span><span>S/ 25.50</span></div>
    <div class="row"><span>Producto C</span><span>S/ 5.00</span></div>
  </div>
  <div class="line"></div>
  <div class="row bold" style="margin:4px 0;font-size:13px;">
    <span>TOTAL</span><span>S/ 40.50</span>
  </div>
  <div class="line"></div>
  <div class="center" style="margin-top:8px;font-size:10px;">Si ves este ticket, la impresora</div>
  <div class="center" style="font-size:10px;">esta configurada correctamente.</div>
  <div class="center bold" style="margin-top:6px;">¡Gracias por su compra!</div>
</body>
</html>`)
    w.document.close()
    w.focus()
    setTimeout(() => {
      w.print()
      setEstadoImpresion('ok')
    }, 400)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Configuración</h1>
        <p className="text-sm text-ink-400">Ajustes del sistema y herramientas de diagnóstico</p>
      </div>

      {/* Sección: Impresora */}
      <Card className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="font-display font-bold text-ink-900">Impresora de tickets</h2>
          <p className="mt-0.5 text-sm text-ink-400">
            Prueba la conexión con tu impresora térmica o Bluetooth
          </p>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              El botón abre una ventana con un ticket de prueba y lanza la impresión automáticamente.
              Asegúrate de que los popups estén habilitados para este sitio.
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={probarImpresion}>
              <Printer className="size-4" /> Imprimir ticket de prueba
            </Button>
            {estadoImpresion === 'ok' && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-accent-700">
                <CheckCircle2 className="size-4" /> Ventana abierta correctamente
              </span>
            )}
            {estadoImpresion === 'error' && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-red-600">
                <AlertTriangle className="size-4" /> Popup bloqueado — habilita los popups
              </span>
            )}
          </div>

          <div className="rounded-xl bg-ink-50 p-4 text-sm text-ink-600">
            <p className="mb-2 font-semibold text-ink-800">Para impresoras Bluetooth:</p>
            <ol className="list-decimal list-inside space-y-1 text-ink-500">
              <li>Vincula la impresora al dispositivo desde Configuración → Bluetooth</li>
              <li>Instala el driver o app de la impresora si es necesario</li>
              <li>Selecciona la impresora en el diálogo de impresión del navegador</li>
              <li>Ajusta el tamaño de papel a <strong>80 mm</strong> (papel térmico estándar)</li>
            </ol>
          </div>
        </div>
      </Card>

      {/* Sección: Información del sistema */}
      <Card className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="font-display font-bold text-ink-900">Información del sistema</h2>
        </div>
        <div className="divide-y divide-ink-50">
          {[
            { k: 'Aplicación', v: 'Bodeguita Juli POS' },
            { k: 'Versión', v: import.meta.env.VITE_APP_VERSION ?? '1.0.0' },
            { k: 'Entorno', v: import.meta.env.MODE === 'production' ? 'Producción' : 'Desarrollo' },
            { k: 'Navegador', v: navigator.userAgent.split(' ').slice(-2).join(' ') },
          ].map(({ k, v }) => (
            <div key={k} className="flex justify-between px-5 py-3 text-sm">
              <span className="text-ink-500">{k}</span>
              <span className="font-medium text-ink-800">{v}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
