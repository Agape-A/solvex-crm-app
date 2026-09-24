-- Solvex CRM — Fase 2: pagine dedicate per ruolo
-- Da eseguire DOPO 0012_nuovi_ruoli.sql (che aggiunge i due ruoli usati qui
-- sotto — vedi il commento in quel file per il perché della separazione).
--
-- Tre nuovi moduli, ciascuno visibile solo a chi ha il ruolo giusto:
-- 1) Sviluppo progetto — per il ruolo "tecnico" già esistente (nessun ruolo
--    nuovo: chi oggi vede pipeline/calendario come tecnico vede anche questo);
-- 2) Ricerche — per il nuovo ruolo "dottore_laboratorio";
-- 3) Acquisti (fornitori + richieste d'acquisto) — per il nuovo ruolo
--    "ufficio_acquisti".
-- "dirigente" vede sempre tutto, come nel resto del CRM.
--
-- Ogni pezzo è scritto per essere sicuro da rieseguire (drop/if-not-exists
-- prima di ogni create), come tutte le migrazioni successive alla 0009.

-- ============ 1) Sviluppo progetto (ruolo "tecnico" + "dirigente") ============
-- "create type" non ha una forma "if not exists": il controllo va fatto a
-- mano su pg_type, altrimenti rieseguire il file darebbe sempre errore
-- "type already exists" (lo stesso problema visto con le policy in 0009).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_stage') then
    create type public.project_stage as enum ('formulazione', 'test', 'validazione', 'completato', 'sospeso');
  end if;
end $$;

create table if not exists public.development_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid references public.clients(id) on delete set null,
  product text not null default '',
  stage public.project_stage not null default 'formulazione',
  owner_id uuid references public.profiles(id),
  due_date date,
  note text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists development_projects_stage_idx on public.development_projects(stage);
create index if not exists development_projects_owner_idx on public.development_projects(owner_id);
create index if not exists development_projects_client_idx on public.development_projects(client_id);
create index if not exists development_projects_tags_idx on public.development_projects using gin (tags);

alter table public.development_projects enable row level security;

drop policy if exists "development_projects_select" on public.development_projects;
create policy "development_projects_select" on public.development_projects
  for select using (public.current_role() in ('tecnico', 'dirigente'));

drop policy if exists "development_projects_insert" on public.development_projects;
create policy "development_projects_insert" on public.development_projects
  for insert with check (public.current_role() in ('tecnico', 'dirigente'));

drop policy if exists "development_projects_update" on public.development_projects;
create policy "development_projects_update" on public.development_projects
  for update
  using (public.current_role() in ('tecnico', 'dirigente'))
  with check (public.current_role() in ('tecnico', 'dirigente'));

drop policy if exists "development_projects_delete" on public.development_projects;
create policy "development_projects_delete" on public.development_projects
  for delete using (public.current_role() in ('tecnico', 'dirigente'));

create or replace trigger development_projects_before_update
  before update on public.development_projects
  for each row execute function public.touch_updated_at();

create or replace function public.log_development_project_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'project_created', 'development_projects', new.id, 'Nuovo progetto di sviluppo: ' || new.name);
  elsif tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'project_stage_changed', 'development_projects', new.id, new.name || ' — fase: ' || new.stage);
  end if;
  return new;
end;
$$;

create or replace trigger development_projects_activity
  after insert or update on public.development_projects
  for each row execute function public.log_development_project_activity();

-- ============ 2) Ricerche (ruolo "dottore_laboratorio" + "dirigente") ============

do $$
begin
  if not exists (select 1 from pg_type where typname = 'research_status') then
    create type public.research_status as enum ('in_corso', 'completata', 'sospesa');
  end if;
end $$;

create table if not exists public.research_records (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  objective text not null default '',
  protocol text not null default '',
  results text not null default '',
  status public.research_status not null default 'in_corso',
  client_id uuid references public.clients(id) on delete set null,
  product text not null default '',
  owner_id uuid references public.profiles(id),
  attachment_url text,
  attachment_name text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists research_records_status_idx on public.research_records(status);
create index if not exists research_records_owner_idx on public.research_records(owner_id);
create index if not exists research_records_client_idx on public.research_records(client_id);
create index if not exists research_records_tags_idx on public.research_records using gin (tags);

alter table public.research_records enable row level security;

drop policy if exists "research_records_select" on public.research_records;
create policy "research_records_select" on public.research_records
  for select using (public.current_role() in ('dottore_laboratorio', 'dirigente'));

drop policy if exists "research_records_insert" on public.research_records;
create policy "research_records_insert" on public.research_records
  for insert with check (public.current_role() in ('dottore_laboratorio', 'dirigente'));

drop policy if exists "research_records_update" on public.research_records;
create policy "research_records_update" on public.research_records
  for update
  using (public.current_role() in ('dottore_laboratorio', 'dirigente'))
  with check (public.current_role() in ('dottore_laboratorio', 'dirigente'));

drop policy if exists "research_records_delete" on public.research_records;
create policy "research_records_delete" on public.research_records
  for delete using (public.current_role() in ('dottore_laboratorio', 'dirigente'));

create or replace trigger research_records_before_update
  before update on public.research_records
  for each row execute function public.touch_updated_at();

create or replace function public.log_research_record_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'research_created', 'research_records', new.id, 'Nuova scheda di ricerca: ' || new.title);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'research_status_changed', 'research_records', new.id, new.title || ' — stato: ' || new.status);
  end if;
  return new;
end;
$$;

create or replace trigger research_records_activity
  after insert or update on public.research_records
  for each row execute function public.log_research_record_activity();

-- Allegati sulle schede di ricerca (bucket dedicato, come per le campagne
-- marketing in 0009 — stessa logica ma per il ruolo dottore_laboratorio).

insert into storage.buckets (id, name, public)
values ('research-attachments', 'research-attachments', true)
on conflict (id) do nothing;

drop policy if exists "research_attachments_read" on storage.objects;
create policy "research_attachments_read" on storage.objects
  for select using (bucket_id = 'research-attachments');

drop policy if exists "research_attachments_write" on storage.objects;
create policy "research_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'research-attachments' and public.current_role() in ('dottore_laboratorio', 'dirigente'));

drop policy if exists "research_attachments_delete" on storage.objects;
create policy "research_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'research-attachments' and public.current_role() in ('dottore_laboratorio', 'dirigente'));

-- ============ 3) Acquisti: fornitori + richieste d'acquisto
--                (ruolo "ufficio_acquisti" + "dirigente") ============

do $$
begin
  if not exists (select 1 from pg_type where typname = 'purchase_status') then
    create type public.purchase_status as enum ('da_inviare', 'inviata', 'confermata', 'ricevuta', 'annullata');
  end if;
end $$;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '',
  contact_name text,
  contact_email text,
  contact_phone text,
  country text,
  note text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suppliers_tags_idx on public.suppliers using gin (tags);

alter table public.suppliers enable row level security;

drop policy if exists "suppliers_select" on public.suppliers;
create policy "suppliers_select" on public.suppliers
  for select using (public.current_role() in ('ufficio_acquisti', 'dirigente'));

drop policy if exists "suppliers_write" on public.suppliers;
create policy "suppliers_write" on public.suppliers
  for all
  using (public.current_role() in ('ufficio_acquisti', 'dirigente'))
  with check (public.current_role() in ('ufficio_acquisti', 'dirigente'));

create or replace trigger suppliers_before_update
  before update on public.suppliers
  for each row execute function public.touch_updated_at();

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  subject text not null,
  status public.purchase_status not null default 'da_inviare',
  requested_by uuid references public.profiles(id),
  due_date date,
  body text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_requests_supplier_idx on public.purchase_requests(supplier_id);
create index if not exists purchase_requests_status_idx on public.purchase_requests(status);
create index if not exists purchase_requests_tags_idx on public.purchase_requests using gin (tags);

alter table public.purchase_requests enable row level security;

drop policy if exists "purchase_requests_select" on public.purchase_requests;
create policy "purchase_requests_select" on public.purchase_requests
  for select using (public.current_role() in ('ufficio_acquisti', 'dirigente'));

drop policy if exists "purchase_requests_write" on public.purchase_requests;
create policy "purchase_requests_write" on public.purchase_requests
  for all
  using (public.current_role() in ('ufficio_acquisti', 'dirigente'))
  with check (public.current_role() in ('ufficio_acquisti', 'dirigente'));

create or replace trigger purchase_requests_before_update
  before update on public.purchase_requests
  for each row execute function public.touch_updated_at();

create or replace function public.log_supplier_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
  values (auth.uid(), 'supplier_created', 'suppliers', new.id, 'Nuovo fornitore in anagrafica: ' || new.name);
  return new;
end;
$$;

create or replace trigger suppliers_activity
  after insert on public.suppliers
  for each row execute function public.log_supplier_activity();

create or replace function public.log_purchase_request_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  supplier_name text;
begin
  select name into supplier_name from public.suppliers where id = new.supplier_id;
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'purchase_request_created', 'purchase_requests', new.id, 'Nuova richiesta d''acquisto a ' || coalesce(supplier_name, '—') || ': ' || new.subject);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'purchase_request_status_changed', 'purchase_requests', new.id, new.subject || ' — stato: ' || new.status);
  end if;
  return new;
end;
$$;

create or replace trigger purchase_requests_activity
  after insert or update on public.purchase_requests
  for each row execute function public.log_purchase_request_activity();
