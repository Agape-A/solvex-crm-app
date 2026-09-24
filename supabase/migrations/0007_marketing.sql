-- Solvex CRM — Fase 1 (estensione): newsletter / marketing
-- Tre tabelle: liste, contatti marketing (possono essere referenti di
-- clienti già in anagrafica, oppure contatti esterni non ancora clienti —
-- es. biglietti da visita raccolti in fiera) e l'appartenenza contatto→lista
-- (un contatto può stare in più liste).
--
-- Importante lato privacy: importare un referente da un cliente NON implica
-- automaticamente il consenso al marketing — è un rapporto commerciale
-- diverso dal consenso esplicito richiesto per l'invio di newsletter. Per
-- questo consent_marketing parte sempre a "false" anche per i contatti
-- importati dai clienti: va attivato esplicitamente, con data, da chi usa
-- il CRM. L'invio vero e proprio delle newsletter non è ancora collegato
-- (dipende dalla connessione email, ancora da configurare) — per ora questa
-- parte serve a organizzare le liste e tracciare il consenso, con
-- un'esportazione CSV per usare uno strumento di invio esterno nel frattempo.

create table public.marketing_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table public.marketing_contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  company text,
  client_id uuid references public.clients(id) on delete set null,
  source text not null default 'altro', -- 'referente_cliente' | 'fiera' | 'sito_web' | 'altro'
  consent_marketing boolean not null default false,
  consent_date timestamptz,
  consent_note text not null default '',
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_contacts add constraint marketing_contacts_email_key unique (email);

create table public.marketing_list_members (
  list_id uuid not null references public.marketing_lists(id) on delete cascade,
  contact_id uuid not null references public.marketing_contacts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, contact_id)
);

create index marketing_contacts_client_idx on public.marketing_contacts(client_id);
create index marketing_list_members_contact_idx on public.marketing_list_members(contact_id);

-- ============ RLS ============
-- Solo commerciale/dirigente: è materiale commerciale/marketing, non
-- rilevante per tecnico e operatore (stessa logica già usata per clients).

alter table public.marketing_lists enable row level security;
alter table public.marketing_contacts enable row level security;
alter table public.marketing_list_members enable row level security;

create policy "marketing_lists_all" on public.marketing_lists
  for all
  using (public.current_role() in ('commerciale', 'dirigente'))
  with check (public.current_role() in ('commerciale', 'dirigente'));

create policy "marketing_contacts_all" on public.marketing_contacts
  for all
  using (public.current_role() in ('commerciale', 'dirigente'))
  with check (public.current_role() in ('commerciale', 'dirigente'));

create policy "marketing_list_members_all" on public.marketing_list_members
  for all
  using (public.current_role() in ('commerciale', 'dirigente'))
  with check (public.current_role() in ('commerciale', 'dirigente'));

create trigger marketing_contacts_before_update
  before update on public.marketing_contacts
  for each row execute function public.touch_updated_at();
