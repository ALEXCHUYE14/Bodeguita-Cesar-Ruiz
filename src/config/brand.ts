/**
 * Configuración de marca — edita este archivo para personalizar el sistema.
 * Los cambios aquí se propagan automáticamente a toda la UI: saludo, avatar,
 * sidebar, tickets y reporte PDF de cierre de caja.
 */
export const BRAND = {
  /** Nombre de la tienda (aparece en sidebar, login, ticket, PDF) */
  nombre: 'Bodeguita Juli',

  /**
   * Nombre del operador principal (lo que se muestra en el saludo del POS,
   * el avatar del sidebar y el campo "Cajero:" de los tickets).
   * Se aplica cuando el rol del usuario autenticado es "administrador".
   * Los cajeros regulares muestran su propio nombre de perfil.
   */
  operador: 'Juli',

  /** Número de WhatsApp para soporte (formato internacional sin +) */
  whatsappSoporte: '51924996961',
} as const
