// Tipos del dominio del sistema Bodeguita Juli

export type Rol = 'administrador' | 'cajero'
export type MetodoPago = 'efectivo' | 'yape' | 'fiado'
export type TipoMovimiento = 'entrada' | 'salida' | 'ajuste' | 'venta' | 'devolucion'
export type EstadoCompra = 'pagado' | 'pendiente'
export type MotivoMerma = 'vencido' | 'danado' | 'consumo_interno' | 'otro'
export type EstadoCaja = 'abierta' | 'cerrada'

export type Perfil = {
  id: string
  nombre: string
  rol: Rol
  activo: boolean
  creado_en: string
}

export type Categoria = {
  id: string
  nombre: string
  color: string
  creado_en: string
}

export type ModalidadVenta = 'unidad' | 'caja'

export type Producto = {
  id: string
  sku: string
  nombre: string
  categoria_id: string | null
  precio_compra: number
  precio_venta: number
  precio_venta_caja: number | null
  stock_actual: number
  stock_minimo: number
  unidad: string
  activo: boolean
  image_url: string | null
  fecha_vencimiento: string | null
  tiene_caja: boolean
  unidades_por_caja: number | null
  creado_en: string
  actualizado_en: string
  categorias?: Categoria | null
}

export type Venta = {
  id: string
  numero: number
  cajero_id: string | null
  cajero_nombre: string | null
  caja_id: string | null
  cliente_id: string | null
  cliente_nombre: string | null
  subtotal: number
  descuento: number
  igv: number
  total: number
  metodo: MetodoPago
  pago_recibido: number
  vuelto: number
  anulada: boolean
  creado_en: string
}

export type DetalleVenta = {
  id: string
  venta_id: string
  producto_id: string | null
  producto_nombre: string
  sku: string | null
  cantidad: number
  precio_unitario: number
  subtotal: number
}

export type MovimientoInventario = {
  id: string
  producto_id: string | null
  producto_nombre: string | null
  tipo: TipoMovimiento
  cantidad: number
  stock_previo: number
  stock_nuevo: number
  motivo: string | null
  usuario_id: string | null
  creado_en: string
}

export type ClienteCredito = {
  id: string
  nombre: string
  telefono: string | null
  direccion: string | null
  limite_credito: number
  deuda_actual: number
  activo: boolean
  creado_en: string
}

export type PagoCredito = {
  id: string
  cliente_id: string
  monto: number
  nota: string | null
  cajero_id: string | null
  creado_en: string
}

export type CajaRegistro = {
  id: string
  cajero_id: string | null
  cajero_nombre: string | null
  monto_inicial: number
  total_efectivo: number
  total_yape: number
  total_fiado: number
  monto_real: number | null
  estado: EstadoCaja
  abierta_en: string
  cerrada_en: string | null
}

export type Proveedor = {
  id: string
  nombre: string
  ruc: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  activo: boolean
  creado_en: string
}

export type Compra = {
  id: string
  numero: string | null
  proveedor_id: string | null
  proveedor_nombre: string | null
  total: number
  estado: EstadoCompra
  fecha_compra: string
  notas: string | null
  creado_en: string
  proveedores?: Proveedor | null
}

export type DetalleCompra = {
  id: string
  compra_id: string
  producto_id: string | null
  producto_nombre: string
  cantidad: number
  precio_unitario: number
  subtotal: number
}

export type Merma = {
  id: string
  producto_id: string | null
  producto_nombre: string
  cantidad: number
  costo_unitario: number
  costo_total: number
  motivo: MotivoMerma
  descripcion: string | null
  usuario_id: string | null
  creado_en: string
}

export type ItemCarrito = {
  producto: Producto
  cantidad: number
  modalidad: ModalidadVenta
}

// Tipado minimo para el cliente de Supabase (compatible con GenericSchema)
type Tabla<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] }

export interface Database {
  public: {
    Tables: {
      perfiles: Tabla<Perfil>
      categorias: Tabla<Categoria>
      productos: Tabla<Producto>
      ventas: Tabla<Venta>
      detalle_ventas: Tabla<DetalleVenta>
      movimientos_inventario: Tabla<MovimientoInventario>
      clientes_credito: Tabla<ClienteCredito>
      pagos_credito: Tabla<PagoCredito>
      cajas: Tabla<CajaRegistro>
      proveedores: Tabla<Proveedor>
      compras: Tabla<Compra>
      detalle_compras: Tabla<DetalleCompra>
      mermas: Tabla<Merma>
    }
    Views: Record<string, never>
    Functions: {
      registrar_venta: {
        Args: {
          p_items: unknown
          p_metodo: MetodoPago
          p_descuento: number
          p_pago_recibido: number
          p_caja_id: string | null
          p_cliente_id: string | null
          p_tasa_igv?: number
        }
        Returns: Venta
      }
      registrar_cargo_fiado: {
        Args: { p_cliente_id: string; p_monto: number }
        Returns: ClienteCredito
      }
      registrar_abono_cliente: {
        Args: { p_cliente_id: string; p_monto: number; p_nota: string | null }
        Returns: PagoCredito
      }
      ajustar_stock: {
        Args: {
          p_producto_id: string
          p_cantidad: number
          p_tipo: TipoMovimiento
          p_motivo: string | null
        }
        Returns: Producto
      }
      incrementar_caja: {
        Args: { p_caja_id: string; p_metodo: string; p_monto: number }
        Returns: void
      }
      anular_venta: { Args: { p_venta_id: string }; Returns: Venta }
      es_admin: { Args: Record<string, never>; Returns: boolean }
    }
    Enums: {
      rol_usuario: Rol
      metodo_pago: MetodoPago
      tipo_movimiento: TipoMovimiento
      estado_compra: EstadoCompra
      motivo_merma: MotivoMerma
      estado_caja: EstadoCaja
    }
    CompositeTypes: Record<string, never>
  }
}
