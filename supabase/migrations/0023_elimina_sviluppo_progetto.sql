-- Andrea ha chiesto di eliminare del tutto il modulo "Sviluppo progetto":
-- pagina, voce di menu E i dati in database (non un semplice
-- nascondimento). "Ricerche" resta e viene rinominata "Ricerca&Sviluppo"
-- (solo lato interfaccia — vedi commit del codice, nessuna migrazione
-- necessaria per quella parte: cambia solo un'etichetta).
--
-- "development_projects" e "research_records" avevano campi troppo diversi
-- per essere la stessa tabella (vedi la 0013), quindi non c'è nulla da
-- "spostare" dentro Ricerche: i progetti registrati finora vengono persi
-- con questa migrazione. Se preferisci un'ultima copia prima di eseguirla,
-- esporta la tabella "development_projects" dalla dashboard Supabase
-- (Table Editor → development_projects → Export as CSV) PRIMA di lanciare
-- questo file.
--
-- "drop table ... cascade" si porta via da sola le policy, gli indici e i
-- trigger della tabella; restano da togliere a mano solo la funzione
-- trigger dedicata e l'enum "project_stage" (non condivisi da nient'altro).
-- Le richieste già collegate con ref_table='development_projects' (vedi
-- requests.ref_table) restano nello storico ma il link non porterà più a
-- nessuna scheda — è lo stesso comportamento di un cliente o un fornitore
-- eliminato altrove nel CRM.

drop table if exists public.development_projects cascade;
drop function if exists public.log_development_project_activity();
drop type if exists public.project_stage;
