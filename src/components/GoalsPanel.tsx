import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { AnnualTarget } from '../lib/types'

// Pannello "I tuoi obiettivi": mostra a chiunque abbia almeno un obiettivo
// assegnato dalla direzione per l'anno indicato la barra di avanzamento, e
// gli permette di aggiornare lui stesso il numero raggiunto finora — non
// c'è nessun dato del CRM da cui calcolarlo in automatico per un obiettivo
// con titolo libero, quindi l'avanzamento è quello che la persona (o la
// direzione) inserisce. Usato sia in Dashboard che in Report, per lo stesso
// utente che sta guardando la pagina (mai per gli obiettivi di altri: la RLS
// lo impedirebbe comunque).

function GoalBar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
  return (
    <div className="barlist-track">
      <div className="barlist-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
    </div>
  )
}

function GoalRow({ goal, onUpdate }: { goal: AnnualTarget; onUpdate: (currentValue: number) => Promise<void> }) {
  const [value, setValue] = useState(goal.current_value)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(goal.current_value)
  }, [goal.current_value])

  async function handleSave() {
    setSaving(true)
    await onUpdate(value)
    setSaving(false)
  }

  const pct = goal.target_value > 0 ? Math.min(100, Math.round((value / goal.target_value) * 100)) : 0
  const unitSuffix = goal.unit ? ` ${goal.unit}` : ''

  return (
    <div className="target-progress">
      <div className="target-progress-head">
        <span>{goal.title}</span>
        <span className="muted">
          {value}
          {unitSuffix} di {goal.target_value}
          {unitSuffix} ({pct}%)
        </span>
      </div>
      <GoalBar value={value} target={goal.target_value} />
      <div className="goal-update-row">
        <input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} />
        <button className="btn btn-ghost" onClick={handleSave} disabled={saving || value === goal.current_value}>
          {saving ? 'Salvataggio…' : 'Aggiorna avanzamento'}
        </button>
      </div>
      {goal.note && <p className="muted">{goal.note}</p>}
    </div>
  )
}

export function OwnGoalsPanel({ userId, year }: { userId: string; year: number }) {
  const [goals, setGoals] = useState<AnnualTarget[]>([])
  const [loaded, setLoaded] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('annual_targets')
      .select('*')
      .eq('user_id', userId)
      .eq('year', year)
      .order('created_at')
    setGoals((data as AnnualTarget[]) ?? [])
    setLoaded(true)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, year])

  async function updateProgress(goal: AnnualTarget, currentValue: number) {
    const { error } = await supabase.from('annual_targets').update({ current_value: currentValue }).eq('id', goal.id)
    if (error) {
      alert("Non è stato possibile aggiornare l'avanzamento: " + error.message)
      return
    }
    load()
  }

  if (!loaded || goals.length === 0) return null

  return (
    <div className="card panel">
      <div className="section-title">I tuoi obiettivi {year}</div>
      {goals.map((g) => (
        <GoalRow key={g.id} goal={g} onUpdate={(v) => updateProgress(g, v)} />
      ))}
    </div>
  )
}
