-- Solvex CRM — Fase 2d: attività guidate sui fornitori (Visita Fornitore,
-- Reclamo Fornitore — "Schema Nuova Pipeline" di Andrea, come confermato:
-- "nel modulo Fornitori", non dentro le trattative Pipeline).
--
-- Non riusiamo "purchase_requests": quella tabella segue lo stato di un
-- ordine d'acquisto (da inviare/inviata/confermata/ricevuta/annullata), che
-- non ha senso per una visita o un reclamo. Una tabella nuova, leggera,
-- sullo stesso schema di deals.activity_details: un campo jsonb con i campi
-- guidati del tipo di attività scelto, così l'elenco può crescere senza
-- nuove migration per ogni nuovo tipo.
--
-- Stessa RLS di suppliers/purchase_requests (0013_moduli_ruoli.sql): solo
-- ufficio_acquisti e dirigente.

create table if not exists public.supplier_activities (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  activity_details jsonb,
  tags text[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists supplier_activities_supplier_idx on public.supplier_activities(supplier_id);
create index if not exists supplier_activities_tags_idx on public.supplier_activities using gin (tags);

alter table public.supplier_activities enable row level security;

drop policy if exists "supplier_activities_select" on public.supplier_activities;
create policy "supplier_activities_select" on public.supplier_activities
  for select using (public.current_role() in ('ufficio_acquisti', 'dirigente'));

drop policy if exists "supplier_activities_write" on public.supplier_activities;
create policy "supplier_activities_write" on public.supplier_activities
  for all
  using (public.current_role() in ('ufficio_acquisti', 'dirigente'))
  with check (public.current_role() in ('ufficio_acquisti', 'dirigente'));

alter table public.supplier_activities
  add constraint supplier_activities_tags_lista_fissa_check check (tags <@ array[
    'PRESENTAZIONE AZIENDALE','RICHIESTA PREZZO','RICHIESTA TECNICA','RICHIESTA DOCUMENTALE',
    'RICHIESTA CERTIFICAZIONE','CAMPIONATURA','CONFERMA ORDINE','NON CONFORMITÀ','RECLAMO CLIENTE',
    'CONTATTO TELEFONICO','CONTATTO EMAIL','INCONTRO IN SEDE','INCONTRO IN FIERA','VISITA FORNITORE',
    'INCONTRO INTERNO','RIUNIONE INTERNA',
    'PRIMA VISITA','VISITA COMMERCIALE CLIENTE','VISITA TECNICA CLIENTE','RECLAMO FORNITORE',
    'ALTRO'
  ]::text[]);

alter table public.supplier_activities
  add constraint supplier_activities_tags_obbligatorio_check check (array_length(tags, 1) > 0);

create or replace function public.log_supplier_activity_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  supplier_name text;
begin
  select name into supplier_name from public.suppliers where id = new.supplier_id;
  insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
  values (auth.uid(), 'supplier_activity_created', 'supplier_activities', new.id,
    coalesce(new.tags[1], 'Attività') || ' — ' || coalesce(supplier_name, '—'));
  return new;
end;
$$;

create or replace trigger supplier_activities_activity
  after insert on public.supplier_activities
  for each row execute function public.log_supplier_activity_created();

insert into storage.buckets (id, name, public)
values ('supplier-attachments', 'supplier-attachments', true)
on conflict (id) do nothing;

drop policy if exists "supplier_attachments_read" on storage.objects;
create policy "supplier_attachments_read" on storage.objects
  for select using (bucket_id = 'supplier-attachments');

drop policy if exists "supplier_attachments_write" on storage.objects;
create policy "supplier_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'supplier-attachments' and public.current_role() in ('ufficio_acquisti', 'dirigente'));

drop policy if exists "supplier_attachments_delete" on storage.objects;
create policy "supplier_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'supplier-attachments' and public.current_role() in ('ufficio_acquisti', 'dirigente'));
