// Tipos del dominio del sistema Comercial Ruiz

export type Rol = 'administrador' | 'supervisor' | 'cajero'
// 'mixto' nunca se elige directamente (no aparece en el selector de pago):
// el servidor lo asigna solo cuando una venta se paga con 2+ metodos
// distintos (ver pagos_venta / registrar_venta con p_pagos).
export type MetodoPago = 'efectivo' | 'yape' | 'fiado' | 'mixto'
// Los 3 metodos que el cajero puede elegir en el cobro (con o sin pago
// mixto) — 'mixto' es un resultado, no una opcion; los que solo existen en
// la base (tarjeta/plin/transferencia) no tienen UI en el POS todavia.
export type MetodoPagoSeleccionable = 'efectivo' | 'yape' | 'fiado'
export type TipoMovimiento = 'entrada' | 'salida' | 'ajuste' | 'venta' | 'devolucion'
export type EstadoCompra = 'pagado' | 'pendiente'
export type MotivoMerma = 'vencido' | 'danado' | 'consumo_interno' | 'otro'
export type EstadoCaja = 'abierta' | 'cerrada'
export type CategoriaEgreso =
  | 'alquiler'
  | 'servicios'
  | 'sueldos'
  | 'transporte'
  | 'insumos'
  | 'impuestos'
  | 'mantenimiento'
  | 'otro'
export type MetodoEgreso = 'efectivo' | 'yape' | 'transferencia' | 'tarjeta'
// Mismos valores que MetodoEgreso (un abono nunca es "fiado": siempre es un
// ingreso real) — alias propio para que el código de cobranzas se lea claro.
export type MetodoAbono = MetodoEgreso

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

// 'unidad' | 'caja' | 'saco' son las modalidades "legacy" (una por producto,
// columnas propias en Producto). Cualquier otro valor es el id de una fila
// de ProductoPresentacion (empaquetado multinivel / venta fraccionada, ver
// mas abajo) — por eso el tipo es `string` y no un union cerrado.
export type ModalidadVenta = string
export type TipoVenta = 'unidad' | 'granel'

// Presentacion de venta/compra adicional a las de "caja"/"saco" (que siguen
// existiendo tal cual, sin cambios). Permite cualquier numero de niveles de
// empaquetado (Paquete Maestro, Bolsa, Docena...) y fracciones (Media Caja,
// Medio Paquete...), cada una con su propio precio. "factor_unidades" esta
// SIEMPRE expresado en unidades base (las de Producto.stock_actual), nunca
// relativo a otro nivel — ver comentario en supabase/schema.sql.
export type ProductoPresentacion = {
  id: string
  producto_id: string
  nombre: string
  factor_unidades: number
  precio_compra: number | null
  precio_venta: number
  es_fraccion: boolean
  orden: number
  activo: boolean
  creado_en: string
  actualizado_en: string
}

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
  tipo_venta: TipoVenta
  tiene_saco: boolean
  kg_por_saco: number | null
  precio_venta_saco: number | null
  creado_en: string
  actualizado_en: string
  categorias?: Categoria | null
  /** Presentaciones flexibles activas de este producto, ya ordenadas — la agrega useProductos(). */
  presentaciones?: ProductoPresentacion[]
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
  /** true si sus productos/cantidades fueron modificados despues de registrada (ver editar_venta). */
  editada: boolean
  creado_en: string
}

/** Desglose de como se pago una venta — 1 fila si fue de un solo metodo, 2+ si fue mixta (ver registrar_venta). */
export type PagoVenta = {
  id: string
  venta_id: string
  metodo: MetodoPago
  monto: number
  creado_en: string
}

/** Rastro de auditoria de una anulacion o edicion de venta: quien, cuando y por que. */
export type AuditoriaVenta = {
  id: string
  venta_id: string | null
  venta_numero: number | null
  accion: 'anulada' | 'editada'
  usuario_id: string | null
  usuario_nombre: string | null
  motivo: string
  detalle: Record<string, unknown> | null
  creado_en: string
}

export type DetalleVenta = {
  id: string
  venta_id: string
  producto_id: string | null
  producto_nombre: string
  sku: string | null
  cantidad: number
  modalidad: ModalidadVenta
  unidades: number
  precio_unitario: number
  subtotal: number
  /** Nombre de la presentacion usada ("Caja", "Saco", o el nombre de una presentacion flexible), tal como estaba al momento de la venta. Null = unidad simple. */
  presentacion_nombre: string | null
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
  metodo: MetodoAbono
  caja_id: string | null
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
  total_egresos: number
  // Abonos de clientes (cobranzas) cobrados durante el turno — separados de
  // total_efectivo/total_yape (que son solo ventas directas) para poder
  // desglosarlos en el reporte de cierre.
  total_cobros_efectivo: number
  total_cobros_yape: number
  total_cobros_otros: number
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
  modalidad: ModalidadVenta
  unidades: number
  /** Nombre de la presentacion usada, tal como estaba al momento de la compra. Null = unidad simple. */
  presentacion_nombre: string | null
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

export type Egreso = {
  id: string
  concepto: string
  categoria: CategoriaEgreso
  monto: number
  metodo: MetodoEgreso
  caja_id: string | null
  usuario_id: string | null
  usuario_nombre: string | null
  fecha: string
  notas: string | null
  creado_en: string
}

export type ConfiguracionNegocio = {
  id: number
  nombre: string
  /** DNI (8 dígitos) o RUC (11 dígitos); '' = sin configurar. */
  documento: string
  /** Imagen del QR de Yape como data URL. */
  yape_qr: string | null
  actualizado_en: string
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
      producto_presentaciones: Tabla<ProductoPresentacion>
      ventas: Tabla<Venta>
      detalle_ventas: Tabla<DetalleVenta>
      pagos_venta: Tabla<PagoVenta>
      auditoria_ventas: Tabla<AuditoriaVenta>
      movimientos_inventario: Tabla<MovimientoInventario>
      clientes_credito: Tabla<ClienteCredito>
      pagos_credito: Tabla<PagoCredito>
      cajas: Tabla<CajaRegistro>
      proveedores: Tabla<Proveedor>
      compras: Tabla<Compra>
      detalle_compras: Tabla<DetalleCompra>
      mermas: Tabla<Merma>
      egresos: Tabla<Egreso>
      configuracion_negocio: Tabla<ConfiguracionNegocio>
    }
    Views: Record<string, never>
    Functions: {
      registrar_venta: {
        Args: {
          p_items: unknown
          p_metodo?: MetodoPago | null
          p_descuento: number
          p_pago_recibido?: number
          p_caja_id: string | null
          p_cliente_id: string | null
          p_tasa_igv?: number
          /** Pago mixto: [{ metodo, monto }]. Omitido/null = un solo metodo (p_metodo + p_pago_recibido). */
          p_pagos?: unknown
        }
        Returns: Venta
      }
      editar_venta: {
        Args: {
          p_venta_id: string
          p_items: unknown
          p_motivo: string
          p_descuento?: number | null
          p_tasa_igv?: number
        }
        Returns: Venta
      }
      registrar_cargo_fiado: {
        Args: { p_cliente_id: string; p_monto: number }
        Returns: ClienteCredito
      }
      registrar_abono_cliente: {
        Args: {
          p_cliente_id: string
          p_monto: number
          p_nota?: string | null
          p_metodo?: MetodoAbono
          p_caja_id?: string | null
        }
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
      anular_venta: { Args: { p_venta_id: string; p_motivo: string }; Returns: Venta }
      es_admin: { Args: Record<string, never>; Returns: boolean }
      registrar_egreso: {
        Args: {
          p_concepto: string
          p_categoria: CategoriaEgreso
          p_monto: number
          p_metodo?: MetodoEgreso
          p_caja_id?: string | null
          p_notas?: string | null
        }
        Returns: Egreso
      }
      eliminar_egreso: { Args: { p_id: string }; Returns: void }
      registrar_compra: {
        Args: {
          p_items: unknown
          p_numero?: string | null
          p_proveedor_id?: string | null
          p_proveedor_nombre?: string | null
          p_fecha_compra?: string
          p_estado?: EstadoCompra
          p_notas?: string | null
        }
        Returns: Compra
      }
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
