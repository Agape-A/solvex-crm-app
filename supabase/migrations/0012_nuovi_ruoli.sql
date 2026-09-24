-- Solvex CRM — Fase 2: nuovi ruoli utente
-- Da eseguire DA SOLO, come blocco a sé, PRIMA della migrazione 0013 che lo
-- segue. Motivo: Postgres non permette di usare un nuovo valore di un enum
-- ("dottore_laboratorio", "ufficio_acquisti") nella stessa transazione in
-- cui è stato aggiunto — e l'SQL Editor di Supabase esegue tutto il testo
-- incollato in un'unica transazione. La 0013 usa questi due valori nelle
-- policy di permesso, quindi se venisse incollata insieme a questa nella
-- stessa esecuzione darebbe errore ("unsafe use of new value of enum
-- type"). Eseguendoli in due passaggi separati, il problema non si pone:
-- quando la 0013 parte, i nuovi ruoli sono già confermati nel database.

alter type public.user_role add value if not exists 'dottore_laboratorio';
alter type public.user_role add value if not exists 'ufficio_acquisti';
