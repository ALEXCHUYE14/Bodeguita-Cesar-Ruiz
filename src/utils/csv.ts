// Exporta datos tabulares a un archivo .csv descargable (abre bien en Excel).

function escaparCelda(valor: string | number): string {
  const s = String(valor)
  // Si contiene coma, comillas o salto de linea, hay que envolver en comillas
  // y escapar las comillas internas duplicandolas (regla estandar de CSV).
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function descargarCSV(nombreArchivo: string, filas: (string | number)[][]): void {
  const contenido = filas.map((fila) => fila.map(escaparCelda).join(',')).join('\r\n')
  // BOM (﻿) al inicio: sin esto Excel interpreta tildes/ñ como caracteres
  // corruptos al abrir el CSV, porque asume la codificacion local en vez de UTF-8.
  const BOM = '﻿'
  const blob = new Blob([BOM + contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
