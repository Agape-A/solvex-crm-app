-- Solvex CRM — Fase 1 (estensione): importazione anagrafica clienti + referente
-- Due cose:
-- 1) un "codice cliente ERP" facoltativo, così la funzione di importazione da
--    Excel/CSV nella pagina Clienti può fare un vero aggiornamento (upsert)
--    invece di duplicare le righe ogni volta che si ricarica l'anagrafica
--    aggiornata dal gestionale;
-- 2) i dati del referente principale (nome, email, telefono), utili sia per
--    l'importazione sia per l'inserimento manuale di un cliente.
--
-- Un vincolo di unicità standard su una colonna nullable in Postgres
-- permette comunque più righe con external_id NULL (due NULL non sono mai
-- considerati "uguali" ai fini del vincolo): i clienti creati a mano dentro
-- il CRM, senza codice ERP, continuano a funzionare senza problemi.

alter table public.clients add column if not exists external_id text;

alter table public.clients
  add constraint clients_external_id_key unique (external_id);

alter table public.clients add column if not exists contact_name text;
alter table public.clients add column if not exists contact_email text;
alter table public.clients add column if not exists contact_phone text;
