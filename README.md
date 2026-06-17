# Bodega Cesar Ruiz — Sistema de Gestion Comercial y POS

Sistema de punto de venta y gestion en tiempo real para bodega/minimarket, construido con **React + TypeScript + Tailwind** en el frontend y **Supabase** (PostgreSQL, Auth, Realtime) en el backend. Funciona como **PWA** instalable en celular y escritorio.

## Caracteristicas

- **Punto de venta (POS)** con doble entrada de productos:
  - Lector fisico de codigo de barras (emulacion de teclado, deteccion automatica).
  - Camara del celular (QR / EAN-13 / EAN-8 / CODE-128 / UPC).
- **Carrito** con calculo de IGV (18%, incluido en el precio), descuentos, metodos de pago (efectivo, tarjeta, Yape, Plin, transferencia) y calculo de vuelto.
- **Dashboard analitico en tiempo real**: ventas del dia, ticket promedio, ventas por hora, por metodo de pago, productos mas vendidos y alertas de stock bajo.
- **Inventario** con CRUD de productos, control de stock, ajustes con kardex (entradas/salidas/ajustes) y valorizado.
- **Historial de ventas** con filtros por fecha, metodo de pago y cajero, reimpresion de ticket y anulacion (solo admin, con reposicion automatica de stock).
- **Roles**: administrador (acceso total) y cajero (venta + inventario).
- Moneda en **soles peruanos (PEN)**.

## Requisitos

- Node.js 18 o superior
- Una cuenta gratuita en [Supabase](https://supabase.com)

## 1. Crear el proyecto en Supabase

1. Entra a [app.supabase.com](https://app.supabase.com) y crea un proyecto nuevo.
2. Anota la contrasena de la base de datos que definas.
3. Cuando el proyecto este listo, ve a **SQL Editor** y abre una nueva consulta.
4. Copia **todo** el contenido de `supabase/schema.sql` y ejecutalo. Esto crea las tablas, funciones (`registrar_venta`, `ajustar_stock`, `anular_venta`), politicas de seguridad (RLS), publicaciones de Realtime y datos de ejemplo.

## 2. Configurar las variables de entorno

1. En Supabase ve a **Project Settings → API**.
2. Copia el **Project URL** y la **anon public key**.
3. En la raiz del proyecto, copia el archivo de ejemplo:

   ```bash
   cp .env.example .env
   ```

4. Edita `.env` con tus credenciales:

   ```
   VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
   VITE_SUPABASE_ANON_KEY=TU-ANON-KEY
   ```

## 3. Crear el primer usuario (administrador)

1. En Supabase ve a **Authentication → Users → Add user** y crea un usuario con correo y contrasena.
2. Ese usuario se registra automaticamente como **cajero**. Para convertirlo en administrador, ve al **SQL Editor** y ejecuta (reemplaza el UUID por el `id` del usuario que aparece en Authentication):

   ```sql
   update public.perfiles set rol = 'administrador' where id = 'UUID-DEL-USUARIO';
   ```

## 4. Instalar y ejecutar

```bash
npm install
npm run dev
```

Abre la URL que indica la consola (por defecto `http://localhost:5173`) e inicia sesion.

## 5. Compilar para produccion

```bash
npm run build      # genera la carpeta dist/
npm run preview    # prueba local del build
```

Puedes desplegar la carpeta `dist/` en cualquier hosting estatico (Vercel, Netlify, Cloudflare Pages, etc.). Recuerda configurar las mismas variables de entorno `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en el panel del hosting.

> **Nota SPA:** al desplegar, configura una regla de *rewrite* para que todas las rutas apunten a `index.html` (necesario para React Router). En Vercel y Netlify esto suele ser automatico.

## Estructura del proyecto

```
cesar-ruiz-pos/
├── public/                  Iconos PWA y favicon
├── supabase/
│   └── schema.sql           Esquema completo de base de datos
├── src/
│   ├── components/          UI, layout, POS, inventario
│   ├── context/             AuthContext (sesion + rol)
│   ├── hooks/               Productos, carrito, ventas realtime, lector
│   ├── lib/                 Cliente de Supabase
│   ├── pages/               Dashboard, POS, Inventario, Ventas, Login
│   ├── types/               Tipos del dominio
│   └── utils/               Formato de soles y fechas
├── .env.example
└── package.json
```

## Uso del lector fisico

El lector de codigo de barras USB funciona como un teclado: basta con enfocar la pantalla de venta y escanear. El sistema detecta automaticamente la lectura rapida (no necesitas hacer clic en ningun campo). Si el producto existe, se agrega al carrito; si no, muestra un aviso.

## Seguridad

- Las politicas **RLS** restringen la escritura de productos y categorias solo a administradores.
- Las ventas se registran mediante una funcion atomica (`registrar_venta`) que descuenta stock y genera el kardex en una sola transaccion.
- La anulacion de ventas (`anular_venta`) esta limitada a administradores y repone el stock automaticamente.

---

Desarrollado para Bodega Cesar Ruiz · Lima, Peru.
