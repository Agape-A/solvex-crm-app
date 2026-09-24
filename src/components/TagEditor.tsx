import { CRM_TAGS } from '../lib/types'

// Selettore di tag a lista fissa: si clicca per selezionare/deselezionare,
// niente più testo libero (l'elenco è lo stesso ovunque — vedi CRM_TAGS in
// src/lib/types.ts — e imposto anche a livello di database in
// 0016_tag_fissi.sql), così il vocabolario resta coerente e i report per tag
// restano affidabili. Obbligatorio almeno un tag: da qui non si può togliere
// l'ultimo rimasto, bisogna prima sceglierne un altro al suo posto.
export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  function toggle(tag: string) {
    if (tags.includes(tag)) {
      if (tags.length <= 1) return
      onChange(tags.filter((t) => t !== tag))
    } else {
      onChange([...tags, tag])
    }
  }

  return (
    <div className="tag-editor">
      <div className="tag-editor-chips">
        {CRM_TAGS.map((tag) => (
          <button
            type="button"
            key={tag}
            className={'tag-pick' + (tags.includes(tag) ? ' selected' : '')}
            onClick={() => toggle(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
      {tags.length === 0 && <span className="notice-error">Seleziona almeno un tag.</span>}
    </div>
  )
}
