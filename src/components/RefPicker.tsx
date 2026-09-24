import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  REQUEST_REF_LABELS,
  REQUEST_REF_ROLES,
  REQUEST_REF_TABLES,
  fetchRefOptions,
  type RefOption,
  type RequestRefTable,
} from '../lib/refRecords'

// Selettore "Collega a un record" riutilizzabile: prima si sceglie il tipo
// (trattativa, cliente, progetto...), poi il record specifico — usato sia
// nel form "Manda una richiesta" in Chat sia nel form Nuova richiesta in
// Richieste. Mostra solo i tipi di record a cui il proprio ruolo ha accesso,
// per non offrire un menu che risulterebbe comunque vuoto.
export function RefPicker({
  table,
  refId,
  onChangeTable,
  onChangeId,
}: {
  table: RequestRefTable | ''
  refId: string
  onChangeTable: (table: RequestRefTable | '') => void
  onChangeId: (id: string) => void
}) {
  const { profile } = useAuth()
  const [options, setOptions] = useState<RefOption[]>([])
  const [loading, setLoading] = useState(false)

  const availableTables = REQUEST_REF_TABLES.filter((t) => profile && REQUEST_REF_ROLES[t].includes(profile.role))

  useEffect(() => {
    if (!table) {
      setOptions([])
      return
    }
    setLoading(true)
    fetchRefOptions(table).then((opts) => {
      setOptions(opts)
      setLoading(false)
    })
  }, [table])

  return (
    <div className="field-row-2">
      <div className="field-row">
        <label className="field-label">Collega a (facoltativo)</label>
        <select
          value={table}
          onChange={(e) => {
            onChangeTable(e.target.value as RequestRefTable | '')
            onChangeId('')
          }}
        >
          <option value="">— nessun collegamento —</option>
          {availableTables.map((t) => (
            <option key={t} value={t}>
              {REQUEST_REF_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      {table && (
        <div className="field-row">
          <label className="field-label">{REQUEST_REF_LABELS[table]}</label>
          <select value={refId} onChange={(e) => onChangeId(e.target.value)} required>
            <option value="">{loading ? 'Caricamento…' : '— seleziona —'}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {!loading && options.length === 0 && (
            <span className="muted">Nessun record disponibile in questo modulo.</span>
          )}
        </div>
      )}
    </div>
  )
}
