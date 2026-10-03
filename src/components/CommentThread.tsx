import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { REQUEST_REF_TABLES, type RequestRefTable } from '../lib/refRecords'
import { REQUEST_DEPARTMENTS, type CommentRefTable, type Profile, type RecordComment, type RequestDepartment } from '../lib/types'

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'adesso'
  if (mins < 60) return `${mins} min fa`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h fa`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} g fa`
  return new Date(iso).toLocaleDateString('it-IT')
}

// "p:<id>" = destinatario una persona precisa; "d:<reparto>" = destinatario
// un intero reparto. Non esiste più il "commento pubblico" senza
// destinatario (richiesta di Andrea, ott 2026: "i commenti così come sono
// adesso sono inutili, perché li legge solo chi li scrive") — ogni commento
// ha sempre uno di questi due, qui scelto con lo stesso selettore sia per un
// commento "normale" sia per una richiesta.
type Recipient = `p:${string}` | `d:${string}`

// "Commento" resta nella cronologia del record (record_comments, con
// destinatario) e attiva il pallino dedicato ai commenti (vedi
// AuthContext.tsx/Layout.tsx). "Richiesta" è il percorso che esisteva già
// prima (tabella "requests") — non toccato, disponibile solo dove c'era
// anche prima (REQUEST_REF_TABLES).
type Mode = 'commento' | 'richiesta'

export function CommentThread({
  refTable,
  refId,
  refLabel,
}: {
  refTable: CommentRefTable
  refId: string
  refLabel?: string
}) {
  const { profile, markCommentsSeen } = useAuth()
  const [comments, setComments] = useState<RecordComment[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [authors, setAuthors] = useState<Map<string, string>>(new Map())
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<Mode>('commento')
  const [recipient, setRecipient] = useState<Recipient | ''>('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sentNotice, setSentNotice] = useState<string | null>(null)

  const canRequest = REQUEST_REF_TABLES.includes(refTable as RequestRefTable)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('record_comments').select('*').eq('ref_table', refTable).eq('ref_id', refId).order('created_at'),
      supabase.from('profiles').select('*').order('full_name'),
    ]).then(([commentsRes, profilesRes]) => {
      if (cancelled) return
      setComments((commentsRes.data as RecordComment[]) ?? [])
      const rows = (profilesRes.data as Profile[]) ?? []
      setProfiles(rows)
      const map = new Map<string, string>()
      for (const p of rows) map.set(p.id, p.full_name)
      setAuthors(map)
      setLoading(false)
    })
    const channel = supabase
      .channel(`record_comments_${refTable}_${refId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'record_comments', filter: `ref_id=eq.${refId}` }, (payload) => {
        const row = payload.new as RecordComment
        if (row.ref_table !== refTable) return
        setComments((current) => (current.some((c) => c.id === row.id) ? current : [...current, row]))
      })
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [refTable, refId])

  // Aprire questa cronologia equivale a "averla vista": segna come letti i
  // commenti indirizzati a me su questo record, così il pallino dedicato
  // (Layout.tsx) si aggiorna — stesso istante in cui si segna vista una chat.
  // "markCommentsSeen" resta fuori dalle dipendenze apposta (stessa scelta
  // di "markChatSeen" in Chat.tsx): è una nuova funzione a ogni render di
  // AuthProvider, includerla qui richiamerebbe questo effetto in loop.
  useEffect(() => {
    markCommentsSeen(refTable, refId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refTable, refId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !body.trim() || !recipient) return
    setSending(true)
    setSentNotice(null)

    const isPersona = recipient.startsWith('p:')
    const recipientId = isPersona ? recipient.slice(2) : null
    const recipientDepartment = isPersona ? null : (recipient.slice(2) as RequestDepartment)
    const recipientProfile = isPersona ? profiles.find((p) => p.id === recipientId) ?? null : null

    if (mode === 'commento') {
      const { error } = await supabase.from('record_comments').insert({
        ref_table: refTable,
        ref_id: refId,
        author_id: profile.id,
        body: body.trim(),
        recipient_id: recipientId,
        recipient_department: recipientDepartment,
      })
      setSending(false)
      if (error) { alert('Non è stato possibile inviare il commento: ' + error.message); return }
      setBody('')
      setRecipient('')
      setSentNotice(isPersona && recipientProfile ? `Commento inviato a ${recipientProfile.full_name}.` : 'Commento inviato al reparto.')
      return
    }

    const subject = refLabel ? `Richiesta su ${refLabel}` : 'Richiesta collegata'
    const { error } = await supabase.from('requests').insert({
      subject,
      sender: profile.full_name,
      type: 'interna',
      department: isPersona ? recipientProfile?.department ?? 'amministrazione' : recipientDepartment,
      priority: 'media',
      status: 'nuova',
      assignee_id: isPersona ? recipientId : null,
      ref_table: refTable,
      ref_id: refId,
      body: body.trim(),
    })
    setSending(false)
    if (error) { alert('Non è stato possibile inviare la richiesta: ' + error.message); return }
    setBody('')
    setRecipient('')
    setMode('commento')
    setSentNotice(isPersona && recipientProfile ? `Richiesta inviata a ${recipientProfile.full_name}.` : 'Richiesta inviata al reparto.')
  }

  // Etichetta del destinatario di un commento già inviato, per mostrarla
  // nella cronologia — niente per i commenti storici "pubblici" (prima di
  // 0043_notifiche_commenti.sql), che non hanno né l'uno né l'altro.
  function recipientLabel(c: RecordComment): string | null {
    if (c.recipient_id) return `→ ${authors.get(c.recipient_id) ?? 'utente'}`
    if (c.recipient_department) return `→ reparto ${c.recipient_department}`
    return null
  }

  return (
    <div className="comment-thread">
      <div className="section-title client-deals-title">Commenti</div>
      {loading && <p className="muted">Caricamento…</p>}
      {!loading && comments.length === 0 && <p className="muted">Nessun commento ancora — il primo lo scrivi tu.</p>}
      <div className="comment-list">
        {comments.map((c) => (
          <div className="comment-row" key={c.id}>
            <div className="comment-head">
              <strong>{authors.get(c.author_id ?? '') ?? 'Utente'}</strong>
              {recipientLabel(c) && <span className="muted comment-recipient">{recipientLabel(c)}</span>}
              <span className="muted">{timeAgo(c.created_at)}</span>
            </div>
            <p>{c.body}</p>
          </div>
        ))}
      </div>
      <form className="comment-form" onSubmit={handleSubmit}>
        {canRequest && (
          <div className="comment-mode-toggle">
            <button type="button" className={mode === 'commento' ? 'active' : ''} onClick={() => setMode('commento')}>
              Commento
            </button>
            <button type="button" className={mode === 'richiesta' ? 'active' : ''} onClick={() => setMode('richiesta')}>
              Richiesta
            </button>
          </div>
        )}
        <select
          className="comment-target-select"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value as Recipient)}
          aria-label="Destinatario"
          required
        >
          <option value="" disabled>
            Scegli il destinatario…
          </option>
          <optgroup label="Persona">
            {profiles
              .filter((p) => p.id !== profile?.id)
              .map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.full_name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Reparto">
            {REQUEST_DEPARTMENTS.map((d) => (
              <option key={d} value={`d:${d}`}>
                {d}
              </option>
            ))}
          </optgroup>
        </select>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={mode === 'commento' ? 'Scrivi il commento…' : 'Scrivi il messaggio della richiesta…'}
        />
        <button className="btn btn-ghost" type="submit" disabled={sending || !body.trim() || !recipient}>
          {sending ? 'Invio…' : mode === 'commento' ? 'Invia commento' : 'Invia richiesta'}
        </button>
      </form>
      {sentNotice && (
        <p className="notice-success">
          {sentNotice}
          {mode === 'richiesta' && (
            <>
              {' '}La trovi anche nella pagina <Link to="/richieste">Richieste</Link>, insieme al collegamento a questa scheda.
            </>
          )}
        </p>
      )}
    </div>
  )
}
