import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CommentThread } from '../components/CommentThread'
import { ActivityAssignment, createActivityAssignments } from '../components/ActivityAssignment'
import {
  INCONTRO_TIPO_LABELS,
  NATURA_RECLAMO_LABELS,
  REPARTI_RIUNIONE,
  RICEZIONE_RECLAMO_LABELS,
  TIPO_ANALISI_LABELS,
  URGENZA_LABELS,
  type IncontroTipo,
  type NaturaReclamo,
  type PendingAssignment,
  type ProcurementActivity,
  type ProcurementActivityDetails,
  type Profile,
  type Request,
  type RequestStatus,
  type RicezioneReclamo,
  type Supplier,
  type TipoAnalisi,
  type Urgenza,
} from '../lib/types'

// Pipeline acquisti, ridisegnata (set 2026, poi allineata definitivamente
// alla Pipeline clienti su richiesta esplicita di Andrea): "+ Nuova
// richiesta" apre il form guidato con i 4 tipi attività (Incontro
// Fornitore, Richiesta Analisi Campione Fornitore, Reclamo Fornitore,
// Riunione Interna) — il fornitore si sceglie nel form stesso. Ogni
// attività registrata vive in procurement_activities (ex
// "supplier_activities" — vedi 0021_pipeline_acquisti_attivita.sql) E genera
// una riga collegata in "requests" (reparto "acquisti"), che segue lo stato
// Nuova → In lavorazione → Risolta: è questa bacheca, non un elenco per
// data, la vista principale della pagina — stessa idea della Pipeline
// clienti, dove ogni attività diventa una scheda nella bacheca a colonne.
//
// La vecchia bacheca a colonne (prezzo unitario, quantità, stato
// da_inviare→ricevuta — 0014_pipeline_acquisti.sql, tabella
// "purchase_requests") non è più la vista di questa pagina: le richieste
// create prima di questo aggiornamento restano nel database, consultabili
// via Supabase, ma "+ Nuova richiesta" da oggi crea solo attività con la
// bacheca per stato qui sotto. Pagina visibile solo a "ufficio_acquisti" e
// "dirigente" — vedi 0013_moduli_ruoli.sql.
const CAN_ACCESS = ['ufficio_acquisti', 'dirigente']

function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date(new Date().toDateString())
}

// Bacheca divisa per stato per le "richieste" del reparto acquisti — ogni
// attività della Pipeline acquisti ne genera una (vedi handleSubmit in
// NewProcurementActivityForm): Andrea aveva segnalato che nella Pipeline
// acquisti "non ci sono le giuste divisioni in base allo stato" — questa
// bacheca mostra Nuova/Lavorazione/Risolta direttamente qui, oltre che
// nella pagina "Richieste".
const ACQUISTI_REQUEST_STATUSES: RequestStatus[] = ['nuova', 'lavorazione', 'risolta']
const ACQUISTI_REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  nuova: 'Nuova',
  lavorazione: 'In lavorazione',
  risolta: 'Risolta',
}

export function PurchasePipeline() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activities, setActivities] = useState<ProcurementActivity[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)
  const [acquistiRequests, setAcquistiRequests] = useState<Request[]>([])
  const [acquistiRequestsLoading, setAcquistiRequestsLoading] = useState(true)
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  const canAccess = profile ? CAN_ACCESS.includes(profile.role) : false

  async function loadSuppliers() {
    const { data, error } = await supabase.from('suppliers').select('*').order('name')
    if (error) console.error(error)
    setSuppliers((data as Supplier[]) ?? [])
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

  // Richieste del reparto "acquisti", una per ogni attività registrata
  // (vedi handleSubmit in NewProcurementActivityForm): sono la bacheca
  // principale di questa pagina — la RLS
  // (0030_richieste_calendario_acquisti.sql) limita già ciò che
  // ufficio_acquisti/dirigente possono vedere.
  async function loadAcquistiRequests() {
    setAcquistiRequestsLoading(true)
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('department', 'acquisti')
      .order('created_at', { ascending: false })
    if (error) console.error(error)
    setAcquistiRequests((data as Request[]) ?? [])
    setAcquistiRequestsLoading(false)
  }

  useEffect(() => {
    if (!canAccess) {
      setActivitiesLoading(false)
      setAcquistiRequestsLoading(false)
      return
    }
    loadSuppliers()
    loadActivities()
    loadAcquistiRequests()
    supabase
      .from('profiles')
      .select('*')
      .then(({ data }) => setProfiles((data as Profile[]) ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess])

  // Notifiche "live": se arriva una nuova richiesta acquisti o un'altra
  // persona ne cambia lo stato, la bacheca (e i pallini sulle colonne/righe
  // qui sotto) si aggiornano subito, senza dover ricaricare la pagina —
  // richiesto da Andrea (set 2026), stesso canale già usato per il pallino
  // sulla casella "Richieste" del menu (vedi AuthContext.tsx).
  useEffect(() => {
    if (!canAccess) return
    const channel = supabase
      .channel('acquisti_requests_live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'requests', filter: 'department=eq.acquisti' },
        () => loadAcquistiRequests(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess])

  // Deep-link (es. dalla scheda di un fornitore) — evidenzia e scorre fino
  // alla richiesta indicata.
  useEffect(() => {
    const fromLink = searchParams.get('richiesta')
    if (!fromLink || acquistiRequests.length === 0) return
    setExpandedId(fromLink)
    setHighlightedId(fromLink)
    setSearchParams({}, { replace: true })
    const timeout = setTimeout(() => {
      document.getElementById('acquisti-request-' + fromLink)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    const clearHighlight = setTimeout(() => setHighlightedId(null), 3000)
    return () => {
      clearTimeout(timeout)
      clearTimeout(clearHighlight)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, acquistiRequests])

  async function updateAcquistiRequestStatus(request: Request, status: RequestStatus) {
    if (request.status === status) return
    setAcquistiRequests((current) => current.map((r) => (r.id === request.id ? { ...r, status } : r)))
    const { error } = await supabase.from('requests').update({ status }).eq('id', request.id)
    if (error) {
      alert('Non è stato possibile aggiornare lo stato: ' + error.message)
      loadAcquistiRequests()
    }
  }

  const supplierMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])

  // La richiesta collegata non ha un campo fornitore proprio: lo risolve
  // passando dall'attività a cui è agganciata (ref_table/ref_id — vedi
  // handleSubmit in NewProcurementActivityForm).
  function acquistiRequestSupplierName(r: Request): string | undefined {
    if (r.ref_table !== 'procurement_activities' || !r.ref_id) return undefined
    const activity = activities.find((a) => a.id === r.ref_id)
    if (!activity?.supplier_id) return undefined
    return supplierMap.get(activity.supplier_id)?.name
  }

  function acquistiRequestActivity(r: Request): ProcurementActivity | undefined {
    if (r.ref_table !== 'procurement_activities' || !r.ref_id) return undefined
    return activities.find((a) => a.id === r.ref_id)
  }

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
          assignees={profiles}
          createdByName={profile.full_name}
          onCreated={() => { setShowActivityForm(false); loadActivities(); loadAcquistiRequests() }}
        />
      )}

      <p className="muted">
        Ogni attività registrata (Incontro Fornitore, Richiesta Analisi Campione Fornitore, Reclamo Fornitore,
        Riunione Interna) genera qui una scheda che segue lo stato Nuova → In lavorazione → Risolta — la stessa
        bacheca che trovi anche nella pagina "Richieste".
      </p>

      {(activitiesLoading || acquistiRequestsLoading) && <p className="muted">Caricamento…</p>}
      {!activitiesLoading && !acquistiRequestsLoading && acquistiRequests.length === 0 && !showActivityForm && (
        <p className="muted">Nessuna richiesta registrata ancora.</p>
      )}
      {!activitiesLoading && !acquistiRequestsLoading && acquistiRequests.length > 0 && (
        <div className="kanban-board">
          {ACQUISTI_REQUEST_STATUSES.map((status) => {
            const rows = acquistiRequests.filter((r) => r.status === status)
            return (
              <div key={status} className="kanban-col">
                <div className="kanban-col-head">
                  <span>
                    {ACQUISTI_REQUEST_STATUS_LABELS[status]}
                    {(status === 'nuova' || status === 'lavorazione') && rows.length > 0 ? (
                      <span className="stage-btn-notify">{rows.length > 99 ? '99+' : rows.length}</span>
                    ) : (
                      <span className="muted"> · {rows.length}</span>
                    )}
                  </span>
                </div>
                <div className="kanban-cards">
                  {rows.length === 0 && <p className="muted kanban-empty">Nessuna richiesta qui.</p>}
                  {rows.map((r) => (
                    <AcquistiRequestCard
                      key={r.id}
                      request={r}
                      activity={acquistiRequestActivity(r)}
                      supplierName={acquistiRequestSupplierName(r)}
                      highlighted={highlightedId === r.id}
                      expanded={expandedId === r.id}
                      onToggleExpand={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                      onChangeStatus={(s) => updateAcquistiRequestStatus(r, s)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Scheda della bacheca per stato: mostra il tipo di attività e il
// fornitore nel titolo (già nell'oggetto della richiesta collegata), con i
// dettagli guidati completi e i commenti a comparsa — stessa idea di
// DealDetails nella Pipeline clienti.
function AcquistiRequestCard({
  request,
  activity,
  supplierName,
  highlighted,
  expanded,
  onToggleExpand,
  onChangeStatus,
}: {
  request: Request
  activity: ProcurementActivity | undefined
  supplierName: string | undefined
  highlighted: boolean
  expanded: boolean
  onToggleExpand: () => void
  onChangeStatus: (s: RequestStatus) => void
}) {
  return (
    <div
      id={'acquisti-request-' + request.id}
      className={'card kanban-card' + (highlighted ? ' kanban-card-highlighted' : '')}
    >
      <div className="kanban-card-main">
        <strong>
          {(request.status === 'nuova' || request.status === 'lavorazione') && <span className="row-notify-dot" />}
          {request.subject}
        </strong>
        {supplierName && !request.subject.includes(supplierName) && <span className="muted">{supplierName}</span>}
      </div>

      {request.due_date && (
        <span className={'kanban-next-action' + (isOverdue(request.due_date) ? ' kanban-next-action-overdue' : '')}>
          Scadenza: {new Date(request.due_date).toLocaleDateString('it-IT')}
        </span>
      )}

      <div className="kanban-quick-actions">
        {ACQUISTI_REQUEST_STATUSES.filter((s) => s !== request.status).map((s) => (
          <button key={s} type="button" className="btn btn-ghost btn-sm" onClick={() => onChangeStatus(s)}>
            → {ACQUISTI_REQUEST_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <button type="button" className="kanban-details-toggle" onClick={onToggleExpand}>
        {expanded ? 'Nascondi dettagli ▾' : 'Dettagli e commenti ▸'}
      </button>
      {expanded && (
        <div className="kanban-card-expanded" onClick={(e) => e.stopPropagation()}>
          {activity ? (
            <ProcurementActivityDetailsView details={activity.activity_details} />
          ) : (
            <p className="muted">Attività collegata non trovata.</p>
          )}
          <CommentThread refTable="requests" refId={request.id} refLabel={request.subject} />
        </div>
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

  if (details.tag === 'INCONTRO FORNITORE') {
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
        <span className="muted">Segue lo stato nella bacheca qui sopra e in "Richieste".</span>
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

const RICEZIONE_OPTIONS: RicezioneReclamo[] = ['mail', 'telefonica', 'di_persona']
const NATURA_OPTIONS: NaturaReclamo[] = ['prodotto', 'documentale', 'logistica', 'servizio']
const URGENZA_OPTIONS: Urgenza[] = ['bassa', 'media', 'alta']
const PROCUREMENT_INCONTRO_OPTIONS: IncontroTipo[] = ['in_sede', 'presso_cliente', 'fiera']
// "Reclamo Cliente" tolto dal 2026 (Andrea: non pertinente all'ufficio
// acquisti, resta gestito dalla Pipeline clienti) — vedi ProcurementActivityDetails
// in lib/types.ts per la nota completa sul cambio.
const PROCUREMENT_ACTIVITY_TYPES = [
  'INCONTRO FORNITORE',
  'RICHIESTA ANALISI CAMPIONE FORNITORE',
  'RECLAMO FORNITORE',
  'RIUNIONE INTERNA',
] as const
// "Descrizione analisi" della richiesta campione fornitore non include "Test
// pelle" — opzione pensata solo per l'eventuale campione lato cliente.
const TIPO_ANALISI_OPTIONS_FORNITORE: TipoAnalisi[] = ['comparativa', 'nuovo_prodotto']
// Stessa idea di NEW_CLIENT_OPTION in Pipeline.tsx: un fornitore non ancora
// in anagrafica si crea al volo dentro il form, senza dover prima passare
// dalla pagina Fornitori.
const NEW_SUPPLIER_OPTION = '__nuovo__'

function NewProcurementActivityForm({
  suppliers,
  assignees,
  createdByName,
  onCreated,
}: {
  suppliers: Supplier[]
  assignees: Profile[]
  createdByName: string
  onCreated: () => void
}) {
  const [activityTag, setActivityTag] = useState<'' | (typeof PROCUREMENT_ACTIVITY_TYPES)[number]>('')
  const [supplierId, setSupplierId] = useState('')

  // Fornitore non ancora in anagrafica, creato al volo — stessa idea del
  // blocco "nuovo cliente" in Pipeline.tsx.
  const [manualSupplierName, setManualSupplierName] = useState('')
  const [newSupplierCategory, setNewSupplierCategory] = useState('')
  const [newSupplierCountry, setNewSupplierCountry] = useState('')
  const [newSupplierContactName, setNewSupplierContactName] = useState('')
  const [newSupplierContactEmail, setNewSupplierContactEmail] = useState('')
  const [newSupplierContactPhone, setNewSupplierContactPhone] = useState('')
  const usingManualSupplier = supplierId === NEW_SUPPLIER_OPTION

  // INCONTRO FORNITORE
  const [incontro, setIncontro] = useState<IncontroTipo | ''>('')
  const [temiTrattatiVisita, setTemiTrattatiVisita] = useState('')
  const [prodottiPresentati, setProdottiPresentati] = useState('')
  const [prossimiPassiVisita, setProssimiPassiVisita] = useState('')
  const [prossimiPassiDataVisita, setProssimiPassiDataVisita] = useState('')

  // RICHIESTA ANALISI CAMPIONE FORNITORE — a differenza delle altre
  // attività, questa segue anche il percorso Nuova/Lavorazione/Risolta:
  // alla creazione genera in più una riga in "requests" (reparto acquisti),
  // vedi handleSubmit.
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

  // RECLAMO FORNITORE
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

  const [assignments, setAssignments] = useState<PendingAssignment[]>([])
  const [saving, setSaving] = useState(false)

  const isReclamo = activityTag === 'RECLAMO FORNITORE'
  const isRichiestaAnalisiFornitore = activityTag === 'RICHIESTA ANALISI CAMPIONE FORNITORE'
  const needsSupplier = activityTag === 'INCONTRO FORNITORE' || activityTag === 'RECLAMO FORNITORE' || isRichiestaAnalisiFornitore

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
    if (needsSupplier) {
      if (!supplierId) return 'Seleziona il fornitore.'
      if (usingManualSupplier && !manualSupplierName.trim()) return 'Inserisci il nome del nuovo fornitore.'
    }
    if (activityTag === 'INCONTRO FORNITORE') {
      if (!incontro || !temiTrattatiVisita.trim() || !prodottiPresentati.trim() || !prossimiPassiVisita.trim()) {
        return 'Compila incontro, temi trattati, prodotti presentati e prossimi passi.'
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
    let subjectLabel: string = activityTag

    if (activityTag === 'INCONTRO FORNITORE') {
      supplierIdToSave = resolvedSupplierId
      activityDetails = {
        tag: 'INCONTRO FORNITORE',
        incontro,
        temi_trattati: temiTrattatiVisita.trim(),
        prodotti_presentati: prodottiPresentati.trim(),
        prossimi_passi: prossimiPassiVisita.trim(),
        prossimi_passi_data: prossimiPassiDataVisita,
      }
      subjectLabel = `${activityTag} — ${resolvedSupplierName}`
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
    } else if (activityTag === 'RIUNIONE INTERNA') {
      activityDetails = {
        tag: 'RIUNIONE INTERNA',
        reparti,
        persone_presenti: personePresenti.trim(),
        temi_trattati: temiTrattatiRiunione.trim(),
      }
    }

    const { data: newActivity, error } = await supabase
      .from('procurement_activities')
      .insert({
        supplier_id: supplierIdToSave,
        client_id: null,
        activity_details: activityDetails,
      })
      .select()
      .single()
    if (error) {
      setSaving(false)
      alert("Non è stato possibile registrare l'attività: " + error.message)
      return
    }

    // Ogni attività Acquisti genera anche una richiesta vera e propria
    // (reparto "acquisti"), così TUTTE — incontri fornitore, richieste
    // analisi campione, reclami fornitore e riunioni interne — compaiono
    // nella bacheca qui sopra e in "Richieste" con gli stati
    // Nuova/Lavorazione/Risolta, collegate all'attività (vedi refRecords.ts
    // — "procurement_activities" è già un tipo di collegamento valido). Un
    // errore qui non deve far perdere l'attività già registrata: si avvisa
    // e si prosegue, come per le assegnazioni.
    let requestSubject = ''
    let requestBodyLines: string[] = []
    let requestDueDate: string | null = null
    let requestPriority: Urgenza = 'media'

    if (activityTag === 'INCONTRO FORNITORE') {
      requestSubject = `Incontro fornitore — ${resolvedSupplierName}`
      requestBodyLines = [
        `Fornitore: ${resolvedSupplierName}`,
        incontro ? `Incontro: ${INCONTRO_TIPO_LABELS[incontro]}` : '',
        temiTrattatiVisita.trim() ? `Temi trattati: ${temiTrattatiVisita.trim()}` : '',
        prodottiPresentati.trim() ? `Prodotti presentati: ${prodottiPresentati.trim()}` : '',
      ]
      requestDueDate = prossimiPassiDataVisita || null
    } else if (isRichiestaAnalisiFornitore) {
      requestSubject = `Richiesta analisi campione fornitore — ${resolvedSupplierName}`
      requestBodyLines = [
        `Fornitore: ${resolvedSupplierName}`,
        `Descrizione prodotto: ${descrizioneProdottoAnalisi.trim()}`,
        tipoAnalisi ? `Descrizione analisi: ${TIPO_ANALISI_LABELS[tipoAnalisi]}` : '',
        prodottoDaComparare.trim() ? `Prodotto da comparare: ${prodottoDaComparare.trim()}` : '',
        descrizioneRichiesteAnalisi.trim() ? `Descrizione richieste analisi: ${descrizioneRichiesteAnalisi.trim()}` : '',
        richiestoDaAnalisi ? `Richiesta da: ${richiestoDaAnalisi}` : '',
      ]
      requestDueDate = prossimiPassiDataAnalisi || null
      requestPriority = (urgenzaAnalisi || 'media') as Urgenza
    } else if (activityTag === 'RECLAMO FORNITORE') {
      requestSubject = `Reclamo fornitore — ${resolvedSupplierName}`
      requestBodyLines = [
        `Fornitore: ${resolvedSupplierName}`,
        natura ? `Natura: ${NATURA_RECLAMO_LABELS[natura]}` : '',
        nomeProdotto.trim() ? `Nome prodotto: ${nomeProdotto.trim()}` : '',
        descrizioneReclamo.trim() ? `Descrizione reclamo: ${descrizioneReclamo.trim()}` : '',
      ]
      requestDueDate = prossimiPassiDataReclamo || null
      requestPriority = (urgenza || 'media') as Urgenza
    } else if (activityTag === 'RIUNIONE INTERNA') {
      requestSubject = `Riunione interna${reparti.length > 0 ? ' — ' + reparti.join(', ') : ''}`
      requestBodyLines = [
        reparti.length > 0 ? `Reparti: ${reparti.join(', ')}` : '',
        personePresenti.trim() ? `Persone presenti: ${personePresenti.trim()}` : '',
        temiTrattatiRiunione.trim() ? `Temi trattati: ${temiTrattatiRiunione.trim()}` : '',
      ]
    }

    if (requestSubject) {
      const { error: requestError } = await supabase.from('requests').insert({
        subject: requestSubject,
        sender: createdByName,
        department: 'acquisti',
        priority: requestPriority,
        body: requestBodyLines.filter(Boolean).join('\n'),
        due_date: requestDueDate,
        type: 'interna',
        status: 'nuova',
        ref_table: 'procurement_activities',
        ref_id: newActivity.id,
      })
      if (requestError) {
        setSaving(false)
        alert("L'attività è stata registrata, ma non è stato possibile creare la richiesta collegata: " + requestError.message)
        onCreated()
        return
      }
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

      {activityTag && (
        <p className="muted">
          Alla registrazione viene creata anche una richiesta in "Richieste" (reparto acquisti), visibile nella
          bacheca qui sopra e da seguire con gli stati Nuova / Lavorazione / Risolta.
        </p>
      )}

      {needsSupplier && (
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

      {isRichiestaAnalisiFornitore && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">Richiesta analisi campione fornitore</span>
          <div className="field-row">
            <label className="field-label">Descrizione prodotto</label>
            <textarea value={descrizioneProdottoAnalisi} onChange={(e) => setDescrizioneProdottoAnalisi(e.target.value)} required />
          </div>

          <div className="field-row-2">
            <div className="field-row">
              <label className="field-label">Scheda tecnica (facoltativo)</label>
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
        </div>
      )}

      {activityTag === 'INCONTRO FORNITORE' && (
        <div className="activity-fields-block">
          <span className="activity-fields-title">Incontro fornitore</span>
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
          <span className="activity-fields-title">Reclamo fornitore</span>
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

      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Salvataggio…' : 'Registra attività'}
      </button>
    </form>
  )
}
