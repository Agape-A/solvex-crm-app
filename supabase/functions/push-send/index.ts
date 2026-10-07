// Solvex CRM — invio notifiche push (Web Push), richiesta di Andrea ott
// 2026: "è possibile ora far inviare notifiche come app e far apparire una
// notifica stile whatsapp". Riceve { profile_ids, title, body, url } da un
// trigger del database (vedi supabase/migrations/0045_notifiche_push.sql)
// o dal controllo giornaliero delle scadenze lead, e manda una vera
// notifica push a ogni dispositivo iscritto di quei profili. Le iscrizioni
// "morte" (telefono disinstallato, permesso tolto) vengono rimosse da sole
// quando il servizio push risponde 404/410.
//
// Da creare/aggiornare a mano nel pannello Supabase (Edge Functions → questa
// funzione si chiama "push-send") — vedi README, sezione "Notifiche push",
// per le istruzioni passo passo e i segreti da impostare.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:andrea@example.com'
const PUSH_DISPATCH_SECRET = Deno.env.get('PUSH_DISPATCH_SECRET')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

interface PushPayload {
  profile_ids?: string[]
  title?: string
  body?: string
  url?: string
}

Deno.serve(async (req) => {
  // Protegge la funzione: solo il database di Solvex (via pg_net, con
  // l'intestazione segreta impostata in app_config) può invocarla — vedi
  // la migrazione 0045. Senza questo controllo chiunque trovasse l'URL
  // potrebbe far comparire notifiche a caso sui telefoni dell'azienda.
  if (req.headers.get('x-push-secret') !== PUSH_DISPATCH_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }

  let payload: PushPayload
  try {
    payload = await req.json()
  } catch {
    return new Response('bad request', { status: 400 })
  }

  const profileIds = payload.profile_ids ?? []
  const title = payload.title ?? 'Solvex CRM'
  const body = payload.body ?? ''
  const url = payload.url ?? '/'

  if (profileIds.length === 0) {
    return new Response('ok', { status: 200 })
  }

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, profile_id, endpoint, p256dh, auth_key')
    .in('profile_id', profileIds)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  // Numero sul pallino rosso dell'icona (richiesta di Andrea, ott 2026):
  // calcolato per ogni destinatario, non uno uguale per tutti — due persone
  // possono avere un numero di non letti diverso nello stesso istante. Una
  // query sola per profilo distinto, anche se più dispositivi condividono
  // lo stesso profilo (telefono + Mac), per non ripeterla inutilmente.
  const distinctProfileIds = [...new Set((subs ?? []).map((s) => s.profile_id))]
  const badgeByProfile = new Map<string, number>()
  await Promise.all(
    distinctProfileIds.map(async (profileId) => {
      const { data: count, error: badgeError } = await supabase.rpc('total_unread_count', {
        p_profile_id: profileId,
      })
      badgeByProfile.set(profileId, badgeError ? 0 : (count as number) ?? 0)
    }),
  )

  await Promise.all(
    (subs ?? []).map(async (sub) => {
      try {
        const badge = badgeByProfile.get(sub.profile_id) ?? 0
        const payloadStr = JSON.stringify({ title, body, url, badge })
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payloadStr,
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          // Iscrizione non più valida (dispositivo disinstallato, permesso
          // tolto): la rimuoviamo, altrimenti ogni invio futuro ripeterebbe
          // lo stesso errore per sempre.
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          console.error('Invio push fallito per', sub.id, err)
        }
      }
    }),
  )

  return new Response('ok', { status: 200 })
})
