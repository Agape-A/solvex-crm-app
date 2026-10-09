import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import {
  hasFullAccess,
  REQUEST_DEPARTMENTS,
  CHAT_CHANNEL_LABELS,
  type ChatChannel,
  type ChatMessage,
  type ChatFeedItem,
  type RecordComment,
  type Profile,
  type RequestDepartment,
} from '../lib/types'

// Canale "Generale": broadcast, tutti i colleghi autenticati vedono tutto.
// Più un canale per reparto — vedi 0033_chat_reparti_1.sql — visibile solo a
// chi ha quel reparto sul profilo, più dirigente che vede sempre tutti i
// canali.
//
// Da 0053_chat_privata_e_commenti.sql (richiesta di Andrea, ott 2026: "la
// chat con tutti gli utenti, dopodiché per ogni utente e per reparto" + "dove
// al suo interno vanno a finire anche tutti i commenti di richieste e
// leeds") la Chat ha anche due cose nuove:
// 1) un messaggio privato 1-a-1 con ciascun collega — SOLO i due coinvolti lo
//    leggono, nemmeno un dirigente (confermato da Andrea con una domanda
//    diretta);
// 2) i commenti con destinatario scritti nelle schede di richieste/
//    trattative/clienti/ecc. (record_comments) compaiono anche qui, nel
//    canale di reparto giusto o nella chat privata tra chi scrive e il
//    destinatario — come messaggi veri a cui si risponde da qui (la
//    risposta torna come nuovo commento sulla stessa scheda, si vede "Rispondi"
//    su questi messaggi).
//
// Una "conversazione" è quindi un canale (Generale/reparto) oppure una chat
// privata con una persona precisa — ActiveConversation sotto.

type ActiveConversation = { kind: 'channel'; channel: ChatChannel } | { kind: 'dm'; userId: string }

// Etichetta e link alla scheda d'origine di un commento, per il piccolo
// richiamo sopra il testo ("💬 commento su una trattativa — Vedi →").
// "appointments" non ha un collegamento diretto (Calendario non supporta
// ancora l'apertura di un appuntamento preciso da link), si linka solo alla
// pagina.
const REF_TABLE_LABELS: Record<string, string> = {
  deals: 'una trattativa',
  requests: 'una richiesta',
  clients: 'un cliente',
  appointments: 'un appuntamento',
  research_records: 'una scheda di ricerca',
  suppliers: 'un fornitore',
  purchase_requests: 'una richiesta di acquisto',
}

function refTableLink(refTable: string, refId: string): string {
  switch (refTable) {
    case 'deals':
      return `/pipeline?deal=${refId}`
    case 'clients':
      return `/clienti?cliente=${refId}`
    case 'requests':
      return `/richieste?id=${refId}`
    case 'research_records':
      return `/ricerche?id=${refId}`
    case 'suppliers':
      return `/fornitori?fornitore=${refId}`
    case 'purchase_requests':
      return `/acquisti?richiesta=${refId}`
    default:
      return '/calendario'
  }
}

function channelKey(conv: ActiveConversation): string {
  return conv.kind === 'channel' ? conv.channel : `dm:${conv.userId}`
}

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
  const [conversation, setConversation] = useState<ActiveConversation>({ kind: 'channel', channel: 'generale' })
  const [items, setItems] = useState<ChatFeedItem[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [authors, setAuthors] = useState<Map<string, string>>(new Map())
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  // Rispondere a un commento (non a un messaggio qualsiasi): la risposta
  // torna sulla stessa scheda, con lo stesso destinatario del commento
  // originale — non un nuovo messaggio di chat generico. Niente "rispondi"
  // per i messaggi normali: lì si scrive e basta, come sempre.
  const [replyTarget, setReplyTarget] = useState<{
    refTable: string
    refId: string
    recipientId: string | null
    recipientDepartment: RequestDepartment | null
  } | null>(null)
  // Non letti per conversazione (canale o "dm:<id>") — funzione
  // unread_chat_by_channel, ora unisce chat_messages e record_comments (vedi
  // 0053_chat_privata_e_commenti.sql).
  const [unreadByConversation, setUnreadByConversation] = useState<Map<string, number>>(new Map())
  const bottomRef = useRef<HTMLDivElement>(null)

  const visibleChannels: ChatChannel[] = hasFullAccess(profile?.role)
    ? ['generale', ...REQUEST_DEPARTMENTS]
    : profile?.department
    ? ['generale', profile.department]
    : ['generale']

  // Chiunque può scrivere in privato a chiunque altro — "la chat con tutti
  // gli utenti" della richiesta di Andrea — niente filtro per reparto qui.
  const dmPartners = profiles.filter((p) => p.id !== profile?.id)

  async function refreshUnread() {
    const { data, error } = await supabase.rpc('unread_chat_by_channel')
    if (error || !data) return
    setUnreadByConversation(new Map((data as { channel: string; unread_count: number }[]).map((r) => [r.channel, r.unread_count])))
  }

  useEffect(() => {
    if (!profile) return
    refreshUnread()
    const channel = supabase
      .channel('chat_unread_by_conversation')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => refreshUnread())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'record_comments' }, () => refreshUnread())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Elenco colleghi, una volta sola (serve sia per i nomi degli autori sia
  // per l'elenco "Messaggi privati").
  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data }) => {
        const rows = (data as Profile[]) ?? []
        setProfiles(rows)
        const map = new Map<string, string>()
        for (const p of rows) map.set(p.id, p.full_name)
        setAuthors(map)
      })
  }, [])

  // Se il reparto dell'utente cambia (o al primo caricamento del profilo) e
  // il canale attivo non è più tra quelli visibili, si torna su "Generale"
  // invece di restare bloccati su un canale ormai non raggiungibile.
  useEffect(() => {
    if (conversation.kind === 'channel' && !visibleChannels.includes(conversation.channel)) {
      setConversation({ kind: 'channel', channel: 'generale' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.department, profile?.role])

  useEffect(() => {
    if (!profile) return
    setLoading(true)
    setReplyTarget(null)

    const isGenerale = conversation.kind === 'channel' && conversation.channel === 'generale'
    const meId = profile.id

    const messagesQuery =
      conversation.kind === 'channel'
        ? supabase.from('chat_messages').select('*').eq('channel', conversation.channel).order('created_at').limit(200)
        : supabase
            .from('chat_messages')
            .select('*')
            .eq('channel', 'dm')
            .or(`and(author_id.eq.${meId},recipient_id.eq.${conversation.userId}),and(author_id.eq.${conversation.userId},recipient_id.eq.${meId})`)
            .order('created_at')
            .limit(200)

    const commentsQuery = isGenerale
      ? null
      : conversation.kind === 'channel'
      ? supabase.from('record_comments').select('*').eq('recipient_department', conversation.channel).order('created_at').limit(200)
      : supabase
          .from('record_comments')
          .select('*')
          .or(`and(author_id.eq.${meId},recipient_id.eq.${conversation.userId}),and(author_id.eq.${conversation.userId},recipient_id.eq.${meId})`)
          .order('created_at')
          .limit(200)

    Promise.all([messagesQuery, commentsQuery ?? Promise.resolve({ data: [] as RecordComment[] })]).then(([messagesRes, commentsRes]) => {
      const messages = ((messagesRes.data as ChatMessage[]) ?? []).map(
        (m): ChatFeedItem => ({
          id: m.id,
          source: 'message',
          author_id: m.author_id,
          body: m.body,
          created_at: m.created_at,
          ref_table: m.ref_table,
          ref_id: m.ref_id,
          recipient_id: m.recipient_id,
          recipient_department: null,
        }),
      )
      const comments = ((commentsRes.data as RecordComment[]) ?? []).map(
        (c): ChatFeedItem => ({
          id: c.id,
          source: 'comment',
          author_id: c.author_id,
          body: c.body,
          created_at: c.created_at,
          ref_table: c.ref_table,
          ref_id: c.ref_id,
          recipient_id: c.recipient_id,
          recipient_department: c.recipient_department,
        }),
      )
      const merged = [...messages, ...comments].sort((a, b) => a.created_at.localeCompare(b.created_at))
      setItems(merged)
      setLoading(false)
    })

    // Sottoscrizione realtime senza filtro (come già per il pallino): le
    // condizioni di appartenenza alla conversazione attiva si controllano
    // qui in JS, non nel filtro — più semplice che tradurre un "OR" in un
    // filtro Realtime, che ne supporta solo uno semplice per colonna.
    function belongsToConversation(row: { author_id: string | null; recipient_id?: string | null; channel?: string; recipient_department?: string | null }, source: 'message' | 'comment'): boolean {
      if (conversation.kind === 'channel') {
        if (conversation.channel === 'generale') return source === 'message' && row.channel === 'generale'
        if (source === 'message') return row.channel === conversation.channel
        return row.recipient_department === conversation.channel
      }
      const partner = conversation.userId
      if (source === 'message') {
        return (
          row.channel === 'dm' &&
          ((row.author_id === meId && row.recipient_id === partner) || (row.author_id === partner && row.recipient_id === meId))
        )
      }
      return (row.author_id === meId && row.recipient_id === partner) || (row.author_id === partner && row.recipient_id === meId)
    }

    const channel = supabase
      .channel(`chat_feed_${channelKey(conversation)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const row = payload.new as ChatMessage
        if (!belongsToConversation(row, 'message')) return
        const newItem: ChatFeedItem = {
          id: row.id,
          source: 'message',
          author_id: row.author_id,
          body: row.body,
          created_at: row.created_at,
          ref_table: row.ref_table,
          ref_id: row.ref_id,
          recipient_id: row.recipient_id,
          recipient_department: null,
        }
        setItems((current) =>
          current.some((i) => i.id === row.id)
            ? current
            : [...current, newItem].sort((a, b) => a.created_at.localeCompare(b.created_at)),
        )
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'record_comments' }, (payload) => {
        const row = payload.new as RecordComment
        if (!belongsToConversation(row, 'comment')) return
        const newItem: ChatFeedItem = {
          id: row.id,
          source: 'comment',
          author_id: row.author_id,
          body: row.body,
          created_at: row.created_at,
          ref_table: row.ref_table,
          ref_id: row.ref_id,
          recipient_id: row.recipient_id,
          recipient_department: row.recipient_department,
        }
        setItems((current) =>
          current.some((i) => i.id === row.id)
            ? current
            : [...current, newItem].sort((a, b) => a.created_at.localeCompare(b.created_at)),
        )
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, conversation.kind, conversation.kind === 'channel' ? conversation.channel : conversation.userId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    // Finché questa conversazione è aperta, ogni volta che arriva/parte
    // qualcosa la segnamo come "vista adesso" — solo QUESTA conversazione,
    // non tutta la chat (stesso motivo di sempre: niente pallini che
    // spariscono "da soli" su conversazioni mai aperte).
    if (!profile) return
    markChatSeen(channelKey(conversation)).then(() => refreshUnread())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, conversation.kind, conversation.kind === 'channel' ? conversation.channel : conversation.userId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !body.trim()) return
    setSending(true)

    if (replyTarget) {
      const { error } = await supabase.from('record_comments').insert({
        ref_table: replyTarget.refTable,
        ref_id: replyTarget.refId,
        author_id: profile.id,
        body: body.trim(),
        recipient_id: replyTarget.recipientId,
        recipient_department: replyTarget.recipientDepartment,
      })
      setSending(false)
      if (error) {
        alert('Non è stato possibile inviare la risposta: ' + error.message)
        return
      }
      setBody('')
      setReplyTarget(null)
      return
    }

    const payload: { author_id: string; body: string; channel: string; recipient_id: string | null } =
      conversation.kind === 'channel'
        ? { author_id: profile.id, body: body.trim(), channel: conversation.channel, recipient_id: null }
        : { author_id: profile.id, body: body.trim(), channel: 'dm', recipient_id: conversation.userId }

    const { error } = await supabase.from('chat_messages').insert(payload)
    setSending(false)
    if (error) {
      alert('Non è stato possibile inviare il messaggio: ' + error.message)
      return
    }
    setBody('')
  }

  if (!profile) return null

  const activeLabel =
    conversation.kind === 'channel' ? CHAT_CHANNEL_LABELS[conversation.channel] : authors.get(conversation.userId) ?? 'Utente'

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
              className={conversation.kind === 'channel' && conversation.channel === c ? 'active' : ''}
              onClick={() => setConversation({ kind: 'channel', channel: c })}
            >
              {CHAT_CHANNEL_LABELS[c]}
              {!(conversation.kind === 'channel' && conversation.channel === c) && (unreadByConversation.get(c) ?? 0) > 0 && (
                <span className="row-notify-dot" aria-label="Non letti" />
              )}
            </button>
          ))}
        </div>
      )}
      {dmPartners.length > 0 && (
        <>
          <p className="muted chat-dm-label">Messaggi privati — solo tu e la persona scelta potete leggerli.</p>
          <div className="chat-mode-toggle chat-dm-toggle">
            {dmPartners.map((p) => {
              const key = `dm:${p.id}`
              const active = conversation.kind === 'dm' && conversation.userId === p.id
              return (
                <button key={p.id} type="button" className={active ? 'active' : ''} onClick={() => setConversation({ kind: 'dm', userId: p.id })}>
                  {p.full_name}
                  {!active && (unreadByConversation.get(key) ?? 0) > 0 && <span className="row-notify-dot" aria-label="Non letti" />}
                </button>
              )
            })}
          </div>
        </>
      )}
      <p className="muted">
        {conversation.kind === 'channel' && conversation.channel === 'generale'
          ? "Canale aziendale — visibile a tutti i colleghi autenticati, aggiornato in tempo reale."
          : conversation.kind === 'channel'
          ? `Canale del reparto ${activeLabel} — comprende anche i commenti indirizzati al reparto, aggiornato in tempo reale.`
          : `Chat privata con ${activeLabel} — comprende anche i commenti scambiati tra voi due, aggiornato in tempo reale.`}
      </p>
      <div className="card chat-panel">
        <div className="chat-messages">
          {loading && <p className="muted">Caricamento…</p>}
          {!loading && items.length === 0 && <p className="muted">Nessun messaggio ancora — scrivi il primo.</p>}
          {items.map((m) => {
            if (m.source === 'message' && m.author_id === null) {
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
            const isComment = m.source === 'comment'
            const refTable = m.ref_table
            const refId = m.ref_id
            const hasOrigin = isComment && refTable !== null && refId !== null
            return (
              <div className={'chat-bubble-row' + (mine ? ' mine' : '')} key={m.id}>
                <div className={'chat-bubble' + (isComment ? ' chat-bubble-comment' : '')}>
                  {!mine && <div className="chat-bubble-author">{authors.get(m.author_id ?? '') ?? 'Utente'}</div>}
                  {hasOrigin && refTable !== null && refId !== null && (
                    <div className="chat-bubble-origin">
                      💬 commento su {REF_TABLE_LABELS[refTable] ?? 'una scheda'}
                      <Link to={refTableLink(refTable, refId)} className="chat-bubble-origin-link">
                        Vedi scheda →
                      </Link>
                    </div>
                  )}
                  <p>{m.body}</p>
                  <div className="chat-bubble-time">
                    {timeLabel(m.created_at)}
                    {hasOrigin && refTable !== null && refId !== null && (
                      <button
                        type="button"
                        className="chat-bubble-reply"
                        onClick={() =>
                          setReplyTarget({
                            refTable,
                            refId,
                            recipientId: m.recipient_id,
                            recipientDepartment: m.recipient_department,
                          })
                        }
                      >
                        Rispondi
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
        {replyTarget && (
          <div className="chat-reply-banner">
            <span>
              Stai rispondendo al commento su {REF_TABLE_LABELS[replyTarget.refTable] ?? 'una scheda'} — la risposta torna anche lì.
            </span>
            <button type="button" onClick={() => setReplyTarget(null)} aria-label="Annulla risposta">
              ✕
            </button>
          </div>
        )}
        <form className="chat-input-row" onSubmit={handleSubmit}>
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              replyTarget
                ? 'Scrivi la risposta…'
                : conversation.kind === 'channel' && conversation.channel === 'generale'
                ? "Scrivi un messaggio a tutta l'azienda…"
                : conversation.kind === 'channel'
                ? `Scrivi al reparto ${activeLabel}…`
                : `Scrivi a ${activeLabel}…`
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
