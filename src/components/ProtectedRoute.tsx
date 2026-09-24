import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth()

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
  return <>{children}</>
}
