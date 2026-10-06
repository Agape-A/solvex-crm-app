import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { IconFlask } from '../components/Icons'

export function Login() {
  const { signInWithOtp, verifyOtpCode } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  // Codice a 6 cifre in alternativa al link (richiesta di Andrea ott 2026):
  // nell'app installata su iPhone/Mac il link via email si apre sempre nel
  // browser normale e non dentro l'app, perché hanno memorie separate. Il
  // codice, letto dall'email e digitato qui, resta dentro la stessa finestra.
  const [code, setCode] = useState('')
  const [codeStatus, setCodeStatus] = useState<'idle' | 'checking' | 'error'>('idle')
  const [codeError, setCodeError] = useState<string | null>(null)

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

  async function handleCodeSubmit(e: FormEvent) {
    e.preventDefault()
    setCodeStatus('checking')
    const { error } = await verifyOtpCode(email, code)
    if (error) {
      setCodeError(error)
      setCodeStatus('error')
    }
    // Se va a buon fine non serve fare nulla qui: onAuthStateChange in
    // AuthContext rileva la nuova sessione e l'app passa da sola alla
    // schermata principale.
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

      {status === 'sent' && (
        <form className="login-card login-card-code" onSubmit={handleCodeSubmit}>
          <p className="muted">
            Se hai installato l'app sulla schermata Home o nel Dock, il link sopra si apre nel
            browser normale, non dentro l'app. Usa invece il codice a 6 cifre che trovi nella
            stessa email:
          </p>
          <label className="field-label" htmlFor="otp-code">
            Codice di accesso
          </label>
          <input
            id="otp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
          />
          <button className="btn" type="submit" disabled={codeStatus === 'checking' || code.trim() === ''}>
            {codeStatus === 'checking' ? 'Verifica in corso…' : 'Conferma codice'}
          </button>
          {codeStatus === 'error' && <p className="notice-error">{codeError}</p>}
        </form>
      )}
    </div>
  )
}
