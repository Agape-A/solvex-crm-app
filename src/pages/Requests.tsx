import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CommentThread } from '../components/CommentThread'
import { ActivityAssignment } from '../components/ActivityAssignment'
import { RefPicker } from '../components/RefPicker'
import { IconChevronsLeft } from '../components/Icons'
import { describeRef, refLinkPath, REQUEST_REF_LABELS, REQUEST_REF_TABLES, type RequestRefTable } from '../lib/refRecords'
import { type Client, type PendingAssignment, type Profile, type Request, type RequestDepartment, type RequestPriority, type RequestStatus } from '../lib/types'

const STATUSES: RequestStatus[] = ['nuova', 'lavorazione', 'risolta']
const DEPARTMENTS: RequestDepartment[] = ['commerciale', 'tecnico', 'operativo', 'amministrazione', 'acquisti', 'ricerca']
const PRIORITIES: RequestPriority[] = ['alta', 'media', 'bassa']

// Allegato facoltativo su una richiesta (richiesta di Andrea, ott 2026):
// solo i 4 formati citati — immagine JPEG, Word, PDF o Excel — sia come
// estensione che come MIME type, per coprire anche i file senza estensione
// nel nome mostrato dal selettore del sistema.
const REQUEST_ATTACHMENT_ACCEPT =
  '.jpg,.jpeg,image/jpeg,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,application/pdf,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const REQUEST_ATTACHMENT_EXTENSIONS = ['.jpg', '.jpeg', '.doc', '.docx', '.pdf', '.xls', '.xlsx']

// Filtro per stato in testata, come una scheda separata per ciascuno stato:
// di default si vedono solo le "Nuove", così le richieste risolte non
// restano in mezzo alle altre facendo perdere di vista quelle da gestire.
// "Tutte" resta disponibile per una vista d'insieme o per cercare qualcosa
// di già risolto.
type StatusFilter = RequestStatus | 'tutte'
const STATUS_FILTERS: StatusFilter[] = ['nuova', 'lavorazione', 'risolta', 'tutte']
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  nuova: 'Nuove',
  lavorazione: 'In lavorazione',
  risolta: 'Risolte',
  tutte: 'Tutte',
}

// Filtri secondari per "tipo di richiesta" (richiesti da Andrea, set 2026):
// reparto, a cosa è collegata (o a niente) e interna/esterna — si
// combinano tra loro e con il filtro di stato qui sopra, così le "Nuove"
// possono essere ristrette solo a quelle, ad es., dell'ufficio acquisti.
type DepartmentFilter = RequestDepartment | 'tutti'
type RefTableFilter = RequestRefTable | 'nessuno' | 'tutti'
type TypeFilter = 'interna' | 'esterna' | 'tutti'

// "Ricevute" (richieste create da qualcun altro, per te o per il tuo
// reparto) vs "Inviate" (create da te) — richiesto da Andrea, ott 2026,
// per rendere più semplice la navigazione quando le richieste si
// accumulano. Le due schede si escludono a vicenda (ogni richiesta sta
// in una sola delle due), a differenza dei filtri di stato/reparto/tipo
// qui sopra che si combinano tra loro.
type InboxFilter = 'ricevute' | 'inviate'
const INBOX_FILTER_LABELS: Record<InboxFilter, string> = {
  ricevute: 'Ricevute',
  inviate: 'Inviate',
}

export function Requests() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [requests, setRequests] = useState<Request[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('ricevute')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('nuova')
  const [departmentFilter, setDepartmentFilter] = useState<DepartmentFilter>('tutti')
  const [refTableFilter, setRefTableFilter] = useState<RefTableFilter>('tutti')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('tutti')
  const [selected, setSelected] = useState<Request | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refLabel, setRefLabel] = useState<string | null>(null)

  function clientFor(request: Request) {
    return request.client_id ? clients.find((c) => c.id === request.client_id) ?? null : null
  }

  // Risolve l'etichetta del record collegato (trattativa, progetto...) solo
  // quando serve, invece di caricare in anticipo tutti i moduli — la stessa
  // richiesta può essere collegata a un tipo diverso ogni volta.
  useEffect(() => {
    setRefLabel(null)
    if (selected?.ref_table && selected.ref_id) {
      describeRef(selected.ref_table, selected.ref_id).then(setRefLabel)
    }
  }, [selected?.ref_table, selected?.ref_id])

  async function loadRequests() {
    setLoading(true)
    // Niente filtro applicativo qui: la RLS restituisce solo le righe che il
    // ruolo dell'utente può vedere (vedi supabase/migrations/0002_rls.sql).
    const { data, error } = await supabase.from('requests').select('*').order('created_at', { ascending: false })
    if (error) console.error(error)
    const rows = (data as Request[]) ?? []
    setRequests(rows)
    setSelected((current) => (current ? rows.find((r) => r.id === current.id) ?? rows[0] ?? null : rows[0] ?? null))
    setLoading(false)
  }

  async function loadProfiles() {
    // profiles_select_all: leggibile da chiunque sia autenticato, serve per
    // proporre a chi assegnare una richiesta.
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setProfiles((data as Profile[]) ?? [])
  }

  async function loadClients() {
    // Se il ruolo non ha accesso all'anagrafica (operatore), la RLS
    // restituisce semplicemente un elenco vuoto: nessun errore da gestire.
    const { data } = await supabase.from('clients').select('*').order('name')
    setClients((data as Client[]) ?? [])
  }

  useEffect(() => {
    loadRequests()
    loadProfiles()
    loadClients()
  }, [])

  // Notifiche "live": se arriva una nuova richiesta o un'altra persona ne
  // cambia lo stato, l'elenco (e i pallini sui filtri/righe qui sotto) si
  // aggiornano subito, senza dover ricaricare la pagina — richiesto da
  // Andrea (set 2026), stesso canale già usato per il pallino sulla casella
  // "Richieste" del menu (vedi AuthContext.tsx).
  useEffect(() => {
    const channel = supabase
      .channel('requests_page_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => loadRequests())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Un link "da fuori" (dal Calendario, dalla ricerca, da un'altra pagina)
  // può indicare quale richiesta aprire — vale anche restando su questa
  // pagina, non solo al primo caricamento (stesso pattern usato in Clienti).
  useEffect(() => {
    const fromLink = searchParams.get('id')
    if (!fromLink || requests.length === 0) return
    const request = requests.find((r) => r.id === fromLink)
    if (request) {
      setSelected(request)
      // Azzera anche i filtri di reparto/collegamento/interna-esterna, non
      // solo lo stato: altrimenti un link "da fuori" (es. l'avviso 🔔 in
      // Chat per una richiesta di un altro reparto) apre la scheda ma la
      // riga resta nascosta/non evidenziata nell'elenco sotto perché non
      // corrisponde ai filtri attivi in quel momento.
      setStatusFilter('tutte')
      setDepartmentFilter('tutti')
      setRefTableFilter('tutti')
      setTypeFilter('tutti')
      setInboxFilter(request.created_by === profile?.id ? 'inviate' : 'ricevute')
    }
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, requests])

  // I filtri secondari (reparto, collegamento, interna/esterna) si applicano
  // insieme a quello di stato — i conteggi sulle schede Nuova/In
  // lavorazione/... qui sotto riflettono già gli altri filtri attivi, così
  // restano coerenti con quello che si vede aprendo quella scheda.
  function matchesInboxFilter(r: Request): boolean {
    const createdByMe = r.created_by !== null && r.created_by === profile?.id
    return inboxFilter === 'inviate' ? createdByMe : !createdByMe
  }

  function matchesSecondaryFilters(r: Request): boolean {
    if (departmentFilter !== 'tutti' && r.department !== departmentFilter) return false
    if (refTableFilter === 'nessuno' && r.ref_table) return false
    if (refTableFilter !== 'tutti' && refTableFilter !== 'nessuno' && r.ref_table !== refTableFilter) return false
    if (typeFilter !== 'tutti' && r.type !== typeFilter) return false
    return true
  }

  const inboxFiltered = requests.filter(matchesInboxFilter)
  const inboxCounts: Record<InboxFilter, number> = {
    inviate: requests.filter((r) => r.created_by !== null && r.created_by === profile?.id).length,
    ricevute: requests.filter((r) => !(r.created_by !== null && r.created_by === profile?.id)).length,
  }
  const secondaryFiltered = inboxFiltered.filter(matchesSecondaryFilters)

  const statusCounts: Record<StatusFilter, number> = {
    nuova: secondaryFiltered.filter((r) => r.status === 'nuova').length,
    lavorazione: secondaryFiltered.filter((r) => r.status === 'lavorazione').length,
    risolta: secondaryFiltered.filter((r) => r.status === 'risolta').length,
    tutte: secondaryFiltered.length,
  }

  const visibleRequests = secondaryFiltered.filter((r) => statusFilter === 'tutte' || r.status === statusFilter)

  const secondaryFiltersActive = departmentFilter !== 'tutti' || refTableFilter !== 'tutti' || typeFilter !== 'tutti'

  async function updateStatus(request: Request, status: RequestStatus) {
    const { error } = await supabase.from('requests').update({ status }).eq('id', request.id)
    if (error) {
      alert('Non è stato possibile aggiornare lo stato: ' + error.message)
      return
    }
    loadRequests()
  }

  async function updateAssignee(request: Request, assigneeId: string) {
    const { error } = await supabase
      .from('requests')
      .update({ assignee_id: assigneeId || null })
      .eq('id', request.id)
    if (error) {
      alert('Non è stato possibile assegnare la richiesta: ' + error.message)
      return
    }
    loadRequests()
  }

  // Posticipare la scadenza senza perdere quella originale (richiesta di
  // Andrea, nov 2026) — "due_date" qui si aggiorna liberamente, mentre
  // "due_date_original" resta fissa alla prima data impostata: ce lo
  // garantisce un trigger lato database (0062_richieste_scadenza_assegnazione_pipeline.sql), non
  // serve nessun controllo in più qui.
  async function updateDueDate(request: Request, dueDate: string) {
    const { error } = await supabase
      .from('requests')
      .update({ due_date: dueDate || null })
      .eq('id', request.id)
    if (error) {
      alert('Non è stato possibile aggiornare la scadenza: ' + error.message)
      return
    }
    loadRequests()
  }

  return (
    <div className="view">
      <div className="view-head">
        <h1>Richieste</h1>
        <div className="view-head-actions">
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Annulla' : '+ Nuova richiesta'}
          </button>
        </div>
      </div>

      <p className="muted">Elenco generale di tutte le richieste, di chiunque verso chiunque.</p>

      {showForm && (
        <NewRequestForm
          profiles={profiles}
          clients={clients}
          senderName={profile?.full_name ?? ''}
          senderId={profile?.id ?? null}
          onCreated={() => {
            setShowForm(false)
            loadRequests()
          }}
        />
      )}

      <div className="stage-btn-row client-filter-row">
        {(['ricevute', 'inviate'] as InboxFilter[]).map((f) => (
          <button
            key={f}
            className={'stage-btn' + (inboxFilter === f ? ' current' : '')}
            onClick={() => setInboxFilter(f)}
          >
            {INBOX_FILTER_LABELS[f]} <span className="muted"> · {inboxCounts[f]}</span>
          </button>
        ))}
      </div>

      <div className="stage-btn-row client-filter-row">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={'stage-btn' + (statusFilter === s ? ' current' : '')}
            onClick={() => setStatusFilter(s)}
          >
            {STATUS_FILTER_LABELS[s]}
            {/* Il pallino rosso resta solo su "Nuova": è l'unica cosa
                davvero nuova/da guardare. "In lavorazione" è un conteggio
                normale — persone e richieste ci restano per giorni, quindi
                marcarlo di rosso lo faceva sembrare sempre "urgente" anche
                quando non lo era, la causa principale della confusione
                (richiesta di Andrea, set 2026: notifiche semplici, un
                significato solo). */}
            {s === 'nuova' && statusCounts[s] > 0 ? (
              <span className="stage-btn-notify">{statusCounts[s] > 99 ? '99+' : statusCounts[s]}</span>
            ) : (
              <span className="muted"> · {statusCounts[s]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="pipeline-toolbar req-type-filters">
        <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value as DepartmentFilter)}>
          <option value="tutti">Tutti i reparti</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select value={refTableFilter} onChange={(e) => setRefTableFilter(e.target.value as RefTableFilter)}>
          <option value="tutti">Collegata a: tutte</option>
          <option value="nessuno">Nessun record collegato</option>
          {REQUEST_REF_TABLES.map((t) => (
            <option key={t} value={t}>
              {REQUEST_REF_LABELS[t]}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}>
          <option value="tutti">Interna o esterna: tutte</option>
          <option value="interna">Interna</option>
          <option value="esterna">Esterna</option>
        </select>
        {secondaryFiltersActive && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setDepartmentFilter('tutti')
              setRefTableFilter('tutti')
              setTypeFilter('tutti')
            }}
          >
            Azzera filtri
          </button>
        )}
      </div>

      {loading && <p className="muted">Caricamento…</p>}
      {!loading && requests.length === 0 && (
        <p className="muted">Nessuna richiesta visibile per il tuo ruolo al momento.</p>
      )}
      {!loading && requests.length > 0 && visibleRequests.length === 0 && (
        <p className="muted">Nessuna richiesta corrisponde ai filtri selezionati.</p>
      )}

      <div className={'req-layout' + (selected ? ' req-layout-detail-open' : '')}>
        <div className="card req-list">
          {visibleRequests.map((r) => (
            <div
              key={r.id}
              className={'req-row' + (selected?.id === r.id ? ' selected' : '')}
              onClick={() => setSelected(r)}
            >
              <div className="req-main">
                <div className="req-subject">
                  {r.status === 'nuova' && <span className="row-notify-dot" />}
                  {r.subject}
                </div>
                <div className="req-meta">
                  {r.sender} · {r.type === 'interna' ? 'Interna' : 'Esterna'} ·{' '}
                  {new Date(r.created_at).toLocaleDateString('it-IT')}
                  {r.due_date && ' · scade ' + new Date(r.due_date).toLocaleDateString('it-IT')}
                  {clientFor(r) && ' · cliente collegato'}
                  {r.ref_table && r.ref_id && ' · record collegato'}
                  {r.attachment_url && ' · 📎 allegato'}
                </div>
              </div>
              <span className={'pill pill-' + r.status}>{r.status}</span>
            </div>
          ))}
        </div>

        <div className="card detail-panel request-print-area">
          {!selected && <p className="muted">Seleziona una richiesta dall'elenco.</p>}
          {selected && (
            <>
              <div className="no-print request-detail-toolbar">
                <button type="button" className="detail-back-btn" onClick={() => setSelected(null)}>
                  <IconChevronsLeft /> Torna all'elenco
                </button>
                {/* Richiesta di Andrea, nov 2026: un tasto per stampare la
                    singola scheda aperta — vedi le regole @media print in
                    index.css, che nascondono tutto il resto della pagina. */}
                <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
                  🖨️ Stampa
                </button>
              </div>
              <div className="eyebrow">
                {selected.department} · {selected.type === 'interna' ? 'richiesta interna' : 'richiesta esterna'}
              </div>
              <h3>{selected.subject}</h3>
              <p className="muted">{selected.body}</p>
              <div className="field-row">
                <label className="field-label">Scadenza</label>
                <input
                  type="date"
                  value={selected.due_date ? selected.due_date.slice(0, 10) : ''}
                  onChange={(e) => updateDueDate(selected, e.target.value)}
                />
                {selected.due_date_original && selected.due_date_original !== selected.due_date && (
                  <span className="muted">
                    Scadenza originale: {new Date(selected.due_date_original).toLocaleDateString('it-IT')}
                  </span>
                )}
              </div>
              {clientFor(selected) && (
                <p className="muted">
                  Cliente collegato:{' '}
                  <Link to={`/clienti?cliente=${selected.client_id}`}>{clientFor(selected)?.name}</Link>
                </p>
              )}
              {selected.ref_table && selected.ref_id && (
                <p className="muted">
                  Collegata a:{' '}
                  {refLabel === null ? (
                    'caricamento…'
                  ) : (
                    <Link to={refLinkPath(selected.ref_table, selected.ref_id)}>{refLabel}</Link>
                  )}
                </p>
              )}
              {selected.attachment_url && (
                <p className="muted">
                  <a href={selected.attachment_url} target="_blank" rel="noreferrer">
                    📎 {selected.attachment_name ?? 'Allegato'}
                  </a>
                </p>
              )}

              <div className="field-row">
                <label className="field-label">Stato</label>
                <div className="stage-btn-row">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      className={'stage-btn' + (selected.status === s ? ' current' : '')}
                      onClick={() => updateStatus(selected, s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-row">
                <label className="field-label">Assegnata a</label>
                <select
                  value={selected.assignee_id ?? ''}
                  onChange={(e) => updateAssignee(selected, e.target.value)}
                >
                  <option value="">— Nessuno —</option>
                  {[...profiles]
                    .sort((a, b) => a.full_name.localeCompare(b.full_name))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                </select>
              </div>

              <CommentThread refTable="requests" refId={selected.id} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function NewRequestForm({
  profiles,
  clients,
  senderName,
  senderId,
  onCreated,
}: {
  profiles: Profile[]
  clients: Client[]
  senderName: string
  senderId: string | null
  onCreated: () => void
}) {
  const [subject, setSubject] = useState('')
  const [clientId, setClientId] = useState('')
  const [department, setDepartment] = useState<RequestDepartment>('commerciale')
  const [priority, setPriority] = useState<RequestPriority>('media')
  const [body, setBody] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assignments, setAssignments] = useState<PendingAssignment[]>([])
  const [refTable, setRefTable] = useState<RequestRefTable | ''>('')
  const [refId, setRefId] = useState('')
  const [saving, setSaving] = useState(false)
  // Allegato facoltativo (JPEG, Word, PDF o Excel — richiesta di Andrea,
  // ott 2026), stesso schema già usato in Marketing.tsx (upload diretto nel
  // bucket, poi l'url pubblico va nella riga della richiesta).
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const [attachmentName, setAttachmentName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const extension = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
    if (!REQUEST_ATTACHMENT_EXTENSIONS.includes(extension)) {
      alert('Formato non supportato: solo JPEG, Word, PDF o Excel.')
      e.target.value = ''
      return
    }
    setUploading(true)
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('request-attachments').upload(path, file, { upsert: true })
    setUploading(false)
    e.target.value = ''
    if (error) {
      alert("Non è stato possibile caricare l'allegato: " + error.message)
      return
    }
    const { data } = supabase.storage.from('request-attachments').getPublicUrl(path)
    setAttachmentUrl(data.publicUrl)
    setAttachmentName(file.name)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)

    const basePayload = {
      subject,
      sender: senderName,
      created_by: senderId,
      client_id: clientId || null,
      ref_table: refTable || null,
      ref_id: refTable ? refId || null : null,
      department,
      priority,
      type: 'esterna' as const,
      status: 'nuova' as const,
      attachment_url: attachmentUrl,
      attachment_name: attachmentName,
    }

    // Nessuna persona scelta sotto "Assegnazione attività a": una sola
    // richiesta, come prima, assegnata al solo reparto (assignee_id null).
    // Una o più persone scelte: una richiesta SEPARATA per ciascuna, con il
    // proprio testo aggiunto ai "Dettagli" comuni e la propria scadenza (o
    // quella comune qui sopra, se non ne ha impostata una) — stesso
    // meccanismo già in uso per i leeds in Pipeline.tsx. Un insert per
    // riga, non un array di righe passato in blocco a .insert(): un array
    // costruito da un ternario con "assignee_id: null" in un ramo e
    // "assignee_id: a.userId" nell'altro faceva inferire a TypeScript due
    // tipi diversi invece di un unico "string | null", e tsc rifiutava la
    // build (visto solo da Vercel: non potevo girare tsc da qui per
    // accorgermene prima).
    let errorMessage: string | null = null
    if (assignments.length === 0) {
      const { error } = await supabase
        .from('requests')
        .insert({ ...basePayload, body, due_date: dueDate || null, assignee_id: null })
      errorMessage = error?.message ?? null
    } else {
      for (const a of assignments) {
        const { error } = await supabase.from('requests').insert({
          ...basePayload,
          body: body.trim() ? `${body.trim()}\n\n${a.task}` : a.task,
          due_date: a.dueDate || dueDate || null,
          assignee_id: a.userId,
        })
        if (error) {
          errorMessage = error.message
          break
        }
      }
    }
    setSaving(false)
    if (errorMessage) {
      alert('Non è stato possibile creare la richiesta: ' + errorMessage)
      return
    }
    onCreated()
  }

  return (
    <form className="card panel new-deal-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field-label">Oggetto</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </div>
      <div className="field-row">
        <label className="field-label">Mittente</label>
        <input value={senderName} disabled />
      </div>
      {clients.length > 0 && (
        <div className="field-row">
          <label className="field-label">Cliente collegato (facoltativo)</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— nessuno —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Reparto</label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value as RequestDepartment)}
          >
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label">Priorità</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as RequestPriority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field-row">
        <label className="field-label">Scadenza (facoltativa)</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <span className="muted">
          Usata se non assegni la richiesta a nessuno qui sotto, o come scadenza di partenza per chi non ne
          imposta una propria.
        </span>
      </div>
      <RefPicker table={refTable} refId={refId} onChangeTable={setRefTable} onChangeId={setRefId} />
      <div className="field-row">
        <label className="field-label">Dettagli</label>
        <textarea className="note-field" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {/* Coinvolgere più persone (richiesta di Andrea, nov 2026: "come nei
          leeds, scelta libera e multipla") — stesso componente già usato in
          Pipeline/Acquisti/Ricerca: una richiesta separata per ciascuna
          persona scelta, ognuna con il proprio testo ed eventuale scadenza
          (vedi handleSubmit più sotto). Senza nessuna scelta qui, si crea
          comunque UNA sola richiesta, assegnata al solo reparto. */}
      <ActivityAssignment profiles={profiles} assignments={assignments} onChange={setAssignments} />
      <div className="field-row">
        <label className="field-label">Allegato (facoltativo — JPEG, Word, PDF o Excel)</label>
        {attachmentUrl ? (
          <div className="marketing-attachment-row">
            <a href={attachmentUrl} target="_blank" rel="noreferrer">
              📎 {attachmentName}
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAttachmentUrl(null)
                setAttachmentName(null)
              }}
            >
              Rimuovi
            </button>
          </div>
        ) : (
          <input type="file" accept={REQUEST_ATTACHMENT_ACCEPT} onChange={handleFileChange} disabled={uploading} />
        )}
        {uploading && <span className="muted">Caricamento…</span>}
      </div>
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Creazione…' : 'Crea richiesta'}
      </button>
    </form>
  )
}
