-- Solvex CRM — l'eliminazione di un utente deve essere SEMPRE immediata e
-- definitiva, anche se la persona ha storico nel CRM (richiesta di Andrea,
-- ott 2026: "l'eliminazione deve essere immediata e cancellare
-- definitivamente l'account" — confermato dal tentativo diretto da
-- Supabase → Authentication → Users, fallito con "Database error deleting
-- user": il database rifiutava la cancellazione perché alcune tabelle
-- (trattative, richieste, commenti, chat, attività…) puntavano ancora a
-- quell'account e non sapevano cosa fare della riga orfana).
--
-- Da qui in poi, eliminare un account NON elimina lo storico collegato
-- (trattative, richieste, appuntamenti, commenti, chat, log attività,
-- progetti, ricerche, acquisti, attività fornitori/acquisti): quelle righe
-- restano, ma perdono il collegamento alla persona (il campo
-- proprietario/assegnatario/autore diventa vuoto, come già succedeva da
-- tempo per il proprietario di un cliente — vedi 0038/0041). Chi vuole
-- bloccare una persona SENZA perdere quel collegamento continua a usare
-- "Sospendi" invece di "Elimina".

alter table public.deals drop constraint if exists deals_owner_id_fkey;
alter table public.deals add constraint deals_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete set null;

alter table public.requests drop constraint if exists requests_assignee_id_fkey;
alter table public.requests add constraint requests_assignee_id_fkey
  foreign key (assignee_id) references public.profiles(id) on delete set null;

alter table public.activity_log drop constraint if exists activity_log_actor_id_fkey;
alter table public.activity_log add constraint activity_log_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;

alter table public.appointments drop constraint if exists appointments_assignee_id_fkey;
alter table public.appointments add constraint appointments_assignee_id_fkey
  foreign key (assignee_id) references public.profiles(id) on delete set null;

alter table public.record_comments drop constraint if exists record_comments_author_id_fkey;
alter table public.record_comments add constraint record_comments_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;

alter table public.chat_messages drop constraint if exists chat_messages_author_id_fkey;
alter table public.chat_messages add constraint chat_messages_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;

alter table public.development_projects drop constraint if exists development_projects_owner_id_fkey;
alter table public.development_projects add constraint development_projects_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete set null;

alter table public.research_records drop constraint if exists research_records_owner_id_fkey;
alter table public.research_records add constraint research_records_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete set null;

alter table public.purchase_requests drop constraint if exists purchase_requests_requested_by_fkey;
alter table public.purchase_requests add constraint purchase_requests_requested_by_fkey
  foreign key (requested_by) references public.profiles(id) on delete set null;

alter table public.supplier_activities drop constraint if exists supplier_activities_created_by_fkey;
alter table public.supplier_activities add constraint supplier_activities_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.procurement_activities drop constraint if exists procurement_activities_created_by_fkey;
alter table public.procurement_activities add constraint procurement_activities_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
