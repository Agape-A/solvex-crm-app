import { supabase } from './supabaseClient'

// Raccoglie tutti i tag già usati nel CRM (trattative, richieste, clienti,
// contatti marketing) in un unico elenco, per suggerirli mentre si scrive —
// così i colleghi tendono a riusare lo stesso tag invece di crearne varianti
// leggermente diverse ("fiera 2026" vs "Fiera2026").
export async function fetchAllTags(): Promise<string[]> {
  // Include anche i moduli riservati a un ruolo (ricerca&sviluppo, acquisti):
  // per chi non ha accesso la RLS restituisce semplicemente un
  // elenco vuoto, nessun errore da gestire — stesso principio già visto per
  // "clients" con il ruolo operatore. Così i tag restano un vocabolario
  // condiviso tra tutti i reparti invece di essere isolati per modulo.
  const [deals, requests, clients, contacts, research, suppliers, purchaseRequests] = await Promise.all([
    supabase.from('deals').select('tags'),
    supabase.from('requests').select('tags'),
    supabase.from('clients').select('tags'),
    supabase.from('marketing_contacts').select('tags'),
    supabase.from('research_records').select('tags'),
    supabase.from('suppliers').select('tags'),
    supabase.from('purchase_requests').select('tags'),
  ])
  const set = new Set<string>()
  for (const res of [deals, requests, clients, contacts, research, suppliers, purchaseRequests]) {
    for (const row of (res.data as { tags: string[] | null }[]) ?? []) {
      for (const t of row.tags ?? []) set.add(t)
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}
