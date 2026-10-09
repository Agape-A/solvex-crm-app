import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { CommentRefTable, Profile, UnreadCommentsByTable } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signInWithOtp: (email: string) => Promise<{ error: string | null }>
  // Verifica del codice ricevuto via email (richiesta di Andrea ott 2026: nell'app
  // installata su iPhone/Mac il link di accesso ricevuto via email si apre
  // sempre nel browser normale, mai dentro l'app installata, perché hanno
  // una loro memoria separata. Il codice, letto dall'email e digitato a
  // mano nella stessa finestra dell'app installata, evita del tutto il
  // problema. Nessuna modifica al database: usa l'OTP di Supabase Auth
  // già generato da signInWithOtp.
  verifyOtpCode: (email: string, code: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  unreadChatCount: number
  newRequestsCount: number
  // Il parametro è una stringa, non più ChatChannel: da 0053 serve anche
  // marcare "vista" una chat privata, con una chiave sintetica
  // "dm:<id dell'altra persona>" (vedi Chat.tsx), non un canale vero.
  markChatSeen: (channel: string) => Promise<void>
  // Pallino dedicato ai commenti (0043_notifiche_commenti.sql, richiesta di
  // Andrea ott 2026) — distinto da "Chat" e "Richieste": per ref_table, così
  // Layout.tsx mostra il numero giusto su ciascuna pagina (Pipeline,
  // Richieste, Calendario, Clienti, Fornitori, Ricerca&Sviluppo) invece di
  // un totale unico che mischierebbe record diversi.
  unreadCommentsByTable: Record<string, number>
  markCommentsSeen: (refTable: CommentRefTable, refId: string) => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [newRequestsCount, setNewRequestsCount] = useState(0)
  const [unreadCommentsByTable, setUnreadCommentsByTable] = useState<Record<string, number>>({})

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
        const loadedProfile = (data as Profile) ?? null
        if (loadedProfile && loadedProfile.active === false) {
          // Account sospeso (richiesta di Andrea, ott 2026). Il ban vero è
          // lato Supabase Auth (blocca nuovi accessi e il refresh del
          // token), ma un token già valido può restare attivo fino a
          // un'ora: qui chiudiamo subito anche una sessione già aperta,
          // invece di aspettare che scada da sola.
          supabase.auth.signOut()
          setProfile(null)
          setLoading(false)
          return
        }
        setProfile(loadedProfile)
        setLoading(false)
      })
  }, [session])

  // ============ Permessi in tempo reale (sospensione, pagine, ruolo) ============
  // Richiesta di Andrea, ott 2026: senza questo, chi aveva già la pagina
  // aperta continuava a vedere tutto (o a restare dentro) fino al prossimo
  // refresh, anche dopo che un dirigente lo sospendeva o gli cambiava le
  // pagine visibili dalla pagina "Utenti" — qui il profilo si aggiorna da
  // solo non appena cambia nel database, senza dover ricaricare la pagina.
  // Richiede che la tabella "profiles" abbia la Realtime attiva (Supabase →
  // Database → Replication), come già per "requests"/"chat_messages" qui
  // sotto — se non lo è ancora, questo effetto semplicemente non riceve
  // eventi (nessun errore, ma nessun aggiornamento live).
  useEffect(() => {
    if (!session) return

    const channel = supabase
      .channel('own_profile_changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` },
        (payload) => {
          const updated = payload.new as Profile
          if (updated.active === false) {
            supabase.auth.signOut()
            setProfile(null)
            return
          }
          setProfile(updated)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
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
  // ciascun numero). Da 0053_chat_privata_e_commenti.sql il conteggio (lato
  // database) include anche i commenti con destinatario che ora compaiono
  // dentro la Chat, quindi qui si ascoltano anche gli INSERT su
  // record_comments, non solo su chat_messages.

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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'record_comments' }, () => refresh())
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [profile?.id, profile?.role, profile?.department])

  // ============ Notifiche: pallino dedicato ai commenti ============
  // Distinto dal pallino "Richieste" (sopra) e da quello "Chat" (sotto): i
  // commenti con destinatario (0043_notifiche_commenti.sql) sono un terzo
  // canale a sé, per i motivi spiegati nella migrazione. "Visto per record"
  // come già per i canali di chat, qui per (ref_table, ref_id).

  useEffect(() => {
    if (!profile) {
      setUnreadCommentsByTable({})
      return
    }
    let cancelled = false

    async function refresh() {
      const { data, error } = await supabase.rpc('unread_record_comments_by_table')
      if (cancelled || error) return
      const map: Record<string, number> = {}
      for (const row of (data as UnreadCommentsByTable[]) ?? []) map[row.ref_table] = row.unread_count
      setUnreadCommentsByTable(map)
    }

    refresh()

    const channel = supabase
      .channel('record_comments_badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'record_comments' }, () => refresh())
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [profile?.id, profile?.role, profile?.department])

  // ============ Pallino rosso sull'icona dell'app (stile iPhone) ============
  // Richiesta di Andrea, ott 2026: "non appare il numero delle notifiche nel
  // classico cerchio rosso". Qui si tiene aggiornato il badge MENTRE l'app è
  // aperta, sommando i tre contatori già calcolati sopra (chat + richieste +
  // commenti) — lo stesso numero che spariva una notifica alla volta quando
  // arrivava via push ad app chiusa viene aggiornato qui in tempo reale non
  // appena qualcosa viene segnato come letto. "setAppBadge" non esiste in
  // tutti i browser (richiede l'app installata su iOS/macOS): il controllo
  // 'setAppBadge' in navigator evita un errore dove manca.

  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    const commentsTotal = (Object.values(unreadCommentsByTable) as number[]).reduce((sum, n) => sum + n, 0)
    const total = unreadChatCount + newRequestsCount + commentsTotal
    const task =
      total > 0 ? (navigator as Navigator & { setAppBadge: (n: number) => Promise<void> }).setAppBadge(total) : (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge()
    task.catch(() => {
      // Nessun badge disponibile in questo contesto (es. non installata): non
      // è un errore da segnalare all'utente, semplicemente non si vede.
    })
  }, [unreadChatCount, newRequestsCount, unreadCommentsByTable])

  async function markCommentsSeen(refTable: CommentRefTable, refId: string) {
    if (!profile) return
    const { error } = await supabase
      .from('record_comment_reads')
      .upsert({ profile_id: profile.id, ref_table: refTable, ref_id: refId, last_seen_at: new Date().toISOString() })
    if (error) {
      console.error('Impossibile aggiornare ultima visita al record', error)
      return
    }
    const { data } = await supabase.rpc('unread_record_comments_by_table')
    const map: Record<string, number> = {}
    for (const row of (data as UnreadCommentsByTable[]) ?? []) map[row.ref_table] = row.unread_count
    setUnreadCommentsByTable(map)
  }

  async function markChatSeen(channel: string) {
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

  async function verifyOtpCode(email: string, code: string) {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email',
    })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        signInWithOtp,
        verifyOtpCode,
        signOut,
        unreadChatCount,
        newRequestsCount,
        markChatSeen,
        unreadCommentsByTable,
        markCommentsSeen,
      }}
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
