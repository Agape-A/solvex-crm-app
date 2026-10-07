// Solvex CRM — gestione utenti dalla pagina "Utenti": invito, sospensione,
// riattivazione ed eliminazione (richiesta di Andrea, ott 2026: prima solo
// l'invito — "dobbiamo inserire tutti gli utenti e le policy" — poi anche
// "darmi la possibilità... di eliminare un user o sospendere"). Tutte e
// quattro le azioni richiedono privilegi (service role / Admin API) che il
// CRM non può avere lato browser, per questo passano da qui.
//
// Chiamata dal browser con la sessione di chi è loggato: la verifica JWT
// di Supabase resta ATTIVA (il contrario di push-send — NON disattivarla
// per questa funzione). Quel controllo verifica solo che chi chiama sia
// loggato; dentro, controlliamo anche che sia dirigente o amministrazione,
// altrimenti un utente qualsiasi (es. un operatore) potrebbe invitare,
// sospendere o eliminare altri account.
//
// Da creare nel pannello Supabase (Edge Functions → "Via Editor", nome
// "manage-users") — vedi README, sezione "Gestione utenti". Nessun segreto
// da impostare: usa solo le variabili che Supabase fornisce già a ogni
// funzione (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).
//
// Se avevi già creato la funzione "invite-user" delle settimane scorse:
// questa la sostituisce (stesso scopo, più azioni) — vedi README per come
// aggiornarla nel pannello Supabase (si rinomina, non basta incollare).

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Tenuti allineati a mano con l'enum Postgres (user_role / request_department,
// vedi supabase/migrations) e con src/lib/types.ts — stesso approccio già
// usato nel resto del progetto per i tipi lato client.
const ALLOWED_ROLES = [
  'operatore',
  'tecnico',
  'commerciale',
  'dirigente',
  'dottore_laboratorio',
  'ufficio_acquisti',
  'amministrazione',
]
const ALLOWED_DEPARTMENTS = ['commerciale', 'tecnico', 'operativo', 'amministrazione', 'acquisti', 'ricerca']

// Tabelle che possono contenere lo storico di una persona (trattative,
// richieste, appuntamenti, commenti, attività...). Quasi tutte queste
// colonne non hanno "on delete cascade" verso profiles: se anche una sola
// riga referenzia ancora l'account, eliminarlo per sempre fallirebbe a
// metà con un errore del database poco comprensibile — qui lo
// controlliamo PRIMA e rispondiamo con un messaggio chiaro, suggerendo
// "Sospendi" invece (che non tocca nessuno storico).
const HISTORY_CHECKS: { table: string; column: string }[] = [
  { table: 'deals', column: 'owner_id' },
  { table: 'clients', column: 'owner_id' },
  { table: 'clients', column: 'tech_responsible_id' },
  { table: 'requests', column: 'assignee_id' },
  { table: 'appointments', column: 'assignee_id' },
  { table: 'activity_log', column: 'actor_id' },
  { table: 'record_comments', column: 'author_id' },
  { table: 'chat_messages', column: 'author_id' },
  { table: 'supplier_activities', column: 'created_by' },
  { table: 'procurement_activities', column: 'created_by' },
  { table: 'annual_targets', column: 'user_id' },
  { table: 'development_projects', column: 'owner_id' },
  { table: 'research_records', column: 'owner_id' },
  { table: 'purchase_requests', column: 'requested_by' },
]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface ActionPayload {
  action?: 'invite' | 'delete' | 'suspend' | 'reactivate'
  // invito
  email?: string
  full_name?: string
  role?: string
  department?: string | null
  redirect_to?: string
  // sospensione/riattivazione/eliminazione
  user_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return jsonResponse({ error: 'Non autenticato.' }, 401)
  }

  // Client "anon + token del chiamante": serve solo per scoprire CHI sta
  // chiamando (getUser verifica il token contro Supabase Auth).
  const callerClient = createClient(SUPABASE_URL, ANON_KEY)
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token)
  if (callerError || !callerData?.user) {
    return jsonResponse({ error: 'Sessione non valida, prova a ricaricare la pagina.' }, 401)
  }

  // Client con la service role: bypassa la RLS, usato solo per le cose che
  // un utente normale non può fare da browser — leggere il ruolo vero del
  // chiamante in modo affidabile, e invitare/sospendere/eliminare.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', callerData.user.id).single()

  if (!callerProfile || !['dirigente', 'amministrazione'].includes(callerProfile.role)) {
    return jsonResponse({ error: 'Solo la direzione può gestire gli utenti.' }, 403)
  }

  let payload: ActionPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Richiesta non valida.' }, 400)
  }

  const action = payload.action ?? 'invite'

  // ============ INVITO ============
  if (action === 'invite') {
    const email = payload.email?.trim().toLowerCase()
    const fullName = payload.full_name?.trim()
    const role = payload.role
    const department = payload.department || null

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: 'Email non valida.' }, 400)
    }
    if (!fullName) {
      return jsonResponse({ error: 'Il nome è obbligatorio.' }, 400)
    }
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return jsonResponse({ error: 'Ruolo non valido.' }, 400)
    }
    if (department && !ALLOWED_DEPARTMENTS.includes(department)) {
      return jsonResponse({ error: 'Reparto non valido.' }, 400)
    }

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: payload.redirect_to || undefined,
    })

    if (inviteError) {
      const already = /already.*registered|already.*exists/i.test(inviteError.message)
      return jsonResponse({ error: already ? 'Questa email ha già un account.' : inviteError.message }, already ? 409 : 500)
    }

    const newUserId = invited.user?.id
    if (newUserId) {
      // Il trigger handle_new_user() ha già creato il profilo con ruolo
      // "operatore" di default (vedi 0028_gestione_utenti.sql): qui lo
      // sistemiamo subito con quello scelto nel form.
      await admin.from('profiles').update({ full_name: fullName, role, department }).eq('id', newUserId)
    }

    return jsonResponse({ ok: true, user_id: newUserId })
  }

  // Le altre tre azioni agiscono tutte su un utente esistente.
  const userId = payload.user_id
  if (!userId) {
    return jsonResponse({ error: 'Utente mancante.' }, 400)
  }
  if (userId === callerData.user.id) {
    return jsonResponse({ error: 'Non puoi farlo sul tuo stesso account.' }, 400)
  }

  // ============ SOSPENDI / RIATTIVA ============
  if (action === 'suspend' || action === 'reactivate') {
    // "876000h" (100 anni) è la convenzione di Supabase per un ban senza
    // scadenza pratica; "none" rimuove il ban. Non cancella nulla: tutto lo
    // storico della persona (trattative, richieste, commenti…) resta.
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: action === 'suspend' ? '876000h' : 'none',
    })
    if (banError) {
      return jsonResponse({ error: banError.message }, 500)
    }
    await admin.from('profiles').update({ active: action === 'reactivate' }).eq('id', userId)
    return jsonResponse({ ok: true })
  }

  // ============ ELIMINA ============
  if (action === 'delete') {
    for (const { table, column } of HISTORY_CHECKS) {
      const { count, error: countError } = await admin.from(table).select('id', { count: 'exact', head: true }).eq(column, userId)
      if (!countError && (count ?? 0) > 0) {
        return jsonResponse(
          {
            error: `Questa persona ha ancora dati collegati (${table}): eliminarla per sempre cancellerebbe anche quelli, o l'operazione fallirebbe a metà. Usa "Sospendi" invece — blocca l'accesso senza toccare lo storico.`,
          },
          409,
        )
      }
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 500)
    }
    // Il profilo viene rimosso da solo: profiles.id ha "on delete cascade"
    // verso auth.users(id) (vedi 0001_schema.sql).
    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'Azione non valida.' }, 400)
})
