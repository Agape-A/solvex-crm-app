import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CLIENT_TYPE_LABELS, type Client, type UserRole } from '../lib/types'
import {
  IconDashboard,
  IconPipeline,
  IconClients,
  IconRequests,
  IconCalendar,
  IconMarketing,
  IconReport,
  IconChat,
  IconLogout,
  IconSearch,
  IconFlask,
  IconChevronsLeft,
  IconResearch,
  IconSuppliers,
  IconUsers,
} from './Icons'

// "roles" facoltativo: se presente, la voce compare solo a chi ha uno di
// quei ruoli (oltre a "dirigente", che vede sempre tutto — vedi il filtro
// più sotto). Le tre voci di reparto rispecchiano le policy RLS impostate
// in supabase/migrations/0013_moduli_ruoli.sql.
const NAV: { to: string; label: string; icon: typeof IconDashboard; roles?: UserRole[] }[] = [
  { to: '/', label: 'Dashboard', icon: IconDashboard },
  { to: '/pipeline', label: 'Pipeline clienti', icon: IconPipeline },
  { to: '/clienti', label: 'Clienti', icon: IconClients },
  { to: '/richieste', label: 'Richieste', icon: IconRequests },
  { to: '/ricerche', label: 'Ricerca&Sviluppo', icon: IconResearch, roles: ['dottore_laboratorio'] },
  { to: '/fornitori', label: 'Fornitori', icon: IconSuppliers, roles: ['ufficio_acquisti'] },
  { to: '/acquisti', label: 'Pipeline acquisti', icon: IconPipeline, roles: ['ufficio_acquisti'] },
  { to: '/calendario', label: 'Calendario', icon: IconCalendar },
  { to: '/marketing', label: 'Marketing', icon: IconMarketing },
  { to: '/report', label: 'Report e analytics', icon: IconReport },
  { to: '/chat', label: 'Chat', icon: IconChat },
  { to: '/utenti', label: 'Utenti', icon: IconUsers, roles: ['dirigente'] },
]

const SIDEBAR_COLLAPSED_KEY = 'solvex-sidebar-collapsed'

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()
  // Menu comprimibile: a icone soltanto, così le pagine (bacheca pipeline,
  // elenchi, calendario) guadagnano spazio orizzontale. La preferenza resta
  // salvata nel browser da una sessione all'altra.
  const [collapsed, setCollapsed] = useState(readStoredCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // Storage non disponibile (es. navigazione privata): la preferenza
      // semplicemente non viene ricordata, non è un problema bloccante.
    }
  }, [collapsed])

  return (
    <div className="shell">
      <aside className={'sidebar' + (collapsed ? ' sidebar-collapsed' : '')}>
        <div className="sidebar-head">
          <div className="brand">
            <span className="brand-mark">
              <IconFlask />
            </span>
            <span className="brand-text">Solvex</span>
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Espandi il menu' : 'Comprimi il menu'}
          >
            <IconChevronsLeft />
          </button>
        </div>
        {!collapsed && <ClientSearch />}
        <nav className="nav">
          {NAV.filter((item) => !item.roles || item.roles.includes(profile?.role as UserRole) || profile?.role === 'dirigente').map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
              >
                <Icon className="nav-item-icon" />
                <span className="nav-item-label">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="whoami" title={collapsed ? profile?.full_name : undefined}>
            <div className="avatar">{profile?.initials}</div>
            <div className="whoami-text">
              <div className="whoami-name">{profile?.full_name}</div>
              <div className="whoami-role">{profile?.role}</div>
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => signOut()} title={collapsed ? 'Esci' : undefined}>
            <IconLogout />
            <span className="btn-label">Esci</span>
          </button>
        </div>
      </aside>
      <main className={'main' + (collapsed ? ' main-expanded' : '')}>{children}</main>
    </div>
  )
}

// ============ Ricerca clienti globale ============
// Disponibile da qualsiasi pagina: cerca per ragione sociale e porta dritto
// alla scheda cliente in Clienti, senza dover prima aprire quella sezione e
// scorrere l'elenco. Per il ruolo operatore la RLS su "clients" restituisce
// sempre zero risultati — la ricerca resta lì ma di fatto non trova nulla.

function ClientSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Client[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    const timeout = setTimeout(async () => {
      const { data } = await supabase.from('clients').select('*').ilike('name', `%${q}%`).order('name').limit(8)
      setResults((data as Client[]) ?? [])
      setSearching(false)
    }, 250)
    return () => clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function goTo(client: Client) {
    setOpen(false)
    setQuery('')
    setResults([])
    navigate(`/clienti?cliente=${client.id}`)
  }

  return (
    <div className="sidebar-search" ref={boxRef}>
      <IconSearch className="sidebar-search-icon" />
      <input
        className="sidebar-search-input"
        placeholder="Cerca cliente…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim().length >= 2 && (
        <div className="sidebar-search-results">
          {searching && <div className="sidebar-search-empty muted">Ricerca…</div>}
          {!searching && results.length === 0 && <div className="sidebar-search-empty muted">Nessun cliente trovato.</div>}
          {!searching &&
            results.map((c) => (
              <button key={c.id} type="button" className="sidebar-search-result" onClick={() => goTo(c)}>
                <strong>{c.name}</strong>
                <span className="muted">{CLIENT_TYPE_LABELS[c.client_type]}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
