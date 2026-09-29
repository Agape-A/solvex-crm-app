-- Solvex CRM — nuovo reparto "Ricerca&Sviluppo" (richiesta di Andrea, set 2026)
-- Da eseguire DA SOLO, come blocco a sé, PRIMA della 0035 che lo usa — stesso
-- motivo di 0030_ruolo_amministrazione.sql/0032_dipartimento_acquisti.sql:
-- Postgres non permette di usare un nuovo valore di un enum nella stessa
-- transazione in cui è stato aggiunto, e l'SQL Editor di Supabase esegue
-- tutto il testo incollato in un'unica transazione.
--
-- Finora "dottore_laboratorio" (Ricerca&Sviluppo) era solo un ruolo, senza un
-- reparto vero e proprio (il campo "department" dei profili non aveva un
-- valore per loro) — quindi non potevano avere un canale Chat dedicato né
-- ricevere richieste indirizzate a tutto il reparto, solo quelle assegnate a
-- una persona precisa.

alter type request_department add value if not exists 'ricerca';
