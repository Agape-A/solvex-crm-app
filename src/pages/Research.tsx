import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CommentThread } from '../components/CommentThread'
import { ActivityAssignment, createActivityAssignments } from '../components/ActivityAssignment'
import {
  RESEARCH_STATUS_LABELS,
  type Client,
  type PendingAssignment,
  type Profile,
  type ResearchRecord,
  type ResearchStatus,
} from '../lib/types'

// Pagina visibile solo a "dottore_laboratorio" e "dirigente" — vedi
// supabase/migrations/0013_moduli_ruoli.sql per le policy RLS gemelle.
const CAN_ACCESS = ['dottore_laboratorio', 'dirigente', 'amministrazione']
const STATUSES = Object.keys(RESEARCH_STATUS_LABELS) as ResearchStatus[]

export function Research() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [records, setRecords] = useState<ResearchRecord[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selected, setSelected] = useState<ResearchRecord | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  const canAccess = profile ? CAN_ACCESS.includes(profile.role) : false

  function clientFor(record: ResearchRecord) {
    return record.client_id ? clients.find((c) => c.id === record.client_id) ?? null : null
  }

  function ownerFor(record: ResearchRecord) {
    return record.owner_id ? profiles.find((p) => p.id === record.owner_id) ?? null : null
  }

  async function loadRecords() {
    setLoading(true)
    const { data, error } = await supabase.from('research_records').select('*').order('created_at', { ascending: false })
    if (error) console.error(error)
    const rows = (data as ResearchRecord[]) ?? []
    setRecords(rows)
    setSelected((current) => (current ? rows.find((r) => r.id === current.id) ?? rows[0] ?? null : rows[0] ?? null))
    setLoading(false)
  }

  async function loadClients() {
    const { data } = await supabase.from('clients').select('*').order('name')
    setClients((data as Client[]) ?? [])
  }

  async function loadProfiles() {
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setProfiles((data as Profile[]) ?? [])
  }

  useEffect(() => {
    if (!canAccess) {
      setLoading(false)
      return
    }
    loadRecords()
    loadClients()
    loadProfiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess])

  useEffect(() => {
    const fromLink = searchParams.get('id')
    if (!fromLink) return
    const record = records.find((r) => r.id === fromLink)
    if (record) setSelected(record)
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, records])

  if (!profile) return null

  if (!canAccess) {
    return (
      <div className="view">
        <h1>Ricerca&Sviluppo</h1>
        <p className="muted">Questa sezione è disponibile solo per il laboratorio ricerche e la direzione.</p>
      </div>
    )
  }

  async function updateRecord(record: ResearchRecord, patch: Partial<ResearchRecord>) {
    const { error } = await supabase.from('research_records').update(patch).eq('id', record.id)
    if (error) {
      alert('Non è stato possibile salvare la modifica: ' + error.message)
      return
    }
    setSelected((s) => (s && s.id === record.id ? { ...s, ...patch } : s))
    setRecords((rs) => rs.map((r) => (r.id === record.id ? { ...r, ...patch } : r)))
  }

  return (
    <div className="view">
      <div className="view-head">
        <h1>Ricerca&Sviluppo</h1>
        <div className="view-head-actions">
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Annulla' : '+ Nuova scheda'}
          </button>
        </div>
      </div>

      {showForm && (
        <NewResearchForm
          clients={clients}
          profiles={profiles}
          defaultOwnerId={profile.id}
          createdByName={profile.full_name}
          onCreated={() => {
            setShowForm(false)
            loadRecords()
          }}
        />
      )}

      {loading && <p className="muted">Caricamento…</p>}
      {!loading && records.length === 0 && <p className="muted">Nessuna scheda di ricerca ancora.</p>}

      <div className="req-layout">
        <div className="card req-list">
          {records.map((r) => (
            <div
              key={r.id}
              className={'req-row' + (selected?.id === r.id ? ' selected' : '')}
              onClick={() => setSelected(r)}
            >
              <div className="req-main">
                <div className="req-subject">{r.title}</div>
                <div className="req-meta">
                  {r.product || 'prodotto non specificato'}
                  {ownerFor(r) && ' · ' + ownerFor(r)?.full_name}
                  {clientFor(r) && ' · cliente collegato'}
                </div>
              </div>
              <span className={'pill pill-' + r.status}>{RESEARCH_STATUS_LABELS[r.status]}</span>
            </div>
          ))}
        </div>

        <div className="card detail-panel">
          {!selected && <p className="muted">Seleziona una scheda dall'elenco.</p>}
          {selected && <ResearchDetail record={selected} clients={clients} profiles={profiles} onChange={(patch) => updateRecord(selected, patch)} />}
        </div>
      </div>
    </div>
  )
}

function ResearchDetail({
  record,
  clients,
  profiles,
  onChange,
}: {
  record: ResearchRecord
  clients: Client[]
  profiles: Profile[]
  onChange: (patch: Partial<ResearchRecord>) => void
}) {
  const [objective, setObjective] = useState(record.objective)
  const [protocol, setProtocol] = useState(record.protocol)
  const [results, setResults] = useState(record.results)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    setObjective(record.objective)
    setProtocol(record.protocol)
    setResults(record.results)
  }, [record.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const client = record.client_id ? clients.find((c) => c.id === record.client_id) ?? null : null

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('research-attachments').upload(path, file, { upsert: true })
    setUploading(false)
    e.target.value = ''
    if (error) {
      alert("Non è stato possibile caricare l'allegato: " + error.message)
      return
    }
    const { data } = supabase.storage.from('research-attachments').getPublicUrl(path)
    onChange({ attachment_url: data.publicUrl, attachment_name: file.name })
  }

  return (
    <>
      <div className="eyebrow">{record.product || 'Scheda di ricerca'}</div>
      <h3>{record.title}</h3>
      {client && (
        <p className="muted">
          Cliente collegato: <Link to={`/clienti?cliente=${record.client_id}`}>{client.name}</Link>
        </p>
      )}

      <div className="field-row">
        <label className="field-label">Stato</label>
        <div className="stage-btn-row">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={'stage-btn' + (record.status === s ? ' current' : '')}
              onClick={() => onChange({ status: s })}
            >
              {RESEARCH_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <label className="field-label">Responsabile</label>
        <select value={record.owner_id ?? ''} onChange={(e) => onChange({ owner_id: e.target.value || null })}>
          <option value="">— nessuno —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <label className="field-label">Obiettivo</label>
        <textarea
          className="note-field"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          onBlur={() => objective !== record.objective && onChange({ objective })}
        />
      </div>

      <div className="field-row">
        <label className="field-label">Metodo / protocollo</label>
        <textarea
          className="note-field"
          value={protocol}
          onChange={(e) => setProtocol(e.target.value)}
          onBlur={() => protocol !== record.protocol && onChange({ protocol })}
        />
      </div>

      <div className="field-row">
        <label className="field-label">Risultati</label>
        <textarea
          className="note-field"
          value={results}
          onChange={(e) => setResults(e.target.value)}
          onBlur={() => results !== record.results && onChange({ results })}
        />
      </div>

      <div className="field-row">
        <label className="field-label">Allegato (facoltativo — es. referto, grafico)</label>
        {record.attachment_url ? (
          <div className="marketing-attachment-row">
            <a href={record.attachment_url} target="_blank" rel="noreferrer">
              📎 {record.attachment_name}
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onChange({ attachment_url: null, attachment_name: null })}
            >
              Rimuovi
            </button>
          </div>
        ) : (
          <input type="file" onChange={handleFileChange} disabled={uploading} />
        )}
        {uploading && <span className="muted">Caricamento…</span>}
      </div>

      <CommentThread refTable="research_records" refId={record.id} refLabel={record.title} />
    </>
  )
}

function NewResearchForm({
  clients,
  profiles,
  defaultOwnerId,
  createdByName,
  onCreated,
}: {
  clients: Client[]
  profiles: Profile[]
  defaultOwnerId: string
  createdByName: string
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [product, setProduct] = useState('')
  const [clientId, setClientId] = useState('')
  const [ownerId, setOwnerId] = useState(defaultOwnerId)
  const [objective, setObjective] = useState('')
  const [assignments, setAssignments] = useState<PendingAssignment[]>([])
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    for (const a of assignments) {
      if (!a.task.trim() || !a.dueDate) {
        alert('Per ogni persona assegnata servono attività da svolgere e scadenza.')
        return
      }
    }
    setSaving(true)
    const { data: newRecord, error } = await supabase
      .from('research_records')
      .insert({
        title,
        product,
        client_id: clientId || null,
        owner_id: ownerId || null,
        objective,
        status: 'in_corso',
      })
      .select()
      .single()
    if (error) {
      setSaving(false)
      alert('Non è stato possibile creare la scheda: ' + error.message)
      return
    }

    if (assignments.length > 0) {
      const { error: assignError } = await createActivityAssignments({
        assignments,
        profiles,
        refTable: 'research_records',
        refId: newRecord.id,
        subject: `Scheda di ricerca — ${title}`,
        createdByName,
      })
      if (assignError) {
        setSaving(false)
        alert('La scheda è stata creata, ma non è stato possibile creare tutte le richieste di assegnazione: ' + assignError)
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
        <label className="field-label">Titolo</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Prodotto</label>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="es. concia al cromo" />
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
      </div>
      <div className="field-row">
        <label className="field-label">Responsabile</label>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">— nessuno —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label className="field-label">Obiettivo</label>
        <textarea className="note-field" value={objective} onChange={(e) => setObjective(e.target.value)} />
      </div>
      <ActivityAssignment profiles={profiles} assignments={assignments} onChange={setAssignments} />
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Creazione…' : 'Crea scheda'}
      </button>
    </form>
  )
}
