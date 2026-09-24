import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { CommentThread } from '../components/CommentThread'
import { RefPicker } from '../components/RefPicker'
import { describeRef, refLinkPath, type RequestRefTable } from '../lib/refRecords'
import { type Client, type Profile, type Request, type RequestDepartment, type RequestPriority, type RequestStatus } from '../lib/types'

const STATUSES: RequestStatus[] = ['nuova', 'lavorazione', 'risolta']
const DEPARTMENTS: RequestDepartment[] = ['commerciale', 'tecnico', 'operativo', 'amministrazione']
const PRIORITIES: RequestPriority[] = ['alta', 'media', 'bassa']

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

export function Requests() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [requests, setRequests] = useState<Request[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('nuova')
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

  // Un link "da fuori" (dal Calendario, dalla ricerca, da un'altra pagina)
  // può indicare quale richiesta aprire — vale anche restando su questa
  // pagina, non solo al primo caricamento (stesso pattern usato in Clienti).
  useEffect(() => {
    const fromLink = searchParams.get('id')
    if (!fromLink) return
    const request = requests.find((r) => r.id === fromLink)
    if (request) {
      setSelected(request)
      setStatusFilter('tutte') // altrimenti, se lo stato non corrisponde alla scheda attiva, sparirebbe dall'elenco
    }
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, requests])

  const statusCounts: Record<StatusFilter, number> = {
    nuova: requests.filter((r) => r.status === 'nuova').length,
    lavorazione: requests.filter((r) => r.status === 'lavorazione').length,
    risolta: requests.filter((r) => r.status === 'risolta').length,
    tutte: requests.length,
  }

  const visibleRequests = requests.filter((r) => statusFilter === 'tutte' || r.status === statusFilter)

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

  function peopleInDepartment(department: RequestDepartment) {
    return profiles.filter((p) => p.department === department)
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

      {showForm && (
        <NewRequestForm
          profiles={profiles}
          clients={clients}
          onCreated={() => {
            setShowForm(false)
            loadRequests()
          }}
        />
      )}

      <div className="stage-btn-row client-filter-row">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={'stage-btn' + (statusFilter === s ? ' current' : '')}
            onClick={() => setStatusFilter(s)}
          >
            {STATUS_FILTER_LABELS[s]} <span className="muted">· {statusCounts[s]}</span>
          </button>
        ))}
      </div>

      {loading && <p className="muted">Caricamento…</p>}
      {!loading && requests.length === 0 && (
        <p className="muted">Nessuna richiesta visibile per il tuo ruolo al momento.</p>
      )}
      {!loading && requests.length > 0 && visibleRequests.length === 0 && (
        <p className="muted">Nessuna richiesta corrisponde ai filtri selezionati.</p>
      )}

      <div className="req-layout">
        <div className="card req-list">
          {visibleRequests.map((r) => (
            <div
              key={r.id}
              className={'req-row' + (selected?.id === r.id ? ' selected' : '')}
              onClick={() => setSelected(r)}
            >
              <div className="req-main">
                <div className="req-subject">{r.subject}</div>
                <div className="req-meta">
                  {r.sender} · {r.type === 'interna' ? 'Interna' : 'Esterna'} ·{' '}
                  {new Date(r.created_at).toLocaleDateString('it-IT')}
                  {r.due_date && ' · scade ' + new Date(r.due_date).toLocaleDateString('it-IT')}
                  {clientFor(r) && ' · cliente collegato'}
                  {r.ref_table && r.ref_id && ' · record collegato'}
                </div>
              </div>
              <span className={'pill pill-' + r.status}>{r.status}</span>
            </div>
          ))}
        </div>

        <div className="card detail-panel">
          {!selected && <p className="muted">Seleziona una richiesta dall'elenco.</p>}
          {selected && (
            <>
              <div className="eyebrow">
                {selected.department} · {selected.type === 'interna' ? 'richiesta interna' : 'richiesta esterna'}
              </div>
              <h3>{selected.subject}</h3>
              <p className="muted">{selected.body}</p>
              {selected.due_date && (
                <p className="muted">Scadenza: {new Date(selected.due_date).toLocaleDateString('it-IT')}</p>
              )}
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
                  <option value="">— Nessuno (solo reparto {selected.department}) —</option>
                  {peopleInDepartment(selected.department).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                  {peopleInDepartment(selected.department).length === 0 && (
                    <option disabled>Nessuno collegato al reparto {selected.department} ancora</option>
                  )}
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
  onCreated,
}: {
  profiles: Profile[]
  clients: Client[]
  onCreated: () => void
}) {
  const [subject, setSubject] = useState('')
  const [sender, setSender] = useState('')
  const [clientId, setClientId] = useState('')
  const [department, setDepartment] = useState<RequestDepartment>('commerciale')
  const [priority, setPriority] = useState<RequestPriority>('media')
  const [body, setBody] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [refTable, setRefTable] = useState<RequestRefTable | ''>('')
  const [refId, setRefId] = useState('')
  const [saving, setSaving] = useState(false)

  const peopleInDepartment = profiles.filter((p) => p.department === department)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('requests').insert({
      subject,
      sender,
      client_id: clientId || null,
      ref_table: refTable || null,
      ref_id: refTable ? refId || null : null,
      department,
      priority,
      body,
      due_date: dueDate || null,
      assignee_id: assigneeId || null,
      type: 'esterna',
      status: 'nuova',
    })
    setSaving(false)
    if (error) {
      alert('Non è stato possibile creare la richiesta: ' + error.message)
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
        <input value={sender} onChange={(e) => setSender(e.target.value)} required />
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
            onChange={(e) => {
              setDepartment(e.target.value as RequestDepartment)
              setAssigneeId('') // il reparto è cambiato: l'assegnatario scelto prima potrebbe non farne più parte
            }}
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
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Assegna a (facoltativo)</label>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">— Solo reparto, nessuna persona —</option>
            {peopleInDepartment.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label">Scadenza (facoltativa)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <RefPicker table={refTable} refId={refId} onChangeTable={setRefTable} onChangeId={setRefId} />
      <div className="field-row">
        <label className="field-label">Dettagli</label>
        <textarea className="note-field" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Creazione…' : 'Crea richiesta'}
      </button>
    </form>
  )
}
