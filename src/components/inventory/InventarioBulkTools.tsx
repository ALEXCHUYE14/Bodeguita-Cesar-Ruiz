import { useRef, useState, type ChangeEvent } from 'react'
import { FileSpreadsheet, FileUp, ImageDown, ImageUp, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { Button, Badge } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { useProductoImagen } from '@/hooks/useProductoImagen'
import { supabase } from '@/lib/supabase'
import { cx } from '@/utils/format'
import {
  exportarInventarioExcel,
  leerArchivoExcelInventario,
  importarInventarioExcel,
  type ResultadoImportacionFila,
} from '@/utils/inventarioExcel'
import { descargarFotosZip, leerArchivosFotos, conPool, CONCURRENCIA, type ErrorPorArchivo } from '@/utils/inventarioFotos'

interface Props {
  /** Exportar/descargar fotos quedan disponibles para cualquiera (son de solo lectura); importar y subir fotos modifican el catalogo, igual que editar un producto. */
  esAdmin: boolean
  /** Se llama tras una importacion o subida de fotos exitosa, para refrescar la lista de Inventario. */
  onCambios: () => void
}

interface ResultadoFotos {
  subidas: string[]
  sinCoincidencia: string[]
  errores: ErrorPorArchivo[]
}

/**
 * Las 4 herramientas de inventario en bloque: Exportar/Importar Excel y
 * Descargar/Subir fotos. Vive aparte de Inventario.tsx para no inflar mas
 * ese archivo — se monta directo en su fila de botones.
 */
export function InventarioBulkTools({ esAdmin, onCambios }: Props) {
  const toast = useToast()
  const { subir } = useProductoImagen()
  const inputExcelRef = useRef<HTMLInputElement>(null)
  const inputFotosRef = useRef<HTMLInputElement>(null)

  const [exportando, setExportando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [descargandoFotos, setDescargandoFotos] = useState(false)
  const [subiendoFotos, setSubiendoFotos] = useState(false)

  const [resultadoImport, setResultadoImport] = useState<ResultadoImportacionFila[] | null>(null)
  const [resultadoFotos, setResultadoFotos] = useState<ResultadoFotos | null>(null)

  async function exportar() {
    setExportando(true)
    try {
      const { productos } = await exportarInventarioExcel()
      toast.exito(`Inventario exportado (${productos} productos)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo exportar el inventario')
    } finally {
      setExportando(false)
    }
  }

  async function onArchivoExcel(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportando(true)
    try {
      const { filas, avisoFormato } = await leerArchivoExcelInventario(file)
      if (avisoFormato) toast.error(avisoFormato)
      if (filas.length === 0) {
        toast.error('El archivo no tiene filas de datos para importar.')
        return
      }
      const resultado = await importarInventarioExcel(filas)
      setResultadoImport(resultado)
      const creados = resultado.filter((r) => r.accion === 'creado').length
      const actualizados = resultado.filter((r) => r.accion === 'actualizado').length
      const errores = resultado.filter((r) => r.accion === 'error').length
      toast.exito(
        `Importación lista: ${creados} creado(s), ${actualizados} actualizado(s)` +
          (errores > 0 ? `, ${errores} con error` : ''),
      )
      if (creados + actualizados > 0) onCambios()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo importar el archivo')
    } finally {
      setImportando(false)
    }
  }

  async function descargarFotos() {
    setDescargandoFotos(true)
    try {
      const r = await descargarFotosZip()
      if (r.incluidas === 0) {
        toast.error(r.sinFoto > 0 ? 'Ningún producto tiene foto para descargar.' : 'No hay productos registrados.')
        return
      }
      toast.exito(
        `${r.incluidas} foto(s) descargadas` +
          (r.sinFoto > 0 ? ` · ${r.sinFoto} sin foto` : '') +
          (r.errores.length > 0 ? ` · ${r.errores.length} con error` : ''),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo generar el .zip de fotos')
    } finally {
      setDescargandoFotos(false)
    }
  }

  async function onArchivosFotos(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    e.target.value = ''
    if (!files || files.length === 0) return
    setSubiendoFotos(true)
    try {
      const candidatos = await leerArchivosFotos(files)
      if (candidatos.length === 0) {
        toast.error('No se encontraron imágenes en lo seleccionado.')
        return
      }

      // Contra TODO el catalogo (incluye inactivos) — es un respaldo/restauracion,
      // no solo del catalogo en venta.
      const { data: productos, error } = await supabase.from('productos').select('id, sku')
      if (error) throw error
      const mapa = new Map((productos ?? []).map((p) => [p.sku.trim().toLowerCase(), p]))

      const subidas: string[] = []
      const sinCoincidencia: string[] = []
      const errores: ErrorPorArchivo[] = []

      await conPool(candidatos, CONCURRENCIA, async (c) => {
        const prod = mapa.get(c.nombreBase.trim().toLowerCase())
        if (!prod) {
          sinCoincidencia.push(c.nombreBase)
          return
        }
        try {
          // Mismo mecanismo de subida que ProductForm (compresion + cacheControl largo).
          const url = await subir(c.archivo, prod.id)
          const { error: errUpd } = await supabase.from('productos').update({ image_url: url }).eq('id', prod.id)
          if (errUpd) throw errUpd
          subidas.push(prod.sku)
        } catch (err) {
          errores.push({ nombre: c.nombreBase, mensaje: err instanceof Error ? err.message : 'Error al subir' })
        }
      })

      setResultadoFotos({ subidas, sinCoincidencia, errores })
      toast.exito(
        `${subidas.length} foto(s) subidas` +
          (sinCoincidencia.length > 0 ? ` · ${sinCoincidencia.length} sin coincidencia` : '') +
          (errores.length > 0 ? ` · ${errores.length} con error` : ''),
      )
      if (subidas.length > 0) onCambios()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo procesar lo seleccionado')
    } finally {
      setSubiendoFotos(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={exportar} loading={exportando}>
        <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">Exportar Excel</span>
      </Button>

      {esAdmin && (
        <>
          <input
            ref={inputExcelRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={onArchivoExcel}
          />
          <Button variant="outline" size="sm" onClick={() => inputExcelRef.current?.click()} loading={importando}>
            <FileUp className="size-4" /> <span className="hidden sm:inline">Importar Excel</span>
          </Button>
        </>
      )}

      <Button variant="outline" size="sm" onClick={descargarFotos} loading={descargandoFotos}>
        <ImageDown className="size-4" /> <span className="hidden sm:inline">Descargar fotos</span>
      </Button>

      {esAdmin && (
        <>
          <input
            ref={inputFotosRef}
            type="file"
            accept=".zip,image/*"
            multiple
            className="hidden"
            onChange={onArchivosFotos}
          />
          <Button variant="outline" size="sm" onClick={() => inputFotosRef.current?.click()} loading={subiendoFotos}>
            <ImageUp className="size-4" /> <span className="hidden sm:inline">Subir fotos</span>
          </Button>
        </>
      )}

      {/* Resultado de Importar Excel */}
      <Sheet
        open={!!resultadoImport}
        onClose={() => setResultadoImport(null)}
        title="Resultado de la importación"
        maxWidth="max-w-lg"
      >
        {resultadoImport && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <Badge tone="success">
                {resultadoImport.filter((r) => r.accion === 'creado').length} creados
              </Badge>
              <Badge tone="info">
                {resultadoImport.filter((r) => r.accion === 'actualizado').length} actualizados
              </Badge>
              <Badge tone="danger">
                {resultadoImport.filter((r) => r.accion === 'error').length} con error
              </Badge>
            </div>
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200">
              {resultadoImport.map((r) => (
                <li key={r.fila} className="flex items-start gap-2.5 px-3.5 py-2.5">
                  {r.accion === 'error' ? (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent-600" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-800">
                      Fila {r.fila} {r.sku && <span className="text-ink-400">· {r.sku}</span>}
                    </p>
                    <p className={cx('text-xs', r.accion === 'error' ? 'text-red-600' : 'text-ink-400')}>
                      {r.mensaje}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Sheet>

      {/* Resultado de Subir fotos */}
      <Sheet
        open={!!resultadoFotos}
        onClose={() => setResultadoFotos(null)}
        title="Resultado de la subida de fotos"
        maxWidth="max-w-lg"
      >
        {resultadoFotos && (
          <div className="space-y-4">
            {resultadoFotos.subidas.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-accent-700">
                  <CheckCircle2 className="size-4" /> Subidas ({resultadoFotos.subidas.length})
                </p>
                <p className="text-xs text-ink-500">{resultadoFotos.subidas.join(', ')}</p>
              </div>
            )}
            {resultadoFotos.sinCoincidencia.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                  <AlertTriangle className="size-4" /> Sin coincidencia ({resultadoFotos.sinCoincidencia.length})
                </p>
                <p className="text-xs text-ink-500">
                  Ningún producto tiene este SKU: {resultadoFotos.sinCoincidencia.join(', ')}
                </p>
              </div>
            )}
            {resultadoFotos.errores.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-red-600">
                  <XCircle className="size-4" /> Errores ({resultadoFotos.errores.length})
                </p>
                <ul className="space-y-1 text-xs text-ink-500">
                  {resultadoFotos.errores.map((e, i) => (
                    <li key={i}>
                      {e.nombre}: {e.mensaje}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  )
}
