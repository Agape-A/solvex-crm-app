import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CommentThread } from '../components/CommentThread'
import { ActivityAssignment, createActivityAssignments } from '../components/ActivityAssignment'
import {
  INCONTRO_TIPO_LABELS,
  NATURA_RECLAMO_LABELS,
  PURCHASE_STATUSES,
  PURCHASE_STATUS_LABELS,
  REPARTI_RIUNIONE,
  RICEZIONE_RECLAMO_LABELS,
  TIPO_ANALISI_LABELS,
  URGENZA_LABELS,
  type Client,
  type IncontroTipo,
  type NaturaReclamo,
  type PendingAssignment,
  type ProcurementActivity,
  type ProcurementActivityDetails,
  type Profile,
  type PurchaseRequest,
  type PurchaseStatus,
  type RicezioneReclamo,
  type Supplier,
  type TipoAnalisi,
  type Urgenza,
} from '../lib/types'

// Pipeline acquisti, ridisegnata (set 2026) sullo stesso schema della
// Pipeline clienti: "+ Nuova richiesta" apre subito il form guidato con i 4
// tipi attività dello "Schema Nuova Pipeline Acquisti" di Andrea (Visita
// Fornitore, Reclamo Fornitore, Reclamo Cliente, Riunione Interna) — il
// fornitore o il cliente si sceglie nel form stesso, non serve aprire prima
// una scheda specifica. Le attività vivono in procurement_activities (ex
// "supplier_activities" — vedi 0021_pipeline_acquisti_attivita.sql), non
// nella tabella purchase_requests: non seguono uno stato d'ordine.
//
// La vecchia bacheca a colonne (prezzo unitario, quantità, stato
// da_inviare→ricevuta — 0014_pipeline_acquisti.sql) resta sotto come
// archivio delle richieste create prima di questo aggiornamento: restano
// consultabili e aggiornabili, ma da "+ Nuova richiesta" non se ne creano
// più di nuove — non era nello schema di Andrea. Visibile solo a
// "ufficio_acquisti" e "dirigente" — vedi 0013_moduli_ruoli.sql.
const CAN_ACCESS = ['ufficio_acquisti', 'dirigente']

const currency = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

// "Ferma da tempo": come nella Pipeline clienti, se una richiesta aperta non
// viene toccata da più di ROTTING_DAYS giorni la evidenziamo.
const ROTTING_DAYS = 14
const OPEN_STATUSES: string[] = ['da_inviare', 'inviata', 'confermata']
// Il percorso "sano" di una richiesta, senza "annullata" (un'uscita, non uno
// step) — usato per lo stepper Path e per il pulsante di avanzamento rapido.
const PATH_STATUSES: PurchaseStatus[] = ['da_inviare', 'inviata', 'confermata', 'ricevuta']

function nextPathStatus(status: PurchaseStatus): PurchaseStatus | null {
  const idx = PATH_STATUSES.indexOf(status)
  if (idx === -1 || idx === PATH_STATUSES.length - 1) return null
  return PATH_STATUSES[idx + 1]
}

function statusLabel(status: PurchaseStatus): string {
  return PURCHASE_STATUS_LABELS[status] ?? status
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

function isRotting(request: PurchaseRequest): boolean {
  return OPEN_STATUSES.includes(request.status) && daysSince(request.updated_at) > ROTTING_DAYS
}

function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date(new Date().toDateString())
}

function estimatedValue(request: PurchaseRequest): number {
  return Number(request.unit_price ?? 0) * Number(request.quantity ?? 0)
}

type SortKey = 'recenti' | 'valore_desc' | 'valore_asc' | 'scadenza' | 'ferme'

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'recenti', label: 'Più recenti' },
  { id: 'valore_desc', label: 'Valore (dal più alto)' },
  { id: 'valore_asc', label: 'Valore (dal più basso)' },
  { id: 'scadenza', label: 'Scadenza' },
  { id: 'ferme', label: 'Ferme da più tempo' },
]

function compareRequests(a: PurchaseRequest, b: PurchaseRequest, sortBy: SortKey): number {
  switch (sortBy) {
    case 'valore_desc':
      return estimatedValue(b) - estimatedValue(a)
    case 'valore_asc':
      return estimatedValue(a) - estimatedValue(b)
    case 'scadenza': {
      if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      if (a.due_date) return -1
      if (b.due_date) return 1
      return 0
    }
    case 'ferme':
      return daysSince(b.updated_at) - daysSince(a.updated_at)
    case 'recenti':
    default:
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  }
}

export function PurchasePipeline() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activities, setActivities] = useState<ProcurementActivity[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<PurchaseStatus | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('recenti')

  const canAccess = profile ? CAN_ACCESS.includes(profile.role) : false

  async function loadRequests() {
    setLoading(true)
    const { data, error } = await supabase.from('purchase_requests').select('*').order('created_at', { ascending: false })
    if (error) console.error(error)
    setRequests((data as PurchaseRequest[]) ?? [])
    setLoading(false)
  }

  async function loadSuppliers() {
    const { data, error } = await supabase.from('suppliers').select('*').order('name')
    if (error) console.error(error)
    setSuppliers((data as Supplier[]) ?? [])
  }

  async function loadClients() {
    const { data, error } = await supabase.from('clients').select('*').order('name')
    if (error) console.error(error)
    setClients((data as Client[]) ?? [])
  }

  async function loadActivities() {
    setActivitiesLoading(true)
    const { data, error } = await supabase
      .from('procurement_activities')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) console.error(error)
    setActivities((data as ProcurementActivity[]) ?? [])
    setActivitiesLoading(false)
  }

  useEffect(() => {
    if (!canAccess) {
      setLoading(false)
      setActivitiesLoading(false)
      return
    }
    loadRequests()
    loadSuppliers()
    loadClients()
    loadActivities()
    supabase
      .from('profiles')
      .select('*')
      .then(({ data }) => setProfiles((data as Profile[]) ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess])

  // Deep-link (es. dalla scheda di un fornitore) — evidenzia e scorre fino
  // alla richiesta indicata, azzerando filtri/vista che potrebbero nasconderla.
  useEffect(() => {
    const fromLink = searchParams.get('richiesta')
    if (!fromLink || requests.length === 0) return
    setView('kanban')
    setSearch('')
    setSupplierFilter('')
    setExpandedId(fromLink)
    setHighlightedId(fromLink)
    setSearchParams({}, { replace: true })
    const timeout = setTimeout(() => {
      document.getElementById('request-' + fromLink)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    const clearHighlight = setTimeout(() => setHighlightedId(null), 3000)
    return () => {
      clearTimeout(timeout)
      clearTimeout(clearHighlight)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, requests])

  async function updateStatus(request: PurchaseRequest, status: PurchaseStatus) {
    if (request.status === status) return
    setSavingId(request.id)
    setRequests((current) => current.map((r) => (r.id === request.id ? { ...r, status } : r)))
    const { error } = await supabase.from('purchase_requests').update({ status }).eq('id', request.id)
    setSavingId(null)
    if (error) {
      alert('Non è stato possibile aggiornare lo stato: ' + error.message)
      loadRequests()
    }
  }

  async function updateField(request: PurchaseRequest, patch: Partial<PurchaseRequest>) {
    const { error } = await supabase.from('purchase_requests').update(patch).eq('id', request.id)
    if (error) {
      alert('Non è stato possibile salvare la modifica: ' + error.message)
      return
    }
    setRequests((rs) => rs.map((r) => (r.id === request.id ? { ...r, ...patch } : r)))
  }

  const supplierMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const requesterMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase()
    return requests.filter((r) => {
      const supplierName = supplierMap.get(r.supplier_id)?.name ?? ''
      if (q && !(supplierName.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q))) return false
      if (supplierFilter && r.supplier_id !== supplierFilter) return false
      return true
    })
  }, [requests, search, supplierFilter, supplierMap])

  if (!profile) return null

  if (!canAccess) {
    return (
      <div className="view">
        <h1>Pipeline acquisti</h1>
        <p className="muted">Questa sezione è disponibile solo per l'ufficio acquisti e la direzione.</p>
      </div>
    )
  }

  return (
    <div className="view view-wide">
      <div className="view-head">
        <h1>Pipeline acquisti</h1>
        <button className="btn btn-primary" onClick={() => setShowActivityForm((v) => !v)}>
          {showActivityForm ? 'Annulla' : '+ Nuova richiesta'}
        </button>
      </div>

      {showActivityForm && (
        <NewProcurementActivityForm
          suppliers={suppliers}
          clients={clients}
          assignees={profiles}
          createdByName={profile.full_name}
          onCreated={() => { setShowActivityForm(false); loadActivities() }}
        />
      )}

      {activitiesLoading && <p className="muted">Caricamento…</p>}
      {!activitiesLoading && activities.length === 0 && !showActivityForm && (
        <p className="muted">Nessuna richiesta registrata ancora.</p>
      )}
      {!activitiesLoading && activities.length > 0 && (
        <div className="client-deals-list procurement-activities-list">
          {activities.map((a) => (
            <ProcurementActivityRow
              key={a.id}
              activity={a}
              supplierName={a.supplier_id ? supplierMap.get(a.supplier_id)?.name : undefined}
              clientName={a.client_id ? clientMap.get(a.client_id)?.name : undefined}
            />
          ))}
        </div>
      )}

      <div className="section-title client-deals-title">Richieste d'acquisto (archivio)</div>
      <p className="muted">
        Le richieste d'acquisto con prezzo, quantità e stato dell'ordine create prima di questo aggiornamento restano
        qui, consultabili e aggiornabili — da oggi le nuove richieste si creano con "+ Nuova richiesta" sopra.
      </p>

      {loading && <p className="muted">Caricamento…</p>}

      {!loading && (
        <>
          <div className="pipeline-toolbar">
            <input
              className="pipeline-search-input"
              placeholder="Cerca fornitore o oggetto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
              <option value="">Tutti i fornitori</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  Ordina: {o.label}
                </option>
              ))}
            </select>
            <div className="pipeline-view-toggle">
              <button type="button" className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}>
                Bacheca
              </button>
              <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
                Elenco
              </button>
            </div>
          </div>

          {filteredRequests.length === 0 && <p className="muted">Nessuna richiesta corrisponde ai filtri selezionati.</p>}

          {filteredRequests.length > 0 && view === 'kanban' && (
            <div className="kanban-board">
              {PURCHASE_STATUSES.map((status) => {
                const rows = filteredRequests.filter((r) => r.status === status.id).sort((a, b) => compareRequests(a, b, sortBy))
                const total = rows.reduce((sum, r) => sum + estimatedValue(r), 0)
                const rottingCount = rows.filter(isRotting).length
                return (
                  <div
                    key={status.id}
                    className={'kanban-col' + (dragOverStatus === status.id ? ' drag-over' : '')}
                    onDragOver={(e) => {
                      if (!draggedId) return
                      e.preventDefault()
                      setDragOverStatus(status.id)
                    }}
                    onDragLeave={() => setDragOverStatus((s) => (s === status.id ? null : s))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOverStatus(null)
                      const id = e.dataTransfer.getData('text/plain')
                      const request = requests.find((r) => r.id === id)
                      if (request) updateStatus(request, status.id)
                    }}
                  >
                    <div className="kanban-col-head">
                      <span>
                        {status.label} <span className="muted">· {rows.length}</span>
                        {rottingCount > 0 && (
                          <span className="kanban-rotting-badge" title={`${rottingCount} ferma/e da più di ${ROTTING_DAYS} giorni`}>
                            {rottingCount}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="kanban-col-total-row muted">{currency.format(total)}</div>

                    <div className="kanban-cards">
                      {rows.length === 0 && <p className="muted kanban-empty">Nessuna richiesta qui.</p>}
                      {rows.map((request) => (
                        <RequestCard
                          key={request.id}
                          request={request}
                          supplier={supplierMap.get(request.supplier_id)}
                          requester={request.requested_by ? requesterMap.get(request.requested_by) : undefined}
                          rotting={isRotting(request)}
                          dragging={draggedId === request.id}
                          saving={savingId === request.id}
                          highlighted={highlightedId === request.id}
                          expanded={expandedId === request.id}
                          requesters={profiles}
                          onToggleExpand={() => setExpandedId((id) => (id === request.id ? null : request.id))}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', request.id)
                            e.dataTransfer.effectAllowed = 'move'
                            setDraggedId(request.id)
                          }}
                          onDragEnd={() => {
                            setDraggedId(null)
                            setDragOverStatus(null)
                          }}
                          onChangeStatus={(s) => updateStatus(request, s)}
                          onChangeField={(patch) => updateField(request, patch)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {filteredRequests.length > 0 && view === 'list' && (
            <div className="pipeline-list">
              <div className="pipeline-list-head">
                <span className="pcol-client">Fornitore / oggetto</span>
                <span className="pcol-stage">Stato</span>
                <button type="button" className="pcol-value" onClick={() => setSortBy('valore_desc')}>
                  Valore
                </button>
                <span className="pcol-owner">Rich.</span>
                <button type="button" className="pcol-action" onClick={() => setSortBy('scadenza')}>
                  Scadenza
                </button>
                <span className="pcol-expand" />
              </div>
              {filteredRequests
                .slice()
                .sort((a, b) => compareRequests(a, b, sortBy))
                .map((request) => {
                  const supplier = supplierMap.get(request.supplier_id)
                  const requester = request.requested_by ? requesterMap.get(request.requested_by) : undefined
                  const rotting = isRotting(request)
                  return (
                    <div key={request.id} id={'request-' + request.id}>
                      <div
                        className={
                          'pipeline-row' +
                          (highlightedId === request.id ? ' pipeline-row-highlighted' : '') +
                          (rotting ? ' pipeline-row-rotting' : '')
                        }
                        onClick={() => setExpandedId((id) => (id === request.id ? null : request.id))}
                      >
                        <div className="pcol-client">
                          <strong>{supplier?.name ?? 'fornitore eliminato'}</strong>
                          <span className="muted">{request.subject}</span>
                        </div>
                        <span className={'pill pill-' + request.status}>{statusLabel(request.status)}</span>
                        <span className="pcol-value pipeline-row-value">{currency.format(estimatedValue(request))}</span>
                        <span className="pcol-owner">
                          <RequesterAvatar requester={requester} />
                        </span>
                        <span className={'pcol-action' + (request.due_date && isOverdue(request.due_date) ? ' pipeline-action-overdue' : '')}>
                          {request.due_date ? new Date(request.due_date).toLocaleDateString('it-IT') : '—'}
                        </span>
                        <span className="pcol-expand">{expandedId === request.id ? '▾' : '▸'}</span>
                      </div>
                      {expandedId === request.id && (
                        <div className="pipeline-row-expanded">
                          <RequestDetails
                            request={request}
                            requesters={profiles}
                            onChangeStatus={(s) => updateStatus(request, s)}
                            onChangeField={(patch) => updateField(request, patch)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function RequesterAvatar({ requester }: { requester: Profile | undefined }) {
  if (!requester) {
    return (
      <span className="deal-owner-avatar deal-owner-avatar-empty" title="Nessun richiedente assegnato">
        —
      </span>
    )
  }
  return (
    <span className="deal-owner-avatar" title={requester.full_name}>
      {requester.initials}
    </span>
  )
}

// Stepper di stato, stessa idea del componente "Path" della Pipeline
// clienti: pallini collegati (senza etichette) nella card compatta della
// bacheca, versione estesa con etichette e grid elastica nell'elenco.
function StatusPath({
  request,
  compact = false,
  onChangeStatus,
}: {
  request: PurchaseRequest
  compact?: boolean
  onChangeStatus: (status: PurchaseStatus) => void
}) {
  if (request.status === 'annullata') {
    return (
      <div className="stage-path-lost">
        <span className="stage-path-lost-label">Richiesta annullata</span>
        <button type="button" className="stage-path-lost-btn" onClick={() => onChangeStatus('da_inviare')}>
          Riapri come "da inviare"
        </button>
      </div>
    )
  }

  const currentIdx = PATH_STATUSES.indexOf(request.status)

  if (compact) {
    const track: ReactNode[] = []
    PATH_STATUSES.forEach((s, i) => {
      const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo'
      track.push(
        <button
          type="button"
          key={s}
          title={statusLabel(s)}
          className={'stage-path-dot-only stage-path-' + state}
          onClick={() => onChangeStatus(s)}
        />,
      )
      if (i < PATH_STATUSES.length - 1) {
        track.push(<span key={s + '-c'} className={'stage-path-connector' + (i < currentIdx ? ' done' : '')} />)
      }
    })
    return (
      <div className="stage-path-compact">
        <div className="stage-path-compact-track">{track}</div>
        <div className="stage-path-compact-foot">
          <span className="muted">{statusLabel(request.status)}</span>
          {request.status !== 'ricevuta' && (
            <button type="button" className="stage-path-lost-btn" onClick={() => onChangeStatus('annullata')}>
              Annulla
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="stage-path">
      <div className="stage-path-track">
        {PATH_STATUSES.map((s, i) => {
          const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo'
          return (
            <button
              type="button"
              key={s}
              className={'stage-path-step stage-path-' + state}
              onClick={() => onChangeStatus(s)}
            >
              <span className="stage-path-dot">{state === 'done' ? '✓' : i + 1}</span>
              <span className="stage-path-label">{statusLabel(s)}</span>
            </button>
          )
        })}
      </div>
      {request.status !== 'ricevuta' && (
        <div className="stage-path-foot">
          <button type="button" className="stage-path-lost-btn" onClick={() => onChangeStatus('annullata')}>
            Segna come annullata
          </button>
        </div>
      )}
    </div>
  )
}

function RequestDetails({
  request,
  compact = false,
  requesters,
  onChangeStatus,
  onChangeField,
}: {
  request: PurchaseRequest
  compact?: boolean
  requesters: Profile[]
  onChangeStatus: (s: PurchaseStatus) => void
  onChangeField: (patch: Partial<PurchaseRequest>) => void
}) {
  const [uploading, setUploading] = useState(false)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('purchase-attachments').upload(path, file, { upsert: true })
    setUploading(false)
    e.target.value = ''
    if (error) {
      alert("Non è stato possibile caricare l'allegato: " + error.message)
      return
    }
    const { data } = supabase.storage.from('purchase-attachments').getPublicUrl(path)
    onChangeField({ attachment_url: data.publicUrl, attachment_name: file.name })
  }

  return (
    <div className="kanban-card-expanded" onClick={(e) => e.stopPropagation()}>
      <StatusPath request={request} compact={compact} onChangeStatus={onChangeStatus} />

      <div className="field-row">
        <label className="field-label">Richiesta da</label>
        <select value={request.requested_by ?? ''} onChange={(e) => onChangeField({ requested_by: e.target.value || null })}>
          <option value="">— Nessuno —</option>
          {requesters.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Prezzo unitario (€)</label>
          <input
            type="number"
            defaultValue={request.unit_price ?? ''}
            placeholder="0"
            onBlur={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value)
              if (v !== request.unit_price) onChangeField({ unit_price: v })
            }}
          />
        </div>
        <div className="field-row">
          <label className="field-label">Quantità</label>
          <div className="field-row-inline">
            <input
              type="number"
              defaultValue={request.quantity ?? ''}
              placeholder="0"
              onBlur={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value)
                if (v !== request.quantity) onChangeField({ quantity: v })
              }}
            />
            <input
              defaultValue={request.quantity_unit ?? ''}
              placeholder="unità (kg, pezzi…)"
              onBlur={(e) => {
                const v = e.target.value.trim() || null
                if (v !== request.quantity_unit) onChangeField({ quantity_unit: v })
              }}
            />
          </div>
        </div>
      </div>

      <div className="field-row">
        <label className="field-label">Scadenza</label>
        <input
          type="date"
          value={request.due_date ?? ''}
          onChange={(e) => onChangeField({ due_date: e.target.value || null })}
        />
      </div>

      <div className="field-row">
        <label className="field-label">Specifiche d'ordine</label>
        <textarea
          className="note-field"
          defaultValue={request.order_specs}
          placeholder="Specifiche tecniche, condizioni di consegna…"
          onBlur={(e) => {
            if (e.target.value !== request.order_specs) onChangeField({ order_specs: e.target.value })
          }}
        />
      </div>

      <div className="field-row">
        <label className="field-label">Dettagli</label>
        <textarea
          className="note-field"
          defaultValue={request.body}
          placeholder="Nota…"
          onBlur={(e) => {
            if (e.target.value !== request.body) onChangeField({ body: e.target.value })
          }}
        />
      </div>

      <div className="field-row">
        <label className="field-label">Documentazione (facoltativa — es. scheda tecnica, conferma d'ordine, DDT)</label>
        {request.attachment_url ? (
          <div className="marketing-attachment-row">
            <a href={request.attachment_url} target="_blank" rel="noreferrer">
              📎 {request.attachment_name}
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onChangeField({ attachment_url: null, attachment_name: null })}
            >
              Rimuovi
            </button>
          </div>
        ) : (
          <input type="file" onChange={handleFileChange} disabled={uploading} />
        )}
        {uploading && <span className="muted">Caricamento…</span>}
      </div>

      <CommentThread refTable="purchase_requests" refId={request.id} refLabel={request.subject} />
    </div>
  )
}

function RequestCard({
  request,
  supplier,
  requester,
  rotting,
  dragging,
  saving,
  highlighted,
  expanded,
  requesters,
  onToggleExpand,
  onDragStart,
  onDragEnd,
  onChangeStatus,
  onChangeField,
}: {
  request: PurchaseRequest
  supplier: Supplier | undefined
  requester: Profile | undefined
  rotting: boolean
  dragging: boolean
  saving: boolean
  highlighted: boolean
  expanded: boolean
  requesters: Profile[]
  onToggleExpand: () => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onChangeStatus: (s: PurchaseStatus) => void
  onChangeField: (patch: Partial<PurchaseRequest>) => void
}) {
  const next = nextPathStatus(request.status)
  const showQuickActions = request.status !== 'ricevuta' && request.status !== 'annullata'

  return (
    <div
      id={'request-' + request.id}
      className={
        'card kanban-card' +
        (dragging ? ' dragging' : '') +
        (saving ? ' saving' : '') +
        (rotting ? ' kanban-card-rotting' : '') +
        (highlighted ? ' kanban-card-highlighted' : '')
      }
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="kanban-card-main">
        <div className="kanban-card-top">
          <strong>{supplier?.name ?? 'fornitore eliminato'}</strong>
          <RequesterAvatar requester={requester} />
        </div>
        <span className="muted">{request.subject}</span>
        {request.quantity != null && (
          <span className="muted">
            {request.quantity} {request.quantity_unit ?? ''}
          </span>
        )}
      </div>

      <div className="kanban-card-value-row">
        <span className="kanban-card-value">{currency.format(estimatedValue(request))}</span>
      </div>

      {request.due_date && (
        <span className={'kanban-next-action' + (isOverdue(request.due_date) ? ' kanban-next-action-overdue' : '')}>
          Scadenza: {new Date(request.due_date).toLocaleDateString('it-IT')}
        </span>
      )}

      {rotting && <span className="kanban-rotting-label">Ferma da {daysSince(request.updated_at)} giorni — nessun aggiornamento</span>}

      {showQuickActions && (
        <div className="kanban-quick-actions">
          {next && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onChangeStatus(next)}>
              {next === 'ricevuta' ? '✓ Segna come ricevuta' : '→ ' + statusLabel(next)}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm kanban-lost-btn" onClick={() => onChangeStatus('annullata')}>
            Annulla
          </button>
        </div>
      )}

      <button type="button" className="kanban-details-toggle" onClick={onToggleExpand}>
        {expanded ? 'Nascondi dettagli ▾' : 'Dettagli e commenti ▸'}
      </button>
      {expanded && (
        <RequestDetails
          request={request}
          compact
          requesters={requesters}
          onChangeStatus={onChangeStatus}
          onChangeField={onChangeField}
        />
      )}
    </div>
  )
}

// ============ Attività guidate Acquisti (Visita Fornitore, Reclamo
// Fornitore, Reclamo Cliente, Riunione Interna) ============
// Mostra in sola lettura i campi guidati di un'attività già registrata —
// stessa idea di ActivityDetailsView in Pipeline.tsx.
function ProcurementActivityDetailsView({ details }: { details: ProcurementActivityDetails }) {
  if (!details) return null

  if (details.tag === 'VISITA FORNITORE') {
    return (
      <div className="activity-details-grid">
        {details.incontro && <span><strong>Incontro:</strong> {INCONTRO_TIPO_LABELS[details.incontro]}</span>}
        {details.temi_trattati && <span><strong>Temi trattati:</strong> {details.temi_trattati}</span>}
        {details.prodotti_presentati && <span><strong>Prodotti presentati:</strong> {details.prodotti_presentati}</span>}
        {details.prossimi_passi && <span><strong>Prossimi passi:</strong> {details.prossimi_passi}</span>}
        {details.prossimi_passi_data && (
          <span><strong>Data prossimi passi:</strong> {new Date(details.prossimi_passi_data).toLocaleDateString('it-IT')}</span>
        )}
      </div>
    )
  }

  if (details.tag === 'RIUNIONE INTERNA') {
    return (
      <div className="activity-details-grid">
        {details.reparti.length > 0 && <span><strong>Reparti:</strong> {details.reparti.join(', ')}</span>}
        {details.persone_presenti && <span><strong>Persone presenti:</strong> {details.persone_presenti}</span>}
        {details.temi_trattati && <span><strong>Temi trattati:</strong> {details.temi_trattati}</span>}
      </div>
    )
  }

  if (details.tag === 'RICHIESTA ANALISI CAMPIONE FORNITORE') {
    return (
      <div className="activity-details-grid">
        {details.richiesto_da && <span><strong>Richiesta da:</strong> {details.richiesto_da}</span>}
        {details.descrizione_prodotto && <span><strong>Descrizione prodotto:</strong> {details.descrizione_prodotto}</span>}
        {details.scheda_tecnica_url && (
          <span>
            <strong>Scheda tecnica:</strong>{' '}
            <a href={details.scheda_tecnica_url} target="_blank" rel="noreferrer">📎 {details.scheda_tecnica_name}</a>
          </span>
        )}
        {details.msds_url && (
          <span>
            <strong>MSDS:</strong> <a href={details.msds_url} target="_blank" rel="noreferrer">📎 {details.msds_name}</a>
          </span>
        )}
        {details.tipo_analisi && <span><strong>Descrizione analisi:</strong> {TIPO_ANALISI_LABELS[details.tipo_analisi]}</span>}
        {details.prodotto_da_comparare && <span><strong>Prodotto da comparare:</strong> {details.prodotto_da_comparare}</span>}
        {details.descrizione_richieste_analisi && (
          <span><strong>Descrizione richieste analisi:</strong> {details.descrizione_richieste_analisi}</span>
        )}
        {details.prossimi_passi && <span><strong>Prossimi passi:</strong> {details.prossimi_passi}</span>}
        {details.prossimi_passi_data && (
          <span><strong>Data prossimi passi:</strong> {new Date(details.prossimi_passi_data).toLocaleDateString('it-IT')}</span>
        )}
        {details.urgenza && <span><strong>Urgenza:</strong> {URGENZA_LABELS[details.urgenza]}</span>}
      </div>
    )
  }

  return (
    <div className="activity-details-grid">
      {details.ricezione && <span><strong>Ricezione reclamo:</strong> {RICEZIONE_RECLAMO_LABELS[details.ricezione]}</span>}
      {details.natura && <span><strong>Natura:</strong> {NATURA_RECLAMO_LABELS[details.natura]}</span>}
      {details.nome_prodotto && <span><strong>Nome prodotto:</strong> {details.nome_prodotto}</span>}
      {details.documento_numero && <span><strong>Documento n°:</strong> {details.documento_numero}</span>}
      {details.descrizione_prodotto && <span><strong>Descrizione prodotto:</strong> {details.descrizione_prodotto}</span>}
      {details.descrizione_servizio && <span><strong>Descrizione servizio:</strong> {details.descrizione_servizio}</span>}
      {details.riferimento_lotto && <span><strong>Riferimento lotto:</strong> {details.riferimento_lotto}</span>}
      {details.riferimento_documento && <span><strong>Riferimento documento:</strong> {details.riferimento_documento}</span>}
      {details.descrizione_reclamo && <span><strong>Descrizione reclamo:</strong> {details.descrizione_reclamo}</span>}
      {details.attachment_url && (
        <span>
          <strong>Allegato:</strong> <a href={details.attachment_url} target="_blank" rel="noreferrer">📎 {details.attachment_name}</a>
        </span>
      )}
      {details.prossimi_passi && <span><strong>Prossimi passi:</strong> {details.prossimi_passi}</span>}
      {details.prossimi_passi_data && (
        <span><strong>Data prossimi passi:</strong> {new Date(details.prossimi_passi_data).toLocaleDateString('it-IT')}</span>
      )}
      {details.urgenza && <span><strong>Urgenza:</strong> {URGENZA_LABELS[details.urgenza]}</span>}
    </div>
  )
}

function ProcurementActivityRow({
  activity,
  supplierName,
  clientName,
}: {
  activity: ProcurementActivity
  supplierName: string | undefined
  clientName: string | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  const tag = activity.activity_details?.tag ?? 'Attività'
  const who = supplierName ?? clientName ?? (tag === 'RIUNIONE INTERNA' ? 'Interna' : '—')
  return (
    <div>
      <div className="client-deal-row" style={{ cursor: 'pointer' }} onClick={() => setExpanded((v) => !v)}>
        <span className="client-timeline-when muted">
          {new Date(activity.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
        </span>
        <span>{tag}</span>
        <span className="muted">{who}</span>
        <span className="muted">{expanded ? 'Nascondi ▾' : 'Dettagli ▸'}</span>
      </div>
      {expanded && (
        <div className="activity-details-view">
          <ProcurementActivityDetailsView details={activity.activity_details} />
        </div>
      )}
    </div>
  )
}

const RICEZIONE_OPTIONS: RicezioneReclamo[] = ['mail', 'telefonica', 'di_persona']
const NATURA_OPTIONS: NaturaReclamo[] = ['prodotto', 'documentale', 'logistica', 'servizio']
const URGENZA_OPTIONS: Urgenza[] = ['bassa', 'media', 'alta']
const PROCUREMENT_INCONTRO_OPTIONS: IncontroTipo[] = ['in_sede', 'presso_cliente', 'fiera']
const PROCUREMENT_ACTIVITY_TYPES = [
  'VISITA FORNITORE',
  'RECLAMO FORNITORE',
  'RECLAMO CLIENTE',
  'RIUNIONE INTERNA',
  'RICHIESTA ANALISI CAMPIONE FORNITORE',
] as const
// "Descrizione analisi" della richiesta campione fornitore non include "Test
// pelle" — opzione pensata solo per il campione cliente (vedi Pipeline.tsx).
const TIPO_ANALISI_OPTIONS_FORNITORE: TipoAnalisi[] = ['comparativa', 'nuovo_prodotto']
// Stessa idea di NEW_CLIENT_OPTION in Pipeline.tsx: un fornitore non ancora
// in anagrafica si crea al volo dentro il form, senza dover prima passare
// dalla pagina Fornitori.
const NEW_SUPPLIER_OPTION = '__nuovo__'

function NewProcurementActivityForm({
  suppliers,
  clients,
  assignees,
  createdByName,
  onCreated,
}: {
  suppliers: Supplier[]
  clients: Client[]
  assignees: Profile[]
  createdByName: string
  onCreated: () => void
}) {
  const [activityTag, setActivityTag] = useState<'' | (typeof PROCUREMENT_ACTIVITY_TYPES)[number]>('')
  const [supplierId, setSupplierId] = useState('')
  const [clientId, setClientId] = useState('')

  // Fornitore non ancora in anagrafica, creato al volo — stessa idea del
  // blocco "nuovo cliente" in Pipeline.tsx.
  const [manualSupplierName, setManualSupplierName] = useState('')
  const [newSupplierCategory, setNewSupplierCategory] = useState('')
  const [newSupplierCountry, setNewSupplierCountry] = useState('')
  const [newSupplierContactName, setNewSupplierContactName] = useState('')
  const [newSupplierContactEmail, setNewSupplierContactEmail] = useState('')
  const [newSupplierContactPhone, setNewSupplierContactPhone] = useState('')
  const usingManualSupplier = supplierId === NEW_SUPPLIER_OPTION

  // VISITA FORNITORE
  const [incontro, setIncontro] = useState<IncontroTipo | ''>('')
  const [temiTrattatiVisita, setTemiTrattatiVisita] = useState('')
  const [prodottiPresentati, setProdottiPresentati] = useState('')
  const [prossimiPassiVisita, setProssimiPassiVisita] = useState('')
  const [prossimiPassiDataVisita, setProssimiPassiDataVisita] = useState('')

  // RECLAMO FORNITORE / RECLAMO CLIENTE (stessi campi, tag diverso)
  const [ricezione, setRicezione] = useState<RicezioneReclamo | ''>('')
  const [natura, setNatura] = useState<NaturaReclamo | ''>('')
  const [nomeProdotto, setNomeProdotto] = useState('')
  const [documentoNumero, setDocumentoNumero] = useState('')
  const [descrizioneProdotto, setDescrizioneProdotto] = useState('')
  const [descrizioneServizio, setDescrizioneServizio] = useState('')
  const [riferimentoLotto, setRiferimentoLotto] = useState('')
  const [riferimentoDocumento, setRiferimentoDocumento] = useState('')
  const [descrizioneReclamo, setDescrizioneReclamo] = useState('')
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const [attachmentName, setAttachmentName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [prossimiPassiReclamo, setProssimiPassiReclamo] = useState('')
  const [prossimiPassiDataReclamo, setProssimiPassiDataReclamo] = useState('')
  const [urgenza, setUrgenza] = useState<Urgenza | ''>('')

  // RIUNIONE INTERNA
  const [reparti, setReparti] = useState<string[]>([])
  const [personePresenti, setPersonePresenti] = useState('')
  const [temiTrattatiRiunione, setTemiTrattatiRiunione] = useState('')

  // RICHIESTA ANALISI CAMPIONE FORNITORE
  const [descrizioneProdottoAnalisi, setDescrizioneProdottoAnalisi] = useState('')
  const [schedaTecnicaUrl, setSchedaTecnicaUrl] = useState<string | null>(null)
  const [schedaTecnicaName, setSchedaTecnicaName] = useState<string | null>(null)
  const [uploadingSchedaTecnica, setUploadingSchedaTecnica] = useState(false)
  const [msdsUrl, setMsdsUrl] = useState<string | null>(null)
  const [msdsName, setMsdsName] = useState<string | null>(null)
  const [uploadingMsds, setUploadingMsds] = useState(false)
  const [tipoAnalisi, setTipoAnalisi] = useState<TipoAnalisi | ''>('')
  const [prodottoDaComparare, setProdottoDaComparare] = useState('')
  const [descrizioneRichiesteAnalisi, setDescrizioneRichiesteAnalisi] = useState('')
  const [prossimiPassiAnalisi, setProssimiPassiAnalisi] = useState('')
  const [prossimiPassiDataAnalisi, setProssimiPassiDataAnalisi] = useState('')
  const [urgenzaAnalisi, setUrgenzaAnalisi] = useState<Urgenza | ''>('')
  const [richiestoDaAnalisi, setRichiestoDaAnalisi] = useState('')

  const [assignments, setAssignments] = useState<PendingAssignment[]>([])
  const [saving, setSaving] = useState(false)

  const isReclamo = activityTag === 'RECLAMO FORNITORE' || activityTag === 'RECLAMO CLIENTE'
  const isRichiestaAnalisiFornitore = activityTag === 'RICHIESTA ANALISI CAMPIONE FORNITORE'

  function toggleReparto(r: string) {
    setReparti((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('procurement-attachments').upload(path, file, { upsert: true })
    setUploading(false)
    e.target.value = ''
    if (error) {
      alert("Non è stato possibile caricare l'allegato: " + error.message)
      return
    }
    const { data } = supabase.storage.from('procurement-attachments').getPublicUrl(path)
    setAttachmentUrl(data.publicUrl)
    setAttachmentName(file.name)
  }

  // Due allegati distinti per la richiesta analisi campione (scheda tecnica
  // e MSDS): stesso bucket "procurement-attachments" degli altri allegati,
  // solo due handler separati così restano due file indipendenti invece di
  // uno che sovrascrive l'altro.
  async function handleSchedaTecnicaChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingSchedaTecnica(true)
    const path = `scheda-tecnica-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('procurement-attachments').upload(path, file, { upsert: true })
    setUploadingSchedaTecnica(false)
    e.target.value = ''
    if (error) {
      alert('Non è stato possibile caricare la scheda tecnica: ' + error.message)
      return
    }
    const { data } = supabase.storage.from('procurement-attachments').getPublicUrl(path)
    setSchedaTecnicaUrl(data.publicUrl)
    setSchedaTecnicaName(file.name)
  }

  async function handleMsdsChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingMsds(true)
    const path = `msds-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('procurement-attachments').upload(path, file, { upsert: true })
    setUploadingMsds(false)
    e.target.value = ''
    if (error) {
      alert('Non è stato possibile caricare la MSDS: ' + error.message)
      return
    }
    const { data } = supabase.storage.from('procurement-attachments').getPublicUrl(path)
    setMsdsUrl(data.publicUrl)
    setMsdsName(file.name)
  }

  function validate(): string | null {
    if (!activityTag) return 'Seleziona il tipo di attività.'
    if (activityTag === 'VISITA FORNITORE' || activityTag === 'RECLAMO FORNITORE' || isRichiestaAnalisiFornitore) {
      if (!supplierId) return 'Seleziona il fornitore.'
      if (usingManualSupplier && !manualSupplierName.trim()) return 'Inserisci il nome del nuovo fornitore.'
    }
    if (activityTag === 'VISITA FORNITORE') {
      if (!incontro || !temiTrattatiVisita.trim() || !prodottiPresentati.trim() || !prossimiPassiVisita.trim()) {
        return 'Compila incontro, temi trattati, prodotti presentati e prossimi passi.'
      }
    }
    if (activityTag === 'RECLAMO CLIENTE' && !clientId) return 'Seleziona il cliente.'
    if (isReclamo) {
      if (!ricezione || !natura || !descrizioneReclamo.trim() || !prossimiPassiReclamo.trim() || !urgenza) {
        return 'Compila ricezione, natura del reclamo, descrizione, prossimi passi e urgenza.'
      }
    }
    if (activityTag === 'RIUNIONE INTERNA') {
      if (reparti.length === 0 || !personePresenti.trim() || !temiTrattatiRiunione.trim()) {
        return 'Compila reparti coinvolti, persone presenti e temi trattati.'
      }
    }
    if (isRichiestaAnalisiFornitore) {
      if (!descrizioneProdottoAnalisi.trim() || !tipoAnalisi || !prossimiPassiAnalisi.trim() || !urgenzaAnalisi || !richiestoDaAnalisi) {
        return 'Compila descrizione prodotto, descrizione analisi, prossimi passi, urgenza e da chi è stata richiesta.'
      }
      if (tipoAnalisi === 'comparativa' && !prodottoDaComparare.trim()) return 'Indica il prodotto da comparare.'
      if (tipoAnalisi === 'nuovo_prodotto' && !descrizioneRichiesteAnalisi.trim()) {
        return 'Indica la descrizione delle richieste di analisi.'
      }
    }
    for (const a of assignments) {
      if (!a.task.trim() || !a.dueDate) return 'Per ogni persona assegnata servono attività da svolgere e scadenza.'
    }
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      alert(validationError)
      return
    }
    setSaving(true)

    // Fornitore non ancora in anagrafica: lo creo prima di registrare
    // l'attività, così l'attività può collegarsi al suo id — stessa
    // sequenza del "nuovo cliente" in Pipeline.tsx.
    let resolvedSupplierId = supplierId
    let resolvedSupplierName = suppliers.find((s) => s.id === supplierId)?.name ?? ''
    if (usingManualSupplier) {
      const { data: newSupplier, error: supplierError } = await supabase
        .from('suppliers')
        .insert({
          name: manualSupplierName.trim(),
          category: newSupplierCategory.trim(),
          country: newSupplierCountry.trim() || null,
          contact_name: newSupplierContactName.trim() || null,
          contact_email: newSupplierContactEmail.trim() || null,
          contact_phone: newSupplierContactPhone.trim() || null,
        })
        .select()
        .single()
      if (supplierError) {
        setSaving(false)
        alert('Non è stato possibile creare la scheda fornitore: ' + supplierError.message)
        return
      }
      resolvedSupplierId = newSupplier.id
      resolvedSupplierName = newSupplier.name
    }

    let activityDetails: ProcurementActivityDetails = null
    let reclamoPriority: Urgenza | undefined
    let supplierIdToSave: string | null = null
    let clientIdToSave: string | null = null
    let subjectLabel: string = activityTag

    if (activityTag === 'VISITA FORNITORE') {
      supplierIdToSave = resolvedSupplierId
      activityDetails = {
        tag: 'VISITA FORNITORE',
        incontro,
        temi_trattati: temiTrattatiVisita.trim(),
        prodotti_presentati: prodottiPresentati.trim(),
        prossimi_passi: prossimiPassiVisita.trim(),
        prossimi_passi_data: prossimiPassiDataVisita,
      }
      subjectLabel = `${activityTag} — ${resolvedSupplierName}`
    } else if (activityTag === 'RECLAMO FORNITORE') {
      supplierIdToSave = resolvedSupplierId
      activityDetails = {
        tag: 'RECLAMO FORNITORE',
        ricezione,
        natura,
        nome_prodotto: nomeProdotto.trim(),
        documento_numero: documentoNumero.trim(),
        descrizione_prodotto: descrizioneProdotto.trim(),
        descrizione_servizio: descrizioneServizio.trim(),
        riferimento_lotto: riferimentoLotto.trim(),
        riferimento_documento: riferimentoDocumento.trim(),
        descrizione_reclamo: descrizioneReclamo.trim(),
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
        prossimi_passi: prossimiPassiReclamo.trim(),
        prossimi_passi_data: prossimiPassiDataReclamo,
        urgenza,
      }
      reclamoPriority = urgenza || undefined
      subjectLabel = `${activityTag} — ${resolvedSupplierName}`
    } else if (activityTag === 'RECLAMO CLIENTE') {
      clientIdToSave = clientId
      activityDetails = {
        tag: 'RECLAMO CLIENTE',
        ricezione,
        natura,
        nome_prodotto: nomeProdotto.trim(),
        documento_numero: documentoNumero.trim(),
        descrizione_prodotto: descrizioneProdotto.trim(),
        descrizione_servizio: descrizioneServizio.trim(),
        riferimento_lotto: riferimentoLotto.trim(),
        riferimento_documento: riferimentoDocumento.trim(),
        descrizione_reclamo: descrizioneReclamo.trim(),
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
        prossimi_passi: prossimiPassiReclamo.trim(),
        prossimi_passi_data: prossimiPassiDataReclamo,
        urgenza,
      }
      reclamoPriority = urgenza || undefined
      subjectLabel = `${activityTag} — ${clients.find((c) => c.id === clientId)?.name ?? ''}`
    } else if (activityTag === 'RIUNIONE INTERNA') {
      activityDetails = {
        tag: 'RIUNIONE INTERNA',
        reparti,
        persone_presenti: personePresenti.trim(),
        temi_trattati: temiTrattatiRiunione.trim(),
      }
    } else if (isRichiestaAnalisiFornitore) {
      supplierIdToSave = resolvedSupplierId
      activityDetails = {
        tag: 'RICHIESTA ANALISI CAMPIONE FORNITORE',
        descrizione_prodotto: descrizioneProdottoAnalisi.trim(),
        scheda_tecnica_url: schedaTecnicaUrl,
        scheda_tecnica_name: schedaTecnicaName,
        msds_url: msdsUrl,
        msds_name: msdsName,
        tipo_analisi: tipoAnalisi,
        prodotto_da_comparare: prodottoDaComparare.trim(),
        descrizione_richieste_analisi: descrizioneRichiesteAnalisi.trim(),
        prossimi_passi: prossimiPassiAnalisi.trim(),
        prossimi_passi_data: prossimiPassiDataAnalisi,
        urgenza: urgenzaAnalisi,
        richiesto_da: richiestoDaAnalisi,
      }
      reclamoPriority = urgenzaAnalisi || undefined
      subjectLabel = `${activityTag} — ${resolvedSupplierName}`
    }

    const { data: newActivity, error } = await supabase
      .from('procurement_activities')
      .insert({
        supplier_id: supplierIdToSave,
        client_id: clientIdToSave,
        activity_details: activityDetails,
      })
      .select()
      .single()
    if (error) {
      setSaving(false)
      alert("Non è stato possibile registrare l'attività: " + error.message)
      return
    }

    if (assignments.length > 0) {
      const { error: assignError } = await createActivityAssignments({
        assignments,
        profiles: assignees,
        refTable: 'procurement_activities',
        refId: newActivity.id,
        subject: subjectLabel,
        createdByName,
        priority: reclamoPriority,
      })
      if (assignError) {
        setSaving(false)
        alert("L'attività è stata registrata, ma non è stato possibile creare tutte le richieste di assegnazione: " + assignError)
        onCreated()
        return
      }
    }

    setSaving(false)
    onCreated()
  }

  return (
    <form className="card panel new-deal-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field-label">Tipo di attività</label>
        <select value={activityTag} onChange={(e) => setActivityTag(e.target.value as typeof activityTag)} required>
          <option value="">— Seleziona —</option>
          {PROCUREMENT_ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {(activityTag === 'VISITA FORNITORE' || activityTag === 'RECLAMO FORNITORE' || isRichiestaAnalisiFornitore) && (
        <>
          <div className="field-row">
            <label className="field-label">Fornitore</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">— Seleziona —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value={NEW_SUPPLIER_OPTION}>+ Fornitore non ancora in anagrafica…</option>
            </select>
          </div>

          {usingManualSupplier && (
            <div className="new-client-block">
              <div className="field-row">
                <label className="field-label">Nome fornitore</label>
                <input value={manualSupplierName} onChange={(e) => setManualSupplierName(e.target.value)} required />
                <span className="muted">Non ancora in anagrafica — la scheda fornitore verrà creata insieme alla richiesta.</span>
              </div>
              <div className="field-row-2">
                <div className="field-row">
                  <label className="field-label">Categoria (facoltativa)</label>
                  <input
                    value={newSupplierCategory}
                    onChange={(e) => setNewSupplierCategory(e.target.value)}
                    placeholder="es. materie prime, imballaggi"
                  />
                </div>
                <div className="field-row">
                  <label className="field-label">Paese (facoltativo)</label>
                  <input value={newSupplierCountry} onChange={(e) => setNewSupplierCountry(e.target.value)} />
                </div>
              </div>
              <div className="field-row-2">
                <div className="field-row">
                  <label className="field-label">Referente (facoltativo)</label>
                  <input value={newSupplierContactName} onChange={(e) => setNewSupplierContactName(e.target.value)} />
                </div>
                <div className="field-row">
                  <label className="field-label">Email referente (facoltativa)</label>
                  <input
                    type="email"
                    value={newSupplierContactEmail}
                    onChange={(e) => setNewSupplierContactEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="field-row">
                <label className="field-label">Telefono referente (facoltativo)</label>
                <input value={newSupplierContactPhone} onChange={(e) => setNewSupplierContactPhone(e.target.value)} />
              </div>
            </div>
          )}
        </>
      )}

      {activityTag === 'RECLAMO CLIENTE' && (
        <div className="field-row">
          <label className="field-label">Cliente</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">— Seleziona —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {activityTag === 'VISITA FORNITORE' && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">Visita fornitore</span>
          <div className="field-row">
            <label className="field-label">Incontro</label>
            <select value={incontro} onChange={(e) => setIncontro(e.target.value as IncontroTipo)} required>
              <option value="">— Seleziona —</option>
              {PROCUREMENT_INCONTRO_OPTIONS.map((i) => (
                <option key={i} value={i}>
                  {INCONTRO_TIPO_LABELS[i]}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Temi trattati</label>
            <textarea value={temiTrattatiVisita} onChange={(e) => setTemiTrattatiVisita(e.target.value)} required />
          </div>
          <div className="field-row">
            <label className="field-label">Prodotti presentati</label>
            <input value={prodottiPresentati} onChange={(e) => setProdottiPresentati(e.target.value)} required />
          </div>
          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Prossimi passi</label>
              <textarea value={prossimiPassiVisita} onChange={(e) => setProssimiPassiVisita(e.target.value)} required />
            </div>
            <div className="field-row">
              <label className="field-label">Data prossimi passi (facoltativa)</label>
              <input type="date" value={prossimiPassiDataVisita} onChange={(e) => setProssimiPassiDataVisita(e.target.value)} />
            </div>
          </div>
          <ActivityAssignment profiles={assignees} assignments={assignments} onChange={setAssignments} />
        </div>
      )}

      {isReclamo && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">{activityTag === 'RECLAMO FORNITORE' ? 'Reclamo fornitore' : 'Reclamo cliente'}</span>
          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Ricezione reclamo</label>
              <select value={ricezione} onChange={(e) => setRicezione(e.target.value as RicezioneReclamo)} required>
                <option value="">— Seleziona —</option>
                {RICEZIONE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {RICEZIONE_RECLAMO_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label">Natura del reclamo</label>
              <select value={natura} onChange={(e) => setNatura(e.target.value as NaturaReclamo)} required>
                <option value="">— Seleziona —</option>
                {NATURA_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {NATURA_RECLAMO_LABELS[n]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {natura === 'prodotto' && (
            <div className="field-row-2">
              <div className="field-row">
                <label className="field-label">Nome prodotto</label>
                <input value={nomeProdotto} onChange={(e) => setNomeProdotto(e.target.value)} required />
              </div>
              <div className="field-row">
                <label className="field-label">Riferimento lotto</label>
                <input value={riferimentoLotto} onChange={(e) => setRiferimentoLotto(e.target.value)} required />
              </div>
            </div>
          )}
          {natura === 'documentale' && (
            <div className="field-row-2">
              <div className="field-row">
                <label className="field-label">Documento n°</label>
                <input value={documentoNumero} onChange={(e) => setDocumentoNumero(e.target.value)} required />
              </div>
              <div className="field-row">
                <label className="field-label">Descrizione prodotto</label>
                <input value={descrizioneProdotto} onChange={(e) => setDescrizioneProdotto(e.target.value)} required />
              </div>
              <div className="field-row">
                <label className="field-label">Riferimento lotto</label>
                <input value={riferimentoLotto} onChange={(e) => setRiferimentoLotto(e.target.value)} required />
              </div>
            </div>
          )}
          {natura === 'servizio' && (
            <div className="field-row-2">
              <div className="field-row">
                <label className="field-label">Descrizione servizio</label>
                <input value={descrizioneServizio} onChange={(e) => setDescrizioneServizio(e.target.value)} required />
              </div>
              <div className="field-row">
                <label className="field-label">Riferimento documento</label>
                <input value={riferimentoDocumento} onChange={(e) => setRiferimentoDocumento(e.target.value)} required />
              </div>
            </div>
          )}
          {natura === 'logistica' && (
            <p className="muted">
              Per "Non conformità logistica" non ho ancora campi specifici — usa la descrizione qui sotto, dimmi tu
              cosa aggiungere.
            </p>
          )}

          <div className="field-row">
            <label className="field-label">Allega foto/video (facoltativo)</label>
            {attachmentUrl ? (
              <div className="marketing-attachment-row">
                <a href={attachmentUrl} target="_blank" rel="noreferrer">📎 {attachmentName}</a>
                <button type="button" className="btn btn-ghost" onClick={() => { setAttachmentUrl(null); setAttachmentName(null) }}>
                  Rimuovi
                </button>
              </div>
            ) : (
              <input type="file" onChange={handleFileChange} disabled={uploading} />
            )}
            {uploading && <span className="muted">Caricamento…</span>}
          </div>

          <div className="field-row">
            <label className="field-label">Descrizione reclamo</label>
            <textarea value={descrizioneReclamo} onChange={(e) => setDescrizioneReclamo(e.target.value)} required />
          </div>

          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Prossimi passi</label>
              <textarea value={prossimiPassiReclamo} onChange={(e) => setProssimiPassiReclamo(e.target.value)} required />
            </div>
            <div className="field-row">
              <label className="field-label">Data prossimi passi (facoltativa)</label>
              <input type="date" value={prossimiPassiDataReclamo} onChange={(e) => setProssimiPassiDataReclamo(e.target.value)} />
            </div>
          </div>

          <div className="field-row">
            <label className="field-label">Urgenza</label>
            <select value={urgenza} onChange={(e) => setUrgenza(e.target.value as Urgenza)} required>
              <option value="">— Seleziona —</option>
              {URGENZA_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {URGENZA_LABELS[u]}
                </option>
              ))}
            </select>
          </div>

          <ActivityAssignment profiles={assignees} assignments={assignments} onChange={setAssignments} />
        </div>
      )}

      {activityTag === 'RIUNIONE INTERNA' && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">Riunione interna</span>
          <div className="field-row">
            <label className="field-label">Reparti coinvolti (selezione multipla)</label>
            <div className="tag-editor-chips">
              {REPARTI_RIUNIONE.map((r) => (
                <button
                  type="button"
                  key={r}
                  className={'tag-pick' + (reparti.includes(r) ? ' selected' : '')}
                  onClick={() => toggleReparto(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">Persone presenti</label>
            <input value={personePresenti} onChange={(e) => setPersonePresenti(e.target.value)} required />
          </div>
          <div className="field-row">
            <label className="field-label">Temi trattati</label>
            <textarea value={temiTrattatiRiunione} onChange={(e) => setTemiTrattatiRiunione(e.target.value)} required />
          </div>
          <ActivityAssignment profiles={assignees} assignments={assignments} onChange={setAssignments} />
        </div>
      )}

      {isRichiestaAnalisiFornitore && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">Richiesta analisi campione fornitore</span>
          <div className="field-row">
            <label className="field-label">Descrizione prodotto</label>
            <textarea value={descrizioneProdottoAnalisi} onChange={(e) => setDescrizioneProdottoAnalisi(e.target.value)} required />
          </div>

          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Schede tecniche (facoltativo)</label>
              {schedaTecnicaUrl ? (
                <div className="marketing-attachment-row">
                  <a href={schedaTecnicaUrl} target="_blank" rel="noreferrer">📎 {schedaTecnicaName}</a>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => { setSchedaTecnicaUrl(null); setSchedaTecnicaName(null) }}
                  >
                    Rimuovi
                  </button>
                </div>
              ) : (
                <input type="file" onChange={handleSchedaTecnicaChange} disabled={uploadingSchedaTecnica} />
              )}
              {uploadingSchedaTecnica && <span className="muted">Caricamento…</span>}
            </div>
            <div className="field-row">
              <label className="field-label">MSDS (facoltativo)</label>
              {msdsUrl ? (
                <div className="marketing-attachment-row">
                  <a href={msdsUrl} target="_blank" rel="noreferrer">📎 {msdsName}</a>
                  <button type="button" className="btn btn-ghost" onClick={() => { setMsdsUrl(null); setMsdsName(null) }}>
                    Rimuovi
                  </button>
                </div>
              ) : (
                <input type="file" onChange={handleMsdsChange} disabled={uploadingMsds} />
              )}
              {uploadingMsds && <span className="muted">Caricamento…</span>}
            </div>
          </div>

          <div className="field-row">
            <label className="field-label">Descrizione analisi</label>
            <select value={tipoAnalisi} onChange={(e) => setTipoAnalisi(e.target.value as TipoAnalisi)} required>
              <option value="">— Seleziona —</option>
              {TIPO_ANALISI_OPTIONS_FORNITORE.map((t) => (
                <option key={t} value={t}>
                  {TIPO_ANALISI_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {tipoAnalisi === 'comparativa' && (
            <div className="field-row">
              <label className="field-label">Prodotto da comparare</label>
              <input value={prodottoDaComparare} onChange={(e) => setProdottoDaComparare(e.target.value)} required />
            </div>
          )}
          {tipoAnalisi === 'nuovo_prodotto' && (
            <div className="field-row">
              <label className="field-label">Descrizione richieste analisi</label>
              <textarea value={descrizioneRichiesteAnalisi} onChange={(e) => setDescrizioneRichiesteAnalisi(e.target.value)} required />
            </div>
          )}

          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Prossimi passi</label>
              <textarea value={prossimiPassiAnalisi} onChange={(e) => setProssimiPassiAnalisi(e.target.value)} required />
            </div>
            <div className="field-row">
              <label className="field-label">Data prossimi passi (facoltativa)</label>
              <input type="date" value={prossimiPassiDataAnalisi} onChange={(e) => setProssimiPassiDataAnalisi(e.target.value)} />
            </div>
          </div>

          <div className="field-row">
            <label className="field-label">Urgenza</label>
            <select value={urgenzaAnalisi} onChange={(e) => setUrgenzaAnalisi(e.target.value as Urgenza)} required>
              <option value="">— Seleziona —</option>
              {URGENZA_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {URGENZA_LABELS[u]}
                </option>
              ))}
            </select>
          </div>

          <div className="field-row">
            <label className="field-label">Richiesta da</label>
            <select value={richiestoDaAnalisi} onChange={(e) => setRichiestoDaAnalisi(e.target.value)} required>
              <option value="">— Seleziona —</option>
              {assignees.map((p) => (
                <option key={p.id} value={p.full_name}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>

          <ActivityAssignment profiles={assignees} assignments={assignments} onChange={setAssignments} />
          <p className="muted">L'attività verrà girata al laboratorio Ricerca&Sviluppo tramite l'assegnazione sopra.</p>
        </div>
      )}

      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Salvataggio…' : 'Registra attività'}
      </button>
    </form>
  )
}
