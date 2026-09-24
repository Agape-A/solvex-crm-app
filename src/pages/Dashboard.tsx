import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { OwnGoalsPanel } from '../components/GoalsPanel'
import type { ActivityLogEntry, Appointment, Deal, Request } from '../lib/types'

// Stessa soglia usata in Pipeline.tsx per le "trattative ferme" — duplicata
// qui perché non è (ancora) un valore condiviso in un file comune.
const ROTTING_DAYS = 14
const OPEN_STAGES: string[] = ['lead', 'qualificato', 'proposta', 'trattativa']

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

function startOfDay(d: Date) {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

export function Dashboard() {
  const { profile } = useAuth()
  const [dealsOpen, setDealsOpen] = useState<number | null>(null)
  const [requestsOpen, setRequestsOpen] = useState<number | null>(null)
  const [rottingDeals, setRottingDeals] = useState<Deal[]>([])
  const [dueRequests, setDueRequests] = useState<Request[]>([])
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([])
  const [activity, setActivity] = useState<ActivityLogEntry[]>([])

  const canSeePipeline = profile ? ['tecnico', 'commerciale', 'dirigente'].includes(profile.role) : false
  const canSeeAppointments = canSeePipeline

  useEffect(() => {
    // Il conteggio rispecchia solo ciò che la RLS permette di vedere al ruolo
    // corrente: nessun filtro aggiuntivo va scritto qui.
    supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .not('stage', 'in', '(vinto,perso)')
      .then(({ count }) => setDealsOpen(count ?? 0))

    supabase
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'risolta')
      .then(({ count }) => setRequestsOpen(count ?? 0))

    supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setActivity((data as ActivityLogEntry[]) ?? []))

    if (canSeePipeline) {
      supabase
        .from('deals')
        .select('*')
        .not('stage', 'in', '(vinto,perso)')
        .then(({ data }) => {
          const open = (data as Deal[]) ?? []
          setRottingDeals(
            open
              .filter((d) => OPEN_STAGES.includes(d.stage) && daysSince(d.updated_at) > ROTTING_DAYS)
              .sort((a, b) => daysSince(b.updated_at) - daysSince(a.updated_at))
          )
        })
    }

    const in3Days = new Date()
    in3Days.setDate(in3Days.getDate() + 3)
    supabase
      .from('requests')
      .select('*')
      .neq('status', 'risolta')
      .not('due_date', 'is', null)
      .lte('due_date', in3Days.toISOString().slice(0, 10))
      .order('due_date')
      .then(({ data }) => setDueRequests((data as Request[]) ?? []))

    if (canSeeAppointments) {
      const start = startOfDay(new Date())
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      supabase
        .from('appointments')
        .select('*')
        .gte('appointment_at', start.toISOString())
        .lt('appointment_at', end.toISOString())
        .order('appointment_at')
        .then(({ data }) => setTodayAppointments((data as Appointment[]) ?? []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeePipeline])

  const hasAlerts = rottingDeals.length > 0 || dueRequests.length > 0 || todayAppointments.length > 0

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Bentornato, {profile?.full_name}.</p>
        </div>
      </div>

      <div className="tile-row">
        <Link to="/pipeline" className="card tile">
          <div className="tile-label">Trattative aperte</div>
          <div className="tile-value">{dealsOpen ?? '—'}</div>
        </Link>
        <Link to="/richieste" className="card tile">
          <div className="tile-label">Richieste aperte</div>
          <div className="tile-value">{requestsOpen ?? '—'}</div>
        </Link>
      </div>

      {profile && <OwnGoalsPanel userId={profile.id} year={new Date().getFullYear()} />}

      {hasAlerts && (
        <div className="card panel">
          <div className="section-title">In evidenza</div>
          <div className="dash-alerts">
            {rottingDeals.length > 0 && (
              <Link to="/pipeline" className="dash-alert-group">
                <div className="dash-alert-head">
                  <span className="dash-alert-dot dash-alert-dot-critical" />
                  Trattative ferme <span className="muted">· {rottingDeals.length}</span>
                </div>
                {rottingDeals.slice(0, 4).map((d) => (
                  <div className="dash-alert-row" key={d.id}>
                    <span>{d.client_name}</span>
                    <span className="muted">ferma da {daysSince(d.updated_at)} giorni</span>
                  </div>
                ))}
              </Link>
            )}
            {dueRequests.length > 0 && (
              <Link to="/richieste" className="dash-alert-group">
                <div className="dash-alert-head">
                  <span className="dash-alert-dot dash-alert-dot-warning" />
                  Richieste in scadenza <span className="muted">· {dueRequests.length}</span>
                </div>
                {dueRequests.slice(0, 4).map((r) => (
                  <div className="dash-alert-row" key={r.id}>
                    <span>{r.subject}</span>
                    <span className="muted">
                      {new Date(r.due_date as string) < new Date(new Date().toDateString())
                        ? 'scaduta il '
                        : 'scade il '}
                      {new Date(r.due_date as string).toLocaleDateString('it-IT')}
                    </span>
                  </div>
                ))}
              </Link>
            )}
            {todayAppointments.length > 0 && (
              <Link to="/calendario" className="dash-alert-group">
                <div className="dash-alert-head">
                  <span className="dash-alert-dot dash-alert-dot-info" />
                  Appuntamenti di oggi <span className="muted">· {todayAppointments.length}</span>
                </div>
                {todayAppointments.map((a) => (
                  <div className="dash-alert-row" key={a.id}>
                    <span>{a.client_name}</span>
                    <span className="muted">{new Date(a.appointment_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="card panel">
        <div className="section-title">Attività recente</div>
        <div className="activity-list">
          {activity.length === 0 && <p className="muted">Nessuna attività ancora.</p>}
          {activity.map((a) => (
            <div className="activity-item" key={a.id}>
              <span className="activity-dot" />
              <div>
                <div>{a.message}</div>
                <div className="activity-time">{new Date(a.created_at).toLocaleString('it-IT')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
