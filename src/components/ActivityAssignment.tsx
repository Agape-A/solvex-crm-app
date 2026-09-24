import { supabase } from '../lib/supabaseClient'
import type { PendingAssignment, Profile, RequestDepartment, Urgenza } from '../lib/types'

// Blocco riusabile "Assegnazione attività a": selezione multipla di persone,
// con per ciascuna un'attività da svolgere e una scadenza. Usato ovunque un
// tipo di attività guidata preveda la possibilità di coinvolgere subito
// altre persone (Pipeline, e in seguito Fornitori) — vedi "Schema Nuova
// Pipeline" di Andrea: ogni assegnazione diventa una vera richiesta,
// collegata al record di origine e assegnata a quella persona, così compare
// anche nel suo calendario (le richieste con scadenza sono già lette dal
// Calendario — vedi 0004_calendar.sql) e non si perde.
export function ActivityAssignment({
  profiles,
  assignments,
  onChange,
}: {
  profiles: Profile[]
  assignments: PendingAssignment[]
  onChange: (assignments: PendingAssignment[]) => void
}) {
  function toggleUser(id: string) {
    if (assignments.some((a) => a.userId === id)) {
      onChange(assignments.filter((a) => a.userId !== id))
    } else {
      onChange([...assignments, { userId: id, task: '', dueDate: '' }])
    }
  }

  function updateAssignment(id: string, patch: Partial<PendingAssignment>) {
    onChange(assignments.map((a) => (a.userId === id ? { ...a, ...patch } : a)))
  }

  return (
    <div className="assignment-editor">
      <span className="field-label">Assegnazione attività a (facoltativo)</span>
      <span className="muted">
        Per ogni persona scelta si apre un'attività da svolgere con una scadenza — diventerà una richiesta
        calendarizzata per lei, così non si perde.
      </span>
      <div className="tag-editor-chips">
        {profiles.map((p) => (
          <button
            type="button"
            key={p.id}
            className={'tag-pick' + (assignments.some((a) => a.userId === p.id) ? ' selected' : '')}
            onClick={() => toggleUser(p.id)}
          >
            {p.full_name}
          </button>
        ))}
        {profiles.length === 0 && <span className="muted">Nessuna persona disponibile.</span>}
      </div>

      {assignments.map((a) => {
        const person = profiles.find((p) => p.id === a.userId)
        return (
          <div className="assignment-row" key={a.userId}>
            <span className="assignment-row-name">{person?.full_name ?? '—'}</span>
            <div className="field-row-2">
              <div className="field-row">
                <label className="field-label">Attività da svolgere</label>
                <input value={a.task} onChange={(e) => updateAssignment(a.userId, { task: e.target.value })} required />
              </div>
              <div className="field-row">
                <label className="field-label">Scadenza</label>
                <input
                  type="date"
                  value={a.dueDate}
                  onChange={(e) => updateAssignment(a.userId, { dueDate: e.target.value })}
                  required
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Traduce le assegnazioni compilate nel form in vere righe della tabella
// "requests" — una per persona — collegate al record di origine (il lead,
// domani anche una richiesta fornitore) tramite ref_table/ref_id. Il subject
// già indica di che tipo di attività si tratta, quindi non serve più anche
// un tag (l'interfaccia non li usa più — torneranno più avanti, con un
// disegno da rivedere). Il reparto della richiesta è quello della persona
// assegnata quando lo ha già impostato (vedi profiles.department),
// altrimenti "commerciale" come impostazione di partenza ragionevole per
// attività nate dalla Pipeline.
export async function createActivityAssignments({
  assignments,
  profiles,
  refTable,
  refId,
  subject,
  createdByName,
  priority,
}: {
  assignments: PendingAssignment[]
  profiles: Profile[]
  refTable: string
  refId: string
  subject: string
  createdByName: string
  priority?: Urgenza
}): Promise<{ error: string | null }> {
  for (const a of assignments) {
    const person = profiles.find((p) => p.id === a.userId)
    const department: RequestDepartment = person?.department ?? 'commerciale'
    const { error } = await supabase.from('requests').insert({
      subject,
      sender: createdByName,
      type: 'interna',
      department,
      priority: priority || 'media',
      assignee_id: a.userId,
      ref_table: refTable,
      ref_id: refId,
      body: a.task,
      due_date: a.dueDate || null,
    })
    if (error) return { error: error.message }
  }
  return { error: null }
}
