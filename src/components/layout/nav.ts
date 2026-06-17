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
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  soloAdmin?: boolean
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Resumen', icon: LayoutDashboard, soloAdmin: true },
  { to: '/pos', label: 'Vender', icon: ScanLine },
  { to: '/inventario', label: 'Inventario', icon: Package },
  { to: '/ventas', label: 'Ventas', icon: ReceiptText },
  { to: '/caja', label: 'Caja', icon: Vault },
  { to: '/clientes', label: 'Clientes', icon: Users, soloAdmin: true },
  { to: '/proveedores', label: 'Proveedores', icon: Truck, soloAdmin: true },
  { to: '/compras', label: 'Compras', icon: ShoppingBag, soloAdmin: true },
  { to: '/mermas', label: 'Mermas', icon: Trash2, soloAdmin: true },
  { to: '/configuracion', label: 'Ajustes', icon: Settings, soloAdmin: true },
]
