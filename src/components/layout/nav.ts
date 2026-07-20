import {
  LayoutDashboard,
  ScanLine,
  Package,
  ReceiptText,
  Truck,
  ShoppingBag,
  Trash2,
  Users,
  Vault,
  Settings,
  Percent,
  type LucideIcon,
} from 'lucide-react'
import type { Rol } from '@/types/database'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Rol minimo necesario para ver este item. Sin definir = visible para todos. */
  minRol?: Rol
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Resumen', icon: LayoutDashboard, minRol: 'supervisor' },
  { to: '/pos', label: 'Vender', icon: ScanLine },
  { to: '/inventario', label: 'Inventario', icon: Package },
  { to: '/ventas', label: 'Ventas', icon: ReceiptText },
  { to: '/caja', label: 'Caja', icon: Vault },
  { to: '/rentabilidad', label: 'Rentabilidad', icon: Percent, minRol: 'supervisor' },
  { to: '/clientes', label: 'Clientes', icon: Users, minRol: 'supervisor' },
  { to: '/proveedores', label: 'Proveedores', icon: Truck, minRol: 'supervisor' },
  { to: '/compras', label: 'Compras', icon: ShoppingBag, minRol: 'supervisor' },
  { to: '/mermas', label: 'Mermas', icon: Trash2, minRol: 'supervisor' },
  { to: '/configuracion', label: 'Ajustes', icon: Settings, minRol: 'administrador' },
]
