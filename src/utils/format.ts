// Utilidades de formato para mercado peruano (soles, fechas locales)

export const PEN = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
})

export const money = (n: number | null | undefined): string => PEN.format(Number(n ?? 0))

export const numero = new Intl.NumberFormat('es-PE')

// Formatea una cantidad de stock/venta redondeando a 3 decimales y sin ceros
// sobrantes (12.500 -> "12.5", 12 -> "12"). Util para productos a granel (kg).
export function cantidad(n: number | null | undefined): string {
  return (Math.round(Number(n ?? 0) * 1000) / 1000).toString()
}

// Etiqueta de unidad para mostrar junto a una cantidad de stock: el nombre de
// la unidad de medida para productos a granel, o "u." para productos por pieza.
export function etiquetaUnidad(producto: { tipo_venta: string; unidad: string }): string {
  return producto.tipo_venta === 'granel' ? producto.unidad : 'u.'
}

export function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fechaHora(iso: string): string {
  return `${fechaCorta(iso)} - ${horaCorta(iso)}`
}

// Devuelve YYYY-MM-DD en zona local (para inputs date / filtros)
export function ymd(d: Date): string {
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 10)
}

export function inicioDelDia(d = new Date()): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function finDelDia(d = new Date()): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

// Parsea un "YYYY-MM-DD" (lo que dan los <input type="date"> y ymd()) al
// inicio/fin de ESE dia en hora LOCAL, listo para .toISOString() antes de
// mandarlo a un filtro de Supabase (.gte/.lte sobre una columna timestamptz).
//
// Mandar el string crudo "2026-11-09T00:00:00" (sin offset de zona horaria)
// directo a Supabase es un bug: el servidor lo interpreta como UTC, no como
// hora local. En Peru (UTC-5) el corte queda 5 horas antes de la medianoche
// real — ventas de la noche anterior se cuelan como "de hoy", y ventas de la
// noche de HOY quedan afuera (su hora UTC ya es "de mañana").
//
// `new Date("YYYY-MM-DD")` tampoco sirve para arreglarlo: ese formato, SIN
// componente de hora, lo especifica el estandar ECMAScript como UTC tambien.
// Solo el constructor con componentes sueltos (año, mes, dia) es local de
// verdad — por eso se parsea a mano en vez de pasarle el string entero.
function fechaLocalDesdeYmd(ymdStr: string): Date {
  const [y, m, d] = ymdStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function inicioDia(ymdStr: string): Date {
  const x = fechaLocalDesdeYmd(ymdStr)
  x.setHours(0, 0, 0, 0)
  return x
}

export function finDia(ymdStr: string): Date {
  const x = fechaLocalDesdeYmd(ymdStr)
  x.setHours(23, 59, 59, 999)
  return x
}

// Une clases condicionalmente sin dependencias externas
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export const ETIQUETA_PAGO: Record<string, string> = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  fiado: 'Fiado',
  mixto: 'Mixto',
}
