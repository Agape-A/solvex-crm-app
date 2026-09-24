-- Solvex CRM — Fase 1 (estensione): tipizzazione clienti
-- Il business reale ha tre canali commerciali distinti — concerie (vendita
-- diretta), distributori/agenti (Italia ed estero), aziende chimiche (che
-- rivendono a marchio proprio) — con logiche di gestione diverse. Questa
-- migration aggiunge i campi per distinguerli; le policy di sicurezza restano
-- quelle già esistenti su "clients" (0002_rls.sql: tecnico sola lettura,
-- commerciale/dirigente piena gestione, operatore nessun accesso).

create type client_type as enum ('conceria', 'distributore', 'azienda_chimica');

alter table public.clients add column if not exists client_type client_type not null default 'conceria';

-- Serve soprattutto per i distributori (Italia vs. estero), ma è utile anche
-- per le altre tipologie: "Italia" come default per i clienti già presenti.
alter table public.clients add column if not exists country text not null default 'Italia';

create index if not exists clients_type_idx on public.clients(client_type);
