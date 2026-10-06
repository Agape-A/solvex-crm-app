import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CLIENT_TYPE_LABELS, hasFullAccess, type Client, type CommentRefTable, type UserRole } from '../lib/types'
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
  IconMenu,
  IconX,
} from './Icons'

// "roles" facoltativo: se presente, la voce compare solo a chi ha uno di
// quei ruoli (oltre a dirigente/amministrazione, che vedono sempre tutto —
// vedi hasFullAccess() e il filtro più sotto). Le voci per reparto
// rispecchiano le policy RLS impostate in
// supabase/migrations/0013_moduli_ruoli.sql e 0031_policy_reparti.sql —
// pagina per pagina, "chi vede cosa":
//   operatore/tecnico/commerciale → lato clienti (Pipeline clienti,
//     Clienti, Richieste, Marketing); tecnico e commerciale anche
//     Calendario.
//   dottore_laboratorio (Ricerca&Sviluppo) → per il momento solo la pagina
//     Ricerca&Sviluppo e Calendario (solo le proprie scadenze/appuntamenti) —
//     niente Richieste/Report per ora (richiesta di Andrea, set 2026, vedi
//     anche 0034/0035_reparto_ricerca*.sql: il reparto "ricerca" esiste già
//     lato dati, per quando in futuro queste pagine verranno riaperte).
//   ufficio_acquisti → Pipeline acquisti, Fornitori, Richieste (le proprie
//     e quelle del reparto "acquisti" — vedi 0030_richieste_calendario_acquisti.sql),
//     Calendario (idem, solo proprio).
// Dashboard e Chat restano visibili a chiunque sia autenticato.
// "badgeKey" facoltativo: mostra il pallino rosso di notifica preso da
// useAuth() (vedi AuthContext.tsx e 0029_notifiche_badge.sql).
// "commentTables" facoltativo: pallino SEPARATO e dedicato ai commenti con
// destinatario (0043_notifiche_commenti.sql, richiesta di Andrea ott 2026) —
// somma unreadCommentsByTable per i ref_table dei <CommentThread> che
// vivono in quella pagina (vedi i call-site in Pipeline/Requests/
// PurchasePipeline/Suppliers/Clients/Calendar/Research.tsx). Resta distinto
// dal pallino "Richieste"/"Chat" anche quando compare sulla stessa voce.
const NAV: {
  to: string
  label: string
  icon: typeof IconDashboard
  roles?: UserRole[]
  badgeKey?: 'chat' | 'richieste'
  commentTables?: CommentRefTable[]
}[] = [
  { to: '/', label: 'Dashboard', icon: IconDashboard },
  {
    to: '/pipeline',
    label: 'Pipeline clienti',
    icon: IconPipeline,
    roles: ['operatore', 'tecnico', 'commerciale'],
    commentTables: ['deals'],
  },
  {
    to: '/clienti',
    label: 'Clienti',
    icon: IconClients,
    roles: ['operatore', 'tecnico', 'commerciale'],
    commentTables: ['clients'],
  },
  {
    to: '/richieste',
    label: 'Richieste',
    icon: IconRequests,
    badgeKey: 'richieste',
    roles: ['operatore', 'tecnico', 'commerciale', 'ufficio_acquisti'],
    commentTables: ['requests'],
  },
  {
    to: '/ricerche',
    label: 'Ricerca&Sviluppo',
    icon: IconResearch,
    roles: ['dottore_laboratorio'],
    commentTables: ['research_records'],
  },
  {
    to: '/fornitori',
    label: 'Fornitori',
    icon: IconSuppliers,
    roles: ['ufficio_acquisti'],
    commentTables: ['suppliers'],
  },
  { to: '/acquisti', label: 'Pipeline acquisti', icon: IconPipeline, roles: ['ufficio_acquisti'] },
  {
    to: '/calendario',
    label: 'Calendario',
    icon: IconCalendar,
    roles: ['operatore', 'tecnico', 'commerciale', 'dottore_laboratorio', 'ufficio_acquisti'],
    commentTables: ['appointments'],
  },
  { to: '/marketing', label: 'Marketing', icon: IconMarketing, roles: ['operatore', 'tecnico', 'commerciale'] },
  {
    to: '/report',
    label: 'Report e analytics',
    icon: IconReport,
    roles: ['operatore', 'tecnico', 'commerciale', 'ufficio_acquisti'],
  },
  { to: '/chat', label: 'Chat', icon: IconChat, badgeKey: 'chat' },
  { to: '/utenti', label: 'Utenti', icon: IconUsers, roles: ['dirigente', 'amministrazione'] },
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
  const { profile, signOut, unreadChatCount, newRequestsCount, unreadCommentsByTable } = useAuth()
  // Menu comprimibile: a icone soltanto, così le pagine (bacheca pipeline,
  // elenchi, calendario) guadagnano spazio orizzontale. La preferenza resta
  // salvata nel browser da una sessione all'altra.
  const [collapsed, setCollapsed] = useState(readStoredCollapsed)
  // Menu laterale su telefono (richiesta di Andrea ott 2026): sotto gli 860px
  // il menu non resta più fisso a lato (non c'è spazio), diventa un pannello
  // che si apre da un bottone in alto e si chiude da solo dopo aver scelto
  // una voce, oppure toccando fuori dal pannello.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // Storage non disponibile (es. navigazione privata): la preferenza
      // semplicemente non viene ricordata, non è un problema bloccante.
    }
  }, [collapsed])

  const badgeCounts: Record<'chat' | 'richieste', number> = {
    chat: unreadChatCount,
    richieste: newRequestsCount,
  }

  function commentBadgeCount(tables?: CommentRefTable[]): number {
    if (!tables) return 0
    return tables.reduce((sum, t) => sum + (unreadCommentsByTable[t] ?? 0), 0)
  }

  return (
    <div className="shell">
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-topbar-btn"
          onClick={() => setMobileNavOpen(true)}
          title="Apri il menu"
        >
          <IconMenu />
        </button>
        <div className="brand">
          <span className="brand-mark">
            <IconFlask />
          </span>
          <span className="brand-text">Solvex</span>
        </div>
      </header>
      {mobileNavOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <aside
        className={
          'sidebar' + (collapsed ? ' sidebar-collapsed' : '') + (mobileNavOpen ? ' sidebar-mobile-open' : '')
        }
      >
        <button
          type="button"
          className="mobile-nav-close"
          onClick={() => setMobileNavOpen(false)}
          title="Chiudi il menu"
        >
          <IconX />
        </button>
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
          {NAV.filter((item) => !item.roles || item.roles.includes(profile?.role as UserRole) || hasFullAccess(profile?.role)).map((item) => {
            const Icon = item.icon
            const badgeCount = item.badgeKey ? badgeCounts[item.badgeKey] : 0
            const commentCount = commentBadgeCount(item.commentTables)
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                onClick={() => setMobileNavOpen(false)}
              >
                <Icon className="nav-item-icon" />
                <span className="nav-item-label">{item.label}</span>
                {badgeCount > 0 && <span className="nav-badge">{badgeCount > 99 ? '99+' : badgeCount}</span>}
                {commentCount > 0 && (
                  <span className="nav-badge nav-badge-comments" title="Commenti non letti indirizzati a te">
                    {commentCount > 99 ? '99+' : commentCount}
                  </span>
                )}
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
