import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerAppServiceWorker } from './utils/pwa.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD) {
  window.addEventListener(
    'load',
    () => {
      registerAppServiceWorker(window.navigator).catch((error) => {
        console.error('[pwa] service worker registration failed', error)
      })
    },
    { once: true },
  )
}
