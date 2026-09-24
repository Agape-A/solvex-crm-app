import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'

// Pagina pubblica, senza login — chi apre il link si iscrive da solo alla
// newsletter. L'inserimento è permesso a chiunque (anche non autenticato)
// solo con questa forma esatta di dati, vedi la policy
// "marketing_contacts_public_signup" in 0008_marketing_pro.sql: consenso a
// true, con data, provenienza "sito_web". Nessun altro accesso è concesso.

export function PublicSignup() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!consent) {
      setError('Per iscriverti devi acconsentire a ricevere comunicazioni via email.')
      return
    }
    setError('')
    setSaving(true)
    const { error: insertError } = await supabase.from('marketing_contacts').insert({
      full_name: fullName,
      email: email.trim().toLowerCase(),
      company: company || null,
      source: 'sito_web',
      consent_marketing: true,
      consent_date: new Date().toISOString(),
      consent_note: 'Iscrizione tramite modulo pubblico',
    })
    setSaving(false)
    if (insertError) {
      if (insertError.code === '23505') {
        // email già presente: non aggiorniamo nulla da qui (nessun permesso
        // di update per un utente non autenticato) — mostriamo comunque un
        // messaggio di successo, così da non rivelare a un estraneo se
        // quell'indirizzo è già nella nostra anagrafica.
        setDone(true)
        return
      }
      setError('Non è stato possibile completare l\'iscrizione. Riprova più tardi.')
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="brand">Solvex</div>
          <p className="notice-success">Iscrizione registrata. Grazie!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand">Solvex</div>
        <p className="muted">Iscriviti per ricevere aggiornamenti su prodotti e novità.</p>

        <label className="field-label">Nome e cognome</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />

        <label className="field-label">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label className="field-label">Azienda (facoltativa)</label>
        <input value={company} onChange={(e) => setCompany(e.target.value)} />

        <label className="field-label signup-consent-label">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Acconsento a ricevere comunicazioni di marketing via email. Puoi disiscriverti in qualsiasi momento
          scrivendoci.
        </label>

        {error && <p className="notice-error">{error}</p>}

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Invio…' : 'Iscrivimi'}
        </button>
      </form>
    </div>
  )
}
