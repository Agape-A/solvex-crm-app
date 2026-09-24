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

// "pubblico" = commento normale (record_comments, visibile a tutti quelli che
// vedono il record); "p:<id>" = richiesta a una persona precisa; "d:<reparto>"
// = richiesta a un intero reparto. Stessa area "Commenti", niente più una
// finestra separata: chi scrive sceglie il destinatario lì per lì e il
// messaggio parte come commento o come richiesta collegata a questo stesso
// record, senza dover ripetere la scelta del record (è già refTable/refId).
type Target = 'pubblico' | `p:${string}` | `d:${string}`

export function CommentThread({
  refTable,
  refId,
  refLabel,
}: {
  refTable: CommentRefTable
  refId: string
  refLabel?: string
}) {
  const { profile } = useAuth()
  const [comments, setComments] = useState<RecordComment[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [authors, setAuthors] = useState<Map<string, string>>(new Map())
  const [body, setBody] = useState('')
  const [target, setTarget] = useState<Target>('pubblico')
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !body.trim()) return
    setSending(true)
    setSentNotice(null)

    if (target === 'pubblico') {
      const { error } = await supabase.from('record_comments').insert({ ref_table: refTable, ref_id: refId, author_id: profile.id, body: body.trim() })
      setSending(false)
      if (error) { alert('Non è stato possibile pubblicare il commento: ' + error.message); return }
      setBody('')
      return
    }

    const isPersona = target.startsWith('p:')
    const recipientId = isPersona ? target.slice(2) : ''
    const recipient = isPersona ? profiles.find((p) => p.id === recipientId) ?? null : null
    const department: RequestDepartment = isPersona ? recipient?.department ?? 'amministrazione' : (target.slice(2) as RequestDepartment)
    const subject = refLabel ? `Richiesta su ${refLabel}` : 'Richiesta collegata'

    const { error } = await supabase.from('requests').insert({
      subject,
      sender: profile.full_name,
      type: 'interna',
      department,
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
    setSentNotice(isPersona && recipient ? `Richiesta inviata a ${recipient.full_name}.` : 'Richiesta inviata al reparto.')
    setTarget('pubblico')
  }

  return (
    <div className="comment-thread">
      <div className="section-title client-deals-title">Commenti</div>
      {loading && <p className="muted">Caricamento…</p>}
      {!loading && comments.length === 0 && <p className="muted">Nessun commento ancora — il primo lo scrivi tu.</p>}
      <div className="comment-list">
        {comments.map((c) => (
          <div className="comment-row" key={c.id}>
            <div className="comment-head"><strong>{authors.get(c.author_id ?? '') ?? 'Utente'}</strong><span className="muted">{timeAgo(c.created_at)}</span></div>
            <p>{c.body}</p>
          </div>
        ))}
      </div>
      <form className="comment-form" onSubmit={handleSubmit}>
        {canRequest && (
          <select
            className="comment-target-select"
            value={target}
            onChange={(e) => setTarget(e.target.value as Target)}
            aria-label="Destinatario"
          >
            <option value="pubblico">Commento pubblico</option>
            <optgroup label="Manda come richiesta a…">
              {profiles.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.full_name}
                </option>
              ))}
            </optgroup>
            <optgroup label="…o a un reparto">
              {REQUEST_DEPARTMENTS.map((d) => (
                <option key={d} value={`d:${d}`}>
                  {d}
                </option>
              ))}
            </optgroup>
          </select>
        )}
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={target === 'pubblico' ? 'Scrivi un commento per i colleghi…' : 'Scrivi il messaggio della richiesta…'}
        />
        <button className="btn btn-ghost" type="submit" disabled={sending || !body.trim()}>
          {sending ? 'Invio…' : target === 'pubblico' ? 'Invia' : 'Invia richiesta'}
        </button>
      </form>
      {sentNotice && (
        <p className="notice-success">
          {sentNotice} La trovi anche nella pagina <Link to="/richieste">Richieste</Link>, insieme al collegamento a questa scheda.
        </p>
      )}
    </div>
  )
}
