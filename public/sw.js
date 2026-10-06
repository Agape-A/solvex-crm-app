// Service worker minimale per Solvex CRM (richiesta di Andrea, ott 2026:
// "pensiamo anche ad avere un'app mobile" — versione PWA installabile dal
// browser, senza passare dagli store). Deliberatamente SENZA cache: questo
// CRM cambia spesso (più deploy al giorno durante lo sviluppo) e tutti i
// dati passano sempre da Supabase via rete. Mettere in cache pagine o script
// vecchi ricreerebbe esattamente il problema già avuto una volta con un
// deploy non aggiornato — qui serve solo a soddisfare il requisito "ha un
// service worker" che rende l'app installabile su telefono; ogni richiesta
// continua ad andare sempre alla rete, come se il service worker non ci
// fosse.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // Nessun intercept: nessuna risposta dalla cache, nessun event.respondWith.
})
