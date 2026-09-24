-- Solvex CRM — Fase 1 (estensione): collaborazione tra colleghi
-- Quattro pezzi:
-- 1) commenti agganciati a un record (richiesta, trattativa, cliente,
--    appuntamento) — la "cronologia condivisa" per discutere quel record
--    specifico, invece di scriversi fuori dal CRM;
-- 2) una chat aziendale generale, non legata a un record preciso;
-- 3) tag liberi su richieste, trattative e clienti (i contatti marketing li
--    hanno già da 0008), per etichettare ed è più facile ritrovare le cose;
-- 4) pubblicazione realtime per commenti e chat, così i colleghi vedono i
--    nuovi messaggi comparire senza dover ricaricare la pagina.
--
-- Ogni pezzo è scritto per essere sicuro da rieseguire (drop/if-not-exists
-- prima di ogni create), come richiesto dopo i problemi avuti con 0009.

-- ============ 1) Commenti sui record ============

create table if not exists public.record_comments (
  id uuid primary key default gen_random_uuid(),
  ref_table text not null,
  ref_id uuid not null,
  author_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists record_comments_ref_idx on public.record_comments(ref_table, ref_id, created_at);

alter table public.record_comments enable row level security;

drop policy if exists "record_comments_select" on public.record_comments;
create policy "record_comments_select" on public.record_comments
  for select using (auth.uid() is not null);

drop policy if exists "record_comments_insert" on public.record_comments;
create policy "record_comments_insert" on public.record_comments
  for insert with check (auth.uid() is not null and author_id = auth.uid());

drop policy if exists "record_comments_delete" on public.record_comments;
create policy "record_comments_delete" on public.record_comments
  for delete using (author_id = auth.uid() or public.current_role() = 'dirigente');

-- ============ 2) Chat aziendale generale ============

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_idx on public.chat_messages(created_at);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages_select" on public.chat_messages;
create policy "chat_messages_select" on public.chat_messages
  for select using (auth.uid() is not null);

drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert" on public.chat_messages
  for insert with check (auth.uid() is not null and author_id = auth.uid());

drop policy if exists "chat_messages_delete" on public.chat_messages;
create policy "chat_messages_delete" on public.chat_messages
  for delete using (author_id = auth.uid() or public.current_role() = 'dirigente');

-- ============ 3) Tag su richieste, trattative, clienti ============

alter table public.deals add column if not exists tags text[] not null default '{}';
alter table public.requests add column if not exists tags text[] not null default '{}';
alter table public.clients add column if not exists tags text[] not null default '{}';

create index if not exists deals_tags_idx on public.deals using gin (tags);
create index if not exists requests_tags_idx on public.requests using gin (tags);
create index if not exists clients_tags_idx on public.clients using gin (tags);

-- Log dei cambi tag nell'attività, così i colleghi li vedono nel feed senza
-- dover riaprire ogni record per accorgersene.

create or replace function public.log_deal_tags_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.tags is distinct from old.tags then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (
      auth.uid(), 'deal_tags_changed', 'deals', new.id,
      new.client_name || ' — tag: ' || (case when array_length(new.tags, 1) is null then 'nessuno' else array_to_string(new.tags, ', ') end)
    );
  end if;
  return new;
end;
$$;

create or replace trigger deals_tags_activity
  after update on public.deals
  for each row execute function public.log_deal_tags_activity();

create or replace function public.log_request_tags_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.tags is distinct from old.tags then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (
      auth.uid(), 'request_tags_changed', 'requests', new.id,
      new.subject || ' — tag: ' || (case when array_length(new.tags, 1) is null then 'nessuno' else array_to_string(new.tags, ', ') end)
    );
  end if;
  return new;
end;
$$;

create or replace trigger requests_tags_activity
  after update on public.requests
  for each row execute function public.log_request_tags_activity();

create or replace function public.log_client_tags_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.tags is distinct from old.tags then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (
      auth.uid(), 'client_tags_changed', 'clients', new.id,
      new.name || ' — tag: ' || (case when array_length(new.tags, 1) is null then 'nessuno' else array_to_string(new.tags, ', ') end)
    );
  end if;
  return new;
end;
$$;

create or replace trigger clients_tags_activity
  after update on public.clients
  for each row execute function public.log_client_tags_activity();

-- ============ 4) Realtime per commenti e chat ============
-- "alter publication ... add table" non ha una forma "if not exists": senza
-- questo controllo, rieseguire il file darebbe errore se la tabella è già
-- stata aggiunta in precedenza.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'record_comments'
  ) then
    alter publication supabase_realtime add table public.record_comments;
  end if;
end $$;
