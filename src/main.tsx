import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// La app es una PWA instalable: tras cada despliegue, el navegador puede
// intentar cargar un chunk JS con un nombre (hash) que ya no existe en el
// servidor porque quedó en caché de una version anterior. Vite emite este
// evento en ese caso; sin manejarlo, la pantalla queda en blanco sin ningún
// aviso. Recargamos una sola vez para traer la version nueva.
window.addEventListener('vite:preloadError', () => {
  const yaRecargo = sessionStorage.getItem('recarga-por-version-nueva')
  if (!yaRecargo) {
    sessionStorage.setItem('recarga-por-version-nueva', '1')
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
