// Notifiche push stile WhatsApp (richiesta di Andrea, ott 2026: "è possibile
// ora far inviare notifiche come app e far apparire una notifica stile
// whatsapp"). Attivabile dal pulsante "Notifiche" nel menu laterale (vedi
// Layout.tsx). Il permesso va chiesto per forza da un clic dell'utente —
// Safari/iOS lo blocca se arriva da solo al caricamento della pagina — per
// questo non parte da sé dopo il login, serve il pulsante.
//
// Richiede che l'app sia installata (schermata Home su iPhone, Dock su Mac)
// e, su iPhone, iOS 16.4 o superiore: prima di allora Safari non supporta le
// notifiche push per le app aggiunte alla schermata Home.

import { supabase } from './supabaseClient'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export type PushStatus = 'unsupported' | 'denied' | 'inactive' | 'active'

export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const registration = await navigator.serviceWorker.ready
  const sub = await registration.pushManager.getSubscription()
  return sub ? 'active' : 'inactive'
}

// Il servizio push vuole la chiave VAPID come array di byte, non come
// stringa: conversione standard da base64url (vedi documentazione MDN
// "Push API").
function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  // Cast esplicito a BufferSource: alcune versioni di TypeScript sono più
  // severe sul tipo generico di Uint8Array rispetto a quanto richiesto da
  // PushSubscriptionOptionsInit.applicationServerKey (vedi lib.dom.d.ts).
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))) as BufferSource
}

export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) {
    return { ok: false, error: 'Le notifiche non sono supportate su questo dispositivo/browser.' }
  }
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, error: 'Configurazione mancante (VITE_VAPID_PUBLIC_KEY). Vedi README.' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, error: 'Permesso negato per le notifiche.' }
  }

  const registration = await navigator.serviceWorker.ready
  let sub = await registration.pushManager.getSubscription()
  if (!sub) {
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint as string,
    p_p256dh: json.keys?.p256dh as string,
    p_auth_key: json.keys?.auth as string,
    p_user_agent: navigator.userAgent,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  const registration = await navigator.serviceWorker.ready
  const sub = await registration.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint })
}
