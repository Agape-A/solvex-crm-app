import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { ChatMessage } from '../lib/types'

// Canale aziendale generale: broadcast, tutti i colleghi autenticati vedono
// tutto. Per mandare qualcosa a una persona o a un reparto preciso, collegata
// a un'attività (una trattativa, un cliente, un progetto...), si usa il
// selettore "Manda come richiesta a…" nella zona Commenti di quell'attività —
// più rapido perché il record è già quello aperto, niente da ripetere qui.

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function Chat() {
  const { profile } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [authors, setAuthors] = useState<Map<string, string>>(new Map())
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('chat_messages').select('*').order('created_at').limit(200),
      supabase.from('profiles').select('*').order('full_name'),
    ]).then(([messagesRes, profilesRes]) => {
      setMessages((messagesRes.data as ChatMessage[]) ?? [])
      const map = new Map<string, string>()
      for (const p of (profilesRes.data as { id: string; full_name: string }[]) ?? []) map.set(p.id, p.full_name)
      setAuthors(map)
      setLoading(false)
    })

    const channel = supabase
      .channel('chat_messages_generale')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const row = payload.new as ChatMessage
        setMessages((current) => (current.some((m) => m.id === row.id) ? current : [...current, row]))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !body.trim()) return
    setSending(true)
    const { error } = await supabase.from('chat_messages').insert({ author_id: profile.id, body: body.trim() })
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
      <p className="muted">Canale aziendale — visibile a tutti i colleghi autenticati, aggiornato in tempo reale.</p>
      <div className="card chat-panel">
        <div className="chat-messages">
          {loading && <p className="muted">Caricamento…</p>}
          {!loading && messages.length === 0 && <p className="muted">Nessun messaggio ancora — scrivi il primo.</p>}
          {messages.map((m) => {
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
            placeholder="Scrivi un messaggio a tutta l'azienda…"
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
