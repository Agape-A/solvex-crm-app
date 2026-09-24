-- Solvex CRM — Fase 1: schema di base
-- Modello dati come descritto nella Specifica tecnica CRM Solvex

create extension if not exists "pgcrypto"; -- per gen_random_uuid()

-- ============ ENUM ============

create type user_role as enum ('operatore','tecnico','commerciale','dirigente');
create type deal_stage as enum ('lead','qualificato','proposta','trattativa','vinto','perso');
create type request_type as enum ('interna','esterna');
create type request_department as enum ('commerciale','tecnico','operativo','amministrazione');
create type request_priority as enum ('alta','media','bassa');
create type request_status as enum ('nuova','lavorazione','risolta');

-- ============ PROFILES ============
-- Un profilo per ogni utente Supabase Auth. Il ruolo qui è quello che guida
-- sia l'interfaccia sia i permessi reali (vedi 0002_rls.sql).

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'operatore',
  initials text generated always as (
    upper(
      left(split_part(full_name, ' ', 1), 1) ||
      coalesce(left(split_part(full_name, ' ', 2), 1), '')
    )
  ) stored,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Un record per utente Supabase Auth: nome e ruolo aziendale.';

-- ============ CLIENTS ============

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sector text,
  created_at timestamptz not null default now()
);

-- ============ DEALS (pipeline) ============

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null, -- denormalizzato: utile prima che esista una scheda cliente completa
  product text not null,
  value_estimate numeric(12,2) not null default 0,
  stage deal_stage not null default 'lead',
  owner_id uuid references public.profiles(id),
  next_action date,
  requires_tech_validation boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ REQUESTS (richieste interne/esterne) ============

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  sender text not null,
  type request_type not null default 'esterna',
  department request_department not null,
  priority request_priority not null default 'media',
  status request_status not null default 'nuova',
  assignee_id uuid references public.profiles(id),
  body text not null default '',
  source_email_id text, -- popolato in Fase 2 dall'integrazione Microsoft Graph (id del messaggio)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.requests.source_email_id is
  'Id del messaggio Microsoft Graph di origine. Nullo finché la Fase 2 (integrazione email) non è collegata.';

-- ============ ACTIVITY LOG ============
-- Scritto solo dai trigger (vedi 0003_triggers.sql), mai direttamente dal client.

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  event_type text not null,
  ref_table text not null,
  ref_id uuid not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index deals_stage_idx on public.deals(stage);
create index deals_owner_idx on public.deals(owner_id);
create index requests_department_idx on public.requests(department);
create index requests_status_idx on public.requests(status);
create index requests_assignee_idx on public.requests(assignee_id);
create index activity_log_created_idx on public.activity_log(created_at desc);
