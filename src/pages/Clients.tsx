import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CommentThread } from '../components/CommentThread'
import {
  APPOINTMENT_TYPE_LABELS,
  CLIENT_TYPE_LABELS,
  DEAL_STAGES,
  type Appointment,
  type Client,
  type ClientType,
  type Deal,
  type MarketingContact,
  type Request,
} from '../lib/types'

const TYPE_FILTERS: (ClientType | 'tutti')[] = ['tutti', 'conceria', 'distributore', 'azienda_chimica']
const CAN_WRITE: string[] = ['commerciale', 'dirigente']
const currency = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function Clients() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [filter, setFilter] = useState<ClientType | 'tutti'>('tutti')
  const [selected, setSelected] = useState<Client | null>(null)
  const [selectedDeals, setSelectedDeals] = useState<Deal[]>([])
  const [selectedRequests, setSelectedRequests] = useState<Request[]>([])
  const [selectedAppointments, setSelectedAppointments] = useState<Appointment[]>([])
  const [selectedContact, setSelectedContact] = useState<MarketingContact | null>(null)
  const [dealsLoading, setDealsLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const canWrite = profile ? CAN_WRITE.includes(profile.role) : false
  const canSeeDeals = profile ? ['tecnico', 'commerciale', 'dirigente'].includes(profile.role) : false

  async function loadClients() {
    setLoading(true)
    const { data, error } = await supabase.from('clients').select('*').order('name')
    if (error) console.error(error)
    const rows = (data as Client[]) ?? []
    setClients(rows)
    // Se il cliente selezionato è ancora nell'elenco, aggiorna i suoi dati
    // (utile dopo una modifica); altrimenti chiudi il pannello di dettaglio.
    setSelected((current) => (current ? rows.find((r) => r.id === current.id) ?? null : null))
    setLoading(false)
  }

  async function loadLinkedRecords(client: Client) {
    if (!canSeeDeals) return
    setDealsLoading(true)
    // Le trattative hanno un vero collegamento (client_id) da sempre; da
    // 0010_integrazione.sql anche richieste e appuntamenti — i record creati
    // prima sono stati recuperati via backfill sul nome, quelli più vecchi o
    // con nome diverso restano intercettati dal confronto testuale qui sotto.
    const [dealsById, dealsByName, reqById, reqByName, apptById, apptByName, contactRes] = await Promise.all([
      supabase.from('deals').select('*').eq('client_id', client.id),
      supabase.from('deals').select('*').eq('client_name', client.name),
      supabase.from('requests').select('*').eq('client_id', client.id),
      supabase.from('requests').select('*').eq('sender', client.name),
      supabase.from('appointments').select('*').eq('client_id', client.id),
      supabase.from('appointments').select('*').eq('client_name', client.name),
      supabase.from('marketing_contacts').select('*').eq('client_id', client.id).limit(1).maybeSingle(),
    ])
    const mergedDeals = new Map<string, Deal>()
    for (const row of [...((dealsById.data as Deal[]) ?? []), ...((dealsByName.data as Deal[]) ?? [])]) {
      mergedDeals.set(row.id, row)
    }
    const mergedRequests = new Map<string, Request>()
    for (const row of [...((reqById.data as Request[]) ?? []), ...((reqByName.data as Request[]) ?? [])]) {
      mergedRequests.set(row.id, row)
    }
    const mergedAppointments = new Map<string, Appointment>()
    for (const row of [...((apptById.data as Appointment[]) ?? []), ...((apptByName.data as Appointment[]) ?? [])]) {
      mergedAppointments.set(row.id, row)
    }
    setSelectedDeals(Array.from(mergedDeals.values()))
    setSelectedRequests(Array.from(mergedRequests.values()))
    setSelectedAppointments(Array.from(mergedAppointments.values()))
    setSelectedContact((contactRes.data as MarketingContact | null) ?? null)
    setDealsLoading(false)
  }

  useEffect(() => {
    loadClients()
  }, [])

  // Un link "da fuori" (ricerca globale nella sidebar, o un rimando da
  // un'altra scheda come Richieste) può indicare quale cliente aprire: si
  // applica ogni volta che l'URL lo porta, anche restando su questa pagina,
  // non solo al primo caricamento.
  useEffect(() => {
    const fromLink = searchParams.get('cliente')
    if (!fromLink) return
    const client = clients.find((c) => c.id === fromLink)
    if (client) setSelected(client)
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, clients])

  useEffect(() => {
    if (selected) {
      loadLinkedRecords(selected)
    } else {
      setSelectedDeals([])
      setSelectedRequests([])
      setSelectedAppointments([])
      setSelectedContact(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  async function updateClient(client: Client, patch: Partial<Client>) {
    const { error } = await supabase.from('clients').update(patch).eq('id', client.id)
    if (error) {
      alert('Non è stato possibile salvare la modifica: ' + error.message)
      return
    }
    setSelected((s) => (s && s.id === client.id ? { ...s, ...patch } : s))
    setClients((cs) => cs.map((c) => (c.id === client.id ? { ...c, ...patch } : c)))
  }

  async function deleteClient(client: Client) {
    if (!window.confirm(`Eliminare definitivamente "${client.name}" dall'anagrafica? L'operazione non è reversibile.`)) {
      return
    }
    setDeleting(true)
    const { error } = await supabase.from('clients').delete().eq('id', client.id)
    setDeleting(false)
    if (error) {
      alert('Non è stato possibile eliminare il cliente: ' + error.message)
      return
    }
    setSelected(null)
    loadClients()
  }

  if (!profile) return null

  if (profile.role === 'operatore') {
    return (
      <div className="view">
        <h1>Clienti</h1>
        <p className="muted">Il ruolo operatore non ha accesso all'anagrafica clienti.</p>
      </div>
    )
  }

  const filtered = filter === 'tutti' ? clients : clients.filter((c) => c.client_type === filter)

  const counts: Record<ClientType | 'tutti', number> = {
    tutti: clients.length,
    conceria: clients.filter((c) => c.client_type === 'conceria').length,
    distributore: clients.filter((c) => c.client_type === 'distributore').length,
    azienda_chimica: clients.filter((c) => c.client_type === 'azienda_chimica').length,
  }

  return (
    <div className="view">
      <div className="view-head">
        <h1>Clienti</h1>
        {canWrite && (
          <div className="view-head-actions">
            <button
              className="btn btn-ghost"
              onClick={() => {
                setShowImport((v) => !v)
                setShowForm(false)
              }}
            >
              {showImport ? 'Annulla importazione' : 'Importa da Excel/CSV'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setShowForm((v) => !v)
                setShowImport(false)
              }}
            >
              {showForm ? 'Annulla' : '+ Nuovo cliente'}
            </button>
          </div>
        )}
      </div>

      <p className="muted">
        Concerie (vendita diretta), distributori/agenti (Italia ed estero) e aziende chimiche
        (private label) — tutti in un'unica anagrafica.
      </p>

      {showForm && <NewClientForm onCreated={() => { setShowForm(false); loadClients() }} />}
      {showImport && <ImportClientsPanel onImported={() => { setShowImport(false); loadClients() }} />}

      <div className="stage-btn-row client-filter-row">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            className={'stage-btn' + (filter === t ? ' current' : '')}
            onClick={() => setFilter(t)}
          >
            {t === 'tutti' ? 'Tutti' : CLIENT_TYPE_LABELS[t]} <span className="muted">· {counts[t]}</span>
          </button>
        ))}
      </div>

      {loading && <p className="muted">Caricamento…</p>}
      {!loading && filtered.length === 0 && <p className="muted">Nessun cliente in questa categoria.</p>}

      <div className="req-layout">
        <div className="card client-list">
          {filtered.map((c) => (
            <div
              className={'client-row client-row-clickable' + (selected?.id === c.id ? ' selected' : '')}
              key={c.id}
              onClick={() => setSelected(c)}
            >
              <div className="client-row-main">
                <strong>{c.name}</strong>
                <span className="muted">{c.sector || '—'}</span>
                {(c.contact_name || c.contact_email || c.contact_phone) && (
                  <span className="muted client-contact">
                    {[c.contact_name, c.contact_email, c.contact_phone].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <span className={'pill client-type-' + c.client_type}>{CLIENT_TYPE_LABELS[c.client_type]}</span>
              <span className="muted client-country">{c.country}</span>
            </div>
          ))}
        </div>

        <div className="card detail-panel">
          {!selected && <p className="muted">Seleziona un cliente dall'elenco per vedere il dettaglio.</p>}
          {selected && (
            <ClientDetail
              client={selected}
              canWrite={canWrite}
              canSeeDeals={canSeeDeals}
              deals={selectedDeals}
              requests={selectedRequests}
              appointments={selectedAppointments}
              contact={selectedContact}
              dealsLoading={dealsLoading}
              deleting={deleting}
              onChange={(patch) => updateClient(selected, patch)}
              onDelete={() => deleteClient(selected)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

type TimelineKind = 'trattativa' | 'richiesta' | 'appuntamento'

interface TimelineItem {
  id: string
  date: Date
  kind: TimelineKind
  title: string
  sub: string
  badge: string
  badgeClass: string
}

const TIMELINE_LABEL: Record<TimelineKind, string> = {
  trattativa: 'Trattativa',
  richiesta: 'Richiesta',
  appuntamento: 'Appuntamento',
}

function buildTimeline(deals: Deal[], requests: Request[], appointments: Appointment[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...deals.map((d) => ({
      id: 'deal-' + d.id,
      date: new Date(d.created_at),
      kind: 'trattativa' as TimelineKind,
      title: d.product,
      sub: currency.format(d.value_estimate),
      badge: DEAL_STAGES.find((s) => s.id === d.stage)?.label ?? d.stage,
      badgeClass: 'client-deal-stage',
    })),
    ...requests.map((r) => ({
      id: 'req-' + r.id,
      date: new Date(r.created_at),
      kind: 'richiesta' as TimelineKind,
      title: r.subject,
      sub: r.department,
      badge: r.status,
      badgeClass: 'pill-' + r.status,
    })),
    ...appointments.map((a) => ({
      id: 'appt-' + a.id,
      date: new Date(a.appointment_at),
      kind: 'appuntamento' as TimelineKind,
      title: a.subject,
      sub: new Date(a.appointment_at).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }),
      badge: APPOINTMENT_TYPE_LABELS[a.type],
      badgeClass: 'client-deal-stage',
    })),
  ]
  return items.sort((a, b) => b.date.getTime() - a.date.getTime())
}

function ClientDetail({
  client,
  canWrite,
  canSeeDeals,
  deals,
  requests,
  appointments,
  contact,
  dealsLoading,
  deleting,
  onChange,
  onDelete,
}: {
  client: Client
  canWrite: boolean
  canSeeDeals: boolean
  deals: Deal[]
  requests: Request[]
  appointments: Appointment[]
  contact: MarketingContact | null
  dealsLoading: boolean
  deleting: boolean
  onChange: (patch: Partial<Client>) => void
  onDelete: () => void
}) {
  // Campi testuali: valore locale + salvataggio su blur (come nelle note
  // della pipeline), così non si scrive ad ogni singola lettera digitata.
  const [name, setName] = useState(client.name)
  const [sector, setSector] = useState(client.sector ?? '')
  const [country, setCountry] = useState(client.country)
  const [contactName, setContactName] = useState(client.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(client.contact_email ?? '')
  const [contactPhone, setContactPhone] = useState(client.contact_phone ?? '')

  useEffect(() => {
    setName(client.name)
    setSector(client.sector ?? '')
    setCountry(client.country)
    setContactName(client.contact_name ?? '')
    setContactEmail(client.contact_email ?? '')
    setContactPhone(client.contact_phone ?? '')
  }, [client.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dealTotal = deals.reduce((sum, d) => sum + Number(d.value_estimate), 0)
  // "Nessun record collegato" = né trattative, né richieste, né appuntamenti
  // risultano collegati (per id o, sui dati più vecchi, per nome) — solo
  // allora è sicuro eliminarlo.
  const linkedTotal = deals.length + requests.length + appointments.length
  const canDelete = canWrite && !dealsLoading && linkedTotal === 0
  const timeline = buildTimeline(deals, requests, appointments)

  return (
    <>
      <div className="eyebrow">
        {CLIENT_TYPE_LABELS[client.client_type]} · {client.country}
      </div>
      {canWrite ? (
        <input
          className="client-detail-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== client.name && onChange({ name: name.trim() })}
        />
      ) : (
        <h3>{client.name}</h3>
      )}

      {canWrite ? (
        <div className="field-row-2">
          <div className="field-row">
            <label className="field-label">Tipo cliente</label>
            <select
              value={client.client_type}
              onChange={(e) => onChange({ client_type: e.target.value as ClientType })}
            >
              {(['conceria', 'distributore', 'azienda_chimica'] as ClientType[]).map((t) => (
                <option key={t} value={t}>
                  {CLIENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Paese</label>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              onBlur={() => country.trim() && country !== client.country && onChange({ country: country.trim() })}
            />
          </div>
        </div>
      ) : null}

      {canWrite ? (
        <div className="field-row">
          <label className="field-label">Settore</label>
          <input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            onBlur={() => sector !== (client.sector ?? '') && onChange({ sector: sector.trim() || null })}
          />
        </div>
      ) : (
        <p className="muted">{client.sector || '—'}</p>
      )}

      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Referente</label>
          {canWrite ? (
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              onBlur={() =>
                contactName !== (client.contact_name ?? '') && onChange({ contact_name: contactName.trim() || null })
              }
            />
          ) : (
            <p className="muted">{client.contact_name || '—'}</p>
          )}
        </div>
        <div className="field-row">
          <label className="field-label">Email referente</label>
          {canWrite ? (
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              onBlur={() =>
                contactEmail !== (client.contact_email ?? '') &&
                onChange({ contact_email: contactEmail.trim() || null })
              }
            />
          ) : (
            <p className="muted">{client.contact_email || '—'}</p>
          )}
        </div>
      </div>
      <div className="field-row">
        <label className="field-label">Telefono referente</label>
        {canWrite ? (
          <input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            onBlur={() =>
              contactPhone !== (client.contact_phone ?? '') &&
              onChange({ contact_phone: contactPhone.trim() || null })
            }
          />
        ) : (
          <p className="muted">{client.contact_phone || '—'}</p>
        )}
      </div>

      {client.external_id && <p className="muted">Codice cliente ERP: {client.external_id}</p>}

      {contact && (
        <p className="muted">
          Iscritto al marketing:{' '}
          <span className={'pill ' + (contact.consent_marketing ? 'pill-risolta' : 'pill-nuova')}>
            {contact.consent_marketing ? 'Consenso attivo' : contact.unsubscribed_at ? 'Disiscritto' : 'Nessun consenso'}
          </span>
        </p>
      )}

      {canSeeDeals && (
        <>
          <div className="section-title client-deals-title">
            Cronologia cliente {deals.length > 0 && <span className="muted">· pipeline {currency.format(dealTotal)}</span>}
          </div>
          {dealsLoading && <p className="muted">Caricamento…</p>}
          {!dealsLoading && timeline.length === 0 && (
            <p className="muted">Nessuna trattativa, richiesta o appuntamento collegato a questo cliente.</p>
          )}
          {!dealsLoading && timeline.length > 0 && (
            <div className="client-deals-list">
              {timeline.map((item) => (
                <div className="client-deal-row" key={item.id}>
                  <span className="client-timeline-when muted">
                    {item.date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                  </span>
                  <span className="client-timeline-kind muted">{TIMELINE_LABEL[item.kind]}</span>
                  <span>{item.title}</span>
                  <span className={'pill ' + item.badgeClass}>{item.badge}</span>
                  <span className="muted">{item.sub}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <CommentThread refTable="clients" refId={client.id} refLabel={client.name} />

      {canWrite && (
        <div className="client-delete-row">
          {dealsLoading ? (
            <p className="muted">Verifica record collegati…</p>
          ) : canDelete ? (
            <button className="btn btn-ghost client-delete-btn" onClick={onDelete} disabled={deleting}>
              {deleting ? 'Eliminazione…' : 'Elimina cliente'}
            </button>
          ) : (
            <p className="muted">
              Non eliminabile: ha {linkedTotal} record collegati ({deals.length} trattative, {requests.length}{' '}
              richieste, {appointments.length} appuntamenti). Scollega o elimina prima quelli.
            </p>
          )}
        </div>
      )}
    </>
  )
}

function NewClientForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [sector, setSector] = useState('')
  const [clientType, setClientType] = useState<ClientType>('conceria')
  const [country, setCountry] = useState('Italia')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('clients').insert({
      name,
      sector: sector || null,
      client_type: clientType,
      country,
      contact_name: contactName || null,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
    })
    setSaving(false)
    if (error) {
      alert('Non è stato possibile creare il cliente: ' + error.message)
      return
    }
    onCreated()
  }

  return (
    <form className="card panel new-deal-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field-label">Ragione sociale</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Tipo cliente</label>
          <select value={clientType} onChange={(e) => setClientType(e.target.value as ClientType)}>
            {(['conceria', 'distributore', 'azienda_chimica'] as ClientType[]).map((t) => (
              <option key={t} value={t}>
                {CLIENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label">Paese</label>
          <input value={country} onChange={(e) => setCountry(e.target.value)} required />
        </div>
      </div>
      <div className="field-row">
        <label className="field-label">Settore (facoltativo)</label>
        <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="es. Concia, Distribuzione chimica…" />
      </div>
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Referente (facoltativo)</label>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome e cognome" />
        </div>
        <div className="field-row">
          <label className="field-label">Email referente (facoltativa)</label>
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <label className="field-label">Telefono referente (facoltativo)</label>
        <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Creazione…' : 'Crea cliente'}
      </button>
    </form>
  )
}

// ============ Importazione da Excel/CSV ============
// Legge il file interamente nel browser (libreria "xlsx"), lascia scegliere
// a chi importa quale colonna del file corrisponde a quale campo del CRM
// (i nomi delle colonne nell'export del gestionale quasi certamente non
// coincidono con i nostri), mostra un'anteprima e poi scrive i dati in
// Supabase. Se il file ha una colonna con un codice cliente univoco (mappata
// su "external_id"), le importazioni successive aggiornano le righe già
// esistenti invece di duplicarle.

type TargetField =
  | 'name'
  | 'sector'
  | 'clientType'
  | 'country'
  | 'externalId'
  | 'contactName'
  | 'contactEmail'
  | 'contactPhone'

type ColumnMap = Record<TargetField, string>

const EMPTY_MAP: ColumnMap = {
  name: '',
  sector: '',
  clientType: '',
  country: '',
  externalId: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
}

const FIELD_LABELS: Record<TargetField, string> = {
  name: 'Ragione sociale *',
  sector: 'Settore',
  clientType: 'Tipo cliente',
  country: 'Paese',
  externalId: 'Codice cliente ERP (per aggiornamenti futuri)',
  contactName: 'Referente',
  contactEmail: 'Email referente',
  contactPhone: 'Telefono referente',
}

interface ImportedRow {
  name: string
  sector: string | null
  client_type: ClientType
  country: string
  external_id: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
}

function guessClientType(raw: string | undefined, fallback: ClientType): ClientType {
  if (!raw) return fallback
  const v = raw.toLowerCase()
  if (v.includes('concer') || v.includes('tannery') || v.includes('tanner')) return 'conceria'
  if (v.includes('distrib') || v.includes('agent')) return 'distributore'
  if (v.includes('chimic') || v.includes('chemical')) return 'azienda_chimica'
  return fallback
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

async function insertInChunks(rows: ImportedRow[], chunkSize = 300) {
  let written = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    // upsert su external_id: righe con external_id nullo non generano mai un
    // conflitto (due NULL non sono mai "uguali" per un vincolo di unicità),
    // quindi funziona sia per la prima importazione sia per gli aggiornamenti.
    const { error } = await supabase.from('clients').upsert(chunk, { onConflict: 'external_id' })
    if (error) throw error
    written += chunk.length
  }
  return written
}

function ImportClientsPanel({ onImported }: { onImported: () => void }) {
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([])
  const [map, setMap] = useState<ColumnMap>(EMPTY_MAP)
  const [defaultClientType, setDefaultClientType] = useState<ClientType>('conceria')
  const [defaultCountry, setDefaultCountry] = useState('Italia')
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [parseError, setParseError] = useState('')

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    setParsing(true)
    setFileName(file.name)
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[firstSheetName]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (rows.length === 0) {
        setParseError('Il file sembra vuoto (nessuna riga sotto l\'intestazione).')
        setHeaders([])
        setRawRows([])
      } else {
        const detectedHeaders = Object.keys(rows[0])
        setHeaders(detectedHeaders)
        setRawRows(rows)
        // Tentativo automatico di riconoscere le colonne più comuni, tanto per
        // partire — resta comunque tutto modificabile prima di importare.
        const auto: ColumnMap = { ...EMPTY_MAP }
        for (const h of detectedHeaders) {
          const low = h.toLowerCase()
          if (!auto.name && /(ragione sociale|denominazione|nome cliente|azienda|company)/.test(low)) auto.name = h
          if (!auto.sector && /(settore|sector)/.test(low)) auto.sector = h
          if (!auto.clientType && /(tipo|categoria|type)/.test(low)) auto.clientType = h
          if (!auto.country && /(paese|country|nazione)/.test(low)) auto.country = h
          if (!auto.externalId && /(codice|cod\.?\s*cliente|id erp|customer id)/.test(low)) auto.externalId = h
          if (!auto.contactName && /(referente|contatto|contact)/.test(low)) auto.contactName = h
          if (!auto.contactEmail && /(email|e-mail|mail)/.test(low)) auto.contactEmail = h
          if (!auto.contactPhone && /(telefono|tel\.?|phone|cellulare)/.test(low)) auto.contactPhone = h
        }
        setMap(auto)
      }
    } catch (err) {
      setParseError(
        'Non riesco a leggere questo file. Controlla che sia un vero file Excel (.xlsx) o CSV esportato dal gestionale. Dettaglio: ' +
          (err instanceof Error ? err.message : String(err))
      )
      setHeaders([])
      setRawRows([])
    }
    setParsing(false)
  }

  function mapRow(row: Record<string, unknown>): ImportedRow | null {
    const name = map.name ? cellToText(row[map.name]) : ''
    if (!name) return null
    return {
      name,
      sector: map.sector ? cellToText(row[map.sector]) || null : null,
      client_type: map.clientType
        ? guessClientType(cellToText(row[map.clientType]), defaultClientType)
        : defaultClientType,
      country: map.country ? cellToText(row[map.country]) || defaultCountry : defaultCountry,
      external_id: map.externalId ? cellToText(row[map.externalId]) || null : null,
      contact_name: map.contactName ? cellToText(row[map.contactName]) || null : null,
      contact_email: map.contactEmail ? cellToText(row[map.contactEmail]) || null : null,
      contact_phone: map.contactPhone ? cellToText(row[map.contactPhone]) || null : null,
    }
  }

  const mappedRows = rawRows.map(mapRow)
  const validRows = mappedRows.filter((r): r is ImportedRow => r !== null)
  const skippedCount = mappedRows.length - validRows.length

  async function handleImport() {
    if (validRows.length === 0) return
    setImporting(true)
    try {
      const written = await insertInChunks(validRows)
      alert(
        `Importazione completata: ${written} clienti scritti` +
          (skippedCount > 0 ? ` (${skippedCount} righe saltate perché senza ragione sociale).` : '.')
      )
      onImported()
    } catch (err) {
      alert(
        'Importazione interrotta per un errore: ' +
          (err instanceof Error ? err.message : String(err)) +
          '. Nessuna riga oltre quelle già scritte è stata importata: puoi correggere il file e riprovare, le righe già importate verranno aggiornate invece che duplicate solo se hai mappato un codice cliente ERP.'
      )
    }
    setImporting(false)
  }

  return (
    <div className="card panel import-panel">
      <div className="section-title">Importa clienti da Excel/CSV</div>
      <p className="muted">
        Carica l'export dell'anagrafica dal tuo gestionale, poi indica quale colonna del file
        corrisponde a ciascun campo del CRM. Se il file ha un codice cliente univoco, mappalo su
        "Codice cliente ERP": le prossime importazioni aggiorneranno gli stessi clienti invece di
        duplicarli.
      </p>

      <div className="field-row">
        <label className="field-label">File (.xlsx o .csv)</label>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
        {fileName && <span className="muted">{fileName}</span>}
      </div>

      {parsing && <p className="muted">Lettura del file…</p>}
      {parseError && <p className="notice-error">{parseError}</p>}

      {headers.length > 0 && (
        <>
          <div className="import-map-grid">
            {(Object.keys(FIELD_LABELS) as TargetField[]).map((field) => (
              <div className="field-row" key={field}>
                <label className="field-label">{FIELD_LABELS[field]}</label>
                <select
                  value={map[field]}
                  onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value }))}
                >
                  <option value="">— non mappato —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Tipo cliente di default (se non mappato o riga vuota)</label>
              <select value={defaultClientType} onChange={(e) => setDefaultClientType(e.target.value as ClientType)}>
                {(['conceria', 'distributore', 'azienda_chimica'] as ClientType[]).map((t) => (
                  <option key={t} value={t}>
                    {CLIENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label">Paese di default (se non mappato o riga vuota)</label>
              <input value={defaultCountry} onChange={(e) => setDefaultCountry(e.target.value)} />
            </div>
          </div>

          {!map.name && <p className="notice-error">Devi mappare almeno la Ragione sociale per poter importare.</p>}

          {map.name && (
            <>
              <p className="muted">
                Anteprima ({validRows.length} clienti pronti da importare
                {skippedCount > 0 ? `, ${skippedCount} righe saltate perché senza ragione sociale` : ''}) — prime 5:
              </p>
              <div className="import-preview">
                {validRows.slice(0, 5).map((r, i) => (
                  <div className="import-preview-row" key={i}>
                    <strong>{r.name}</strong>
                    <span className="muted">
                      {CLIENT_TYPE_LABELS[r.client_type]} · {r.country}
                      {r.sector ? ' · ' + r.sector : ''}
                      {r.contact_name ? ' · ' + r.contact_name : ''}
                    </span>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary" onClick={handleImport} disabled={importing || validRows.length === 0}>
                {importing ? 'Importazione…' : `Importa ${validRows.length} clienti`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
