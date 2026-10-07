import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { ALL_ROLES, hasFullAccess, REQUEST_DEPARTMENTS, ROLE_LABELS, type Profile, type RequestDepartment, type UserRole } from '../lib/types'

// Pagina "Utenti", riservata alla direzione (dirigente/amministrazione):
// qui si invita una nuova persona via email con ruolo e reparto già giusti
// (InviteForm, sotto — richiesta di Andrea, ott 2026: "dobbiamo inserire
// tutti gli utenti e le policy"), e si corregge nome/ruolo/reparto di chi è
// già dentro (UserRow). Prima, creare un account richiedeva aprire Supabase
// e usare Authentication → Users → Invite a mano — ora basta questa pagina.

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('operatore')
  const [department, setDepartment] = useState<RequestDepartment | ''>('')
  const [sending, setSending] = useState(false)

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: {
        full_name: fullName.trim(),
        email: email.trim(),
        role,
        department: department || null,
        redirect_to: window.location.origin,
      },
    })
    setSending(false)

    if (error) {
      // La funzione risponde con un messaggio chiaro nel corpo anche sugli
      // errori (es. "Questa email ha già un account.") — proviamo a
      // leggerlo, altrimenti mostriamo il messaggio generico di supabase-js.
      let message = error.message
      try {
        const body = await (error as unknown as { context: Response }).context.json()
        if (body?.error) message = body.error
      } catch {
        // risposta non JSON: teniamo il messaggio generico
      }
      alert("Non è stato possibile inviare l'invito: " + message)
      return
    }

    alert(`Invito inviato a ${email.trim()}. Riceverà un'email con il link per accedere.`)
    setFullName('')
    setEmail('')
    setRole('operatore')
    setDepartment('')
    onInvited()
  }

  return (
    <form className="card panel goal-add-form" onSubmit={handleInvite}>
      <div className="field-row">
        <label className="field-label">Nome e cognome</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Es. Maria Rossi" />
      </div>
      <div className="field-row">
        <label className="field-label">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="maria.rossi@email.it" />
      </div>
      <div className="field-row">
        <label className="field-label">Ruolo</label>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label className="field-label">Reparto</label>
        <select value={department} onChange={(e) => setDepartment(e.target.value as RequestDepartment | '')} title="Reparto (per l'assegnazione delle richieste)">
          <option value="">— Nessun reparto —</option>
          {REQUEST_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <button className="btn btn-primary" type="submit" disabled={sending}>
        {sending ? 'Invio…' : 'Invita'}
      </button>
    </form>
  )
}

function UserRow({
  user,
  onSave,
}: {
  user: Profile
  onSave: (patch: { full_name: string; role: UserRole; department: RequestDepartment | null }) => Promise<void>
}) {
  const [fullName, setFullName] = useState(user.full_name)
  const [role, setRole] = useState<UserRole>(user.role)
  const [department, setDepartment] = useState<RequestDepartment | ''>(user.department ?? '')
  const [saving, setSaving] = useState(false)

  const dirty = fullName !== user.full_name || role !== user.role || (department || null) !== user.department

  async function handleSave() {
    setSaving(true)
    await onSave({ full_name: fullName, role, department: department || null })
    setSaving(false)
  }

  return (
    <div className="target-admin-row">
      <div className="target-admin-name">
        <strong>{user.full_name || user.email || '—'}</strong>
        <span className="muted">
          {user.email ?? '—'} · iscritto il {new Date(user.created_at).toLocaleDateString('it-IT')}
        </span>
      </div>
      <div className="target-admin-inputs">
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome e cognome" />
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <select value={department} onChange={(e) => setDepartment(e.target.value as RequestDepartment | '')} title="Reparto (per l'assegnazione delle richieste)">
          <option value="">— Nessun reparto —</option>
          {REQUEST_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Salvataggio…' : 'Salva'}
        </button>
      </div>
    </div>
  )
}

export function Users() {
  const { profile } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers((data as Profile[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function saveUser(userId: string, patch: { full_name: string; role: UserRole; department: RequestDepartment | null }) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
    if (error) {
      alert("Non è stato possibile salvare le modifiche: " + error.message)
      return
    }
    await load()
  }

  if (!hasFullAccess(profile?.role)) {
    return (
      <div className="view">
        <p className="muted">Questa pagina è riservata alla direzione.</p>
      </div>
    )
  }

  return (
    <div className="view">
      <div className="view-head">
        <h1>Utenti</h1>
      </div>
      <p className="muted">
        Invita una nuova persona dal modulo qui sotto: le arriverà un'email con il link per accedere, già con il
        ruolo e il reparto che scegli — non più "Operatore" di default da correggere dopo.
      </p>
      <InviteForm onInvited={load} />
      {loading && <p className="muted">Caricamento…</p>}
      {!loading && (
        <div className="card panel target-admin-list">
          {users.length === 0 && <p className="muted">Nessun utente ancora.</p>}
          {users.map((u) => (
            <UserRow key={u.id} user={u} onSave={(patch) => saveUser(u.id, patch)} />
          ))}
        </div>
      )}
    </div>
  )
}
