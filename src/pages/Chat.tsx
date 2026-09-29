import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { hasFullAccess, REQUEST_DEPARTMENTS, CHAT_CHANNEL_LABELS, type ChatChannel, type ChatMessage } from '../lib/types'

// Canale "Generale": broadcast, tutti i colleghi autenticati vedono tutto.
// Più un canale per reparto (richiesto da Andrea, set 2026) — stessa lista
// di reparti già usata in Richieste/Report — visibile solo a chi ha quel
// reparto sul profilo, più dirigente/amministrazione che vedono sempre
// tutti i canali (RLS in 0033_chat_reparti.sql fa rispettare questo anche
// lato database, non solo qui).
//
// I commenti/richieste legati a un record specifico (una trattativa, un
// cliente, una richiesta...) restano nel loro thread unico, sul record
// stesso — vedi CommentThread.tsx e il selettore "Manda come richiesta a…"
// lì dentro. Qui in chat arriva solo un avviso automatico quando nasce una
// richiesta nuova per un reparto (autore nullo, riconoscibile dall'icona
// 🔔 e senza bolla), con un link diretto alla richiesta — niente thread
// duplicato, solo un modo in più per accorgersene.

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function Chat() {
  const { profile, markChatSeen } = useAuth()
  const [activeChannel, setActiveChannel] = useState<ChatChannel>('generale')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [authors, setAuthors] = useState<Map<string, string>>(new Map())
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  // Non letti per canale (funzione unread_chat_by_channel, vedi
  // 0036_notifiche_semplici.sql) — un pallino sulla linguetta del canale
  // che ha davvero qualcosa di nuovo, invece di dover aprire ciascun canale
  // per scoprirlo (richiesta di Andrea, set 2026: capire a colpo d'occhio
  // dove sono le novità).
  const [unreadByChannel, setUnreadByChannel] = useState<Map<ChatChannel, number>>(new Map())
  const bottomRef = useRef<HTMLDivElement>(null)

  const visibleChannels: ChatChannel[] = hasFullAccess(profile?.role)
    ? ['generale', ...REQUEST_DEPARTMENTS]
    : profile?.department
    ? ['generale', profile.department]
    : ['generale']

  async function refreshUnreadByChannel() {
    const { data, error } = await supabase.rpc('unread_chat_by_channel')
    if (error || !data) return
    setUnreadByChannel(
      new Map((data as { channel: ChatChannel; unread_count: number }[]).map((r) => [r.channel, r.unread_count])),
    )
  }

  useEffect(() => {
    if (!profile) return
    refreshUnreadByChannel()
    const channel = supabase
      .channel('chat_messages_unread_by_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () =>
        refreshUnreadByChannel(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Se il reparto dell'utente cambia (o al primo caricamento del profilo) e
  // il canale attivo non è più tra quelli visibili, si torna su "Generale"
  // invece di restare bloccati su un canale ormai non raggiungibile.
  useEffect(() => {
    if (!visibleChannels.includes(activeChannel)) setActiveChannel('generale')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.department, profile?.role])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('chat_messages').select('*').eq('channel', activeChannel).order('created_at').limit(200),
      supabase.from('profiles').select('*').order('full_name'),
    ]).then(([messagesRes, profilesRes]) => {
      setMessages((messagesRes.data as ChatMessage[]) ?? [])
      const map = new Map<string, string>()
      for (const p of (profilesRes.data as { id: string; full_name: string }[]) ?? []) map.set(p.id, p.full_name)
      setAuthors(map)
      setLoading(false)
    })

    const channel = supabase
      .channel(`chat_messages_${activeChannel}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel=eq.${activeChannel}` },
        (payload) => {
          const row = payload.new as ChatMessage
          setMessages((current) => (current.some((m) => m.id === row.id) ? current : [...current, row]))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeChannel])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    // Finché questo canale è aperto, ogni volta che arriva/parte un messaggio
    // lo segniamo come "visto adesso" — solo QUESTO canale, non tutta la
    // chat: così il pallino su un canale mai aperto resta corretto invece di
    // sparire "da solo" quando si legge un altro canale.
    markChatSeen(activeChannel).then(() => refreshUnreadByChannel())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, activeChannel])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !body.trim()) return
    setSending(true)
    const { error } = await supabase
      .from('chat_messages')
      .insert({ author_id: profile.id, body: body.trim(), channel: activeChannel })
    setSending(false)
    if (error) {
      alert('Non è stato possibile inviare il messaggio: ' + error.message)
      return
    }
    setBody('')
  }

  if (!profile) return null

  return (
    <div className="view chat-view">
      <div className="view-head">
        <h1>Chat</h1>
      </div>
      {visibleChannels.length > 1 && (
        <div className="chat-mode-toggle">
          {visibleChannels.map((c) => (
            <button
              key={c}
              type="button"
              className={activeChannel === c ? 'active' : ''}
              onClick={() => setActiveChannel(c)}
            >
              {CHAT_CHANNEL_LABELS[c]}
              {c !== activeChannel && (unreadByChannel.get(c) ?? 0) > 0 && (
                <span className="row-notify-dot" aria-label="Non letti" />
              )}
            </button>
          ))}
        </div>
      )}
      <p className="muted">
        {activeChannel === 'generale'
          ? "Canale aziendale — visibile a tutti i colleghi autenticati, aggiornato in tempo reale."
          : `Canale del reparto ${CHAT_CHANNEL_LABELS[activeChannel]} — aggiornato in tempo reale.`}
      </p>
      <div className="card chat-panel">
        <div className="chat-messages">
          {loading && <p className="muted">Caricamento…</p>}
          {!loading && messages.length === 0 && <p className="muted">Nessun messaggio ancora — scrivi il primo.</p>}
          {messages.map((m) => {
            if (m.author_id === null) {
              return (
                <div className="chat-system-row" key={m.id}>
                  <span className="chat-system-icon" aria-hidden="true">
                    🔔
                  </span>
                  <span className="chat-system-body">{m.body}</span>
                  {m.ref_table === 'requests' && m.ref_id && (
                    <Link to={`/richieste?id=${m.ref_id}`} className="chat-system-link">
                      Vedi →
                    </Link>
                  )}
                  <span className="chat-system-time">{timeLabel(m.created_at)}</span>
                </div>
              )
            }
            const mine = m.author_id === profile.id
            return (
              <div className={'chat-bubble-row' + (mine ? ' mine' : '')} key={m.id}>
                <div className="chat-bubble">
                  {!mine && <div className="chat-bubble-author">{authors.get(m.author_id ?? '') ?? 'Utente'}</div>}
                  <p>{m.body}</p>
                  <div className="chat-bubble-time">{timeLabel(m.created_at)}</div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
        <form className="chat-input-row" onSubmit={handleSubmit}>
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              activeChannel === 'generale'
                ? "Scrivi un messaggio a tutta l'azienda…"
                : `Scrivi al reparto ${CHAT_CHANNEL_LABELS[activeChannel]}…`
            }
            autoFocus
          />
          <button className="btn btn-primary" type="submit" disabled={sending || !body.trim()}>
            Invia
          </button>
        </form>
      </div>
    </div>
  )
}
