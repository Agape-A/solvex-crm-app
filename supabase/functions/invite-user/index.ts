// Solvex CRM — invito nuovi utenti dalla pagina "Utenti" (richiesta di
// Andrea, ott 2026: "dobbiamo inserire tutti gli utenti e le policy").
// Prima, creare un account richiedeva aprire Supabase e usare
// Authentication → Users → Invite a mano; questa funzione fa lo stesso
// invito (via Admin API, che richiede la service role key e per questo non
// può girare nel browser) direttamente dal pulsante "Invita" della pagina,
// e imposta subito ruolo e reparto giusti sul profilo — non più
// "Operatore" di default da correggere dopo.
//
// A differenza di "push-send" (invocata dal database via pg_net), questa è
// chiamata dal browser con la sessione di chi è loggato: qui la verifica
// JWT di Supabase resta ATTIVA (il contrario di push-send — NON disattivare
// "Verify JWT" per questa funzione). Quel controllo verifica solo che chi
// chiama sia loggato; dentro, controlliamo anche che sia dirigente o
// amministrazione, altrimenti un qualsiasi utente loggato (es. un
// operatore) potrebbe invitare altri con qualsiasi ruolo.
//
// Da creare nel pannello Supabase (Edge Functions → "Via Editor", nome
// "invite-user") — vedi README, sezione "Gestione utenti". Nessun segreto
// da impostare: usa solo le variabili che Supabase fornisce già a ogni
// funzione (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).

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

interface InvitePayload {
  email?: string
  full_name?: string
  role?: string
  department?: string | null
  redirect_to?: string
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

  // Client con la service role: bypassa la RLS, usato solo per le due cose
  // che un utente normale non può fare da browser — leggere il ruolo vero
  // del chiamante in modo affidabile, e invitare un nuovo utente.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', callerData.user.id).single()

  if (!callerProfile || !['dirigente', 'amministrazione'].includes(callerProfile.role)) {
    return jsonResponse({ error: 'Solo la direzione può invitare nuovi utenti.' }, 403)
  }

  let payload: InvitePayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Richiesta non valida.' }, 400)
  }

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
    // Messaggio più chiaro del testo tecnico di Supabase per il caso più
    // comune: la persona ha già un account.
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
})
