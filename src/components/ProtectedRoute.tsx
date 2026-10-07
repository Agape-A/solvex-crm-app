import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { canSeePage } from './Layout'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="page-loading">Caricamento…</div>
  if (!session) return <Navigate to="/login" replace />
  if (!profile) {
    return (
      <div className="page-loading">
        Il tuo account non ha ancora un profilo assegnato. Chiedi a un dirigente di
        verificarlo nella tabella <code>profiles</code> su Supabase.
      </div>
    )
  }
  // Blocca anche l'apertura diretta di una pagina scrivendo l'indirizzo a
  // mano, non solo la voce nascosta dal menu (richiesta di Andrea, ott
  // 2026: "spuntare le pagine che può vedere") — stessa logica del menu,
  // vedi canSeePage() in Layout.tsx.
  if (!canSeePage(location.pathname, profile)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
