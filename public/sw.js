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

// ============ Notifiche push (richiesta di Andrea, ott 2026) ============
// Qui sì che il service worker fa qualcosa: riceve l'evento "push" dal
// sistema operativo (anche ad app chiusa) e mostra la notifica di sistema,
// stile WhatsApp. Il contenuto arriva dalla Edge Function "push-send" (vedi
// supabase/migrations/0045_notifiche_push.sql e README).

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Solvex CRM', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Solvex CRM'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Numero sul pallino rosso dell'icona dell'app, stile iPhone
      // (richiesta di Andrea, ott 2026). "badge" qui nel payload è il totale
      // dei non letti calcolato dalla Edge Function al momento dell'invio
      // (vedi supabase/functions/push-send), non l'icona monocromatica di
      // sopra (quella è un'altra cosa, built-in della Notification stessa).
      'setAppBadge' in self.navigator
        ? self.navigator.setAppBadge(data.badge || 0).catch(() => {})
        : Promise.resolve(),
    ])
  )
})

// Toccando la notifica si apre (o si porta avanti) l'app, sulla pagina
// giusta per quell'evento (es. /chat per un messaggio, /richieste per una
// nuova richiesta).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    })
  )
})
