import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CommentThread } from '../components/CommentThread'
import { PURCHASE_STATUS_LABELS, type PurchaseRequest, type Supplier } from '../lib/types'

// Pagina "Fornitori", costruita sullo stesso schema della pagina Clienti:
// filtro per categoria, elenco + dettaglio, importazione da Excel/CSV,
// cronologia delle richieste d'acquisto collegate, tag e commenti condivisi.
// Visibile solo a "ufficio_acquisti" e "dirigente" — vedi
// supabase/migrations/0013_moduli_ruoli.sql e 0014_pipeline_acquisti.sql.
const CAN_ACCESS = ['ufficio_acquisti', 'dirigente', 'amministrazione']
const currency = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function Suppliers() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [filter, setFilter] = useState<string>('tutti')
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [selectedRequests, setSelectedRequests] = useState<PurchaseRequest[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const canAccess = profile ? CAN_ACCESS.includes(profile.role) : false

  async function loadSuppliers() {
    setLoading(true)
    const { data, error } = await supabase.from('suppliers').select('*').order('name')
    if (error) console.error(error)
    const rows = (data as Supplier[]) ?? []
    setSuppliers(rows)
    setSelected((current) => (current ? rows.find((r) => r.id === current.id) ?? null : null))
    setLoading(false)
  }

  async function loadLinkedRequests(supplier: Supplier) {
    setRequestsLoading(true)
    const { data } = await supabase.from('purchase_requests').select('*').eq('supplier_id', supplier.id)
    setSelectedRequests((data as PurchaseRequest[]) ?? [])
    setRequestsLoading(false)
  }

  useEffect(() => {
    if (!canAccess) {
      setLoading(false)
      return
    }
    loadSuppliers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess])

  // Deep-link (es. dalla scheda di una richiesta nella Pipeline acquisti).
  useEffect(() => {
    const fromLink = searchParams.get('fornitore')
    if (!fromLink) return
    const supplier = suppliers.find((s) => s.id === fromLink)
    if (supplier) setSelected(supplier)
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, suppliers])

  useEffect(() => {
    if (selected) {
      loadLinkedRequests(selected)
    } else {
      setSelectedRequests([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  async function updateSupplier(supplier: Supplier, patch: Partial<Supplier>) {
    const { error } = await supabase.from('suppliers').update(patch).eq('id', supplier.id)
    if (error) {
      alert('Non è stato possibile salvare la modifica: ' + error.message)
      return
    }
    setSelected((s) => (s && s.id === supplier.id ? { ...s, ...patch } : s))
    setSuppliers((ss) => ss.map((s) => (s.id === supplier.id ? { ...s, ...patch } : s)))
  }

  async function deleteSupplier(supplier: Supplier) {
    if (!window.confirm(`Eliminare definitivamente "${supplier.name}" dall'anagrafica? L'operazione non è reversibile.`)) {
      return
    }
    setDeleting(true)
    const { error } = await supabase.from('suppliers').delete().eq('id', supplier.id)
    setDeleting(false)
    if (error) {
      alert('Non è stato possibile eliminare il fornitore: ' + error.message)
      return
    }
    setSelected(null)
    loadSuppliers()
  }

  if (!profile) return null

  if (!canAccess) {
    return (
      <div className="view">
        <h1>Fornitori</h1>
        <p className="muted">Questa sezione è disponibile solo per l'ufficio acquisti e la direzione.</p>
      </div>
    )
  }

  // Le categorie non sono un enum fisso come per i clienti (concerie,
  // distributori...): sono testo libero, quindi i filtri si costruiscono
  // dinamicamente da quelle già in uso invece di un elenco predefinito.
  const categories = Array.from(new Set(suppliers.map((s) => s.category).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  )
  const filtered = filter === 'tutti' ? suppliers : suppliers.filter((s) => s.category === filter)

  return (
    <div className="view">
      <div className="view-head">
        <h1>Fornitori</h1>
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
            {showForm ? 'Annulla' : '+ Nuovo fornitore'}
          </button>
        </div>
      </div>

      {showForm && <NewSupplierForm onCreated={() => { setShowForm(false); loadSuppliers() }} />}
      {showImport && <ImportSuppliersPanel onImported={() => { setShowImport(false); loadSuppliers() }} />}

      {categories.length > 0 && (
        <div className="stage-btn-row client-filter-row">
          <button className={'stage-btn' + (filter === 'tutti' ? ' current' : '')} onClick={() => setFilter('tutti')}>
            Tutti <span className="muted">· {suppliers.length}</span>
          </button>
          {categories.map((cat) => (
            <button key={cat} className={'stage-btn' + (filter === cat ? ' current' : '')} onClick={() => setFilter(cat)}>
              {cat} <span className="muted">· {suppliers.filter((s) => s.category === cat).length}</span>
            </button>
          ))}
        </div>
      )}

      {loading && <p className="muted">Caricamento…</p>}
      {!loading && filtered.length === 0 && <p className="muted">Nessun fornitore in questa categoria.</p>}

      <div className="req-layout">
        <div className="card client-list">
          {filtered.map((s) => (
            <div
              className={'client-row client-row-clickable' + (selected?.id === s.id ? ' selected' : '')}
              key={s.id}
              onClick={() => setSelected(s)}
            >
              <div className="client-row-main">
                <strong>{s.name}</strong>
                <span className="muted">{s.category || '—'}</span>
                {(s.contact_name || s.contact_email || s.contact_phone) && (
                  <span className="muted client-contact">
                    {[s.contact_name, s.contact_email, s.contact_phone].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <span className="muted client-country">{s.country}</span>
            </div>
          ))}
        </div>

        <div className="card detail-panel">
          {!selected && <p className="muted">Seleziona un fornitore dall'elenco per vedere il dettaglio.</p>}
          {selected && (
            <SupplierDetail
              supplier={selected}
              requests={selectedRequests}
              requestsLoading={requestsLoading}
              deleting={deleting}
              onChange={(patch) => updateSupplier(selected, patch)}
              onDelete={() => deleteSupplier(selected)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function SupplierDetail({
  supplier,
  requests,
  requestsLoading,
  deleting,
  onChange,
  onDelete,
}: {
  supplier: Supplier
  requests: PurchaseRequest[]
  requestsLoading: boolean
  deleting: boolean
  onChange: (patch: Partial<Supplier>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(supplier.name)
  const [category, setCategory] = useState(supplier.category)
  const [country, setCountry] = useState(supplier.country ?? '')
  const [contactName, setContactName] = useState(supplier.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(supplier.contact_email ?? '')
  const [contactPhone, setContactPhone] = useState(supplier.contact_phone ?? '')
  const [note, setNote] = useState(supplier.note)

  useEffect(() => {
    setName(supplier.name)
    setCategory(supplier.category)
    setCountry(supplier.country ?? '')
    setContactName(supplier.contact_name ?? '')
    setContactEmail(supplier.contact_email ?? '')
    setContactPhone(supplier.contact_phone ?? '')
    setNote(supplier.note)
  }, [supplier.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const canDelete = !requestsLoading && requests.length === 0

  return (
    <>
      <div className="eyebrow">{supplier.category || 'Fornitore'}{supplier.country ? ' · ' + supplier.country : ''}</div>
      <input
        className="client-detail-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== supplier.name && onChange({ name: name.trim() })}
      />

      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Categoria</label>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            onBlur={() => category !== supplier.category && onChange({ category: category.trim() })}
            placeholder="es. materie prime, imballaggi, trasporti"
          />
        </div>
        <div className="field-row">
          <label className="field-label">Paese</label>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            onBlur={() => country !== (supplier.country ?? '') && onChange({ country: country.trim() || null })}
          />
        </div>
      </div>

      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Referente</label>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            onBlur={() => contactName !== (supplier.contact_name ?? '') && onChange({ contact_name: contactName.trim() || null })}
          />
        </div>
        <div className="field-row">
          <label className="field-label">Email referente</label>
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            onBlur={() => contactEmail !== (supplier.contact_email ?? '') && onChange({ contact_email: contactEmail.trim() || null })}
          />
        </div>
      </div>

      <div className="field-row">
        <label className="field-label">Telefono referente</label>
        <input
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          onBlur={() => contactPhone !== (supplier.contact_phone ?? '') && onChange({ contact_phone: contactPhone.trim() || null })}
        />
      </div>

      <div className="field-row">
        <label className="field-label">Note</label>
        <textarea
          className="note-field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== supplier.note && onChange({ note })}
        />
      </div>

      <div className="section-title client-deals-title">Richieste d'acquisto collegate</div>
      {requestsLoading && <p className="muted">Caricamento…</p>}
      {!requestsLoading && requests.length === 0 && <p className="muted">Nessuna richiesta d'acquisto ancora per questo fornitore.</p>}
      {!requestsLoading && requests.length > 0 && (
        <div className="client-deals-list">
          {requests
            .slice()
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .map((r) => (
              <Link className="client-deal-row" to={`/acquisti?richiesta=${r.id}`} key={r.id}>
                <span className="client-timeline-when muted">
                  {new Date(r.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                </span>
                <span>{r.subject}</span>
                <span className={'pill pill-' + r.status}>{PURCHASE_STATUS_LABELS[r.status]}</span>
                <span className="muted">{r.unit_price != null ? currency.format(r.unit_price) : '—'}</span>
              </Link>
            ))}
        </div>
      )}

      <CommentThread refTable="suppliers" refId={supplier.id} refLabel={supplier.name} />

      <div className="client-delete-row">
        {requestsLoading ? (
          <p className="muted">Verifica record collegati…</p>
        ) : canDelete ? (
          <button className="btn btn-ghost client-delete-btn" onClick={onDelete} disabled={deleting}>
            {deleting ? 'Eliminazione…' : 'Elimina fornitore'}
          </button>
        ) : (
          <p className="muted">
            Non eliminabile: ha {requests.length} richieste d'acquisto collegate. Elimina prima quelle.
          </p>
        )}
      </div>
    </>
  )
}

function NewSupplierForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [country, setCountry] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('suppliers').insert({
      name,
      category,
      country: country || null,
      contact_name: contactName || null,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
    })
    setSaving(false)
    if (error) {
      alert('Non è stato possibile creare il fornitore: ' + error.message)
      return
    }
    onCreated()
  }

  return (
    <form className="card panel new-deal-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field-label">Nome fornitore</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Categoria (facoltativa)</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="es. materie prime, imballaggi" />
        </div>
        <div className="field-row">
          <label className="field-label">Paese (facoltativo)</label>
          <input value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
      </div>
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Referente (facoltativo)</label>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
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
        {saving ? 'Creazione…' : 'Crea fornitore'}
      </button>
    </form>
  )
}

// ============ Importazione da Excel/CSV ============
// Stesso meccanismo della pagina Clienti: lettura nel browser, mappatura
// colonne → campi, anteprima, scrittura in Supabase. I fornitori non hanno
// un codice univoco come i clienti (external_id): ogni importazione crea
// nuove righe, non aggiorna quelle esistenti.

type TargetField = 'name' | 'category' | 'country' | 'contactName' | 'contactEmail' | 'contactPhone'

type ColumnMap = Record<TargetField, string>

const EMPTY_MAP: ColumnMap = {
  name: '',
  category: '',
  country: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
}

const FIELD_LABELS: Record<TargetField, string> = {
  name: 'Nome fornitore *',
  category: 'Categoria',
  country: 'Paese',
  contactName: 'Referente',
  contactEmail: 'Email referente',
  contactPhone: 'Telefono referente',
}

interface ImportedSupplierRow {
  name: string
  category: string
  country: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

async function insertSuppliersInChunks(rows: ImportedSupplierRow[], chunkSize = 300) {
  let written = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from('suppliers').insert(chunk)
    if (error) throw error
    written += chunk.length
  }
  return written
}

function ImportSuppliersPanel({ onImported }: { onImported: () => void }) {
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([])
  const [map, setMap] = useState<ColumnMap>(EMPTY_MAP)
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
        setParseError("Il file sembra vuoto (nessuna riga sotto l'intestazione).")
        setHeaders([])
        setRawRows([])
      } else {
        const detectedHeaders = Object.keys(rows[0])
        setHeaders(detectedHeaders)
        setRawRows(rows)
        const auto: ColumnMap = { ...EMPTY_MAP }
        for (const h of detectedHeaders) {
          const low = h.toLowerCase()
          if (!auto.name && /(nome|ragione sociale|denominazione|fornitore|azienda|company|supplier)/.test(low)) auto.name = h
          if (!auto.category && /(categoria|category|tipo)/.test(low)) auto.category = h
          if (!auto.country && /(paese|country|nazione)/.test(low)) auto.country = h
          if (!auto.contactName && /(referente|contatto|contact)/.test(low)) auto.contactName = h
          if (!auto.contactEmail && /(email|e-mail|mail)/.test(low)) auto.contactEmail = h
          if (!auto.contactPhone && /(telefono|tel\.?|phone|cellulare)/.test(low)) auto.contactPhone = h
        }
        setMap(auto)
      }
    } catch (err) {
      setParseError(
        'Non riesco a leggere questo file. Controlla che sia un vero file Excel (.xlsx) o CSV. Dettaglio: ' +
          (err instanceof Error ? err.message : String(err))
      )
      setHeaders([])
      setRawRows([])
    }
    setParsing(false)
  }

  function mapRow(row: Record<string, unknown>): ImportedSupplierRow | null {
    const name = map.name ? cellToText(row[map.name]) : ''
    if (!name) return null
    return {
      name,
      category: map.category ? cellToText(row[map.category]) : '',
      country: map.country ? cellToText(row[map.country]) || defaultCountry : defaultCountry,
      contact_name: map.contactName ? cellToText(row[map.contactName]) || null : null,
      contact_email: map.contactEmail ? cellToText(row[map.contactEmail]) || null : null,
      contact_phone: map.contactPhone ? cellToText(row[map.contactPhone]) || null : null,
    }
  }

  const mappedRows = useMemo(() => rawRows.map(mapRow), [rawRows, map, defaultCountry]) // eslint-disable-line react-hooks/exhaustive-deps
  const validRows = mappedRows.filter((r): r is ImportedSupplierRow => r !== null)
  const skippedCount = mappedRows.length - validRows.length

  async function handleImport() {
    if (validRows.length === 0) return
    setImporting(true)
    try {
      const written = await insertSuppliersInChunks(validRows)
      alert(
        `Importazione completata: ${written} fornitori scritti` +
          (skippedCount > 0 ? ` (${skippedCount} righe saltate perché senza nome).` : '.')
      )
      onImported()
    } catch (err) {
      alert(
        'Importazione interrotta per un errore: ' +
          (err instanceof Error ? err.message : String(err)) +
          '. Le righe già scritte restano salvate: puoi correggere il file e riprovare solo con quelle mancanti.'
      )
    }
    setImporting(false)
  }

  return (
    <div className="card panel import-panel">
      <div className="section-title">Importa fornitori da Excel/CSV</div>
      <p className="muted">
        Carica un elenco fornitori, poi indica quale colonna del file corrisponde a ciascun campo del CRM.
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
                <select value={map[field]} onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value }))}>
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

          <div className="field-row">
            <label className="field-label">Paese di default (se non mappato o riga vuota)</label>
            <input value={defaultCountry} onChange={(e) => setDefaultCountry(e.target.value)} />
          </div>

          {!map.name && <p className="notice-error">Devi mappare almeno il Nome fornitore per poter importare.</p>}

          {map.name && (
            <>
              <p className="muted">
                Anteprima ({validRows.length} fornitori pronti da importare
                {skippedCount > 0 ? `, ${skippedCount} righe saltate perché senza nome` : ''}) — prime 5:
              </p>
              <div className="import-preview">
                {validRows.slice(0, 5).map((r, i) => (
                  <div className="import-preview-row" key={i}>
                    <strong>{r.name}</strong>
                    <span className="muted">
                      {r.category || '—'} · {r.country}
                      {r.contact_name ? ' · ' + r.contact_name : ''}
                    </span>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary" onClick={handleImport} disabled={importing || validRows.length === 0}>
                {importing ? 'Importazione…' : `Importa ${validRows.length} fornitori`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
