import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CommentThread } from '../components/CommentThread'
import { ActivityAssignment, createActivityAssignments } from '../components/ActivityAssignment'
import {
  CLIENT_TYPE_LABELS,
  DEAL_STAGES,
  INCONTRO_TIPO_LABELS,
  NATURA_RECLAMO_LABELS,
  REPARTI_RIUNIONE,
  RICEZIONE_RECLAMO_LABELS,
  TIPO_ANALISI_LABELS,
  URGENZA_LABELS,
  type Client,
  type ClientType,
  type Deal,
  type DealActivityDetails,
  type DealStage,
  type IncontroTipo,
  type NaturaReclamo,
  type PendingAssignment,
  type Profile,
  type RicezioneReclamo,
  type TipoAnalisi,
  type Urgenza,
} from '../lib/types'

const CAN_CREATE_DELETE: string[] = ['commerciale', 'dirigente']

const currency = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

// "Trattativa ferma" (ispirato al "rotting" di Pipedrive): se una trattativa
// aperta non viene toccata da più di ROTTING_DAYS giorni, la evidenziamo in
// rosso. Non serve nessun campo nuovo: usiamo "updated_at" (vedi 0003_triggers.sql).
const ROTTING_DAYS = 14
const OPEN_STAGES: string[] = ['lead', 'qualificato', 'proposta']

// Probabilità di chiusura per fase, come il campo "Probability" delle
// Opportunity in Salesforce.
// "trattativa" non è più una fase selezionabile (tolta con "Primo Contatto"
// / "Conferma Ordine", set 2026) ma resta qui perché il tipo DealStage
// rispecchia l'enum del database, dove il valore esiste ancora — non è mai
// raggiungibile dall'interfaccia.
const STAGE_PROBABILITY: Record<DealStage, number> = {
  lead: 10,
  qualificato: 25,
  proposta: 50,
  trattativa: 50,
  vinto: 100,
  perso: 0,
}

// Le fasi del percorso "sano" di una trattativa (senza "perso", che è
// un'uscita, non uno step) — usate per il componente "Path" e per il
// pulsante di avanzamento rapido, sempre ispirati a Salesforce.
const PATH_STAGES: DealStage[] = ['lead', 'qualificato', 'proposta', 'vinto']

function nextPathStage(stage: DealStage): DealStage | null {
  const idx = PATH_STAGES.indexOf(stage)
  if (idx === -1 || idx === PATH_STAGES.length - 1) return null
  return PATH_STAGES[idx + 1]
}

function stageLabel(stage: DealStage): string {
  return DEAL_STAGES.find((s) => s.id === stage)?.label ?? stage
}

function daysSince(dateStr: string): number {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diffMs / 86_400_000)
}

function isRotting(deal: Deal): boolean {
  return OPEN_STAGES.includes(deal.stage) && daysSince(deal.updated_at) > ROTTING_DAYS
}

function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date(new Date().toDateString())
}

type SortKey = 'recenti' | 'valore_desc' | 'valore_asc' | 'azione' | 'ferme'

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'recenti', label: 'Più recenti' },
  { id: 'valore_desc', label: 'Valore (dal più alto)' },
  { id: 'valore_asc', label: 'Valore (dal più basso)' },
  { id: 'azione', label: 'Prossima azione' },
  { id: 'ferme', label: 'Ferme da più tempo' },
]

function compareDeals(a: Deal, b: Deal, sortBy: SortKey): number {
  switch (sortBy) {
    case 'valore_desc':
      return Number(b.value_estimate) - Number(a.value_estimate)
    case 'valore_asc':
      return Number(a.value_estimate) - Number(b.value_estimate)
    case 'azione': {
      if (a.next_action && b.next_action) return new Date(a.next_action).getTime() - new Date(b.next_action).getTime()
      if (a.next_action) return -1
      if (b.next_action) return 1
      return 0
    }
    case 'ferme':
      return daysSince(b.updated_at) - daysSince(a.updated_at)
    case 'recenti':
    default:
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  }
}

export function Pipeline() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [deals, setDeals] = useState<Deal[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('recenti')

  const canCreate = profile ? CAN_CREATE_DELETE.includes(profile.role) : false
  // Il tecnico vede tutto ma, per via del trigger nel database, può salvare
  // solo modifiche al campo "note": niente trascinamento, niente cambio fase
  // o proprietario — il vero controllo resta comunque lato server (0003_triggers.sql).
  const canEditFields = profile?.role === 'commerciale' || profile?.role === 'dirigente'

  async function loadDeals() {
    setLoading(true)
    const { data, error } = await supabase.from('deals').select('*').order('created_at', { ascending: false })
    if (error) console.error(error)
    setDeals((data as Deal[]) ?? [])
    setLoading(false)
  }

  async function loadClients() {
    const { data, error } = await supabase.from('clients').select('*').order('name')
    if (error) console.error(error)
    setClients((data as Client[]) ?? [])
  }

  useEffect(() => {
    loadDeals()
    loadClients()
    supabase
      .from('profiles')
      .select('*')
      .then(({ data }) => setProfiles((data as Profile[]) ?? []))
  }, [])

  // Un link "da fuori" (dal Calendario, da una richiesta collegata) può
  // indicare quale trattativa aprire: la evidenziamo e ci scorriamo sopra.
  // Azzeriamo anche filtri e vista, altrimenti la trattativa collegata
  // potrebbe restare nascosta da un filtro attivo.
  useEffect(() => {
    const fromLink = searchParams.get('deal')
    if (!fromLink || deals.length === 0) return
    setView('kanban')
    setSearch('')
    setOwnerFilter('')
    setExpandedId(fromLink)
    setHighlightedId(fromLink)
    setSearchParams({}, { replace: true })
    const timeout = setTimeout(() => {
      document.getElementById('deal-' + fromLink)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    const clearHighlight = setTimeout(() => setHighlightedId(null), 3000)
    return () => {
      clearTimeout(timeout)
      clearTimeout(clearHighlight)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, deals])

  async function updateStage(deal: Deal, stage: DealStage) {
    if (deal.stage === stage) return
    setSavingId(deal.id)
    // Aggiornamento ottimista: la card si sposta subito, senza aspettare il
    // giro di rete. Se il salvataggio fallisce, ricarichiamo i dati veri.
    setDeals((current) => current.map((d) => (d.id === deal.id ? { ...d, stage } : d)))
    const { error } = await supabase.from('deals').update({ stage }).eq('id', deal.id)
    setSavingId(null)
    if (error) {
      alert('Non è stato possibile aggiornare la fase: ' + error.message)
      loadDeals()
    }
  }

  async function updateOwner(deal: Deal, ownerId: string | null) {
    const { error } = await supabase.from('deals').update({ owner_id: ownerId }).eq('id', deal.id)
    if (error) {
      alert('Non è stato possibile aggiornare il proprietario: ' + error.message)
      return
    }
    setDeals((ds) => ds.map((d) => (d.id === deal.id ? { ...d, owner_id: ownerId } : d)))
  }

  async function updateNote(deal: Deal, note: string) {
    const { error } = await supabase.from('deals').update({ note }).eq('id', deal.id)
    if (error) alert('Non è stato possibile salvare la nota: ' + error.message)
  }

  const ownerMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])
  const ownerOptions = useMemo(
    () => profiles.filter((p) => p.role === 'commerciale' || p.role === 'dirigente').sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [profiles],
  )

  const filteredDeals = useMemo(() => {
    const q = search.trim().toLowerCase()
    return deals.filter((d) => {
      if (q && !(d.client_name.toLowerCase().includes(q) || d.product.toLowerCase().includes(q))) return false
      if (ownerFilter && d.owner_id !== ownerFilter) return false
      return true
    })
  }, [deals, search, ownerFilter])

  if (!profile) return null

  if (profile.role === 'operatore') {
    return (
      <div className="view">
        <h1>Pipeline clienti</h1>
        <p className="muted">Il ruolo operatore non ha accesso alla pipeline commerciale.</p>
      </div>
    )
  }

  return (
    <div className="view view-wide">
      <div className="view-head">
        <h1>Pipeline clienti</h1>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Annulla' : '+ Nuovo lead'}
          </button>
        )}
      </div>
      {canCreate && !showForm && (
        <p className="muted">
          Un nuovo lead si apre da qui, con il pulsante "+ Nuovo lead" qui sopra — entra direttamente in pipeline
          nella fase "Nuovo Lead".
        </p>
      )}

      {showForm && (
        <NewDealForm
          clients={clients}
          owners={ownerOptions}
          assignees={profiles}
          defaultOwnerId={profile.id}
          createdByName={profile.full_name}
          onCreated={() => { setShowForm(false); loadDeals() }}
        />
      )}

      {loading && <p className="muted">Caricamento…</p>}

      {!loading && (
        <>
          <div className="pipeline-toolbar">
            <input
              className="pipeline-search-input"
              placeholder="Cerca cliente o prodotto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
              <option value="">Tutti i proprietari</option>
              {ownerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
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

          {filteredDeals.length === 0 && (
            <p className="muted">Nessuna trattativa corrisponde ai filtri selezionati.</p>
          )}

          {filteredDeals.length > 0 && view === 'kanban' && (
            <div className="kanban-board">
              {DEAL_STAGES.map((stage) => {
                const rows = filteredDeals.filter((d) => d.stage === stage.id).sort((a, b) => compareDeals(a, b, sortBy))
                const total = rows.reduce((sum, d) => sum + Number(d.value_estimate), 0)
                const rottingCount = rows.filter(isRotting).length
                return (
                  <div
                    key={stage.id}
                    className={'kanban-col' + (dragOverStage === stage.id ? ' drag-over' : '')}
                    onDragOver={(e) => {
                      if (!canEditFields || !draggedId) return
                      e.preventDefault()
                      setDragOverStage(stage.id)
                    }}
                    onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOverStage(null)
                      if (!canEditFields) return
                      const id = e.dataTransfer.getData('text/plain')
                      const deal = deals.find((d) => d.id === id)
                      if (deal) updateStage(deal, stage.id)
                    }}
                  >
                    <div className="kanban-col-head">
                      <span>
                        {stage.label} <span className="muted">· {rows.length}</span>
                        {rottingCount > 0 && (
                          <span className="kanban-rotting-badge" title={`${rottingCount} ferma/e da più di ${ROTTING_DAYS} giorni`}>
                            {rottingCount}
                          </span>
                        )}
                      </span>
                      <span className="kanban-col-probability">{STAGE_PROBABILITY[stage.id]}%</span>
                    </div>
                    <div className="kanban-col-total-row muted">{currency.format(total)}</div>

                    <div className="kanban-cards">
                      {rows.length === 0 && <p className="muted kanban-empty">Nessuna trattativa qui.</p>}
                      {rows.map((deal) => (
                        <DealCard
                          key={deal.id}
                          deal={deal}
                          owner={deal.owner_id ? ownerMap.get(deal.owner_id) : undefined}
                          rotting={isRotting(deal)}
                          dragging={draggedId === deal.id}
                          saving={savingId === deal.id}
                          highlighted={highlightedId === deal.id}
                          canEditFields={canEditFields}
                          canDrag={canEditFields}
                          expanded={expandedId === deal.id}
                          owners={ownerOptions}
                          onToggleExpand={() => setExpandedId((id) => (id === deal.id ? null : deal.id))}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', deal.id)
                            e.dataTransfer.effectAllowed = 'move'
                            setDraggedId(deal.id)
                          }}
                          onDragEnd={() => {
                            setDraggedId(null)
                            setDragOverStage(null)
                          }}
                          onChangeStage={(s) => updateStage(deal, s)}
                          onChangeOwner={(id) => updateOwner(deal, id)}
                          onChangeNote={(note) => updateNote(deal, note)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {filteredDeals.length > 0 && view === 'list' && (
            <div className="pipeline-list">
              <div className="pipeline-list-head">
                <span className="pcol-client">Cliente / prodotto</span>
                <span className="pcol-stage">Fase</span>
                <button type="button" className="pcol-value" onClick={() => setSortBy('valore_desc')}>
                  Valore
                </button>
                <span className="pcol-weighted">Pesato</span>
                <span className="pcol-owner">Prop.</span>
                <button type="button" className="pcol-action" onClick={() => setSortBy('azione')}>
                  Prossima azione
                </button>
                <span className="pcol-expand" />
              </div>
              {filteredDeals
                .slice()
                .sort((a, b) => compareDeals(a, b, sortBy))
                .map((deal) => {
                  const owner = deal.owner_id ? ownerMap.get(deal.owner_id) : undefined
                  const rotting = isRotting(deal)
                  return (
                    <div key={deal.id} id={'deal-' + deal.id}>
                      <div
                        className={
                          'pipeline-row' +
                          (highlightedId === deal.id ? ' pipeline-row-highlighted' : '') +
                          (rotting ? ' pipeline-row-rotting' : '')
                        }
                        onClick={() => setExpandedId((id) => (id === deal.id ? null : deal.id))}
                      >
                        <div className="pcol-client">
                          <strong>{deal.client_name}</strong>
                          <span className="muted">{deal.product}</span>
                        </div>
                        <span className={'pill pill-stage-' + deal.stage}>{stageLabel(deal.stage)}</span>
                        <span className="pcol-value pipeline-row-value">{currency.format(deal.value_estimate)}</span>
                        <span className="pcol-weighted muted">
                          {currency.format((Number(deal.value_estimate) * STAGE_PROBABILITY[deal.stage]) / 100)}
                        </span>
                        <span className="pcol-owner">
                          <OwnerAvatar owner={owner} />
                        </span>
                        <span className={'pcol-action' + (deal.next_action && isOverdue(deal.next_action) ? ' pipeline-action-overdue' : '')}>
                          {deal.next_action ? new Date(deal.next_action).toLocaleDateString('it-IT') : '—'}
                        </span>
                        <span className="pcol-expand">{expandedId === deal.id ? '▾' : '▸'}</span>
                      </div>
                      {expandedId === deal.id && (
                        <div className="pipeline-row-expanded">
                          <DealDetails
                            deal={deal}
                            canEditFields={canEditFields}
                            owners={ownerOptions}
                            onChangeStage={(s) => updateStage(deal, s)}
                            onChangeOwner={(id) => updateOwner(deal, id)}
                            onChangeNote={(note) => updateNote(deal, note)}
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

function OwnerAvatar({ owner }: { owner: Profile | undefined }) {
  if (!owner) {
    return (
      <span className="deal-owner-avatar deal-owner-avatar-empty" title="Nessun proprietario assegnato">
        —
      </span>
    )
  }
  return (
    <span className="deal-owner-avatar" title={owner.full_name}>
      {owner.initials}
    </span>
  )
}

// Lo stepper di fase ispirato al componente "Path" delle Opportunity di
// Salesforce. In "compact" (dentro una card della bacheca, larga ~230px di
// contenuto) mostra solo pallini collegati da una linea — nessuna etichetta
// di testo, per evitare che 5 nomi di fase si sovrappongano in uno spazio
// troppo stretto. Il nome della fase corrente resta comunque visibile come
// testo separato sotto i pallini. La versione estesa (con le etichette),
// usata nella vista Elenco dove lo spazio è ampio, usa una grid a colonne
// elastiche (minmax(0, 1fr)) invece di flex: una grid non lascia mai che il
// contenuto di una colonna spinga le altre fuori posto, mentre una riga
// flex sì (il motivo per cui le etichette si sovrapponevano prima).
function StagePath({
  deal,
  canEdit,
  compact = false,
  onChangeStage,
}: {
  deal: Deal
  canEdit: boolean
  compact?: boolean
  onChangeStage: (stage: DealStage) => void
}) {
  if (deal.stage === 'perso') {
    return (
      <div className="stage-path-lost">
        <span className="stage-path-lost-label">Trattativa persa</span>
        {canEdit && (
          <button type="button" className="stage-path-lost-btn" onClick={() => onChangeStage('lead')}>
            Riapri come lead
          </button>
        )}
      </div>
    )
  }

  const currentIdx = PATH_STAGES.indexOf(deal.stage)

  if (compact) {
    const track: ReactNode[] = []
    PATH_STAGES.forEach((s, i) => {
      const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo'
      track.push(
        <button
          type="button"
          key={s}
          title={stageLabel(s) + ' · ' + STAGE_PROBABILITY[s] + '%'}
          className={'stage-path-dot-only stage-path-' + state}
          disabled={!canEdit}
          onClick={() => onChangeStage(s)}
        />,
      )
      if (i < PATH_STAGES.length - 1) {
        track.push(<span key={s + '-c'} className={'stage-path-connector' + (i < currentIdx ? ' done' : '')} />)
      }
    })
    return (
      <div className="stage-path-compact">
        <div className="stage-path-compact-track">{track}</div>
        <div className="stage-path-compact-foot">
          <span className="muted">
            {stageLabel(deal.stage)} · {STAGE_PROBABILITY[deal.stage]}%
          </span>
          {canEdit && deal.stage !== 'vinto' && (
            <button type="button" className="stage-path-lost-btn" onClick={() => onChangeStage('perso')}>
              Persa
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="stage-path">
      <div className="stage-path-track">
        {PATH_STAGES.map((s, i) => {
          const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo'
          return (
            <button
              type="button"
              key={s}
              className={'stage-path-step stage-path-' + state}
              disabled={!canEdit}
              onClick={() => onChangeStage(s)}
            >
              <span className="stage-path-dot">{state === 'done' ? '✓' : i + 1}</span>
              <span className="stage-path-label">{stageLabel(s)}</span>
            </button>
          )
        })}
      </div>
      {canEdit && deal.stage !== 'vinto' && (
        <div className="stage-path-foot">
          <button type="button" className="stage-path-lost-btn" onClick={() => onChangeStage('perso')}>
            Segna come persa
          </button>
        </div>
      )}
    </div>
  )
}

// Mostra in sola lettura i campi guidati salvati alla creazione del lead
// (deal.activity_details). Per ora solo visualizzazione: la modifica dopo
// la creazione arriverà in un passo successivo, quando saranno chiari gli
// altri tag guidati da aggiungere.
function ActivityDetailsView({ details }: { details: DealActivityDetails }) {
  if (!details) return null

  if (details.tag === 'PRIMA VISITA' || details.tag === 'VISITA COMMERCIALE CLIENTE') {
    return (
      <div className="activity-details-view">
        <span className="activity-details-title">
          Dettagli · {details.tag === 'PRIMA VISITA' ? 'Prima visita' : 'Visita commerciale cliente'}
        </span>
        <div className="activity-details-grid">
          {details.incontro && <span><strong>Incontro:</strong> {INCONTRO_TIPO_LABELS[details.incontro]}</span>}
          {details.temi_trattati && <span><strong>Temi trattati:</strong> {details.temi_trattati}</span>}
          {details.prodotti_presentati && <span><strong>Prodotti presentati:</strong> {details.prodotti_presentati}</span>}
          {details.prossimi_passi && <span><strong>Prossimi passi:</strong> {details.prossimi_passi}</span>}
        </div>
      </div>
    )
  }

  if (details.tag === 'VISITA TECNICA CLIENTE') {
    return (
      <div className="activity-details-view">
        <span className="activity-details-title">Dettagli · Visita tecnica cliente</span>
        <div className="activity-details-grid">
          {details.incontro && <span><strong>Incontro:</strong> {INCONTRO_TIPO_LABELS[details.incontro]}</span>}
          {details.attivita_svolte && <span><strong>Attività svolte:</strong> {details.attivita_svolte}</span>}
          {details.articoli_provati && <span><strong>Articoli provati:</strong> {details.articoli_provati}</span>}
          {details.prodotti_testati && <span><strong>Prodotti testati:</strong> {details.prodotti_testati}</span>}
          {details.prossimi_passi && <span><strong>Prossimi passi:</strong> {details.prossimi_passi}</span>}
        </div>
      </div>
    )
  }

  if (details.tag === 'RECLAMO CLIENTE') {
    return (
      <div className="activity-details-view">
        <span className="activity-details-title">Dettagli · Reclamo cliente</span>
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
          {details.urgenza && <span><strong>Urgenza:</strong> {URGENZA_LABELS[details.urgenza]}</span>}
        </div>
      </div>
    )
  }

  if (details.tag === 'RIUNIONE INTERNA') {
    return (
      <div className="activity-details-view">
        <span className="activity-details-title">Dettagli · Riunione interna</span>
        <div className="activity-details-grid">
          {details.reparti.length > 0 && <span><strong>Reparti:</strong> {details.reparti.join(', ')}</span>}
          {details.persone_presenti && <span><strong>Persone presenti:</strong> {details.persone_presenti}</span>}
          {details.temi_trattati && <span><strong>Temi trattati:</strong> {details.temi_trattati}</span>}
        </div>
      </div>
    )
  }

  if (details.tag === 'RICHIESTA ANALISI CAMPIONE CLIENTE') {
    return (
      <div className="activity-details-view">
        <span className="activity-details-title">Dettagli · Richiesta analisi campione cliente</span>
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
          {details.descrizione_analisi_test_pelle && (
            <span><strong>Descrizione analisi (test pelle):</strong> {details.descrizione_analisi_test_pelle}</span>
          )}
          {details.metodo_test && <span><strong>Metodo test:</strong> {details.metodo_test}</span>}
          {details.prossimi_passi && <span><strong>Prossimi passi:</strong> {details.prossimi_passi}</span>}
          {details.urgenza && <span><strong>Urgenza:</strong> {URGENZA_LABELS[details.urgenza]}</span>}
        </div>
      </div>
    )
  }

  return null
}

function DealDetails({
  deal,
  canEditFields,
  compact = false,
  owners,
  onChangeStage,
  onChangeOwner,
  onChangeNote,
}: {
  deal: Deal
  canEditFields: boolean
  compact?: boolean
  owners: Profile[]
  onChangeStage: (s: DealStage) => void
  onChangeOwner: (ownerId: string | null) => void
  onChangeNote: (note: string) => void
}) {
  return (
    <div className="kanban-card-expanded" onClick={(e) => e.stopPropagation()}>
      <StagePath deal={deal} canEdit={canEditFields} compact={compact} onChangeStage={onChangeStage} />
      <ActivityDetailsView details={deal.activity_details} />
      {canEditFields && (
        <div className="field-row">
          <label className="field-label">Proprietario</label>
          <select value={deal.owner_id ?? ''} onChange={(e) => onChangeOwner(e.target.value || null)}>
            <option value="">— Nessuno —</option>
            {owners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field-row">
        <label className="field-label">Nota</label>
        <textarea
          className="note-field"
          defaultValue={deal.note}
          placeholder="Nota…"
          onBlur={(e) => {
            if (e.target.value !== deal.note) onChangeNote(e.target.value)
          }}
        />
      </div>
      <CommentThread refTable="deals" refId={deal.id} refLabel={`${deal.client_name} — ${deal.product}`} />
    </div>
  )
}

function DealCard({
  deal,
  owner,
  rotting,
  dragging,
  saving,
  highlighted,
  canEditFields,
  canDrag,
  expanded,
  owners,
  onToggleExpand,
  onDragStart,
  onDragEnd,
  onChangeStage,
  onChangeOwner,
  onChangeNote,
}: {
  deal: Deal
  owner: Profile | undefined
  rotting: boolean
  dragging: boolean
  saving: boolean
  highlighted: boolean
  canEditFields: boolean
  canDrag: boolean
  expanded: boolean
  owners: Profile[]
  onToggleExpand: () => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onChangeStage: (s: DealStage) => void
  onChangeOwner: (ownerId: string | null) => void
  onChangeNote: (note: string) => void
}) {
  const next = nextPathStage(deal.stage)
  const showQuickActions = canEditFields && deal.stage !== 'vinto' && deal.stage !== 'perso'

  return (
    <div
      id={'deal-' + deal.id}
      className={
        'card kanban-card' +
        (dragging ? ' dragging' : '') +
        (saving ? ' saving' : '') +
        (rotting ? ' kanban-card-rotting' : '') +
        (highlighted ? ' kanban-card-highlighted' : '')
      }
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="kanban-card-main">
        <div className="kanban-card-top">
          <strong>{deal.client_name}</strong>
          <OwnerAvatar owner={owner} />
        </div>
        <span className="muted">{deal.product}</span>
        {deal.requires_tech_validation && <span className="tag">Richiede validazione tecnica</span>}
      </div>

      <div className="kanban-card-value-row">
        <span className="kanban-card-value">{currency.format(deal.value_estimate)}</span>
        <span className="kanban-card-probability">{STAGE_PROBABILITY[deal.stage]}%</span>
      </div>

      {deal.next_action && (
        <span className={'kanban-next-action' + (isOverdue(deal.next_action) ? ' kanban-next-action-overdue' : '')}>
          Prossima azione: {new Date(deal.next_action).toLocaleDateString('it-IT')}
        </span>
      )}

      {rotting && (
        <span className="kanban-rotting-label">
          Ferma da {daysSince(deal.updated_at)} giorni — nessun aggiornamento
        </span>
      )}

      {showQuickActions && (
        <div className="kanban-quick-actions">
          {next && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onChangeStage(next)}>
              {next === 'vinto' ? '✓ Segna come vinta' : '→ ' + stageLabel(next)}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm kanban-lost-btn" onClick={() => onChangeStage('perso')}>
            Persa
          </button>
        </div>
      )}

      <button type="button" className="kanban-details-toggle" onClick={onToggleExpand}>
        {expanded ? 'Nascondi dettagli ▾' : 'Dettagli e commenti ▸'}
      </button>
      {expanded && (
        <DealDetails
          deal={deal}
          canEditFields={canEditFields}
          compact
          owners={owners}
          onChangeStage={onChangeStage}
          onChangeOwner={onChangeOwner}
          onChangeNote={onChangeNote}
        />
      )}
    </div>
  )
}

const NEW_CLIENT_OPTION = '__nuovo__'

const CLIENT_TYPE_OPTIONS: ClientType[] = ['conceria', 'distributore', 'azienda_chimica']
// Le visite fisiche non includono "Telefonico" (quello è per il contatto
// telefonico vero e proprio, un altro tag) — solo per le visite tecniche lo
// schema di Andrea non prevede nemmeno "Fiera".
const VISITA_INCONTRO_OPTIONS: IncontroTipo[] = ['in_sede', 'presso_cliente', 'fiera']
const VISITA_TECNICA_INCONTRO_OPTIONS: IncontroTipo[] = ['in_sede', 'presso_cliente']
const RICEZIONE_OPTIONS: RicezioneReclamo[] = ['mail', 'telefonica', 'di_persona']
const NATURA_OPTIONS: NaturaReclamo[] = ['prodotto', 'documentale', 'logistica', 'servizio']
const URGENZA_OPTIONS: Urgenza[] = ['bassa', 'media', 'alta']

// I 5 tipi di attività guidati per il lead (schema Excel di Andrea, set
// 2026) — sostituiscono i due tag guidati precedenti (Presentazione
// aziendale, Richiesta prezzo), che restano nella lista tag generale ma non
// più come opzioni qui.
const ACTIVITY_TYPES = [
  'PRIMA VISITA',
  'VISITA COMMERCIALE CLIENTE',
  'VISITA TECNICA CLIENTE',
  'RECLAMO CLIENTE',
  'RIUNIONE INTERNA',
  'RICHIESTA ANALISI CAMPIONE CLIENTE',
] as const
// "Descrizione analisi" della richiesta campione cliente include anche "Test
// pelle", opzione non prevista lato fornitore (vedi PurchasePipeline.tsx).
const TIPO_ANALISI_OPTIONS_CLIENTE: TipoAnalisi[] = ['comparativa', 'nuovo_prodotto', 'test_pelle']

function NewDealForm({
  clients,
  owners,
  assignees,
  defaultOwnerId,
  createdByName,
  onCreated,
}: {
  clients: Client[]
  owners: Profile[]
  assignees: Profile[]
  defaultOwnerId: string
  createdByName: string
  onCreated: () => void
}) {
  const [clientId, setClientId] = useState('')
  const [manualClientName, setManualClientName] = useState('')
  const [isCustomer, setIsCustomer] = useState(false)
  // Campi obbligatori solo quando il cliente non è ancora in anagrafica.
  const [newClientType, setNewClientType] = useState<ClientType>('conceria')
  const [newClientSector, setNewClientSector] = useState('')
  const [newClientCountry, setNewClientCountry] = useState('Italia')
  const [newClientContact, setNewClientContact] = useState('')

  const [ownerId, setOwnerId] = useState(defaultOwnerId)
  const [saving, setSaving] = useState(false)

  // Tipo di attività: determina quale set di campi guidati mostrare. Va in
  // deals.activity_details.tag e in deals.product (deriveProductText) — non
  // più in deals.tags, che l'interfaccia non usa più (i tag torneranno più
  // avanti, con un disegno da rivedere).
  const [activityTag, setActivityTag] = useState('')

  // PRIMA VISITA / VISITA COMMERCIALE CLIENTE (stessi campi)
  const [incontroVisita, setIncontroVisita] = useState<IncontroTipo | ''>('')
  const [temiTrattatiVisita, setTemiTrattatiVisita] = useState('')
  const [prodottiPresentati, setProdottiPresentati] = useState('')
  const [prossimiPassiVisita, setProssimiPassiVisita] = useState('')
  const [prossimiPassiDataVisita, setProssimiPassiDataVisita] = useState('')

  // VISITA TECNICA CLIENTE
  const [incontroTecnica, setIncontroTecnica] = useState<IncontroTipo | ''>('')
  const [attivitaSvolte, setAttivitaSvolte] = useState('')
  const [articoliProvati, setArticoliProvati] = useState('')
  const [prodottiTestati, setProdottiTestati] = useState('')
  const [prossimiPassiTecnica, setProssimiPassiTecnica] = useState('')
  const [prossimiPassiDataTecnica, setProssimiPassiDataTecnica] = useState('')

  // RECLAMO CLIENTE
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

  // RICHIESTA ANALISI CAMPIONE CLIENTE
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
  const [descrizioneAnalisiTestPelle, setDescrizioneAnalisiTestPelle] = useState('')
  const [metodoTest, setMetodoTest] = useState('')
  const [prossimiPassiAnalisi, setProssimiPassiAnalisi] = useState('')
  const [prossimiPassiDataAnalisi, setProssimiPassiDataAnalisi] = useState('')
  const [urgenzaAnalisi, setUrgenzaAnalisi] = useState<Urgenza | ''>('')
  const [richiestoDaAnalisi, setRichiestoDaAnalisi] = useState('')

  // Assegnazione attività a: comune a tutti i tipi.
  const [assignments, setAssignments] = useState<PendingAssignment[]>([])

  const usingManualName = clientId === '' || clientId === NEW_CLIENT_OPTION
  const selectedClient = clients.find((c) => c.id === clientId)

  function handleClientChange(id: string) {
    setClientId(id)
    const c = clients.find((cl) => cl.id === id)
    setIsCustomer(c ? c.is_customer : false)
  }

  function toggleReparto(r: string) {
    setReparti((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('deal-attachments').upload(path, file, { upsert: true })
    setUploading(false)
    e.target.value = ''
    if (error) {
      alert("Non è stato possibile caricare l'allegato: " + error.message)
      return
    }
    const { data } = supabase.storage.from('deal-attachments').getPublicUrl(path)
    setAttachmentUrl(data.publicUrl)
    setAttachmentName(file.name)
  }

  // Due allegati distinti per la richiesta analisi campione (scheda tecnica
  // e MSDS): stesso bucket "deal-attachments" degli altri allegati, solo
  // due handler separati così restano due file indipendenti invece di uno
  // che sovrascrive l'altro.
  async function handleSchedaTecnicaChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingSchedaTecnica(true)
    const path = `scheda-tecnica-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('deal-attachments').upload(path, file, { upsert: true })
    setUploadingSchedaTecnica(false)
    e.target.value = ''
    if (error) {
      alert('Non è stato possibile caricare la scheda tecnica: ' + error.message)
      return
    }
    const { data } = supabase.storage.from('deal-attachments').getPublicUrl(path)
    setSchedaTecnicaUrl(data.publicUrl)
    setSchedaTecnicaName(file.name)
  }

  async function handleMsdsChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingMsds(true)
    const path = `msds-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('deal-attachments').upload(path, file, { upsert: true })
    setUploadingMsds(false)
    e.target.value = ''
    if (error) {
      alert('Non è stato possibile caricare la MSDS: ' + error.message)
      return
    }
    const { data } = supabase.storage.from('deal-attachments').getPublicUrl(path)
    setMsdsUrl(data.publicUrl)
    setMsdsName(file.name)
  }

  // Non c'è più un campo "prodotto" generico da compilare a mano: i campi
  // guidati del tag attività bastano e sono più precisi. Il campo
  // deals.product resta però obbligatorio a livello di database (serve
  // anche altrove nell'interfaccia — bacheca, elenco), quindi lo popoliamo
  // da quello che il commerciale ha già scritto nei campi del tag.
  function deriveProductText(): string {
    if (activityTag === 'PRIMA VISITA' || activityTag === 'VISITA COMMERCIALE CLIENTE') {
      return prodottiPresentati.trim() || activityTag
    }
    if (activityTag === 'VISITA TECNICA CLIENTE') return prodottiTestati.trim() || activityTag
    if (activityTag === 'RECLAMO CLIENTE') {
      return nomeProdotto.trim() || descrizioneProdotto.trim() || descrizioneServizio.trim() || activityTag
    }
    if (activityTag === 'RICHIESTA ANALISI CAMPIONE CLIENTE') return descrizioneProdottoAnalisi.trim() || activityTag
    return activityTag
  }

  function validateActivityFields(): string | null {
    if (activityTag === 'PRIMA VISITA' || activityTag === 'VISITA COMMERCIALE CLIENTE') {
      if (!incontroVisita || !temiTrattatiVisita.trim() || !prodottiPresentati.trim() || !prossimiPassiVisita.trim()) {
        return 'Compila incontro, temi trattati, prodotti presentati e prossimi passi.'
      }
    } else if (activityTag === 'VISITA TECNICA CLIENTE') {
      if (!incontroTecnica || !attivitaSvolte.trim() || !articoliProvati.trim() || !prodottiTestati.trim() || !prossimiPassiTecnica.trim()) {
        return 'Compila incontro, attività svolte, articoli provati, prodotti testati e prossimi passi.'
      }
    } else if (activityTag === 'RECLAMO CLIENTE') {
      if (!ricezione || !natura || !descrizioneReclamo.trim() || !prossimiPassiReclamo.trim() || !urgenza) {
        return 'Compila ricezione, natura del reclamo, descrizione, prossimi passi e urgenza.'
      }
    } else if (activityTag === 'RIUNIONE INTERNA') {
      if (reparti.length === 0 || !personePresenti.trim() || !temiTrattatiRiunione.trim()) {
        return 'Compila reparti coinvolti, persone presenti e temi trattati.'
      }
    } else if (activityTag === 'RICHIESTA ANALISI CAMPIONE CLIENTE') {
      if (!descrizioneProdottoAnalisi.trim() || !tipoAnalisi || !prossimiPassiAnalisi.trim() || !urgenzaAnalisi || !richiestoDaAnalisi) {
        return 'Compila descrizione prodotto, descrizione analisi, prossimi passi, urgenza e da chi è stata richiesta.'
      }
      if (tipoAnalisi === 'comparativa' && !prodottoDaComparare.trim()) return 'Indica il prodotto da comparare.'
      if (tipoAnalisi === 'nuovo_prodotto' && !descrizioneRichiesteAnalisi.trim()) {
        return 'Indica la descrizione delle richieste di analisi.'
      }
      if (tipoAnalisi === 'test_pelle' && (!descrizioneAnalisiTestPelle.trim() || !metodoTest.trim())) {
        return 'Indica descrizione analisi e metodo test per il test pelle.'
      }
    }
    for (const a of assignments) {
      if (!a.task.trim() || !a.dueDate) return "Per ogni persona assegnata servono attività da svolgere e scadenza."
    }
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const clientName = selectedClient ? selectedClient.name : manualClientName.trim()
    if (!clientName) {
      alert('Seleziona un cliente dall\'anagrafica o inserisci il nome.')
      return
    }
    if (!activityTag) {
      alert('Seleziona il tipo di attività prima di creare il lead.')
      return
    }
    if (usingManualName) {
      if (!newClientSector.trim() || !newClientCountry.trim() || !newClientContact.trim()) {
        alert('Per un cliente non ancora in anagrafica, tipo cliente, industria di riferimento, paese e referente sono obbligatori.')
        return
      }
    }
    const activityError = validateActivityFields()
    if (activityError) {
      alert(activityError)
      return
    }

    setSaving(true)

    let clientIdToUse: string | null = null
    let resolvedClientName = clientName

    if (selectedClient) {
      clientIdToUse = selectedClient.id
      if (isCustomer !== selectedClient.is_customer) {
        const { error: updateError } = await supabase
          .from('clients')
          .update({ is_customer: isCustomer })
          .eq('id', selectedClient.id)
        if (updateError) console.error(updateError)
      }
    } else {
      const { data: newClient, error: clientError } = await supabase
        .from('clients')
        .insert({
          name: manualClientName.trim(),
          client_type: newClientType,
          sector: newClientSector.trim(),
          country: newClientCountry.trim(),
          contact_name: newClientContact.trim(),
          is_customer: isCustomer,
        })
        .select()
        .single()
      if (clientError) {
        setSaving(false)
        alert('Non è stato possibile creare la scheda cliente: ' + clientError.message)
        return
      }
      clientIdToUse = newClient.id
      resolvedClientName = newClient.name
    }

    let activityDetails: DealActivityDetails = null
    let nextAction: string | null = null
    let reclamoPriority: Urgenza | undefined

    if (activityTag === 'PRIMA VISITA' || activityTag === 'VISITA COMMERCIALE CLIENTE') {
      activityDetails = {
        tag: activityTag,
        incontro: incontroVisita,
        temi_trattati: temiTrattatiVisita.trim(),
        prodotti_presentati: prodottiPresentati.trim(),
        prossimi_passi: prossimiPassiVisita.trim(),
      }
      nextAction = prossimiPassiDataVisita || null
    } else if (activityTag === 'VISITA TECNICA CLIENTE') {
      activityDetails = {
        tag: 'VISITA TECNICA CLIENTE',
        incontro: incontroTecnica,
        attivita_svolte: attivitaSvolte.trim(),
        articoli_provati: articoliProvati.trim(),
        prodotti_testati: prodottiTestati.trim(),
        prossimi_passi: prossimiPassiTecnica.trim(),
      }
      nextAction = prossimiPassiDataTecnica || null
    } else if (activityTag === 'RECLAMO CLIENTE') {
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
        urgenza,
      }
      nextAction = prossimiPassiDataReclamo || null
      reclamoPriority = urgenza || undefined
    } else if (activityTag === 'RIUNIONE INTERNA') {
      activityDetails = {
        tag: 'RIUNIONE INTERNA',
        reparti,
        persone_presenti: personePresenti.trim(),
        temi_trattati: temiTrattatiRiunione.trim(),
      }
    } else if (activityTag === 'RICHIESTA ANALISI CAMPIONE CLIENTE') {
      activityDetails = {
        tag: 'RICHIESTA ANALISI CAMPIONE CLIENTE',
        descrizione_prodotto: descrizioneProdottoAnalisi.trim(),
        scheda_tecnica_url: schedaTecnicaUrl,
        scheda_tecnica_name: schedaTecnicaName,
        msds_url: msdsUrl,
        msds_name: msdsName,
        tipo_analisi: tipoAnalisi,
        prodotto_da_comparare: prodottoDaComparare.trim(),
        descrizione_richieste_analisi: descrizioneRichiesteAnalisi.trim(),
        descrizione_analisi_test_pelle: descrizioneAnalisiTestPelle.trim(),
        metodo_test: metodoTest.trim(),
        prossimi_passi: prossimiPassiAnalisi.trim(),
        urgenza: urgenzaAnalisi,
        richiesto_da: richiestoDaAnalisi,
      }
      nextAction = prossimiPassiDataAnalisi || null
      reclamoPriority = urgenzaAnalisi || undefined
    }

    const { data: newDeal, error } = await supabase
      .from('deals')
      .insert({
        client_id: clientIdToUse,
        client_name: resolvedClientName,
        product: deriveProductText(),
        stage: 'lead',
        owner_id: ownerId || null,
        activity_details: activityDetails,
        next_action: nextAction,
      })
      .select()
      .single()
    if (error) {
      setSaving(false)
      alert('Non è stato possibile creare la trattativa: ' + error.message)
      return
    }

    if (assignments.length > 0) {
      const { error: assignError } = await createActivityAssignments({
        assignments,
        profiles: assignees,
        refTable: 'deals',
        refId: newDeal.id,
        subject: `${activityTag} — ${resolvedClientName}`,
        createdByName,
        priority: reclamoPriority,
      })
      if (assignError) {
        setSaving(false)
        alert('Il lead è stato creato, ma non è stato possibile creare tutte le richieste di assegnazione: ' + assignError)
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
        <label className="field-label">Cliente</label>
        <select value={clientId} onChange={(e) => handleClientChange(e.target.value)}>
          <option value="">— Seleziona dall'anagrafica —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW_CLIENT_OPTION}>+ Cliente non ancora in anagrafica…</option>
        </select>
      </div>

      <label className="field-checkbox">
        <input type="checkbox" checked={isCustomer} onChange={(e) => setIsCustomer(e.target.checked)} />
        Acquista già nostri prodotti
      </label>

      {usingManualName && (
        <div className="new-client-block">
          <div className="field-row">
            <label className="field-label">Nome azienda</label>
            <input value={manualClientName} onChange={(e) => setManualClientName(e.target.value)} required />
            <span className="muted">Non ancora in anagrafica — la scheda cliente verrà creata insieme al lead.</span>
          </div>
          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Tipo cliente</label>
              <select value={newClientType} onChange={(e) => setNewClientType(e.target.value as ClientType)} required>
                {CLIENT_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {CLIENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label">Industria di riferimento</label>
              <input value={newClientSector} onChange={(e) => setNewClientSector(e.target.value)} required />
            </div>
          </div>
          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Paese</label>
              <input value={newClientCountry} onChange={(e) => setNewClientCountry(e.target.value)} required />
            </div>
            <div className="field-row">
              <label className="field-label">Referente</label>
              <input value={newClientContact} onChange={(e) => setNewClientContact(e.target.value)} required />
            </div>
          </div>
        </div>
      )}

      <div className="field-row">
        <label className="field-label">Proprietario</label>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">— Nessuno —</option>
          {owners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <label className="field-label">Tipo di attività</label>
        <select value={activityTag} onChange={(e) => setActivityTag(e.target.value)} required>
          <option value="">— Seleziona —</option>
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {(activityTag === 'PRIMA VISITA' || activityTag === 'VISITA COMMERCIALE CLIENTE') && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">{activityTag === 'PRIMA VISITA' ? 'Prima visita' : 'Visita commerciale cliente'}</span>
          <div className="field-row">
            <label className="field-label">Incontro</label>
            <select value={incontroVisita} onChange={(e) => setIncontroVisita(e.target.value as IncontroTipo)} required>
              <option value="">— Seleziona —</option>
              {VISITA_INCONTRO_OPTIONS.map((i) => (
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
              <label className="field-label">Data prossimi passi</label>
              <input type="date" value={prossimiPassiDataVisita} onChange={(e) => setProssimiPassiDataVisita(e.target.value)} />
              <span className="muted">Facoltativa — diventa la prossima azione schedulata sul lead.</span>
            </div>
          </div>
          <ActivityAssignment profiles={assignees} assignments={assignments} onChange={setAssignments} />
        </div>
      )}

      {activityTag === 'VISITA TECNICA CLIENTE' && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">Visita tecnica cliente</span>
          <div className="field-row">
            <label className="field-label">Incontro</label>
            <select value={incontroTecnica} onChange={(e) => setIncontroTecnica(e.target.value as IncontroTipo)} required>
              <option value="">— Seleziona —</option>
              {VISITA_TECNICA_INCONTRO_OPTIONS.map((i) => (
                <option key={i} value={i}>
                  {INCONTRO_TIPO_LABELS[i]}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Attività svolte</label>
            <textarea value={attivitaSvolte} onChange={(e) => setAttivitaSvolte(e.target.value)} required />
          </div>
          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Articoli provati</label>
              <input value={articoliProvati} onChange={(e) => setArticoliProvati(e.target.value)} required />
            </div>
            <div className="field-row">
              <label className="field-label">Prodotti testati</label>
              <input value={prodottiTestati} onChange={(e) => setProdottiTestati(e.target.value)} required />
            </div>
          </div>
          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Prossimi passi</label>
              <textarea value={prossimiPassiTecnica} onChange={(e) => setProssimiPassiTecnica(e.target.value)} required />
            </div>
            <div className="field-row">
              <label className="field-label">Data prossimi passi</label>
              <input type="date" value={prossimiPassiDataTecnica} onChange={(e) => setProssimiPassiDataTecnica(e.target.value)} />
              <span className="muted">Facoltativa — diventa la prossima azione schedulata sul lead.</span>
            </div>
          </div>
          <ActivityAssignment profiles={assignees} assignments={assignments} onChange={setAssignments} />
        </div>
      )}

      {activityTag === 'RECLAMO CLIENTE' && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">Reclamo cliente</span>
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
              Per "Non conformità logistica" non avevo ancora campi specifici nello schema — per ora usa solo la
              descrizione qui sotto, dimmi tu cosa aggiungere.
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
              <label className="field-label">Data prossimi passi</label>
              <input type="date" value={prossimiPassiDataReclamo} onChange={(e) => setProssimiPassiDataReclamo(e.target.value)} />
              <span className="muted">Facoltativa — diventa la prossima azione schedulata sul lead.</span>
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

      {activityTag === 'RICHIESTA ANALISI CAMPIONE CLIENTE' && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">Richiesta analisi campione cliente</span>
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
              {TIPO_ANALISI_OPTIONS_CLIENTE.map((t) => (
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
          {tipoAnalisi === 'test_pelle' && (
            <div className="field-row-2">
              <div className="field-row">
                <label className="field-label">Descrizione analisi</label>
                <textarea
                  value={descrizioneAnalisiTestPelle}
                  onChange={(e) => setDescrizioneAnalisiTestPelle(e.target.value)}
                  required
                />
              </div>
              <div className="field-row">
                <label className="field-label">Metodo test</label>
                <input value={metodoTest} onChange={(e) => setMetodoTest(e.target.value)} required />
              </div>
            </div>
          )}

          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Prossimi passi</label>
              <textarea value={prossimiPassiAnalisi} onChange={(e) => setProssimiPassiAnalisi(e.target.value)} required />
            </div>
            <div className="field-row">
              <label className="field-label">Data prossimi passi</label>
              <input type="date" value={prossimiPassiDataAnalisi} onChange={(e) => setProssimiPassiDataAnalisi(e.target.value)} />
              <span className="muted">Facoltativa — diventa la prossima azione schedulata sul lead.</span>
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
        {saving ? 'Salvataggio…' : 'Aggiungi al lead'}
      </button>
    </form>
  )
}
