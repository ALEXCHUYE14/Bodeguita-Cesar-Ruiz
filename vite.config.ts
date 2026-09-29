import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Cesar Ruiz - Gestion Comercial',
        short_name: 'CR POS',
        description: 'Sistema de punto de venta y gestion en tiempo real',
        theme_color: '#0a0a0a',
        background_color: '#fafaf9',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mp3}'],
        // Borra las caches de versiones anteriores al activar el nuevo
        // service worker, para que nunca sirva JS/CSS de un despliegue viejo.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1'),
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-api', networkTimeoutSeconds: 5 },
          },
          {
            // Fotos de producto (Supabase Storage, bucket publico). Se
            // suben con cacheControl de 1 año y la URL solo cambia cuando
            // se sube una foto nueva (ver useProductoImagen.ts) — seguro
            // servirlas siempre de cache sin ir a la red.
            urlPattern: ({ url }) => url.pathname.startsWith('/storage/v1/object/public'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-storage',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) return 'react'
            if (id.includes('recharts')) return 'charts'
            if (id.includes('html5-qrcode')) return 'scanner'
            if (id.includes('@supabase')) return 'supabase'
          }
        },
      },
    },
  },
})
