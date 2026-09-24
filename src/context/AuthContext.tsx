import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signInWithOtp: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  unreadChatCount: number
  newRequestsCount: number
  markChatSeen: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [newRequestsCount, setNewRequestsCount] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (!newSession) {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    setLoading(true)
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          // Capita se il trigger handle_new_user non ha ancora fatto in tempo:
          // in genere basta un refresh. In produzione conviene mostrare un
          // messaggio di attesa invece di un errore secco.
          console.error('Impossibile caricare il profilo', error)
        }
        setProfile((data as Profile) ?? null)
        setLoading(false)
      })
  }, [session])

  // ============ Notifiche: pallino su "Richieste" ============
  // Conta le richieste con status "nuova". La RLS su "requests" filtra già
  // per ruolo/reparto lato database, quindi questa count query restituisce
  // da sola solo quelle che l'utente potrebbe vedere aprendo la pagina.

  useEffect(() => {
    if (!profile) {
      setNewRequestsCount(0)
      return
    }

    let cancelled = false

    async function refresh() {
      const { count } = await supabase
        .from('requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'nuova')
      if (!cancelled) setNewRequestsCount(count ?? 0)
    }

    refresh()

    const channel = supabase
      .channel('requests_badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => refresh())
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [profile?.id, profile?.role, profile?.department])

  // ============ Notifiche: pallino su "Chat" ============
  // Conta i messaggi arrivati da altri dopo l'ultima visita alla pagina Chat
  // (profile.chat_last_seen_at, colonna aggiunta in
  // 0029_notifiche_badge.sql). Si risottoscrive ogni volta che
  // chat_last_seen_at cambia, così dopo markChatSeen() riparte dal punto giusto.

  useEffect(() => {
    if (!profile) {
      setUnreadChatCount(0)
      return
    }
    const myId = profile.id
    const seenAt = profile.chat_last_seen_at
    let cancelled = false

    async function refresh() {
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .gt('created_at', seenAt)
        .neq('author_id', myId)
      if (!cancelled) setUnreadChatCount(count ?? 0)
    }

    refresh()

    const channel = supabase
      .channel('chat_messages_badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => refresh())
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [profile?.id, profile?.chat_last_seen_at])

  async function markChatSeen() {
    if (!profile) return
    const nowIso = new Date().toISOString()
    setUnreadChatCount(0)
    setProfile((p) => (p ? { ...p, chat_last_seen_at: nowIso } : p))
    const { error } = await supabase.from('profiles').update({ chat_last_seen_at: nowIso }).eq('id', profile.id)
    if (error) console.error('Impossibile aggiornare ultima visita chat', error)
  }

  async function signInWithOtp(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, signInWithOtp, signOut, unreadChatCount, newRequestsCount, markChatSeen }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth va usato dentro <AuthProvider>')
  return ctx
}
