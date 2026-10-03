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
  PROPOSAL_TYPE_LABELS,
  PROPOSAL_TYPES,
  PROPOSAL_TYPES_REQUIRING_VALUE,
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
  type ProposalType,
  type RicezioneReclamo,
  type TipoAnalisi,
  type Urgenza,
} from '../lib/types'

const CAN_CREATE_DELETE: string[] = ['commerciale', 'dirigente', 'amministrazione']

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

// Colonne della Bacheca (ott 2026, richiesta di Andrea: "la vista generale
// deve riportare le tre colonne Nuovo Contatto, Sviluppo Contatto e
// Proposta Inviata... le attività chiuse vinte e chiuse perse devono essere
// riportate direttamente nei report e analytics, per dare più spazio alla
// grafica"). "Chiuso Vinto"/"Chiuso Perso" restano fasi valide — si chiude
// una trattativa con i pulsanti "✓ Segna come vinta"/"Persa" già presenti
// sulla card (vedi DealCard/StagePath più sotto, invariati), non più
// trascinandola su una colonna — e restano raggiungibili nella vista Elenco
// (che continua a mostrare tutte le fasi) e nei Report.
const KANBAN_STAGES = DEAL_STAGES.filter((s) => s.id !== 'vinto' && s.id !== 'perso')

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

// Ordinamento della pipeline (rifatto ott 2026 su richiesta di Andrea: le
// vecchie opzioni per valore/prossima azione sono sparite, sostituite da
// queste 6 — le uniche richieste). "Vinti"/"Persi" portano in cima le
// trattative in quella fase (le altre restano sotto, ordinate come
// "Recenti"); "Utente"/"Cliente" sono alfabetici.
type SortKey = 'recenti' | 'ferme' | 'vinti' | 'persi' | 'utente' | 'cliente'

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'recenti', label: 'Recenti' },
  { id: 'ferme', label: 'Fermi da più tempo' },
  { id: 'vinti', label: 'Vinti' },
  { id: 'persi', label: 'Persi' },
  { id: 'utente', label: 'Utente' },
  { id: 'cliente', label: 'Cliente' },
]

// "ownerNameById" serve solo per l'ordinamento "Utente" (il nome
// dell'assegnatario non è un campo diretto di Deal, va risolto da
// owner_id — stessa mappa "ownerMap" già calcolata nel componente,
// trasformata in nome per il confronto alfabetico).
function compareDeals(a: Deal, b: Deal, sortBy: SortKey, ownerNameById: Map<string, string>): number {
  switch (sortBy) {
    case 'ferme':
      return daysSince(b.updated_at) - daysSince(a.updated_at)
    case 'vinti': {
      if (a.stage === 'vinto' && b.stage !== 'vinto') return -1
      if (b.stage === 'vinto' && a.stage !== 'vinto') return 1
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    }
    case 'persi': {
      if (a.stage === 'perso' && b.stage !== 'perso') return -1
      if (b.stage === 'perso' && a.stage !== 'perso') return 1
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    }
    case 'utente':
      return (ownerNameById.get(a.owner_id ?? '') ?? '').localeCompare(ownerNameById.get(b.owner_id ?? '') ?? '')
    case 'cliente':
      return a.client_name.localeCompare(b.client_name)
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
  // Finestra obbligatoria quando una trattativa entra in "Proposta Inviata"
  // (0044_proposta_inviata.sql) — vedi updateStage/confirmProposal più sotto.
  const [proposalModalDeal, setProposalModalDeal] = useState<Deal | null>(null)

  const canCreate = profile ? CAN_CREATE_DELETE.includes(profile.role) : false
  // Il tecnico vede solo le trattative con "Richiede validazione tecnica"
  // attivo (0038_proprietario_clienti_e_validazione_tecnica.sql) e, per via
  // del trigger nel database, può salvare solo modifiche al campo "note":
  // niente trascinamento, niente cambio fase o proprietario — il vero
  // controllo resta comunque lato server (0003_triggers.sql).
  const canEditFields = profile?.role === 'commerciale' || profile?.role === 'dirigente' || profile?.role === 'amministrazione'
  // "Utente" (ex "Proprietario") è sempre e solo chi crea la trattativa —
  // nessuno può più cambiarlo a mano, nemmeno dirigente/amministrazione
  // (richiesta di Andrea, ott 2026): niente più menu di riassegnazione da
  // nessuna parte, solo una scritta informativa. La RLS lo impone comunque
  // in scrittura (owner_id = auth.uid() all'inserimento — vedi
  // 0040_nuovo_contatto.sql).

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
    // Entrare in "Proposta Inviata" richiede prima la finestra con i campi
    // obbligatori (richiesta di Andrea, ott 2026) — da qualunque percorso
    // arrivi (trascinamento, pulsante "avanza", passi dello StagePath):
    // qui si apre solo la finestra, l'aggiornamento vero avviene in
    // confirmProposal una volta compilata. Vale anche lato database, non
    // solo qui (vedi enforce_proposal_fields() in 0044_proposta_inviata.sql).
    if (stage === 'proposta') {
      setProposalModalDeal(deal)
      return
    }
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

  async function confirmProposal(
    deal: Deal,
    fields: { proposal_type: ProposalType; proposal_reference_code: string; proposal_value: number | null; proposal_quantity: number | null },
  ) {
    setSavingId(deal.id)
    setDeals((current) => current.map((d) => (d.id === deal.id ? { ...d, stage: 'proposta', ...fields } : d)))
    const { error } = await supabase.from('deals').update({ stage: 'proposta', ...fields }).eq('id', deal.id)
    setSavingId(null)
    setProposalModalDeal(null)
    if (error) {
      alert('Non è stato possibile salvare la proposta: ' + error.message)
      loadDeals()
    }
  }

  async function updateNote(deal: Deal, note: string) {
    const { error } = await supabase.from('deals').update({ note }).eq('id', deal.id)
    if (error) alert('Non è stato possibile salvare la nota: ' + error.message)
  }

  async function updateTechValidation(deal: Deal, value: boolean) {
    const { error } = await supabase.from('deals').update({ requires_tech_validation: value }).eq('id', deal.id)
    if (error) {
      alert('Non è stato possibile aggiornare la validazione tecnica: ' + error.message)
      return
    }
    setDeals((ds) => ds.map((d) => (d.id === deal.id ? { ...d, requires_tech_validation: value } : d)))
  }

  const ownerMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])
  // Solo per l'ordinamento "Utente" (vedi compareDeals): nome per owner_id.
  const ownerNameById = useMemo(() => new Map(profiles.map((p) => [p.id, p.full_name])), [profiles])
  const ownerOptions = useMemo(
    () =>
      profiles
        .filter((p) => p.role === 'commerciale' || p.role === 'dirigente' || p.role === 'amministrazione')
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
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
            {showForm ? 'Annulla' : '+ Nuovo Contatto'}
          </button>
        )}
      </div>
      {canCreate && !showForm && (
        <p className="muted">
          Un nuovo contatto si apre da qui, con il pulsante "+ Nuovo Contatto" qui sopra — entra direttamente in
          pipeline nella fase "Nuovo Contatto".
        </p>
      )}

      {showForm && (
        <NewDealForm
          clients={clients}
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
              <option value="">Tutti gli utenti</option>
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
              {KANBAN_STAGES.map((stage) => {
                const rows = filteredDeals.filter((d) => d.stage === stage.id).sort((a, b) => compareDeals(a, b, sortBy, ownerNameById))
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
                          onChangeNote={(note) => updateNote(deal, note)}
                          onChangeTechValidation={(v) => updateTechValidation(deal, v)}
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
                <button type="button" className="pcol-client" onClick={() => setSortBy('cliente')}>
                  Cliente / prodotto
                </button>
                <span className="pcol-stage">Fase</span>
                <span className="pcol-value">Valore</span>
                <span className="pcol-weighted">Pesato</span>
                <button type="button" className="pcol-owner" onClick={() => setSortBy('utente')}>
                  Utente
                </button>
                <span className="pcol-action">Prossima azione</span>
                <span className="pcol-expand" />
              </div>
              {filteredDeals
                .slice()
                .sort((a, b) => compareDeals(a, b, sortBy, ownerNameById))
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
                            onChangeNote={(note) => updateNote(deal, note)}
                            onChangeTechValidation={(v) => updateTechValidation(deal, v)}
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

      {proposalModalDeal && (
        <ProposalModal
          deal={proposalModalDeal}
          onCancel={() => setProposalModalDeal(null)}
          onConfirm={(fields) => confirmProposal(proposalModalDeal, fields)}
          saving={savingId === proposalModalDeal.id}
        />
      )}
    </div>
  )
}

// Finestra obbligatoria quando una trattativa entra in "Proposta Inviata"
// (richiesta di Andrea, ott 2026, "pipeline clienti" punto 4) — vedi
// updateStage/confirmProposal più sopra e enforce_proposal_fields() in
// 0044_proposta_inviata.sql (lo stesso vincolo vale anche lato database).
function ProposalModal({
  deal,
  onCancel,
  onConfirm,
  saving,
}: {
  deal: Deal
  onCancel: () => void
  onConfirm: (fields: { proposal_type: ProposalType; proposal_reference_code: string; proposal_value: number | null; proposal_quantity: number | null }) => void
  saving: boolean
}) {
  const [proposalType, setProposalType] = useState<ProposalType | ''>('')
  const [referenceCode, setReferenceCode] = useState('')
  const [value, setValue] = useState('')
  const [quantity, setQuantity] = useState('')

  const needsValue = proposalType !== '' && PROPOSAL_TYPES_REQUIRING_VALUE.includes(proposalType)
  const canSubmit =
    proposalType !== '' && referenceCode.trim() !== '' && (!needsValue || (value.trim() !== '' && quantity.trim() !== ''))

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || proposalType === '') return
    onConfirm({
      proposal_type: proposalType,
      proposal_reference_code: referenceCode.trim(),
      proposal_value: needsValue ? Number(value) : null,
      proposal_quantity: needsValue ? Number(quantity) : null,
    })
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Proposta Inviata</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} aria-label="Chiudi">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-client-row">
            <span className="muted">Trattativa</span>
            <strong>{deal.client_name} — {deal.product}</strong>
          </div>
          <p className="muted">
            Per far passare questa trattativa a "Proposta Inviata" servono questi dati, obbligatori.
          </p>
          <form className="new-deal-form" onSubmit={handleSubmit}>
            <div className="field-row">
              <label className="field-label">Tipo di proposta *</label>
              <select value={proposalType} onChange={(e) => setProposalType(e.target.value as ProposalType)} required>
                <option value="" disabled>
                  Seleziona…
                </option>
                {PROPOSAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PROPOSAL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label">Codice riferimento *</label>
              <input value={referenceCode} onChange={(e) => setReferenceCode(e.target.value)} required />
            </div>
            {needsValue && (
              <div className="field-row-2">
                <div className="field-row">
                  <label className="field-label">Valore *</label>
                  <input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} required />
                </div>
                <div className="field-row">
                  <label className="field-label">Quantità *</label>
                  <input type="number" min="0" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={!canSubmit || saving}>
                {saving ? 'Salvataggio…' : 'Conferma e invia proposta'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
                Annulla
              </button>
            </div>
          </form>
        </div>
      </div>
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
// Esportata per riuso nella "cronologia cliente" di Clients.tsx (richiesta
// di Andrea, ott 2026: "ogni scheda cliente deve riportare tutte le
// attività del cliente, consultabili") — stessa resa dei dettagli guidati
// usata qui nella pipeline, invece di duplicarla.
export function ActivityDetailsView({ details }: { details: DealActivityDetails }) {
  if (!details) return null

  if (details.tag === 'PRIMO CONTATTO' || details.tag === 'CONTATTO COMMERCIALE CLIENTE') {
    return (
      <div className="activity-details-view">
        <span className="activity-details-title">
          Dettagli · {details.tag === 'PRIMO CONTATTO' ? 'Primo contatto' : 'Contatto commerciale cliente'}
        </span>
        <div className="activity-details-grid">
          {details.incontro && <span><strong>Incontro:</strong> {INCONTRO_TIPO_LABELS[details.incontro]}</span>}
          {details.temi_trattati && <span><strong>Temi trattati:</strong> {details.temi_trattati}</span>}
          {details.prodotti_presentati && <span><strong>Prodotti presentati:</strong> {details.prodotti_presentati}</span>}
          {details.prossimi_passi && <span><strong>Prossimi passi:</strong> {details.prossimi_passi}</span>}
          {details.referente_contatto && <span><strong>Referente Contatto:</strong> {details.referente_contatto}</span>}
          {details.mansione_referente && <span><strong>Mansione Referente:</strong> {details.mansione_referente}</span>}
          {details.attachment_url && (
            <span>
              <strong>Allegato:</strong> <a href={details.attachment_url} target="_blank" rel="noreferrer">📎 {details.attachment_name}</a>
            </span>
          )}
        </div>
      </div>
    )
  }

  if (details.tag === 'CONTATTO TECNICO CLIENTE') {
    return (
      <div className="activity-details-view">
        <span className="activity-details-title">Dettagli · Contatto tecnico cliente</span>
        <div className="activity-details-grid">
          {details.incontro && <span><strong>Incontro:</strong> {INCONTRO_TIPO_LABELS[details.incontro]}</span>}
          {details.attivita_svolte && <span><strong>Attività svolte:</strong> {details.attivita_svolte}</span>}
          {details.articoli_provati && <span><strong>Articoli provati:</strong> {details.articoli_provati}</span>}
          {details.prodotti_testati && <span><strong>Prodotti testati:</strong> {details.prodotti_testati}</span>}
          {details.prossimi_passi && <span><strong>Prossimi passi:</strong> {details.prossimi_passi}</span>}
          {details.referente_contatto && <span><strong>Referente Contatto:</strong> {details.referente_contatto}</span>}
          {details.mansione_referente && <span><strong>Mansione Referente:</strong> {details.mansione_referente}</span>}
          {details.attachment_url && (
            <span>
              <strong>Allegato:</strong> <a href={details.attachment_url} target="_blank" rel="noreferrer">📎 {details.attachment_name}</a>
            </span>
          )}
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
          {details.referente_contatto && <span><strong>Referente Contatto:</strong> {details.referente_contatto}</span>}
          {details.mansione_referente && <span><strong>Mansione Referente:</strong> {details.mansione_referente}</span>}
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
          {details.referente_contatto && <span><strong>Referente Contatto:</strong> {details.referente_contatto}</span>}
          {details.mansione_referente && <span><strong>Mansione Referente:</strong> {details.mansione_referente}</span>}
          {details.attachment_url && (
            <span>
              <strong>Allegato:</strong> <a href={details.attachment_url} target="_blank" rel="noreferrer">📎 {details.attachment_name}</a>
            </span>
          )}
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
          {details.referente_contatto && <span><strong>Referente Contatto:</strong> {details.referente_contatto}</span>}
          {details.mansione_referente && <span><strong>Mansione Referente:</strong> {details.mansione_referente}</span>}
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
  onChangeNote,
  onChangeTechValidation,
}: {
  deal: Deal
  canEditFields: boolean
  compact?: boolean
  owners: Profile[]
  onChangeStage: (s: DealStage) => void
  onChangeNote: (note: string) => void
  onChangeTechValidation: (value: boolean) => void
}) {
  return (
    <div className="kanban-card-expanded" onClick={(e) => e.stopPropagation()}>
      <StagePath deal={deal} canEdit={canEditFields} compact={compact} onChangeStage={onChangeStage} />
      <ActivityDetailsView details={deal.activity_details} />
      <div className="field-row">
        <label className="field-label">Utente</label>
        <span>{owners.find((p) => p.id === deal.owner_id)?.full_name ?? '— Nessuno —'}</span>
      </div>
      {canEditFields && (
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={deal.requires_tech_validation}
            onChange={(e) => onChangeTechValidation(e.target.checked)}
          />
          Richiede validazione tecnica
        </label>
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
  onChangeNote,
  onChangeTechValidation,
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
  onChangeNote: (note: string) => void
  onChangeTechValidation: (value: boolean) => void
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
          onChangeNote={onChangeNote}
          onChangeTechValidation={onChangeTechValidation}
        />
      )}
    </div>
  )
}

const NEW_CLIENT_OPTION = '__nuovo__'

const CLIENT_TYPE_OPTIONS: ClientType[] = ['conceria', 'distributore', 'azienda_chimica']
// "Telefonico" aggiunto ai tipi di incontro per entrambi i blocchi
// (richiesta di Andrea, ott 2026) — prima era escluso qui perché pensato
// solo per un contatto telefonico vero e proprio; per le visite tecniche lo
// schema di Andrea non prevede comunque "Fiera".
const VISITA_INCONTRO_OPTIONS: IncontroTipo[] = ['in_sede', 'presso_cliente', 'fiera', 'telefonico']
const VISITA_TECNICA_INCONTRO_OPTIONS: IncontroTipo[] = ['in_sede', 'presso_cliente', 'telefonico']
const RICEZIONE_OPTIONS: RicezioneReclamo[] = ['mail', 'telefonica', 'di_persona']
const NATURA_OPTIONS: NaturaReclamo[] = ['prodotto', 'documentale', 'logistica', 'servizio']
const URGENZA_OPTIONS: Urgenza[] = ['bassa', 'media', 'alta']

// I 5 tipi di attività guidati per il lead (schema Excel di Andrea, set
// 2026) — sostituiscono i due tag guidati precedenti (Presentazione
// aziendale, Richiesta prezzo), che restano nella lista tag generale ma non
// più come opzioni qui. Rinominati nella revisione "Nuovo Contatto" (ott
// 2026): "PRIMA VISITA" → "PRIMO CONTATTO", "VISITA COMMERCIALE CLIENTE" →
// "CONTATTO COMMERCIALE CLIENTE", "VISITA TECNICA CLIENTE" → "CONTATTO
// TECNICO CLIENTE" — vedi 0040_nuovo_contatto.sql per la migrazione dei
// record già esistenti.
const ACTIVITY_TYPES = [
  'PRIMO CONTATTO',
  'CONTATTO COMMERCIALE CLIENTE',
  'CONTATTO TECNICO CLIENTE',
  'RECLAMO CLIENTE',
  'RIUNIONE INTERNA',
  'RICHIESTA ANALISI CAMPIONE CLIENTE',
] as const
// "Descrizione analisi" della richiesta campione cliente include anche "Test
// pelle", opzione non prevista lato fornitore (vedi PurchasePipeline.tsx).
const TIPO_ANALISI_OPTIONS_CLIENTE: TipoAnalisi[] = ['comparativa', 'nuovo_prodotto', 'test_pelle']

function NewDealForm({
  clients,
  assignees,
  defaultOwnerId,
  createdByName,
  onCreated,
}: {
  clients: Client[]
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

  const [requiresTechValidation, setRequiresTechValidation] = useState(false)
  const [saving, setSaving] = useState(false)

  // Tipo di attività: determina quale set di campi guidati mostrare. Va in
  // deals.activity_details.tag e in deals.product (deriveProductText) — non
  // più in deals.tags, che l'interfaccia non usa più (i tag torneranno più
  // avanti, con un disegno da rivedere).
  const [activityTag, setActivityTag] = useState('')

  // Referente Contatto / Mansione Referente: comuni a ogni tipo di attività
  // (richiesta di Andrea, ott 2026) — riferiti alla singola interazione, non
  // alla scheda cliente, quindi vanno compilati ad ogni "Nuovo Contatto" e
  // finiscono in deals.activity_details insieme ai campi guidati del tag.
  const [referenteContatto, setReferenteContatto] = useState('')
  const [mansioneReferente, setMansioneReferente] = useState('')

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
    if (activityTag === 'PRIMO CONTATTO' || activityTag === 'CONTATTO COMMERCIALE CLIENTE') {
      return prodottiPresentati.trim() || activityTag
    }
    if (activityTag === 'CONTATTO TECNICO CLIENTE') return prodottiTestati.trim() || activityTag
    if (activityTag === 'RECLAMO CLIENTE') {
      return nomeProdotto.trim() || descrizioneProdotto.trim() || descrizioneServizio.trim() || activityTag
    }
    if (activityTag === 'RICHIESTA ANALISI CAMPIONE CLIENTE') return descrizioneProdottoAnalisi.trim() || activityTag
    return activityTag
  }

  function validateActivityFields(): string | null {
    if (!referenteContatto.trim() || !mansioneReferente.trim()) {
      return 'Compila referente contatto e mansione referente.'
    }
    if (activityTag === 'PRIMO CONTATTO' || activityTag === 'CONTATTO COMMERCIALE CLIENTE') {
      if (
        !incontroVisita ||
        !temiTrattatiVisita.trim() ||
        !prodottiPresentati.trim() ||
        !prossimiPassiVisita.trim() ||
        !prossimiPassiDataVisita
      ) {
        return 'Compila incontro, temi trattati, prodotti presentati, prossimi passi e data prossimi passi.'
      }
    } else if (activityTag === 'CONTATTO TECNICO CLIENTE') {
      if (
        !incontroTecnica ||
        !attivitaSvolte.trim() ||
        !articoliProvati.trim() ||
        !prodottiTestati.trim() ||
        !prossimiPassiTecnica.trim() ||
        !prossimiPassiDataTecnica
      ) {
        return 'Compila incontro, attività svolte, articoli provati, prodotti testati, prossimi passi e data prossimi passi.'
      }
    } else if (activityTag === 'RECLAMO CLIENTE') {
      if (
        !ricezione ||
        !natura ||
        !descrizioneReclamo.trim() ||
        !prossimiPassiReclamo.trim() ||
        !prossimiPassiDataReclamo ||
        !urgenza
      ) {
        return 'Compila ricezione, natura del reclamo, descrizione, prossimi passi, data prossimi passi e urgenza.'
      }
    } else if (activityTag === 'RIUNIONE INTERNA') {
      if (reparti.length === 0 || !personePresenti.trim() || !temiTrattatiRiunione.trim()) {
        return 'Compila reparti coinvolti, persone presenti e temi trattati.'
      }
    } else if (activityTag === 'RICHIESTA ANALISI CAMPIONE CLIENTE') {
      if (
        !descrizioneProdottoAnalisi.trim() ||
        !tipoAnalisi ||
        !prossimiPassiAnalisi.trim() ||
        !prossimiPassiDataAnalisi ||
        !urgenzaAnalisi ||
        !richiestoDaAnalisi
      ) {
        return 'Compila descrizione prodotto, descrizione analisi, prossimi passi, data prossimi passi, urgenza e da chi è stata richiesta.'
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

    if (activityTag === 'PRIMO CONTATTO' || activityTag === 'CONTATTO COMMERCIALE CLIENTE') {
      activityDetails = {
        tag: activityTag,
        incontro: incontroVisita,
        temi_trattati: temiTrattatiVisita.trim(),
        prodotti_presentati: prodottiPresentati.trim(),
        prossimi_passi: prossimiPassiVisita.trim(),
        referente_contatto: referenteContatto.trim(),
        mansione_referente: mansioneReferente.trim(),
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
      }
      nextAction = prossimiPassiDataVisita || null
    } else if (activityTag === 'CONTATTO TECNICO CLIENTE') {
      activityDetails = {
        tag: 'CONTATTO TECNICO CLIENTE',
        incontro: incontroTecnica,
        attivita_svolte: attivitaSvolte.trim(),
        articoli_provati: articoliProvati.trim(),
        prodotti_testati: prodottiTestati.trim(),
        prossimi_passi: prossimiPassiTecnica.trim(),
        referente_contatto: referenteContatto.trim(),
        mansione_referente: mansioneReferente.trim(),
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
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
        referente_contatto: referenteContatto.trim(),
        mansione_referente: mansioneReferente.trim(),
      }
      nextAction = prossimiPassiDataReclamo || null
      reclamoPriority = urgenza || undefined
    } else if (activityTag === 'RIUNIONE INTERNA') {
      activityDetails = {
        tag: 'RIUNIONE INTERNA',
        reparti,
        persone_presenti: personePresenti.trim(),
        temi_trattati: temiTrattatiRiunione.trim(),
        referente_contatto: referenteContatto.trim(),
        mansione_referente: mansioneReferente.trim(),
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
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
        referente_contatto: referenteContatto.trim(),
        mansione_referente: mansioneReferente.trim(),
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
        owner_id: defaultOwnerId,
        requires_tech_validation: requiresTechValidation,
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
        <label className="field-label">Utente</label>
        <span>{createdByName}</span>
      </div>

      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Referente Contatto</label>
          <input value={referenteContatto} onChange={(e) => setReferenteContatto(e.target.value)} required />
        </div>
        <div className="field-row">
          <label className="field-label">Mansione Referente</label>
          <input value={mansioneReferente} onChange={(e) => setMansioneReferente(e.target.value)} required />
        </div>
      </div>

      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={requiresTechValidation}
          onChange={(e) => setRequiresTechValidation(e.target.checked)}
        />
        Richiede validazione tecnica
      </label>

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

      {(activityTag === 'PRIMO CONTATTO' || activityTag === 'CONTATTO COMMERCIALE CLIENTE') && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">
            {activityTag === 'PRIMO CONTATTO' ? 'Primo contatto' : 'Contatto commerciale cliente'}
          </span>
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
              <input
                type="date"
                value={prossimiPassiDataVisita}
                onChange={(e) => setProssimiPassiDataVisita(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">Allega file (facoltativo)</label>
            {attachmentUrl ? (
              <div className="marketing-attachment-row">
                <a href={attachmentUrl} target="_blank" rel="noreferrer">📎 {attachmentName}</a>
                <button type="button" className="btn btn-ghost" onClick={() => { setAttachmentUrl(null); setAttachmentName(null) }}>
                  Rimuovi
                </button>
              </div>
            ) : (
              <input type="file" accept=".pdf,.xls,.xlsx,.doc,.docx,.jpg,.jpeg" onChange={handleFileChange} disabled={uploading} />
            )}
            {uploading && <span className="muted">Caricamento…</span>}
          </div>
          <ActivityAssignment profiles={assignees} assignments={assignments} onChange={setAssignments} />
        </div>
      )}

      {activityTag === 'CONTATTO TECNICO CLIENTE' && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">Contatto tecnico cliente</span>
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
              <input
                type="date"
                value={prossimiPassiDataTecnica}
                onChange={(e) => setProssimiPassiDataTecnica(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="field-row">
            <label className="field-label">Allega file (facoltativo)</label>
            {attachmentUrl ? (
              <div className="marketing-attachment-row">
                <a href={attachmentUrl} target="_blank" rel="noreferrer">📎 {attachmentName}</a>
                <button type="button" className="btn btn-ghost" onClick={() => { setAttachmentUrl(null); setAttachmentName(null) }}>
                  Rimuovi
                </button>
              </div>
            ) : (
              <input type="file" accept=".pdf,.xls,.xlsx,.doc,.docx,.jpg,.jpeg" onChange={handleFileChange} disabled={uploading} />
            )}
            {uploading && <span className="muted">Caricamento…</span>}
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
            <label className="field-label">Allega file (facoltativo)</label>
            {attachmentUrl ? (
              <div className="marketing-attachment-row">
                <a href={attachmentUrl} target="_blank" rel="noreferrer">📎 {attachmentName}</a>
                <button type="button" className="btn btn-ghost" onClick={() => { setAttachmentUrl(null); setAttachmentName(null) }}>
                  Rimuovi
                </button>
              </div>
            ) : (
              <input type="file" accept=".pdf,.xls,.xlsx,.doc,.docx,.jpg,.jpeg" onChange={handleFileChange} disabled={uploading} />
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
              <input
                type="date"
                value={prossimiPassiDataReclamo}
                onChange={(e) => setProssimiPassiDataReclamo(e.target.value)}
                required
              />
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
          <div className="field-row">
            <label className="field-label">Allega file (facoltativo)</label>
            {attachmentUrl ? (
              <div className="marketing-attachment-row">
                <a href={attachmentUrl} target="_blank" rel="noreferrer">📎 {attachmentName}</a>
                <button type="button" className="btn btn-ghost" onClick={() => { setAttachmentUrl(null); setAttachmentName(null) }}>
                  Rimuovi
                </button>
              </div>
            ) : (
              <input type="file" accept=".pdf,.xls,.xlsx,.doc,.docx,.jpg,.jpeg" onChange={handleFileChange} disabled={uploading} />
            )}
            {uploading && <span className="muted">Caricamento…</span>}
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
                <input
                  type="file"
                  accept=".pdf,.xls,.xlsx,.doc,.docx,.jpg,.jpeg"
                  onChange={handleSchedaTecnicaChange}
                  disabled={uploadingSchedaTecnica}
                />
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
                <input
                  type="file"
                  accept=".pdf,.xls,.xlsx,.doc,.docx,.jpg,.jpeg"
                  onChange={handleMsdsChange}
                  disabled={uploadingMsds}
                />
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
              <input
                type="date"
                value={prossimiPassiDataAnalisi}
                onChange={(e) => setProssimiPassiDataAnalisi(e.target.value)}
                required
              />
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
