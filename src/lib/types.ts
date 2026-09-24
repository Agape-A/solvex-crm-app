// Tipi allineati allo schema in supabase/migrations. Tenerli sincronizzati a
// mano è accettabile per un progetto piccolo; su un team più grande conviene
// generarli con `supabase gen types typescript`.

export type UserRole = 'operatore' | 'tecnico' | 'commerciale' | 'dirigente' | 'dottore_laboratorio' | 'ufficio_acquisti'
export const ROLE_LABELS: Record<UserRole, string> = {
  operatore: 'Operatore',
  tecnico: 'Tecnico',
  commerciale: 'Commerciale',
  dirigente: 'Dirigente',
  dottore_laboratorio: 'Ricerca&Sviluppo',
  ufficio_acquisti: 'Ufficio acquisti',
}
export const ALL_ROLES: UserRole[] = ['operatore', 'tecnico', 'commerciale', 'dirigente', 'dottore_laboratorio', 'ufficio_acquisti']
export type DealStage = 'lead' | 'qualificato' | 'proposta' | 'trattativa' | 'vinto' | 'perso'
export type RequestType = 'interna' | 'esterna'
export type RequestDepartment = 'commerciale' | 'tecnico' | 'operativo' | 'amministrazione'
export type RequestPriority = 'alta' | 'media' | 'bassa'
export type RequestStatus = 'nuova' | 'lavorazione' | 'risolta'
export type AppointmentType = 'visita_commerciale' | 'sopralluogo_tecnico' | 'altro'
export type ClientType = 'conceria' | 'distributore' | 'azienda_chimica'

export const REQUEST_DEPARTMENTS: RequestDepartment[] = ['commerciale', 'tecnico', 'operativo', 'amministrazione']
export const REQUEST_PRIORITIES: RequestPriority[] = ['alta', 'media', 'bassa']

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  conceria: 'Conceria',
  distributore: 'Distributore / Agente',
  azienda_chimica: 'Azienda chimica',
}

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  department: RequestDepartment | null
  initials: string
  email: string | null
  created_at: string
  chat_last_seen_at: string
}

export interface Client {
  id: string
  name: string
  sector: string | null
  client_type: ClientType
  country: string
  external_id: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  is_customer: boolean
  tags: string[]
  created_at: string
}

// ============ Lead guidati: campi specifici per "tag attività" ============
// Ogni tag attività può portare con sé un piccolo set di campi dedicati,
// pensati per rendere l'inserimento di un lead guidato e specifico invece
// che un unico modulo generico. Salvati in deals.activity_details (jsonb):
// una colonna flessibile perché l'elenco dei tag "guidati" crescerà nel
// tempo, ed evita di aggiungere decine di colonne quasi sempre vuote.
export type IncontroTipo = 'in_sede' | 'presso_cliente' | 'fiera' | 'telefonico'

export const INCONTRO_TIPO_LABELS: Record<IncontroTipo, string> = {
  in_sede: 'In sede',
  presso_cliente: 'Presso cliente',
  fiera: 'Fiera',
  telefonico: 'Telefonico',
}

export type RicezioneReclamo = 'mail' | 'telefonica' | 'di_persona'

export const RICEZIONE_RECLAMO_LABELS: Record<RicezioneReclamo, string> = {
  mail: 'Per mail',
  telefonica: 'Telefonica',
  di_persona: 'Di persona',
}

export type NaturaReclamo = 'prodotto' | 'documentale' | 'logistica' | 'servizio'

export const NATURA_RECLAMO_LABELS: Record<NaturaReclamo, string> = {
  prodotto: 'Non conformità prodotto',
  documentale: 'Non conformità documentale',
  // "Logistica" non era dettagliata nello schema di Andrea (mancava il
  // sotto-ramo con i suoi campi): per ora usa lo stesso set minimo del
  // servizio, da correggere quando mi dice cosa serve davvero qui.
  logistica: 'Non conformità logistica',
  servizio: 'Non conformità servizio',
}

export type Urgenza = 'bassa' | 'media' | 'alta'

export const URGENZA_LABELS: Record<Urgenza, string> = {
  bassa: 'Bassa (3 giorni)',
  media: 'Media (1-2 giorni)',
  alta: 'Alta (in giornata)',
}

// "Descrizione analisi" di una Richiesta analisi campione (fornitore o
// cliente) — vedi ProcurementActivityRichiestaAnalisiCampioneFornitore /
// DealActivityRichiestaAnalisiCampioneCliente più sotto. "test_pelle" è
// un'opzione solo per il campione cliente (non ha senso per un fornitore).
export type TipoAnalisi = 'comparativa' | 'nuovo_prodotto' | 'test_pelle'

export const TIPO_ANALISI_LABELS: Record<TipoAnalisi, string> = {
  comparativa: 'Comparativa',
  nuovo_prodotto: 'Analisi nuovo prodotto',
  test_pelle: 'Test pelle',
}

export const REPARTI_RIUNIONE = [
  'Tecnico',
  'Commerciale',
  'Amministrativo',
  'Acquisti',
  'Magazzino',
  'Produzione',
  'R&S',
] as const

// Un'assegnazione "in sospeso" compilata nel form, prima di diventare una
// vera richiesta (vedi src/components/ActivityAssignment.tsx): una per ogni
// persona scelta in "Assegnazione attività a".
export interface PendingAssignment {
  userId: string
  task: string
  dueDate: string
}

export interface DealActivityPrimaVisita {
  tag: 'PRIMA VISITA'
  incontro: IncontroTipo | ''
  temi_trattati: string
  prodotti_presentati: string
  prossimi_passi: string
}

export interface DealActivityVisitaCommerciale {
  tag: 'VISITA COMMERCIALE CLIENTE'
  incontro: IncontroTipo | ''
  temi_trattati: string
  prodotti_presentati: string
  prossimi_passi: string
}

export interface DealActivityVisitaTecnica {
  tag: 'VISITA TECNICA CLIENTE'
  incontro: IncontroTipo | ''
  attivita_svolte: string
  articoli_provati: string
  prodotti_testati: string
  prossimi_passi: string
}

// I campi specifici per "natura del reclamo" sono qui tutti insieme (invece
// che in un tipo distinto per ogni ramo): solo quelli pertinenti alla natura
// scelta vengono compilati, ma tenerli in un solo oggetto rende molto più
// semplice sia il form che la visualizzazione in sola lettura.
export interface DealActivityReclamoCliente {
  tag: 'RECLAMO CLIENTE'
  ricezione: RicezioneReclamo | ''
  natura: NaturaReclamo | ''
  nome_prodotto: string
  documento_numero: string
  descrizione_prodotto: string
  descrizione_servizio: string
  riferimento_lotto: string
  riferimento_documento: string
  descrizione_reclamo: string
  attachment_url: string | null
  attachment_name: string | null
  prossimi_passi: string
  urgenza: Urgenza | ''
}

export interface DealActivityRiunioneInterna {
  tag: 'RIUNIONE INTERNA'
  reparti: string[]
  persone_presenti: string
  temi_trattati: string
}

// Richiesta di analisi di un campione cliente, girata al laboratorio
// Ricerca&Sviluppo (assegnata via "Assegnazione attività a", come tutte le
// altre attività guidate). "richiesto_da" è chi ha fatto la richiesta, non
// necessariamente chi la sta inserendo nel CRM.
export interface DealActivityRichiestaAnalisiCampioneCliente {
  tag: 'RICHIESTA ANALISI CAMPIONE CLIENTE'
  descrizione_prodotto: string
  scheda_tecnica_url: string | null
  scheda_tecnica_name: string | null
  msds_url: string | null
  msds_name: string | null
  tipo_analisi: TipoAnalisi | ''
  prodotto_da_comparare: string
  descrizione_richieste_analisi: string
  descrizione_analisi_test_pelle: string
  metodo_test: string
  prossimi_passi: string
  urgenza: Urgenza | ''
  richiesto_da: string
}

export type DealActivityDetails =
  | DealActivityPrimaVisita
  | DealActivityVisitaCommerciale
  | DealActivityVisitaTecnica
  | DealActivityReclamoCliente
  | DealActivityRiunioneInterna
  | DealActivityRichiestaAnalisiCampioneCliente
  | null

// ============ Pipeline Acquisti: attività guidate (Visita Fornitore,
// Reclamo Fornitore, Reclamo Cliente, Riunione Interna) — stesso principio
// di deals.activity_details, ma in una tabella a sé (procurement_activities)
// perché non sono legate a un'opportunità di vendita: vivono in cima alla
// pagina Acquisti, con un fornitore o un cliente scelto nel form stesso
// (non serve aprire prima una scheda specifica), come da "Schema Nuova
// Pipeline Acquisti" di Andrea. Il Reclamo Cliente qui è autonomo, non
// richiede una trattativa aperta — è un secondo punto d'ingresso rispetto a
// deals.activity_details, pensato per chi lavora in ufficio acquisti.
export interface ProcurementActivityVisitaFornitore {
  tag: 'VISITA FORNITORE'
  incontro: IncontroTipo | ''
  temi_trattati: string
  prodotti_presentati: string
  prossimi_passi: string
  prossimi_passi_data: string
}

export interface ProcurementActivityReclamoFornitore {
  tag: 'RECLAMO FORNITORE'
  ricezione: RicezioneReclamo | ''
  natura: NaturaReclamo | ''
  nome_prodotto: string
  documento_numero: string
  descrizione_prodotto: string
  descrizione_servizio: string
  riferimento_lotto: string
  riferimento_documento: string
  descrizione_reclamo: string
  attachment_url: string | null
  attachment_name: string | null
  prossimi_passi: string
  prossimi_passi_data: string
  urgenza: Urgenza | ''
}

export interface ProcurementActivityReclamoCliente {
  tag: 'RECLAMO CLIENTE'
  ricezione: RicezioneReclamo | ''
  natura: NaturaReclamo | ''
  nome_prodotto: string
  documento_numero: string
  descrizione_prodotto: string
  descrizione_servizio: string
  riferimento_lotto: string
  riferimento_documento: string
  descrizione_reclamo: string
  attachment_url: string | null
  attachment_name: string | null
  prossimi_passi: string
  prossimi_passi_data: string
  urgenza: Urgenza | ''
}

export interface ProcurementActivityRiunioneInterna {
  tag: 'RIUNIONE INTERNA'
  reparti: string[]
  persone_presenti: string
  temi_trattati: string
}

// Richiesta di analisi di un campione fornitore, girata al laboratorio
// Ricerca&Sviluppo (assegnata via "Assegnazione attività a", come tutte le
// altre attività guidate). "richiesto_da" è chi ha fatto la richiesta, non
// necessariamente chi la sta inserendo nel CRM. Niente "test pelle" qui,
// opzione pensata solo per il campione cliente.
export interface ProcurementActivityRichiestaAnalisiCampioneFornitore {
  tag: 'RICHIESTA ANALISI CAMPIONE FORNITORE'
  descrizione_prodotto: string
  scheda_tecnica_url: string | null
  scheda_tecnica_name: string | null
  msds_url: string | null
  msds_name: string | null
  tipo_analisi: TipoAnalisi | ''
  prodotto_da_comparare: string
  descrizione_richieste_analisi: string
  prossimi_passi: string
  prossimi_passi_data: string
  urgenza: Urgenza | ''
  richiesto_da: string
}

export type ProcurementActivityDetails =
  | ProcurementActivityVisitaFornitore
  | ProcurementActivityReclamoFornitore
  | ProcurementActivityReclamoCliente
  | ProcurementActivityRiunioneInterna
  | ProcurementActivityRichiestaAnalisiCampioneFornitore
  | null

export interface ProcurementActivity {
  id: string
  supplier_id: string | null
  client_id: string | null
  activity_details: ProcurementActivityDetails
  tags: string[]
  created_by: string | null
  created_at: string
}

export interface Deal {
  id: string
  client_id: string | null
  client_name: string
  product: string
  value_estimate: number
  stage: DealStage
  owner_id: string | null
  next_action: string | null
  requires_tech_validation: boolean
  note: string
  tags: string[]
  activity_details: DealActivityDetails
  created_at: string
  updated_at: string
}

export interface Request {
  id: string
  subject: string
  sender: string
  type: RequestType
  department: RequestDepartment
  priority: RequestPriority
  status: RequestStatus
  assignee_id: string | null
  client_id: string | null
  // Collegamento generico a un record di un altro modulo (trattativa,
  // progetto, ricerca, fornitore...) — vedi src/lib/refRecords.ts e
  // 0015_richieste_collegate.sql. "clients" resta anche su client_id per
  // compatibilità con la cronologia già in uso nella pagina Clienti.
  ref_table: string | null
  ref_id: string | null
  body: string
  due_date: string | null
  source_email_id: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export interface Appointment {
  id: string
  client_name: string
  client_id: string | null
  subject: string
  appointment_at: string
  type: AppointmentType
  assignee_id: string | null
  note: string
  tags: string[]
  created_at: string
  updated_at: string
}

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  visita_commerciale: 'Visita commerciale',
  sopralluogo_tecnico: 'Sopralluogo tecnico',
  altro: 'Altro',
}

export interface ActivityLogEntry {
  id: string
  actor_id: string | null
  event_type: string
  ref_table: string
  ref_id: string
  message: string
  created_at: string
}

// Fasi della pipeline riviste con Andrea (set 2026): "Qualificato" non era
// chiaro ed è diventato "Primo Contatto"; "Trattativa" era poco utile per il
// loro settore ed è stata tolta — dopo l'offerta si passa direttamente a
// vinta o persa. Il valore enum "trattativa" resta nel database (i pochi
// vecchi record di test sono stati spostati su "proposta" dalla migration
// 0019) ma non è più una fase selezionabile.
export const DEAL_STAGES: { id: DealStage; label: string }[] = [
  { id: 'lead', label: 'Nuovo Lead' },
  { id: 'qualificato', label: 'Primo Contatto' },
  { id: 'proposta', label: 'Proposta Inviata' },
  { id: 'vinto', label: 'Chiuso Vinto' },
  { id: 'perso', label: 'Chiuso Perso' },
]

export type MarketingContactSource = 'referente_cliente' | 'fiera' | 'sito_web' | 'altro'

export const MARKETING_SOURCE_LABELS: Record<MarketingContactSource, string> = {
  referente_cliente: 'Referente cliente',
  fiera: 'Fiera',
  sito_web: 'Sito web',
  altro: 'Altro',
}

export interface MarketingList {
  id: string
  name: string
  description: string
  created_at: string
}

export interface MarketingContact {
  id: string
  full_name: string
  email: string
  phone: string | null
  company: string | null
  client_id: string | null
  source: MarketingContactSource
  consent_marketing: boolean
  consent_date: string | null
  consent_note: string
  unsubscribed_at: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export interface MarketingListMember {
  list_id: string
  contact_id: string
  added_at: string
}

export type MarketingCampaignStatus = 'bozza' | 'pronta'

export interface MarketingCampaign {
  id: string
  name: string
  subject: string
  body: string
  list_id: string | null
  status: MarketingCampaignStatus
  attachment_url: string | null
  attachment_name: string | null
  created_at: string
  updated_at: string
}

// ============ Ricerca&Sviluppo (ruolo "dottore_laboratorio" + "dirigente") ============

export type ResearchStatus = 'in_corso' | 'completata' | 'sospesa'

export const RESEARCH_STATUS_LABELS: Record<ResearchStatus, string> = {
  in_corso: 'In corso',
  completata: 'Completata',
  sospesa: 'Sospesa',
}

export interface ResearchRecord {
  id: string
  title: string
  objective: string
  protocol: string
  results: string
  status: ResearchStatus
  client_id: string | null
  product: string
  owner_id: string | null
  attachment_url: string | null
  attachment_name: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

// ============ Acquisti: fornitori + richieste d'acquisto
//              (ruolo "ufficio_acquisti" + "dirigente") ============

export interface Supplier {
  id: string
  name: string
  category: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  country: string | null
  note: string
  tags: string[]
  created_at: string
  updated_at: string
}

export type PurchaseStatus = 'da_inviare' | 'inviata' | 'confermata' | 'ricevuta' | 'annullata'

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  da_inviare: 'Da inviare',
  inviata: 'Inviata',
  confermata: 'Confermata',
  ricevuta: 'Ricevuta',
  annullata: 'Annullata',
}

export const PURCHASE_STATUSES: { id: PurchaseStatus; label: string }[] = [
  { id: 'da_inviare', label: 'Da inviare' },
  { id: 'inviata', label: 'Inviata' },
  { id: 'confermata', label: 'Confermata' },
  { id: 'ricevuta', label: 'Ricevuta' },
  { id: 'annullata', label: 'Annullata' },
]

export interface PurchaseRequest {
  id: string
  supplier_id: string
  subject: string
  status: PurchaseStatus
  requested_by: string | null
  due_date: string | null
  body: string
  // Campi "pipeline" aggiunti in 0014_pipeline_acquisti.sql: prezzo unitario
  // concordato, quantità (con unità di misura libera), specifiche d'ordine e
  // un allegato per la documentazione (schede tecniche, conferme, DDT...).
  unit_price: number | null
  quantity: number | null
  quantity_unit: string | null
  order_specs: string
  attachment_url: string | null
  attachment_name: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

// ============ Tag: elenco fisso, uguale in tutti i moduli ============

// Elenco chiuso — niente più testo libero — uguale per trattative, richieste,
// clienti, appuntamenti, sviluppo progetto, ricerche, fornitori, acquisti e
// contatti marketing: un vocabolario comune invece di uno diverso per ogni
// persona, per poter fare report per tag affidabili. La stessa lista vive
// anche lato database in 0016_tag_fissi.sql (vincolo CHECK) — se cambia va
// aggiornata in entrambi i posti. "ALTRO" copre i casi che non rientrano
// nelle altre categorie ed è anche il segnaposto usato dalla migrazione per
// i record già esistenti rimasti senza un tag valido.
export const CRM_TAGS = [
  'PRESENTAZIONE AZIENDALE',
  'RICHIESTA PREZZO',
  'RICHIESTA TECNICA',
  'RICHIESTA DOCUMENTALE',
  'RICHIESTA CERTIFICAZIONE',
  'CAMPIONATURA',
  'CONFERMA ORDINE',
  'NON CONFORMITÀ',
  'RECLAMO CLIENTE',
  'CONTATTO TELEFONICO',
  'CONTATTO EMAIL',
  'INCONTRO IN SEDE',
  'INCONTRO IN FIERA',
  'VISITA FORNITORE',
  'INCONTRO INTERNO',
  'RIUNIONE INTERNA',
  // Aggiunti con lo "Schema Nuova Pipeline" di Andrea (set 2026): i tipi
  // attività guidati usati nel form "+ Nuovo lead" della Pipeline.
  'PRIMA VISITA',
  'VISITA COMMERCIALE CLIENTE',
  'VISITA TECNICA CLIENTE',
  'RECLAMO FORNITORE',
  'ALTRO',
] as const

export type CrmTag = (typeof CRM_TAGS)[number]

// ============ Collaborazione: commenti sui record e chat interna ============

// "ref_table" è il nome della tabella collegata, "ref_id" l'id del record —
// un unico schema generico invece di una tabella di commenti per ciascun
// modulo.
export type CommentRefTable =
  | 'deals'
  | 'requests'
  | 'clients'
  | 'appointments'
  | 'research_records'
  | 'suppliers'
  | 'purchase_requests'

export interface RecordComment {
  id: string
  ref_table: CommentRefTable
  ref_id: string
  author_id: string | null
  body: string
  created_at: string
}

export interface ChatMessage {
  id: string
  author_id: string | null
  body: string
  created_at: string
}

// ============ Obiettivi annuali (impostati dalla direzione) ============

// Un obiettivo libero per persona/anno: titolo a scelta della direzione (es.
// "Vendite 2026", "Nuovi clienti fiera", "Campionature inviate"),
// assegnabile a chiunque in azienda — non solo a chi vende o acquista. Il
// CRM non calcola da solo l'avanzamento di un obiettivo con nome libero (a
// differenza di un dato come "vendite chiuse", che si legge dalle trattative):
// current_value lo aggiorna a mano chi è responsabile dell'obiettivo, o la
// direzione.
export interface AnnualTarget {
  id: string
  user_id: string
  year: number
  title: string
  unit: string
  target_value: number
  current_value: number
  note: string
  created_by: string | null
  created_at: string
  updated_at: string
}

// Tipo minimale per il client Supabase tipizzato — non è lo schema completo
// generato automaticamente, ma basta per l'autocompletamento di base.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any
