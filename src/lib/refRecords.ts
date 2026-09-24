import { supabase } from './supabaseClient'
import type { ProcurementActivityDetails, UserRole } from './types'

// Collega una Richiesta a un record di un altro modulo (trattativa, cliente,
// progetto, ricerca, fornitore, richiesta d'acquisto) — stesso principio già
// usato per commenti e tag: un riferimento generico "tabella + id" invece di
// una colonna dedicata per ciascun modulo, così l'elenco resta facile da
// estendere quando arriva un nuovo modulo.
export type RequestRefTable =
  | 'deals'
  | 'clients'
  | 'research_records'
  | 'suppliers'
  | 'purchase_requests'
  | 'procurement_activities'

export const REQUEST_REF_LABELS: Record<RequestRefTable, string> = {
  deals: 'Trattativa (lead / pipeline)',
  clients: 'Cliente',
  research_records: 'Scheda di ricerca',
  suppliers: 'Fornitore',
  purchase_requests: "Richiesta d'acquisto",
  procurement_activities: 'Attività Acquisti (visita / reclamo / riunione)',
}

export const REQUEST_REF_TABLES: RequestRefTable[] = [
  'deals',
  'clients',
  'research_records',
  'suppliers',
  'purchase_requests',
  'procurement_activities',
]

// Quali ruoli hanno effettivamente accesso al modulo — usato per non mostrare
// nel selettore un tipo di record che risulterebbe comunque vuoto per chi sta
// scrivendo (la RLS del database lo impedirebbe comunque, questo è solo per
// non confondere in interfaccia).
export const REQUEST_REF_ROLES: Record<RequestRefTable, UserRole[]> = {
  deals: ['tecnico', 'commerciale', 'dirigente', 'amministrazione'],
  clients: ['tecnico', 'commerciale', 'dirigente', 'amministrazione'],
  research_records: ['dottore_laboratorio', 'dirigente', 'amministrazione'],
  suppliers: ['ufficio_acquisti', 'dirigente', 'amministrazione'],
  purchase_requests: ['ufficio_acquisti', 'dirigente', 'amministrazione'],
  procurement_activities: ['ufficio_acquisti', 'dirigente', 'amministrazione'],
}

export function refLinkPath(refTable: string, refId: string): string {
  switch (refTable as RequestRefTable) {
    case 'deals':
      return `/pipeline?deal=${refId}`
    case 'clients':
      return `/clienti?cliente=${refId}`
    case 'research_records':
      return `/ricerche?id=${refId}`
    case 'suppliers':
      return `/fornitori?fornitore=${refId}`
    case 'purchase_requests':
      return `/acquisti?richiesta=${refId}`
    case 'procurement_activities':
      return `/acquisti`
    default:
      return '#'
  }
}

export interface RefOption {
  id: string
  label: string
}

// Elenco dei record disponibili per un tipo, per riempire il menu a tendina
// di selezione — limitato alle righe più recenti dove il modulo può crescere
// molto (trattative, richieste d'acquisto), per non appesantire il caricamento.
export async function fetchRefOptions(table: RequestRefTable): Promise<RefOption[]> {
  switch (table) {
    case 'deals': {
      const { data } = await supabase
        .from('deals')
        .select('id, client_name, product')
        .order('created_at', { ascending: false })
        .limit(200)
      return ((data as { id: string; client_name: string; product: string }[]) ?? []).map((d) => ({
        id: d.id,
        label: `${d.client_name} — ${d.product}`,
      }))
    }
    case 'clients': {
      const { data } = await supabase.from('clients').select('id, name').order('name')
      return ((data as { id: string; name: string }[]) ?? []).map((c) => ({ id: c.id, label: c.name }))
    }
    case 'research_records': {
      const { data } = await supabase.from('research_records').select('id, title').order('title')
      return ((data as { id: string; title: string }[]) ?? []).map((r) => ({ id: r.id, label: r.title }))
    }
    case 'suppliers': {
      const { data } = await supabase.from('suppliers').select('id, name').order('name')
      return ((data as { id: string; name: string }[]) ?? []).map((s) => ({ id: s.id, label: s.name }))
    }
    case 'purchase_requests': {
      const { data } = await supabase
        .from('purchase_requests')
        .select('id, subject')
        .order('created_at', { ascending: false })
        .limit(200)
      return ((data as { id: string; subject: string }[]) ?? []).map((p) => ({ id: p.id, label: p.subject }))
    }
    case 'procurement_activities': {
      const { data } = await supabase
        .from('procurement_activities')
        .select('id, activity_details, suppliers(name), clients(name)')
        .order('created_at', { ascending: false })
        .limit(200)
      return (
        (data as unknown as {
          id: string
          activity_details: ProcurementActivityDetails
          suppliers: { name: string } | null
          clients: { name: string } | null
        }[]) ?? []
      ).map((a) => ({
        id: a.id,
        label: `${a.activity_details?.tag ?? 'Attività'} — ${a.suppliers?.name ?? a.clients?.name ?? '—'}`,
      }))
    }
    default:
      return []
  }
}

// Risolve l'etichetta di UN solo record — usato per mostrare il link nel
// dettaglio di una richiesta già creata. Su queste tabelle (anagrafiche
// aziendali, non migliaia di righe) recuperare l'elenco intero e filtrare è
// più semplice che scrivere una query dedicata per ogni tabella.
export async function describeRef(table: string, id: string): Promise<string | null> {
  if (!REQUEST_REF_TABLES.includes(table as RequestRefTable)) return null
  const options = await fetchRefOptions(table as RequestRefTable)
  return options.find((o) => o.id === id)?.label ?? null
}
