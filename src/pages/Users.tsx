import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { NAV } from '../components/Layout'
import { ALL_ROLES, hasFullAccess, REQUEST_DEPARTMENTS, ROLE_LABELS, type Profile, type RequestDepartment, type UserRole } from '../lib/types'

// Pagina "Utenti", riservata alla direzione (dirigente/amministrazione):
// invita nuove persone (InviteForm), corregge nome/ruolo/reparto di chi è
// già dentro, sospende/riattiva/elimina un account e decide quali pagine
// vede ciascuna persona (PageAccessEditor) — tutte richieste di Andrea,
// ott 2026 ("dobbiamo inserire tutti gli utenti e le policy", poi
// "darmi la possibilità... di eliminare un user o sospendere, e spuntare
// le pagine che può vedere").
//
// Le pagine che si possono spuntare sono quelle con un "roles" in NAV
// (Layout.tsx) — Dashboard e Chat restano sempre visibili per tutti e non
// compaiono qui. IMPORTANTE: questo controlla solo menu e navigazione, non
// i permessi veri sui dati (quelli restano del ruolo, via RLS) — vedi il
// commento accanto a canSeePage() in Layout.tsx.

function errorMessageFrom(error: { message: string; context?: Response } | null, fallback: string): Promise<string> {
  if (!error) return Promise.resolve(fallback)
  return (async () => {
    try {
      const body = await (error as unknown as { context: Response }).context.json()
      if (body?.error) return body.error as string
    } catch {
      // risposta non JSON: teniamo il messaggio generico di supabase-js
    }
    return error.message ?? fallback
  })()
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('operatore')
  const [department, setDepartment] = useState<RequestDepartment | ''>('')
  const [sending, setSending] = useState(false)

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    const { error } = await supabase.functions.invoke('manage-users', {
      body: {
        action: 'invite',
        full_name: fullName.trim(),
        email: email.trim(),
        role,
        department: department || null,
        redirect_to: window.location.origin,
      },
    })
    setSending(false)

    if (error) {
      alert("Non è stato possibile inviare l'invito: " + (await errorMessageFrom(error, error.message)))
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

// Pagine spuntabili: solo quelle con un ruolo associato in NAV — Dashboard
// e Chat sono sempre visibili per tutti e non si spuntano.
const RESTRICTABLE_PAGES = NAV.filter((item) => item.roles)

function PageAccessEditor({ user, onSave }: { user: Profile; onSave: (pageOverrides: string[] | null) => Promise<void> }) {
  const [custom, setCustom] = useState(user.page_overrides !== null)
  const [selected, setSelected] = useState<string[]>(
    user.page_overrides ?? RESTRICTABLE_PAGES.filter((item) => item.roles!.includes(user.role)).map((item) => item.to),
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(custom ? selected : null)
    setSaving(false)
  }

  return (
    <div className="target-admin-pages">
      <label className="field-checkbox">
        <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
        Personalizza le pagine per questa persona (invece di seguire il ruolo)
      </label>
      {custom && (
        <div className="target-admin-pages-grid">
          {RESTRICTABLE_PAGES.map((item) => (
            <label key={item.to} className="field-checkbox">
              <input
                type="checkbox"
                checked={selected.includes(item.to)}
                onChange={(e) =>
                  setSelected((prev) => (e.target.checked ? [...prev, item.to] : prev.filter((p) => p !== item.to)))
                }
              />
              {item.label}
            </label>
          ))}
        </div>
      )}
      <button className="btn btn-ghost btn-sm" onClick={handleSave} disabled={saving}>
        {saving ? 'Salvataggio…' : 'Salva pagine'}
      </button>
    </div>
  )
}

function UserRow({
  user,
  onSave,
  onSavePages,
  onSuspend,
  onReactivate,
  onDelete,
}: {
  user: Profile
  onSave: (patch: { full_name: string; role: UserRole; department: RequestDepartment | null }) => Promise<void>
  onSavePages: (pageOverrides: string[] | null) => Promise<void>
  onSuspend: () => Promise<void>
  onReactivate: () => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [fullName, setFullName] = useState(user.full_name)
  const [role, setRole] = useState<UserRole>(user.role)
  const [department, setDepartment] = useState<RequestDepartment | ''>(user.department ?? '')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showPages, setShowPages] = useState(false)

  const dirty = fullName !== user.full_name || role !== user.role || (department || null) !== user.department

  async function handleSave() {
    setSaving(true)
    await onSave({ full_name: fullName, role, department: department || null })
    setSaving(false)
  }

  async function handleSuspendToggle() {
    if (user.active && !confirm(`Sospendere ${user.full_name}? Non potrà più accedere, ma tutto il suo storico resta.`)) return
    setBusy(true)
    await (user.active ? onSuspend() : onReactivate())
    setBusy(false)
  }

  async function handleDelete() {
    if (!confirm(`Eliminare per sempre l'account di ${user.full_name}? Non si può annullare.`)) return
    setBusy(true)
    await onDelete()
    setBusy(false)
  }

  return (
    <div className="target-admin-row">
      <div className="target-admin-name">
        <strong>{user.full_name || user.email || '—'}</strong>
        <span className="muted">
          {user.email ?? '—'} · iscritto il {new Date(user.created_at).toLocaleDateString('it-IT')}
          {!user.active && ' · Sospeso'}
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPages((v) => !v)}>
          {showPages ? 'Nascondi pagine' : 'Pagine'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleSuspendToggle} disabled={busy}>
          {user.active ? 'Sospendi' : 'Riattiva'}
        </button>
        <button type="button" className="btn btn-danger-ghost btn-sm" onClick={handleDelete} disabled={busy}>
          Elimina
        </button>
      </div>
      {showPages && <PageAccessEditor user={user} onSave={onSavePages} />}
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

  async function savePages(userId: string, pageOverrides: string[] | null) {
    const { error } = await supabase.from('profiles').update({ page_overrides: pageOverrides }).eq('id', userId)
    if (error) {
      alert("Non è stato possibile salvare le pagine: " + error.message)
      return
    }
    await load()
  }

  async function callManageUsers(action: 'suspend' | 'reactivate' | 'delete', userId: string) {
    const { error } = await supabase.functions.invoke('manage-users', { body: { action, user_id: userId } })
    if (error) {
      const verb = action === 'suspend' ? 'sospendere' : action === 'reactivate' ? 'riattivare' : 'eliminare'
      alert(`Non è stato possibile ${verb} questo utente: ` + (await errorMessageFrom(error, error.message)))
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
        ruolo e il reparto che scegli. Per ciascuna persona già dentro puoi anche sospenderla (blocca l'accesso
        senza perdere il suo storico), eliminarla per sempre (solo se non ha ancora dati collegati) e scegliere
        quali pagine del menu vede, indipendentemente dal ruolo.
      </p>
      <InviteForm onInvited={load} />
      {loading && <p className="muted">Caricamento…</p>}
      {!loading && (
        <div className="card panel target-admin-list">
          {users.length === 0 && <p className="muted">Nessun utente ancora.</p>}
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              onSave={(patch) => saveUser(u.id, patch)}
              onSavePages={(pageOverrides) => savePages(u.id, pageOverrides)}
              onSuspend={() => callManageUsers('suspend', u.id)}
              onReactivate={() => callManageUsers('reactivate', u.id)}
              onDelete={() => callManageUsers('delete', u.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
