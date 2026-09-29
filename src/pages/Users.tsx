import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { ALL_ROLES, REQUEST_DEPARTMENTS, ROLE_LABELS, type Profile, type RequestDepartment, type UserRole } from '../lib/types'

// Pagina "Utenti", riservata alla direzione: qui si corregge il nome e il
// ruolo di chi è già stato invitato. Creare un nuovo account resta un
// passaggio da fare a mano dal pannello Supabase (Authentication → Users →
// Invite), perché richiede privilegi che il CRM non può avere lato browser
// — vedi le istruzioni mandate a parte. Una volta che la persona esiste,
// compare qui con il ruolo di default "Operatore" e va corretta.

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
        <strong>{user.email ?? '—'}</strong>
        <span className="muted">iscritto il {new Date(user.created_at).toLocaleDateString('it-IT')}</span>
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

  if (profile?.role !== 'dirigente') {
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
        Per aggiungere una nuova persona, invitala dal pannello Supabase (Authentication → Users → Invite
        user): le arriverà un'email con il link di accesso. Una volta accettato l'invito, compare qui sotto
        con il ruolo "Operatore" — correggilo con quello giusto.
      </p>
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
