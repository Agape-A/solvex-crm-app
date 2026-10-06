import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// PWA (richiesta di Andrea, ott 2026): registra il service worker solo in
// produzione, per non interferire con l'hot-reload di Vite in sviluppo.
// Il service worker (public/sw.js) non mette nulla in cache — serve solo a
// rendere l'app installabile su telefono (vedi il suo stesso commento).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Registrazione service worker fallita', err)
    })
  })
}
