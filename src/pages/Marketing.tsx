import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import {
  MARKETING_SOURCE_LABELS,
  type Client,
  type MarketingCampaign,
  type MarketingCampaignStatus,
  type MarketingContact,
  type MarketingContactSource,
  type MarketingList,
  type MarketingListMember,
} from '../lib/types'

const CAN_ACCESS: string[] = ['tecnico', 'commerciale', 'dirigente', 'amministrazione']
const ALL_LISTS = '__tutti__'
// Palette categorica validata (skill dataviz): ordine fisso, mai ciclato.
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']

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

export function Marketing() {
  const { profile } = useAuth()
  const [lists, setLists] = useState<MarketingList[]>([])
  const [contacts, setContacts] = useState<MarketingContact[]>([])
  const [members, setMembers] = useState<MarketingListMember[]>([])
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [activeListId, setActiveListId] = useState<string>(ALL_LISTS)
  const [selected, setSelected] = useState<MarketingContact | null>(null)
  const [showNewList, setShowNewList] = useState(false)
  const [showNewContact, setShowNewContact] = useState(false)
  const [showNewCampaign, setShowNewCampaign] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<MarketingCampaign | null>(null)
  const [importing, setImporting] = useState(false)

  const canAccess = profile ? CAN_ACCESS.includes(profile.role) : false

  async function loadAll() {
    setLoading(true)
    const [listsRes, contactsRes, membersRes, campaignsRes] = await Promise.all([
      supabase.from('marketing_lists').select('*').order('name'),
      supabase.from('marketing_contacts').select('*').order('full_name'),
      supabase.from('marketing_list_members').select('*'),
      supabase.from('marketing_campaigns').select('*').order('updated_at', { ascending: false }),
    ])
    const rows = (contactsRes.data as MarketingContact[]) ?? []
    setLists((listsRes.data as MarketingList[]) ?? [])
    setContacts(rows)
    setMembers((membersRes.data as MarketingListMember[]) ?? [])
    setCampaigns((campaignsRes.data as MarketingCampaign[]) ?? [])
    setSelected((current) => (current ? rows.find((r) => r.id === current.id) ?? null : null))
    setLoading(false)
  }

  useEffect(() => {
    if (canAccess) loadAll()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!profile) return null

  if (!canAccess) {
    return (
      <div className="view">
        <h1>Marketing</h1>
        <p className="muted">Questa sezione è disponibile solo per commerciale e dirigente.</p>
      </div>
    )
  }

  const filteredContacts = contacts.filter(
    (c) => activeListId === ALL_LISTS || members.some((m) => m.list_id === activeListId && m.contact_id === c.id)
  )

  const consentCount = contacts.filter((c) => c.consent_marketing).length
  const consentRate = contacts.length === 0 ? 0 : Math.round((consentCount / contacts.length) * 100)
  const sourceRows: BarRow[] = (Object.keys(MARKETING_SOURCE_LABELS) as MarketingContactSource[]).map((s, i) => {
    const count = contacts.filter((c) => c.source === s).length
    return { label: MARKETING_SOURCE_LABELS[s], value: count, formatted: String(count), color: CATEGORICAL[i] }
  })
  const listRows: BarRow[] = lists.map((l) => {
    const count = members.filter((m) => m.list_id === l.id).length
    return { label: l.name, value: count, formatted: String(count) }
  })

  async function updateContact(contact: MarketingContact, patch: Partial<MarketingContact>) {
    const { error } = await supabase.from('marketing_contacts').update(patch).eq('id', contact.id)
    if (error) {
      alert('Non è stato possibile salvare la modifica: ' + error.message)
      return
    }
    setSelected((s) => (s && s.id === contact.id ? { ...s, ...patch } : s))
    setContacts((cs) => cs.map((c) => (c.id === contact.id ? { ...c, ...patch } : c)))
  }

  async function setConsent(contact: MarketingContact, granted: boolean) {
    if (granted) {
      await updateContact(contact, { consent_marketing: true, consent_date: new Date().toISOString(), unsubscribed_at: null })
    } else {
      await updateContact(contact, { consent_marketing: false, unsubscribed_at: new Date().toISOString() })
    }
  }

  async function toggleMembership(contact: MarketingContact, listId: string) {
    const exists = members.some((m) => m.list_id === listId && m.contact_id === contact.id)
    if (exists) {
      const { error } = await supabase
        .from('marketing_list_members')
        .delete()
        .eq('list_id', listId)
        .eq('contact_id', contact.id)
      if (error) {
        alert('Non è stato possibile aggiornare la lista: ' + error.message)
        return
      }
      setMembers((ms) => ms.filter((m) => !(m.list_id === listId && m.contact_id === contact.id)))
    } else {
      const { error } = await supabase.from('marketing_list_members').insert({ list_id: listId, contact_id: contact.id })
      if (error) {
        alert('Non è stato possibile aggiornare la lista: ' + error.message)
        return
      }
      setMembers((ms) => [...ms, { list_id: listId, contact_id: contact.id, added_at: new Date().toISOString() }])
    }
  }

  async function importFromClients() {
    setImporting(true)
    const { data: clientRows, error } = await supabase
      .from('clients')
      .select('*')
      .not('contact_email', 'is', null)
    if (error) {
      alert('Non è stato possibile leggere l\'anagrafica clienti: ' + error.message)
      setImporting(false)
      return
    }
    const existingEmails = new Set(contacts.map((c) => c.email.toLowerCase()))
    const toInsert = ((clientRows as Client[]) ?? [])
      .filter((c) => c.contact_email && !existingEmails.has(c.contact_email.toLowerCase()))
      .map((c) => ({
        full_name: c.contact_name || c.name,
        email: (c.contact_email as string).toLowerCase(),
        phone: c.contact_phone,
        company: c.name,
        client_id: c.id,
        source: 'referente_cliente' as MarketingContactSource,
        consent_marketing: false,
      }))
    if (toInsert.length === 0) {
      alert('Nessun nuovo referente da importare (o non hanno un\'email in anagrafica).')
      setImporting(false)
      return
    }
    const { error: insertError } = await supabase.from('marketing_contacts').insert(toInsert)
    setImporting(false)
    if (insertError) {
      alert('Importazione interrotta: ' + insertError.message)
      return
    }
    alert(
      `${toInsert.length} referenti importati come contatti marketing, con consenso non ancora dato — vanno attivati uno per uno.`
    )
    loadAll()
  }

  function exportCsv() {
    const exportRows = filteredContacts.filter((c) => c.consent_marketing && !c.unsubscribed_at)
    if (exportRows.length === 0) {
      alert('Nessun contatto con consenso attivo in questa lista da esportare.')
      return
    }
    const header = 'nome,email,telefono,azienda\n'
    const body = exportRows
      .map((c) =>
        [c.full_name, c.email, c.phone ?? '', c.company ?? '']
          .map((v) => '"' + String(v).replace(/"/g, '""') + '"')
          .join(',')
      )
      .join('\n')
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const listName = activeListId === ALL_LISTS ? 'tutti-i-contatti' : lists.find((l) => l.id === activeListId)?.name ?? 'lista'
    a.href = url
    a.download = `marketing-${listName.replace(/\s+/g, '-').toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportCampaignRecipients(campaign: MarketingCampaign) {
    if (!campaign.list_id) {
      alert('Questa campagna non ha ancora una lista di destinazione assegnata.')
      return
    }
    const recipients = contacts.filter(
      (c) => c.consent_marketing && !c.unsubscribed_at && members.some((m) => m.list_id === campaign.list_id && m.contact_id === c.id)
    )
    if (recipients.length === 0) {
      alert('Nessun destinatario con consenso attivo per questa campagna.')
      return
    }
    const header = 'nome,email\n'
    const body = recipients.map((c) => `"${c.full_name}","${c.email}"`).join('\n')
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `campagna-${campaign.name.replace(/\s+/g, '-').toLowerCase()}-destinatari.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function saveCampaign(patch: Partial<MarketingCampaign> & { name: string; subject: string }, existing: MarketingCampaign | null) {
    if (existing) {
      const { error } = await supabase.from('marketing_campaigns').update(patch).eq('id', existing.id)
      if (error) {
        alert('Non è stato possibile salvare la campagna: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase.from('marketing_campaigns').insert(patch)
      if (error) {
        alert('Non è stato possibile creare la campagna: ' + error.message)
        return
      }
    }
    setShowNewCampaign(false)
    setEditingCampaign(null)
    loadAll()
  }

  async function deleteCampaign(campaign: MarketingCampaign) {
    if (!window.confirm(`Eliminare la bozza "${campaign.name}"?`)) return
    const { error } = await supabase.from('marketing_campaigns').delete().eq('id', campaign.id)
    if (error) {
      alert('Non è stato possibile eliminare la campagna: ' + error.message)
      return
    }
    loadAll()
  }

  return (
    <div className="view view-wide">
      <div className="view-head">
        <h1>Marketing</h1>
        <div className="view-head-actions">
          <button className="btn btn-ghost" onClick={importFromClients} disabled={importing}>
            {importing ? 'Importazione…' : 'Importa referenti dai clienti'}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowNewList((v) => !v)}>
            {showNewList ? 'Annulla' : '+ Nuova lista'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowNewContact((v) => !v)}>
            {showNewContact ? 'Annulla' : '+ Nuovo contatto'}
          </button>
        </div>
      </div>

      <p className="muted">
        Liste per newsletter/marketing — anche per contatti non ancora clienti (es. raccolti in fiera).
        L'invio vero e proprio non è ancora collegato: per ora puoi organizzare i contatti, tracciare il
        consenso ed esportare la lista in CSV da usare con uno strumento di invio esterno.
      </p>

      {showNewList && (
        <NewListForm
          onCreated={() => {
            setShowNewList(false)
            loadAll()
          }}
        />
      )}
      {showNewContact && (
        <NewContactForm
          onCreated={() => {
            setShowNewContact(false)
            loadAll()
          }}
        />
      )}

      {!loading && contacts.length > 0 && (
        <>
          <div className="tile-row">
            <div className="card tile">
              <div className="tile-label">Contatti totali</div>
              <div className="tile-value">{contacts.length}</div>
            </div>
            <div className="card tile">
              <div className="tile-label">Con consenso attivo</div>
              <div className="tile-value">{consentRate}%</div>
            </div>
          </div>
          <div className="chart-grid">
            <div className="card panel">
              <div className="section-title">Contatti per fonte</div>
              <BarList rows={sourceRows} tableCaption="Numero di contatti marketing per fonte" />
            </div>
            <div className="card panel">
              <div className="section-title">Contatti per lista</div>
              <BarList rows={listRows} tableCaption="Numero di contatti per lista" />
            </div>
          </div>
        </>
      )}

      <div className="stage-btn-row client-filter-row">
        <button
          className={'stage-btn' + (activeListId === ALL_LISTS ? ' current' : '')}
          onClick={() => setActiveListId(ALL_LISTS)}
        >
          Tutti i contatti <span className="muted">· {contacts.length}</span>
        </button>
        {lists.map((l) => {
          const count = members.filter((m) => m.list_id === l.id).length
          return (
            <button
              key={l.id}
              className={'stage-btn' + (activeListId === l.id ? ' current' : '')}
              onClick={() => setActiveListId(l.id)}
            >
              {l.name} <span className="muted">· {count}</span>
            </button>
          )
        })}
      </div>

      <div className="view-head-actions marketing-export-row">
        <button className="btn btn-ghost" onClick={exportCsv}>
          Esporta CSV (solo consenso attivo)
        </button>
      </div>

      {loading && <p className="muted">Caricamento…</p>}
      {!loading && filteredContacts.length === 0 && <p className="muted">Nessun contatto in questa lista.</p>}

      <div className="req-layout">
        <div className="card client-list">
          {filteredContacts.map((c) => (
            <div
              className={'client-row client-row-clickable' + (selected?.id === c.id ? ' selected' : '')}
              key={c.id}
              onClick={() => setSelected(c)}
            >
              <div className="client-row-main">
                <strong>{c.full_name}</strong>
                <span className="muted">{c.email}{c.company ? ' · ' + c.company : ''}</span>
              </div>
              <span className={'pill ' + (c.consent_marketing ? 'pill-risolta' : 'pill-nuova')}>
                {c.consent_marketing ? 'Consenso attivo' : c.unsubscribed_at ? 'Disiscritto' : 'Nessun consenso'}
              </span>
            </div>
          ))}
        </div>

        <div className="card detail-panel">
          {!selected && <p className="muted">Seleziona un contatto dall'elenco per vedere il dettaglio.</p>}
          {selected && (
            <ContactDetail
              contact={selected}
              lists={lists}
              members={members}
              onChange={(patch) => updateContact(selected, patch)}
              onConsentChange={(granted) => setConsent(selected, granted)}
              onToggleMembership={(listId) => toggleMembership(selected, listId)}
            />
          )}
        </div>
      </div>

      <div className="view-head marketing-campaigns-head">
        <h2>Campagne</h2>
        <button
          className="btn btn-ghost"
          onClick={() => {
            setEditingCampaign(null)
            setShowNewCampaign((v) => !v)
          }}
        >
          {showNewCampaign ? 'Annulla' : '+ Nuova campagna'}
        </button>
      </div>
      <p className="muted">
        Bozze pronte per l'invio: oggetto, contenuto e lista di destinazione. Non inviano ancora nulla —
        quando la connessione email sarà collegata basterà un pulsante in più.
      </p>

      {(showNewCampaign || editingCampaign) && (
        <CampaignForm
          lists={lists}
          existing={editingCampaign}
          onSave={(patch) => saveCampaign(patch, editingCampaign)}
          onCancel={() => {
            setShowNewCampaign(false)
            setEditingCampaign(null)
          }}
        />
      )}

      {campaigns.length === 0 && <p className="muted">Nessuna campagna ancora.</p>}
      <div className="marketing-campaign-list">
        {campaigns.map((camp) => (
          <div className="card panel marketing-campaign-row" key={camp.id}>
            <div className="marketing-campaign-main">
              <strong>{camp.name}</strong>
              <span className="muted">{camp.subject}</span>
              <span className="muted">
                Lista: {lists.find((l) => l.id === camp.list_id)?.name ?? '— nessuna assegnata —'}
              </span>
              {camp.attachment_url && (
                <a className="muted" href={camp.attachment_url} target="_blank" rel="noreferrer">
                  📎 {camp.attachment_name ?? 'Allegato'}
                </a>
              )}
            </div>
            <span className={'pill ' + (camp.status === 'pronta' ? 'pill-risolta' : 'pill-nuova')}>
              {camp.status === 'pronta' ? 'Pronta' : 'Bozza'}
            </span>
            <div className="marketing-campaign-actions">
              <button className="btn btn-ghost" onClick={() => exportCampaignRecipients(camp)}>
                Esporta destinatari
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setShowNewCampaign(false)
                  setEditingCampaign(camp)
                }}
              >
                Modifica
              </button>
              <button className="btn btn-ghost client-delete-btn" onClick={() => deleteCampaign(camp)}>
                Elimina
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ContactDetail({
  contact,
  lists,
  members,
  onChange,
  onConsentChange,
  onToggleMembership,
}: {
  contact: MarketingContact
  lists: MarketingList[]
  members: MarketingListMember[]
  onChange: (patch: Partial<MarketingContact>) => void
  onConsentChange: (granted: boolean) => void
  onToggleMembership: (listId: string) => void
}) {
  const [fullName, setFullName] = useState(contact.full_name)
  const [phone, setPhone] = useState(contact.phone ?? '')
  const [company, setCompany] = useState(contact.company ?? '')
  const [consentNote, setConsentNote] = useState(contact.consent_note)

  useEffect(() => {
    setFullName(contact.full_name)
    setPhone(contact.phone ?? '')
    setCompany(contact.company ?? '')
    setConsentNote(contact.consent_note)
  }, [contact.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="eyebrow">
        {MARKETING_SOURCE_LABELS[contact.source]}
        {contact.client_id && ' · collegato a un cliente'}
      </div>
      <input
        className="client-detail-name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        onBlur={() => fullName.trim() && fullName !== contact.full_name && onChange({ full_name: fullName.trim() })}
      />
      <p className="muted">{contact.email}</p>

      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Telefono</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => phone !== (contact.phone ?? '') && onChange({ phone: phone.trim() || null })}
          />
        </div>
        <div className="field-row">
          <label className="field-label">Azienda</label>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            onBlur={() => company !== (contact.company ?? '') && onChange({ company: company.trim() || null })}
          />
        </div>
      </div>

      <div className="field-row consent-row">
        <label className="field-label">Consenso al marketing</label>
        <div className="stage-btn-row">
          <button
            className={'stage-btn' + (contact.consent_marketing ? ' current' : '')}
            onClick={() => onConsentChange(true)}
          >
            Sì, ha dato consenso
          </button>
          <button
            className={'stage-btn' + (!contact.consent_marketing ? ' current' : '')}
            onClick={() => onConsentChange(false)}
          >
            No / disiscritto
          </button>
        </div>
        {contact.consent_date && (
          <span className="muted">Consenso dato il {new Date(contact.consent_date).toLocaleDateString('it-IT')}</span>
        )}
        {contact.unsubscribed_at && !contact.consent_marketing && (
          <span className="muted">Disiscritto il {new Date(contact.unsubscribed_at).toLocaleDateString('it-IT')}</span>
        )}
      </div>

      <div className="field-row">
        <label className="field-label">Nota sul consenso (facoltativa)</label>
        <input
          value={consentNote}
          onChange={(e) => setConsentNote(e.target.value)}
          onBlur={() => consentNote !== contact.consent_note && onChange({ consent_note: consentNote.trim() })}
          placeholder="es. modulo raccolto a Lineapelle 2026"
        />
      </div>

      <div className="section-title client-deals-title">Liste</div>
      {lists.length === 0 && <p className="muted">Nessuna lista creata ancora.</p>}
      <div className="marketing-list-toggles">
        {lists.map((l) => {
          const inList = members.some((m) => m.list_id === l.id && m.contact_id === contact.id)
          return (
            <label className="marketing-list-toggle" key={l.id}>
              <input type="checkbox" checked={inList} onChange={() => onToggleMembership(l.id)} />
              {l.name}
            </label>
          )
        })}
      </div>
    </>
  )
}

function NewListForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('marketing_lists').insert({ name, description })
    setSaving(false)
    if (error) {
      alert('Non è stato possibile creare la lista: ' + error.message)
      return
    }
    onCreated()
  }

  return (
    <form className="card panel new-deal-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field-label">Nome lista</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Newsletter prodotti conciari" required />
      </div>
      <div className="field-row">
        <label className="field-label">Descrizione (facoltativa)</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Creazione…' : 'Crea lista'}
      </button>
    </form>
  )
}

function NewContactForm({ onCreated }: { onCreated: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [source, setSource] = useState<MarketingContactSource>('altro')
  const [saving, setSaving] = useState(false)

  const sources = useMemo(() => Object.keys(MARKETING_SOURCE_LABELS) as MarketingContactSource[], [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('marketing_contacts').insert({
      full_name: fullName,
      email: email.trim().toLowerCase(),
      phone: phone || null,
      company: company || null,
      source,
      consent_marketing: false,
    })
    setSaving(false)
    if (error) {
      alert('Non è stato possibile creare il contatto: ' + error.message)
      return
    }
    onCreated()
  }

  return (
    <form className="card panel new-deal-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field-label">Nome e cognome</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </div>
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field-row">
          <label className="field-label">Telefono (facoltativo)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Azienda (facoltativa)</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        <div className="field-row">
          <label className="field-label">Origine</label>
          <select value={source} onChange={(e) => setSource(e.target.value as MarketingContactSource)}>
            {sources.map((s) => (
              <option key={s} value={s}>
                {MARKETING_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted">Il consenso al marketing parte da "no": lo attivi dopo, dal dettaglio del contatto.</p>
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Creazione…' : 'Crea contatto'}
      </button>
    </form>
  )
}

function CampaignForm({
  lists,
  existing,
  onSave,
  onCancel,
}: {
  lists: MarketingList[]
  existing: MarketingCampaign | null
  onSave: (patch: Partial<MarketingCampaign> & { name: string; subject: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [subject, setSubject] = useState(existing?.subject ?? '')
  const [body, setBody] = useState(existing?.body ?? '')
  const [listId, setListId] = useState(existing?.list_id ?? '')
  const [status, setStatus] = useState<MarketingCampaignStatus>(existing?.status ?? 'bozza')
  const [attachmentUrl, setAttachmentUrl] = useState(existing?.attachment_url ?? null)
  const [attachmentName, setAttachmentName] = useState(existing?.attachment_name ?? null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('marketing-attachments').upload(path, file, { upsert: true })
    setUploading(false)
    e.target.value = ''
    if (error) {
      alert('Non è stato possibile caricare l\'allegato: ' + error.message)
      return
    }
    const { data } = supabase.storage.from('marketing-attachments').getPublicUrl(path)
    setAttachmentUrl(data.publicUrl)
    setAttachmentName(file.name)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    onSave({ name, subject, body, list_id: listId || null, status, attachment_url: attachmentUrl, attachment_name: attachmentName })
    setSaving(false)
  }

  return (
    <form className="card panel new-deal-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field-label">Nome campagna (uso interno)</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Newsletter autunno 2026" required />
      </div>
      <div className="field-row">
        <label className="field-label">Oggetto email</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </div>
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Lista di destinazione</label>
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">— nessuna ancora —</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label">Stato</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as MarketingCampaignStatus)}>
            <option value="bozza">Bozza</option>
            <option value="pronta">Pronta per l'invio</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <label className="field-label">Contenuto</label>
        <textarea
          className="note-field marketing-campaign-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Testo della newsletter…"
        />
      </div>
      <div className="field-row">
        <label className="field-label">Allegato (facoltativo — es. scheda tecnica, listino in PDF)</label>
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
          <input type="file" onChange={handleFileChange} disabled={uploading} />
        )}
        {uploading && <span className="muted">Caricamento…</span>}
      </div>
      <div className="view-head-actions">
        <button className="btn btn-ghost" type="button" onClick={onCancel}>
          Annulla
        </button>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Salvataggio…' : existing ? 'Salva modifiche' : 'Crea bozza'}
        </button>
      </div>
    </form>
  )
}
