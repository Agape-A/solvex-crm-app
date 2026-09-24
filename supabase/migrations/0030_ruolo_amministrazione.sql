-- Solvex CRM — nuovo ruolo "amministrazione"
-- Da eseguire DA SOLO, come blocco a sé, PRIMA della migrazione 0031 che lo
-- usa nelle policy di permesso — stesso motivo di 0012_nuovi_ruoli.sql:
-- Postgres non permette di usare un nuovo valore di un enum nella stessa
-- transazione in cui è stato aggiunto, e l'SQL Editor di Supabase esegue
-- tutto il testo incollato in un'unica transazione.
--
-- Il reparto amministrazione è "assimilabile ai dirigenti": stesso accesso
-- completo a tutte le pagine e a tutti i dati (vedi 0031), ma con
-- un'etichetta propria nella pagina Utenti, per distinguerlo dalla
-- direzione nell'elenco del personale.

alter type public.user_role add value if not exists 'amministrazione';
