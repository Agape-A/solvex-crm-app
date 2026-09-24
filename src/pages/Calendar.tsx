import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CommentThread } from '../components/CommentThread'
import {
  APPOINTMENT_TYPE_LABELS,
  type Appointment,
  type AppointmentType,
  type Client,
  type Deal,
  type Request,
} from '../lib/types'

type ItemType = 'azione_trattativa' | 'scadenza_richiesta' | 'appuntamento'

interface CalendarItem {
  id: string
  recordId: string
  date: Date
  title: string
  subtitle: string
  type: ItemType
}

const TYPE_LABEL: Record<ItemType, string> = {
  azione_trattativa: 'Prossima azione',
  scadenza_richiesta: 'Scadenza richiesta',
  appuntamento: 'Appuntamento',
}
const TYPE_CLASS: Record<ItemType, string> = {
  azione_trattativa: 'cal-type-azione',
  scadenza_richiesta: 'cal-type-scadenza',
  appuntamento: 'cal-type-appuntamento',
}

function startOfDay(d: Date) {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function dayKey(d: Date) {
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
}

function bucketFor(date: Date, today: Date) {
  const day = startOfDay(date)
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  if (diffDays < 0) return 'In ritardo'
  if (diffDays === 0) return 'Oggi'
  if (diffDays === 1) return 'Domani'
  if (diffDays <= 7) return 'Prossimi 7 giorni'
  return 'Più avanti'
}

const BUCKET_ORDER = ['In ritardo', 'Oggi', 'Domani', 'Prossimi 7 giorni', 'Più avanti']
const WEEKDAY_LABELS = ['L', 'M', 'M', 'G', 'V', 'S', 'D']
const MONTH_LABEL_FMT: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }

export function Calendar() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [deals, setDeals] = useState<Deal[]>([])
  const [requests, setRequests] = useState<Request[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [monthCursor, setMonthCursor] = useState(() => startOfDay(new Date()))
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [openAppointmentId, setOpenAppointmentId] = useState<string | null>(null)

  const canSeeAppointments = profile ? ['tecnico', 'commerciale', 'dirigente'].includes(profile.role) : false
  const canCreateAppointment = profile?.role === 'commerciale' || profile?.role === 'dirigente'

  async function loadAll() {
    setLoading(true)
    const [dealsRes, requestsRes, apptRes, clientsRes] = await Promise.all([
      canSeeAppointments
        ? supabase.from('deals').select('*').not('next_action', 'is', null)
        : Promise.resolve({ data: [] as Deal[], error: null }),
      supabase.from('requests').select('*').not('due_date', 'is', null),
      canSeeAppointments
        ? supabase.from('appointments').select('*').order('appointment_at')
        : Promise.resolve({ data: [] as Appointment[], error: null }),
      canCreateAppointment
        ? supabase.from('clients').select('*').order('name')
        : Promise.resolve({ data: [] as Client[], error: null }),
    ])
    setDeals((dealsRes.data as Deal[]) ?? [])
    setRequests((requestsRes.data as Request[]) ?? [])
    setAppointments((apptRes.data as Appointment[]) ?? [])
    setClients((clientsRes.data as Client[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeAppointments])

  const items: CalendarItem[] = useMemo(
    () =>
      [
        ...deals
          .filter((d) => d.next_action)
          .map((d) => ({
            id: 'deal-' + d.id,
            recordId: d.id,
            date: new Date(d.next_action as string),
            title: d.client_name,
            subtitle: d.product,
            type: 'azione_trattativa' as ItemType,
          })),
        ...requests
          .filter((r) => r.due_date)
          .map((r) => ({
            id: 'req-' + r.id,
            recordId: r.id,
            date: new Date(r.due_date as string),
            title: r.subject,
            subtitle: r.sender + ' · ' + r.department,
            type: 'scadenza_richiesta' as ItemType,
          })),
        ...appointments.map((a) => ({
          id: 'appt-' + a.id,
          recordId: a.id,
          date: new Date(a.appointment_at),
          title: a.client_name,
          subtitle: a.subject + ' · ' + APPOINTMENT_TYPE_LABELS[a.type],
          type: 'appuntamento' as ItemType,
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime()),
    [deals, requests, appointments],
  )

  if (!profile) return null

  const today = startOfDay(new Date())
  const visibleItems = selectedDay ? items.filter((item) => sameDay(item.date, selectedDay)) : items
  const buckets = new Map<string, CalendarItem[]>()
  for (const item of visibleItems) {
    const key = bucketFor(item.date, today)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(item)
  }

  function handleItemClick(item: CalendarItem) {
    if (item.type === 'appuntamento') {
      setOpenAppointmentId(item.recordId)
    } else if (item.type === 'scadenza_richiesta') {
      navigate('/richieste?id=' + item.recordId)
    } else if (item.type === 'azione_trattativa') {
      navigate('/pipeline?deal=' + item.recordId)
    }
  }

  const openAppointment = openAppointmentId ? appointments.find((a) => a.id === openAppointmentId) ?? null : null

  return (
    <div className="view">
      <div className="view-head">
        <h1>Calendario</h1>
        {canCreateAppointment && (
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Annulla' : '+ Nuovo appuntamento'}
          </button>
        )}
      </div>

      <p className="muted">
        Prossime azioni sulle trattative, scadenze delle richieste e appuntamenti, tutti in un unico elenco.
      </p>

      {showForm && <NewAppointmentForm clients={clients} onCreated={() => { setShowForm(false); loadAll() }} />}

      <div className="cal-layout">
        <div className="cal-side">
          <MiniMonthCalendar
            cursor={monthCursor}
            onCursorChange={setMonthCursor}
            items={items}
            selectedDay={selectedDay}
            onSelectDay={(d) => setSelectedDay((cur) => (cur && sameDay(cur, d) ? null : d))}
          />
        </div>

        <div className="cal-main">
          {selectedDay && (
            <div className="cal-filter-banner">
              <span>
                Filtrato per: <strong>{selectedDay.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDay(null)}>
                Mostra tutto
              </button>
            </div>
          )}

          {loading && <p className="muted">Caricamento…</p>}
          {!loading && visibleItems.length === 0 && (
            <p className="muted">
              {selectedDay ? 'Nessuna scadenza o appuntamento in questo giorno.' : 'Nessuna scadenza o appuntamento in programma.'}
            </p>
          )}

          <div className="cal-list">
            {BUCKET_ORDER.filter((b) => buckets.has(b)).map((bucket) => (
              <div key={bucket} className="cal-bucket">
                <div className="cal-bucket-title">{bucket}</div>
                {buckets.get(bucket)!.map((item) => (
                  <button type="button" className="card cal-row cal-row-clickable" key={item.id} onClick={() => handleItemClick(item)}>
                    <div className="cal-row-date">
                      {item.date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                    </div>
                    <div className="cal-row-main">
                      <strong>{item.title}</strong>
                      <span className="muted">{item.subtitle}</span>
                    </div>
                    <span className={'cal-type ' + TYPE_CLASS[item.type]}>{TYPE_LABEL[item.type]}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {openAppointment && (
        <AppointmentDetail
          appointment={openAppointment}
          clients={clients}
          canEdit={canCreateAppointment}
          onClose={() => setOpenAppointmentId(null)}
          onChanged={loadAll}
        />
      )}
    </div>
  )
}

function MiniMonthCalendar({
  cursor,
  onCursorChange,
  items,
  selectedDay,
  onSelectDay,
}: {
  cursor: Date
  onCursorChange: (d: Date) => void
  items: CalendarItem[]
  selectedDay: Date | null
  onSelectDay: (d: Date) => void
}) {
  const today = startOfDay(new Date())

  const itemsByDay = useMemo(() => {
    const map = new Map<string, ItemType[]>()
    for (const item of items) {
      const key = dayKey(item.date)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item.type)
    }
    return map
  }, [items])

  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const startWeekday = (firstOfMonth.getDay() + 6) % 7 // Monday = 0
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(gridStart.getDate() - startWeekday)

  const days: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    days.push(d)
  }

  function shiftMonth(delta: number) {
    onCursorChange(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1))
  }

  return (
    <div className="card mini-cal">
      <div className="mini-cal-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftMonth(-1)} aria-label="Mese precedente">
          ‹
        </button>
        <strong className="mini-cal-label">
          {cursor.toLocaleDateString('it-IT', MONTH_LABEL_FMT)}
        </strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftMonth(1)} aria-label="Mese successivo">
          ›
        </button>
      </div>
      <div className="mini-cal-weekdays">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="mini-cal-grid">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth()
          const isToday = sameDay(d, today)
          const isSelected = selectedDay ? sameDay(d, selectedDay) : false
          const dayItems = itemsByDay.get(dayKey(d)) ?? []
          return (
            <button
              type="button"
              key={i}
              className={
                'mini-cal-day' +
                (inMonth ? '' : ' mini-cal-day-out') +
                (isToday ? ' mini-cal-day-today' : '') +
                (isSelected ? ' mini-cal-day-selected' : '')
              }
              onClick={() => onSelectDay(startOfDay(d))}
            >
              <span>{d.getDate()}</span>
              {dayItems.length > 0 && (
                <span className="mini-cal-dots">
                  {Array.from(new Set(dayItems)).slice(0, 3).map((t) => (
                    <span key={t} className={'mini-cal-dot ' + TYPE_CLASS[t]} />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AppointmentDetail({
  appointment,
  clients,
  canEdit,
  onClose,
  onChanged,
}: {
  appointment: Appointment
  clients: Client[]
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [subject, setSubject] = useState(appointment.subject)
  const [when, setWhen] = useState(() => toLocalInputValue(appointment.appointment_at))
  const [type, setType] = useState<AppointmentType>(appointment.type)
  const [note, setNote] = useState(appointment.note ?? '')
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    setSubject(appointment.subject)
    setWhen(toLocalInputValue(appointment.appointment_at))
    setType(appointment.type)
    setNote(appointment.note ?? '')
  }, [appointment])

  const linkedClient = appointment.client_id ? clients.find((c) => c.id === appointment.client_id) ?? null : null

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase
      .from('appointments')
      .update({
        subject,
        appointment_at: new Date(when).toISOString(),
        type,
        note,
      })
      .eq('id', appointment.id)
    setSaving(false)
    if (error) {
      alert('Non è stato possibile salvare le modifiche: ' + error.message)
      return
    }
    onChanged()
  }

  async function handleDelete() {
    if (!confirm("Eliminare definitivamente questo appuntamento?")) return
    const { error } = await supabase.from('appointments').delete().eq('id', appointment.id)
    if (error) {
      alert("Non è stato possibile eliminare l'appuntamento: " + error.message)
      return
    }
    onChanged()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Appuntamento</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Chiudi">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-client-row">
            <span className="muted">Cliente</span>
            {linkedClient ? (
              <button type="button" className="link-button" onClick={() => navigate('/clienti?cliente=' + linkedClient.id)}>
                {linkedClient.name}
              </button>
            ) : (
              <strong>{appointment.client_name}</strong>
            )}
          </div>

          <form className="new-deal-form" onSubmit={handleSave}>
            <div className="field-row">
              <label className="field-label">Oggetto</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} required />
            </div>
            <div className="field-row-2">
              <div className="field-row">
                <label className="field-label">Data e ora</label>
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={!canEdit} required />
              </div>
              <div className="field-row">
                <label className="field-label">Tipo</label>
                <select value={type} onChange={(e) => setType(e.target.value as AppointmentType)} disabled={!canEdit}>
                  {Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-row">
              <label className="field-label">Nota</label>
              <textarea className="note-field" value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} />
            </div>
            {canEdit && (
              <div className="modal-actions">
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? 'Salvataggio…' : 'Salva modifiche'}
                </button>
                <button type="button" className="btn btn-danger-ghost" onClick={handleDelete}>
                  Elimina appuntamento
                </button>
              </div>
            )}
          </form>

          <CommentThread refTable="appointments" refId={appointment.id} refLabel={appointment.subject} />
        </div>
      </div>
    </div>
  )
}

function toLocalInputValue(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  )
}

const NEW_CLIENT_OPTION = '__nuovo__'

function NewAppointmentForm({ clients, onCreated }: { clients: Client[]; onCreated: () => void }) {
  const [clientId, setClientId] = useState('')
  const [manualClientName, setManualClientName] = useState('')
  const [subject, setSubject] = useState('')
  const [when, setWhen] = useState('')
  const [type, setType] = useState<AppointmentType>('visita_commerciale')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const usingManualName = clientId === '' || clientId === NEW_CLIENT_OPTION

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const selectedClient = clients.find((c) => c.id === clientId)
    const clientName = selectedClient ? selectedClient.name : manualClientName
    if (!clientName) {
      alert("Seleziona un cliente dall'anagrafica o inserisci il nome.")
      return
    }
    setSaving(true)
    const { error } = await supabase.from('appointments').insert({
      client_id: selectedClient ? selectedClient.id : null,
      client_name: clientName,
      subject,
      appointment_at: new Date(when).toISOString(),
      type,
      note,
    })
    setSaving(false)
    if (error) {
      alert("Non è stato possibile creare l'appuntamento: " + error.message)
      return
    }
    onCreated()
  }

  return (
    <form className="card panel new-deal-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field-label">Cliente</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">— Seleziona dall'anagrafica —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW_CLIENT_OPTION}>+ Cliente non ancora in anagrafica…</option>
        </select>
      </div>
      {usingManualName && (
        <div className="field-row">
          <label className="field-label">Nome cliente</label>
          <input value={manualClientName} onChange={(e) => setManualClientName(e.target.value)} required />
        </div>
      )}
      <div className="field-row">
        <label className="field-label">Oggetto</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </div>
      <div className="field-row-2">
        <div className="field-row">
          <label className="field-label">Data e ora</label>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </div>
        <div className="field-row">
          <label className="field-label">Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value as AppointmentType)}>
            {Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field-row">
        <label className="field-label">Nota (facoltativa)</label>
        <textarea className="note-field" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Salvataggio…' : 'Aggiungi appuntamento'}
      </button>
    </form>
  )
}
