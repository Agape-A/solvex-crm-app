import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { ChatChannel, Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signInWithOtp: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  unreadChatCount: number
  newRequestsCount: number
  markChatSeen: (channel: ChatChannel) => Promise<void>
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
  // "Visto l'ultima volta" è per canale (chat_channel_reads, vedi
  // 0036_notifiche_semplici.sql), non un solo orario per tutta la chat come
  // prima: aprire un canale non segna più come letti anche gli altri canali
  // mai aperti — motivo per cui il pallino sembrava sparire "da solo" senza
  // che l'utente avesse davvero letto tutto. Il conteggio (funzione
  // unread_chat_count lato database) esclude anche gli avvisi di sistema
  // (autore nullo): questo numero significa solo "messaggi di persone non
  // ancora letti", mai richieste — quelle hanno il proprio pallino su
  // "Richieste" (richiesta di Andrea, set 2026: un significato solo per
  // ciascun numero).

  useEffect(() => {
    if (!profile) {
      setUnreadChatCount(0)
      return
    }
    let cancelled = false

    async function refresh() {
      const { data, error } = await supabase.rpc('unread_chat_count')
      if (!cancelled && !error) setUnreadChatCount((data as number) ?? 0)
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
  }, [profile?.id, profile?.role, profile?.department])

  async function markChatSeen(channel: ChatChannel) {
    if (!profile) return
    const { error } = await supabase
      .from('chat_channel_reads')
      .upsert({ profile_id: profile.id, channel, last_seen_at: new Date().toISOString() })
    if (error) {
      console.error('Impossibile aggiornare ultima visita al canale', error)
      return
    }
    const { data } = await supabase.rpc('unread_chat_count')
    setUnreadChatCount((data as number) ?? 0)
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
