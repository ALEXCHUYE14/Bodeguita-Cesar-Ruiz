import type { Rol } from '@/types/database'

// Jerarquia de roles: cajero < supervisor < administrador.
// Supervisor puede ver reportes (igual que administrador) pero no puede
// crear, editar ni eliminar nada (igual que un cajero en ese sentido).
const RANGO_ROL: Record<Rol, number> = {
  cajero: 0,
  supervisor: 1,
  administrador: 2,
}

/** true si rolActual tiene rango igual o mayor al minimo requerido. */
export function tieneAcceso(rolActual: Rol | undefined, minRol: Rol | undefined): boolean {
  if (!minRol) return true
  if (!rolActual) return false
  return RANGO_ROL[rolActual] >= RANGO_ROL[minRol]
}
