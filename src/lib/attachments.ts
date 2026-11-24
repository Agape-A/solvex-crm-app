import { supabase } from './supabaseClient'

// Prima dell'audit di sicurezza (nov 2026) i bucket di allegati erano
// pubblici: il database conserva ancora, per ogni allegato caricato
// prima di allora, l'indirizzo pubblico permanente di quel momento
// (.../storage/v1/object/public/<bucket>/<percorso>). Ora che i bucket
// sono privati quell'indirizzo non funziona più da solo — serve il
// percorso del file per generare un indirizzo firmato e a scadenza ogni
// volta che l'allegato viene aperto. Questa funzione riconosce entrambi i
// formati (il vecchio indirizzo pubblico e il nuovo, che è già solo un
// percorso), così gli allegati caricati prima di questo cambiamento
// restano apribili senza bisogno di aggiornare i dati già salvati.
function pathFromStored(bucket: string, stored: string): string {
  const marker = `/object/public/${bucket}/`
  const idx = stored.indexOf(marker)
  if (idx === -1) return stored
  try {
    return decodeURIComponent(stored.slice(idx + marker.length))
  } catch {
    return stored.slice(idx + marker.length)
  }
}

// Apre un allegato in una nuova scheda del browser, generando l'indirizzo
// firmato al momento del click (valido un'ora): da bucket privato non
// esiste più un indirizzo permanente da salvare o condividere liberamente.
// La scheda si apre PRIMA della chiamata asincrona a Supabase, altrimenti
// i browser bloccano il popup perché non arriverebbe più in risposta
// diretta al click dell'utente.
export async function openAttachment(bucket: string, stored: string | null | undefined): Promise<void> {
  if (!stored) return
  const win = window.open('', '_blank')
  const path = pathFromStored(bucket, stored)
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
  if (error || !data?.signedUrl) {
    win?.close()
    alert("Non è stato possibile aprire l'allegato: " + (error?.message ?? 'errore sconosciuto'))
    return
  }
  if (win) {
    win.location.href = data.signedUrl
  } else {
    window.open(data.signedUrl, '_blank')
  }
}
