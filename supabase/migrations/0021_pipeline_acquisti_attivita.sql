-- Solvex CRM — Fase 2e: la pipeline Acquisti va ripensata secondo lo
-- "Schema Nuova Pipeline Acquisti" di Andrea. La 0020 metteva Visita
-- Fornitore / Reclamo Fornitore dentro la scheda del singolo fornitore: non
-- andava bene, perché lo schema di Andrea le vuole in cima alla pagina
-- Acquisti (come la Pipeline clienti), con fornitore/cliente scelti nel
-- form stesso, e include anche Reclamo Cliente (autonomo, senza bisogno di
-- una trattativa aperta) e Riunione Interna.
--
-- Rinominiamo la tabella creata dalla 0020 (supplier_activities →
-- procurement_activities, nome più corretto ora che copre anche i clienti)
-- e la rendiamo più generica: supplier_id diventa facoltativo, si aggiunge
-- client_id facoltativo. Il "do $$ ... $$" gestisce sia il caso in cui la
-- 0020 sia già stata eseguita (rinomina la tabella esistente) sia il caso
-- in cui non lo sia stata (la crea da zero, già nella forma nuova).

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'supplier_activities')
     and not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'procurement_activities')
  then
    alter table public.supplier_activities rename to procurement_activities;
  end if;
end $$;

create table if not exists public.procurement_activities (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete cascade,
  activity_details jsonb,
  tags text[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Fornitore non più obbligatorio (Reclamo Cliente e Riunione Interna non ne
-- hanno uno) e nuovo collegamento facoltativo al cliente.
alter table public.procurement_activities alter column supplier_id drop not null;
alter table public.procurement_activities add column if not exists client_id uuid references public.clients(id) on delete cascade;

create index if not exists procurement_activities_supplier_idx on public.procurement_activities(supplier_id);
create index if not exists procurement_activities_client_idx on public.procurement_activities(client_id);
create index if not exists procurement_activities_tags_idx on public.procurement_activities using gin (tags);

alter table public.procurement_activities enable row level security;

drop policy if exists "supplier_activities_select" on public.procurement_activities;
drop policy if exists "procurement_activities_select" on public.procurement_activities;
create policy "procurement_activities_select" on public.procurement_activities
  for select using (public.current_role() in ('ufficio_acquisti', 'dirigente'));

drop policy if exists "supplier_activities_write" on public.procurement_activities;
drop policy if exists "procurement_activities_write" on public.procurement_activities;
create policy "procurement_activities_write" on public.procurement_activities
  for all
  using (public.current_role() in ('ufficio_acquisti', 'dirigente'))
  with check (public.current_role() in ('ufficio_acquisti', 'dirigente'));

alter table public.procurement_activities drop constraint if exists supplier_activities_tags_lista_fissa_check;
alter table public.procurement_activities drop constraint if exists procurement_activities_tags_lista_fissa_check;
alter table public.procurement_activities
  add constraint procurement_activities_tags_lista_fissa_check check (tags <@ array[
    'PRESENTAZIONE AZIENDALE','RICHIESTA PREZZO','RICHIESTA TECNICA','RICHIESTA DOCUMENTALE',
    'RICHIESTA CERTIFICAZIONE','CAMPIONATURA','CONFERMA ORDINE','NON CONFORMITÀ','RECLAMO CLIENTE',
    'CONTATTO TELEFONICO','CONTATTO EMAIL','INCONTRO IN SEDE','INCONTRO IN FIERA','VISITA FORNITORE',
    'INCONTRO INTERNO','RIUNIONE INTERNA',
    'PRIMA VISITA','VISITA COMMERCIALE CLIENTE','VISITA TECNICA CLIENTE','RECLAMO FORNITORE',
    'ALTRO'
  ]::text[]);

alter table public.procurement_activities drop constraint if exists supplier_activities_tags_obbligatorio_check;
alter table public.procurement_activities drop constraint if exists procurement_activities_tags_obbligatorio_check;
alter table public.procurement_activities
  add constraint procurement_activities_tags_obbligatorio_check check (array_length(tags, 1) > 0);

drop trigger if exists supplier_activities_activity on public.procurement_activities;
drop trigger if exists procurement_activities_activity on public.procurement_activities;
drop function if exists public.log_supplier_activity_created();

create or replace function public.log_procurement_activity_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who_name text;
begin
  if new.supplier_id is not null then
    select name into who_name from public.suppliers where id = new.supplier_id;
  elsif new.client_id is not null then
    select name into who_name from public.clients where id = new.client_id;
  end if;
  insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
  values (auth.uid(), 'procurement_activity_created', 'procurement_activities', new.id,
    coalesce(new.tags[1], 'Attività') || ' — ' || coalesce(who_name, 'Interna'));
  return new;
end;
$$;

create or replace trigger procurement_activities_activity
  after insert on public.procurement_activities
  for each row execute function public.log_procurement_activity_created();

-- Bucket allegati dedicato (rimpiazza "supplier-attachments" della 0020: il
-- nome non andava più bene ora che il reclamo può essere anche di un
-- cliente). Nessun file era ancora stato caricato con la funzione vecchia,
-- quindi non serve migrare nulla.
insert into storage.buckets (id, name, public)
values ('procurement-attachments', 'procurement-attachments', true)
on conflict (id) do nothing;

drop policy if exists "procurement_attachments_read" on storage.objects;
create policy "procurement_attachments_read" on storage.objects
  for select using (bucket_id = 'procurement-attachments');

drop policy if exists "procurement_attachments_write" on storage.objects;
create policy "procurement_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'procurement-attachments' and public.current_role() in ('ufficio_acquisti', 'dirigente'));

drop policy if exists "procurement_attachments_delete" on storage.objects;
create policy "procurement_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'procurement-attachments' and public.current_role() in ('ufficio_acquisti', 'dirigente'));
