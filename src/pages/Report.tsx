import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { OwnGoalsPanel } from '../components/GoalsPanel'
import {
  CLIENT_TYPE_LABELS,
  DEAL_STAGES,
  PURCHASE_STATUSES,
  RESEARCH_STATUS_LABELS,
  type AnnualTarget,
  type Client,
  type ClientType,
  type Deal,
  type ProcurementActivity,
  type Profile,
  type PurchaseRequest,
  type Request,
  type ResearchRecord,
  type ResearchStatus,
  type Supplier,
} from '../lib/types'

// Palette categorica validata (skill dataviz): ordine fisso, mai ciclato.
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']
const STATUS_COLOR: Record<string, string> = {
  nuova: '#2a78d6',
  lavorazione: '#c98a00',
  risolta: '#0ca30c',
}

const currency = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const DEPARTMENTS = ['commerciale', 'tecnico', 'operativo', 'amministrazione', 'acquisti'] as const
// "Reclamo Cliente" tolto dal 2026, non più tra le attività Acquisti proponibili — vedi PurchasePipeline.tsx.
const ACTIVITY_TAGS = ['INCONTRO FORNITORE', 'RICHIESTA ANALISI CAMPIONE FORNITORE', 'RECLAMO FORNITORE', 'RIUNIONE INTERNA'] as const

interface BarRow {
  label: string
  value: number
  formatted: string
  color?: string
}

function BarList({ rows, tableCaption }: { rows: BarRow[]; tableCaption: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div className="barlist-row" key={r.label}>
          <div className="barlist-label">{r.label}</div>
          <div className="barlist-track">
            <div
              className="barlist-fill"
              style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? 'var(--accent)' }}
            />
          </div>
          <div className="barlist-value">{r.formatted}</div>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">Nessun dato disponibile.</p>}
      {/* Tabella accessibile equivalente al grafico, per chi usa uno screen reader
          o non distingue bene i colori — vedi skill dataviz, "table fallback". */}
      <table className="sr-only-table">
        <caption>{tableCaption}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.formatted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Form per la direzione: crea un nuovo obiettivo libero, assegnato a una
// persona a scelta.
function NewGoalForm({
  profiles,
  year,
  onCreate,
}: {
  profiles: Profile[]
  year: number
  onCreate: (patch: { user_id: string; title: string; unit: string; target_value: number; note: string }) => Promise<void>
}) {
  const [userId, setUserId] = useState(profiles[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [unit, setUnit] = useState('')
  const [targetValue, setTargetValue] = useState(0)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!userId || !title.trim()) return
    setSaving(true)
    await onCreate({ user_id: userId, title: title.trim(), unit: unit.trim(), target_value: targetValue, note: note.trim() })
    setSaving(false)
    setTitle('')
    setUnit('')
    setTargetValue(0)
    setNote('')
  }

  return (
    <form className="goal-add-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field-label">Persona</label>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label className="field-label">Titolo obiettivo</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="es. Nuovi clienti fiera" required />
      </div>
      <div className="field-row">
        <label className="field-label">Target</label>
        <input type="number" min={0} value={targetValue} onChange={(e) => setTargetValue(Number(e.target.value))} />
      </div>
      <div className="field-row">
        <label className="field-label">Unità (facoltativa)</label>
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="es. €, clienti, pezzi" />
      </div>
      <div className="field-row">
        <label className="field-label">Nota (facoltativa)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="submit" disabled={saving || !userId}>
        {saving ? 'Creazione…' : '+ Aggiungi obiettivo'}
      </button>
    </form>
  )
}

// Riga di modifica per la direzione: titolo, target e avanzamento di un
// obiettivo già esistente — la direzione può correggere anche
// l'avanzamento, non solo chi è responsabile dell'obiettivo (vedi RLS).
function GoalAdminRow({
  goal,
  personName,
  onSave,
  onDelete,
}: {
  goal: AnnualTarget
  personName: string
  onSave: (patch: { title: string; unit: string; target_value: number; current_value: number; note: string }) => Promise<void>
  onDelete: () => void
}) {
  const [title, setTitle] = useState(goal.title)
  const [unit, setUnit] = useState(goal.unit)
  const [targetValue, setTargetValue] = useState(goal.target_value)
  const [currentValue, setCurrentValue] = useState(goal.current_value)
  const [note, setNote] = useState(goal.note)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave({ title, unit, target_value: targetValue, current_value: currentValue, note })
    setSaving(false)
  }

  const pct = targetValue > 0 ? Math.min(100, Math.round((currentValue / targetValue) * 100)) : 0

  return (
    <div className="target-admin-row">
      <div className="target-admin-name">
        <strong>{personName}</strong>
        <span className="muted">{pct}% raggiunto</span>
      </div>
      <div className="target-admin-inputs">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titolo" />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unità" style={{ width: 80 }} />
        <label className="field-label">target</label>
        <input type="number" min={0} value={targetValue} onChange={(e) => setTargetValue(Number(e.target.value))} />
        <label className="field-label">raggiunto</label>
        <input type="number" min={0} value={currentValue} onChange={(e) => setCurrentValue(Number(e.target.value))} />
        <input className="target-admin-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota" />
        <button className="btn btn-ghost" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvataggio…' : 'Salva'}
        </button>
        <button className="btn btn-ghost client-delete-btn" onClick={onDelete}>
          Elimina
        </button>
      </div>
    </div>
  )
}

export function Report() {
  const { profile } = useAuth()
  const [deals, setDeals] = useState<Deal[]>([])
  const [requests, setRequests] = useState<Request[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [research, setResearch] = useState<ResearchRecord[]>([])
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([])
  const [procurementActivities, setProcurementActivities] = useState<ProcurementActivity[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [targets, setTargets] = useState<AnnualTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [targetYear, setTargetYear] = useState(new Date().getFullYear())

  // Ogni reparto vede i propri dati (più la direzione, che vede tutto) — le
  // stesse regole delle pagine dedicate (Pipeline, Ricerca&Sviluppo, Acquisti,
  // vedi 0013_moduli_ruoli.sql). La RLS impedirebbe comunque la lettura a chi
  // non ha il ruolo giusto: qui evitiamo solo la query inutile.
  const canSeeCommerciale = profile ? ['tecnico', 'commerciale', 'dirigente'].includes(profile.role) : false
  const canSeeResearch = profile ? ['dottore_laboratorio', 'dirigente'].includes(profile.role) : false
  const canSeeAcquisti = profile ? ['ufficio_acquisti', 'dirigente'].includes(profile.role) : false
  const isDirigente = profile?.role === 'dirigente'

  async function reloadTargets() {
    const { data } = await supabase.from('annual_targets').select('*')
    setTargets((data as AnnualTarget[]) ?? [])
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [dealsRes, requestsRes, clientsRes, researchRes, purchaseRes, activitiesRes, suppliersRes, profilesRes, targetsRes] =
        await Promise.all([
          canSeeCommerciale ? supabase.from('deals').select('*') : Promise.resolve({ data: [] as Deal[], error: null }),
          supabase.from('requests').select('*'),
          canSeeCommerciale ? supabase.from('clients').select('*') : Promise.resolve({ data: [] as Client[], error: null }),
          canSeeResearch
            ? supabase.from('research_records').select('*')
            : Promise.resolve({ data: [] as ResearchRecord[], error: null }),
          canSeeAcquisti
            ? supabase.from('purchase_requests').select('*')
            : Promise.resolve({ data: [] as PurchaseRequest[], error: null }),
          canSeeAcquisti
            ? supabase.from('procurement_activities').select('*')
            : Promise.resolve({ data: [] as ProcurementActivity[], error: null }),
          canSeeAcquisti ? supabase.from('suppliers').select('*') : Promise.resolve({ data: [] as Supplier[], error: null }),
          supabase.from('profiles').select('*'),
          supabase.from('annual_targets').select('*'),
        ])
      setDeals((dealsRes.data as Deal[]) ?? [])
      setRequests((requestsRes.data as Request[]) ?? [])
      setClients((clientsRes.data as Client[]) ?? [])
      setResearch((researchRes.data as ResearchRecord[]) ?? [])
      setPurchaseRequests((purchaseRes.data as PurchaseRequest[]) ?? [])
      setProcurementActivities((activitiesRes.data as ProcurementActivity[]) ?? [])
      setSuppliers((suppliersRes.data as Supplier[]) ?? [])
      setProfiles((profilesRes.data as Profile[]) ?? [])
      setTargets((targetsRes.data as AnnualTarget[]) ?? [])
      setLoading(false)
    }
    load()
  }, [canSeeCommerciale, canSeeResearch, canSeeAcquisti])

  if (!profile) return null
  if (loading) return <div className="view"><p className="muted">Caricamento…</p></div>

  // ============ Richieste (generale, tutti i ruoli) ============

  const richiesteAperte = requests.filter((r) => r.status !== 'risolta')
  const risolte = requests.filter((r) => r.status === 'risolta')
  const tempoMedioOre =
    risolte.length === 0
      ? null
      : risolte.reduce((s, r) => s + (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()), 0) /
        risolte.length /
        3_600_000
  const tempoMedioLabel =
    tempoMedioOre == null
      ? '—'
      : tempoMedioOre < 24
      ? `${tempoMedioOre.toFixed(1)} ore`
      : `${(tempoMedioOre / 24).toFixed(1)} giorni`

  const perReparto: BarRow[] = DEPARTMENTS.map((dep, i) => {
    const count = requests.filter((r) => r.department === dep).length
    return { label: dep, value: count, formatted: String(count), color: CATEGORICAL[i % CATEGORICAL.length] }
  })

  const perStato: BarRow[] = (['nuova', 'lavorazione', 'risolta'] as const).map((st) => {
    const count = requests.filter((r) => r.status === st).length
    return { label: st, value: count, formatted: String(count), color: STATUS_COLOR[st] }
  })

  // ============ Commerciale ============

  const pipelineAperta = deals.filter((d) => d.stage !== 'vinto' && d.stage !== 'perso')
  const vinti = deals.filter((d) => d.stage === 'vinto')
  const valorePipelineAperta = pipelineAperta.reduce((s, d) => s + Number(d.value_estimate), 0)
  const valoreVinto = vinti.reduce((s, d) => s + Number(d.value_estimate), 0)

  const valorePerFase: BarRow[] = DEAL_STAGES.map((s) => {
    const v = deals.filter((d) => d.stage === s.id).reduce((sum, d) => sum + Number(d.value_estimate), 0)
    return { label: s.label, value: v, formatted: currency.format(v) }
  })

  const funnelStages = DEAL_STAGES.filter((s) => s.id !== 'perso')
  const funnel: BarRow[] = funnelStages.map((s) => {
    const count = deals.filter((d) => d.stage === s.id).length
    return { label: s.label, value: count, formatted: String(count) }
  })

  // Valore per canale: unisce le trattative (non perse) al tipo di cliente
  // collegato — i tre canali commerciali reali dell'azienda (concerie,
  // distributori/agenti, aziende chimiche private label) più le trattative
  // ancora senza un cliente vero e proprio in anagrafica.
  const clientTypeById = new Map(clients.map((c) => [c.id, c.client_type]))
  const CHANNELS: (ClientType | 'non_collegato')[] = ['conceria', 'distributore', 'azienda_chimica', 'non_collegato']
  const CHANNEL_LABELS: Record<ClientType | 'non_collegato', string> = {
    ...CLIENT_TYPE_LABELS,
    non_collegato: 'Non collegato in anagrafica',
  }
  const dealsNonPersi = deals.filter((d) => d.stage !== 'perso')
  const valorePerCanale: BarRow[] = CHANNELS.map((ch, i) => {
    const v = dealsNonPersi
      .filter((d) => (d.client_id ? clientTypeById.get(d.client_id) ?? 'non_collegato' : 'non_collegato') === ch)
      .reduce((sum, d) => sum + Number(d.value_estimate), 0)
    return { label: CHANNEL_LABELS[ch], value: v, formatted: currency.format(v), color: CATEGORICAL[i] }
  })

  // Andamento mensile: valore delle trattative chiuse vinte negli ultimi 6
  // mesi (mese corrente incluso), per capire il trend invece della sola
  // fotografia di oggi.
  const monthLabel = (d: Date) => d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' })
  const months: { key: string; label: string }[] = []
  const cursor = new Date()
  cursor.setDate(1)
  for (let i = 5; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1)
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: monthLabel(d) })
  }
  const vintiPerMese: BarRow[] = months.map(({ key, label }) => {
    const v = vinti
      .filter((d) => {
        const u = new Date(d.updated_at)
        return `${u.getFullYear()}-${u.getMonth()}` === key
      })
      .reduce((sum, d) => sum + Number(d.value_estimate), 0)
    return { label, value: v, formatted: currency.format(v) }
  })

  // ============ Ricerca&Sviluppo ============

  const ricercheInCorso = research.filter((r) => r.status === 'in_corso').length
  const schedePerStato: BarRow[] = (['in_corso', 'completata', 'sospesa'] as ResearchStatus[]).map((st, i) => {
    const count = research.filter((r) => r.status === st).length
    return { label: RESEARCH_STATUS_LABELS[st], value: count, formatted: String(count), color: CATEGORICAL[i] }
  })

  // ============ Acquisti ============

  const acquistiAperti = purchaseRequests.filter((p) => p.status !== 'ricevuta' && p.status !== 'annullata')
  const valoreAcquistiConfermati = purchaseRequests
    .filter((p) => p.status === 'confermata' || p.status === 'ricevuta')
    .reduce((s, p) => s + (p.unit_price ?? 0) * (p.quantity ?? 0), 0)
  const acquistiPerStato: BarRow[] = PURCHASE_STATUSES.map((s, i) => {
    const count = purchaseRequests.filter((p) => p.status === s.id).length
    return { label: s.label, value: count, formatted: String(count), color: CATEGORICAL[i % CATEGORICAL.length] }
  })
  const attivitaPerTipo: BarRow[] = ACTIVITY_TAGS.map((tag, i) => {
    const count = procurementActivities.filter((a) => a.activity_details?.tag === tag).length
    return { label: tag, value: count, formatted: String(count), color: CATEGORICAL[i] }
  })

  const nessunReparto = !canSeeCommerciale && !canSeeResearch && !canSeeAcquisti

  // ============ Obiettivi annuali (direzione) ============
  // Obiettivi liberi, uno o più per persona: la direzione ne crea di nuovi e
  // corregge quelli esistenti; l'avanzamento viene aggiornato a mano (da chi
  // è responsabile, nel pannello "I tuoi obiettivi", o qui dalla direzione).
  async function createGoal(patch: { user_id: string; title: string; unit: string; target_value: number; note: string }) {
    const { error } = await supabase
      .from('annual_targets')
      .insert({ ...patch, year: targetYear, current_value: 0, created_by: profile?.id ?? null })
    if (error) {
      alert('Non è stato possibile creare l\'obiettivo: ' + error.message)
      return
    }
    await reloadTargets()
  }
  async function updateGoal(
    goalId: string,
    patch: { title: string; unit: string; target_value: number; current_value: number; note: string }
  ) {
    const { error } = await supabase.from('annual_targets').update(patch).eq('id', goalId)
    if (error) {
      alert("Non è stato possibile salvare l'obiettivo: " + error.message)
      return
    }
    await reloadTargets()
  }
  async function deleteGoal(goalId: string, title: string) {
    if (!window.confirm(`Eliminare l'obiettivo "${title}"?`)) return
    const { error } = await supabase.from('annual_targets').delete().eq('id', goalId)
    if (error) {
      alert("Non è stato possibile eliminare l'obiettivo: " + error.message)
      return
    }
    await reloadTargets()
  }

  const profileNameById = new Map(profiles.map((p) => [p.id, p.full_name]))
  const goalsForYear = targets
    .filter((t) => t.year === targetYear)
    .sort((a, b) => (profileNameById.get(a.user_id) ?? '').localeCompare(profileNameById.get(b.user_id) ?? ''))
  const thisYear = new Date().getFullYear()

  return (
    <div className="view view-wide">
      <div className="view-head">
        <h1>Report e analytics</h1>
      </div>

      {isDirigente && (
        <>
          <div className="section-title">Direzione — vista d'insieme</div>
          <div className="tile-row tile-row-4">
            <div className="card tile">
              <div className="tile-label">Pipeline aperta</div>
              <div className="tile-value">{currency.format(valorePipelineAperta)}</div>
            </div>
            <div className="card tile">
              <div className="tile-label">Richieste aperte</div>
              <div className="tile-value">{richiesteAperte.length}</div>
            </div>
            <div className="card tile">
              <div className="tile-label">Ricerche in corso</div>
              <div className="tile-value">{ricercheInCorso}</div>
            </div>
            <div className="card tile">
              <div className="tile-label">Acquisti da completare</div>
              <div className="tile-value">{acquistiAperti.length}</div>
            </div>
          </div>

          <div className="view-head report-section-head">
            <h2>Target annuali</h2>
            <div className="view-head-actions">
              <label className="field-label" htmlFor="target-year">
                Anno
              </label>
              <input
                id="target-year"
                type="number"
                value={targetYear}
                onChange={(e) => setTargetYear(Number(e.target.value))}
                style={{ width: 90 }}
              />
            </div>
          </div>
          <p className="muted">
            Obiettivi liberi, uno o più per persona — assegnabili a chiunque in azienda. L'avanzamento lo
            aggiorna chi è responsabile dell'obiettivo (o tu da qui).
          </p>
          <NewGoalForm profiles={profiles} year={targetYear} onCreate={createGoal} />
          <div className="card panel target-admin-list">
            {goalsForYear.length === 0 && <p className="muted">Nessun obiettivo impostato per il {targetYear}.</p>}
            {goalsForYear.map((g) => (
              <GoalAdminRow
                key={g.id}
                goal={g}
                personName={profileNameById.get(g.user_id) ?? '—'}
                onSave={(patch) => updateGoal(g.id, patch)}
                onDelete={() => deleteGoal(g.id, g.title)}
              />
            ))}
          </div>
        </>
      )}

      <OwnGoalsPanel userId={profile.id} year={thisYear} />

      <div className="view-head report-section-head">
        <h2>Richieste</h2>
      </div>
      <div className="tile-row">
        <div className="card tile">
          <div className="tile-label">Richieste aperte</div>
          <div className="tile-value">{richiesteAperte.length}</div>
        </div>
        <div className="card tile">
          <div className="tile-label">Tempo medio di risposta</div>
          <div className="tile-value">{tempoMedioLabel}</div>
        </div>
      </div>
      <div className="chart-grid">
        <div className="card panel">
          <div className="section-title">Richieste per reparto</div>
          <BarList rows={perReparto} tableCaption="Numero di richieste per reparto" />
        </div>
        <div className="card panel">
          <div className="section-title">Richieste per stato</div>
          <BarList rows={perStato} tableCaption="Numero di richieste per stato di lavorazione" />
        </div>
      </div>

      {canSeeCommerciale && (
        <>
          <div className="view-head report-section-head">
            <h2>Commerciale</h2>
          </div>
          <div className="tile-row">
            <div className="card tile">
              <div className="tile-label">Pipeline aperta</div>
              <div className="tile-value">{currency.format(valorePipelineAperta)}</div>
            </div>
            <div className="card tile">
              <div className="tile-label">Chiuso vinto</div>
              <div className="tile-value">{currency.format(valoreVinto)}</div>
            </div>
          </div>
          <div className="chart-grid">
            <div className="card panel">
              <div className="section-title">Valore pipeline per fase</div>
              <BarList rows={valorePerFase} tableCaption="Valore stimato delle trattative per fase" />
            </div>
            <div className="card panel">
              <div className="section-title">Funnel di conversione</div>
              <BarList rows={funnel} tableCaption="Numero di trattative per fase, dal lead alla chiusura" />
            </div>
            <div className="card panel">
              <div className="section-title">Valore per canale commerciale</div>
              <BarList rows={valorePerCanale} tableCaption="Valore delle trattative non perse per tipo di cliente" />
            </div>
            <div className="card panel">
              <div className="section-title">Chiuso vinto, ultimi 6 mesi</div>
              <BarList rows={vintiPerMese} tableCaption="Valore delle trattative chiuse vinte, per mese" />
            </div>
          </div>
        </>
      )}

      {canSeeResearch && (
        <>
          <div className="view-head report-section-head">
            <h2>Ricerca&Sviluppo</h2>
          </div>
          <div className="tile-row">
            <div className="card tile">
              <div className="tile-label">Schede di ricerca totali</div>
              <div className="tile-value">{research.length}</div>
            </div>
            <div className="card tile">
              <div className="tile-label">In corso</div>
              <div className="tile-value">{ricercheInCorso}</div>
            </div>
          </div>
          <div className="chart-grid">
            <div className="card panel">
              <div className="section-title">Schede per stato</div>
              <BarList rows={schedePerStato} tableCaption="Numero di schede di ricerca per stato" />
            </div>
          </div>
        </>
      )}

      {canSeeAcquisti && (
        <>
          <div className="view-head report-section-head">
            <h2>Acquisti</h2>
          </div>
          <div className="tile-row">
            <div className="card tile">
              <div className="tile-label">Richieste d'acquisto aperte</div>
              <div className="tile-value">{acquistiAperti.length}</div>
            </div>
            <div className="card tile">
              <div className="tile-label">Valore confermato/ricevuto</div>
              <div className="tile-value">{currency.format(valoreAcquistiConfermati)}</div>
            </div>
            <div className="card tile">
              <div className="tile-label">Fornitori</div>
              <div className="tile-value">{suppliers.length}</div>
            </div>
          </div>
          <div className="chart-grid">
            <div className="card panel">
              <div className="section-title">Richieste d'acquisto per stato</div>
              <BarList rows={acquistiPerStato} tableCaption="Numero di richieste d'acquisto per stato" />
            </div>
            <div className="card panel">
              <div className="section-title">Attività Acquisti per tipo</div>
              <BarList rows={attivitaPerTipo} tableCaption="Numero di attività Acquisti per tipo" />
            </div>
          </div>
        </>
      )}

      {nessunReparto && (
        <p className="muted">
          Il tuo ruolo vede qui solo i dati sulle richieste — le sezioni per reparto (Commerciale,
          Ricerca&Sviluppo, Acquisti) sono riservate a chi ci lavora.
        </p>
      )}
    </div>
  )
}
