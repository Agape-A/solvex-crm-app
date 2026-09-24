import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { IconFlask } from '../components/Icons'

export function Login() {
  const { signInWithOtp } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('sending')
    const { error } = await signInWithOtp(email)
    if (error) {
      setError(error)
      setStatus('error')
    } else {
      setStatus('sent')
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand brand-center">
          <span className="brand-mark">
            <IconFlask />
          </span>
          <span className="brand-text">Solvex CRM</span>
        </div>
        <p className="muted">
          Accedi con la tua email aziendale: ti mandiamo un link di accesso, senza
          password.
        </p>
        <label className="field-label" htmlFor="email">
          Email aziendale
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome.cognome@solvex.it"
        />
        <button className="btn btn-primary" type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Invio in corso…' : 'Invia link di accesso'}
        </button>
        {status === 'sent' && (
          <p className="notice-success">Controlla la tua casella: ti abbiamo inviato il link di accesso.</p>
        )}
        {status === 'error' && <p className="notice-error">{error}</p>}
      </form>
    </div>
  )
}
