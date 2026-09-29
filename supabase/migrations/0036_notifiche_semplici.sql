-- Solvex CRM — notifiche più semplici e affidabili (richiesta di Andrea, set
-- 2026: "non si capisce bene quando ce ne siano di nuove, quante si
-- riferiscano a chat e quante a richieste in lavorazione").
--
-- Due bug concreti dietro la confusione, corretti qui:
--
-- 1) Il pallino di "Chat" nel menu contava anche gli avvisi automatici di
--    nuova richiesta (autore nullo, vedi 0033_chat_reparti.sql) insieme ai
--    messaggi scritti da una persona — un numero che mischiava due cose
--    diverse senza modo di distinguerle. Corretto lato codice
--    (AuthContext.tsx: torna a contare solo autore ≠ null).
-- 2) "Vista l'ultima volta" era UN SOLO orario per tutta la chat
--    (profiles.chat_last_seen_at): aprire un canale qualsiasi segnava
--    TUTTI i canali come letti, quindi il pallino spariva anche per canali
--    mai aperti davvero — impossibile fidarsi di quando c'è qualcosa di
--    nuovo. Qui si sostituisce con un "visto" per canale.

-- ============ 1) Vista dell'ultimo messaggio, per canale ============

create table if not exists public.chat_channel_reads (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null,
  last_seen_at timestamptz not null default now(),
  primary key (profile_id, channel)
);

alter table public.chat_channel_reads enable row level security;

drop policy if exists "chat_channel_reads_select" on public.chat_channel_reads;
create policy "chat_channel_reads_select" on public.chat_channel_reads
  for select using (profile_id = auth.uid());

drop policy if exists "chat_channel_reads_insert" on public.chat_channel_reads;
create policy "chat_channel_reads_insert" on public.chat_channel_reads
  for insert with check (profile_id = auth.uid());

drop policy if exists "chat_channel_reads_update" on public.chat_channel_reads;
create policy "chat_channel_reads_update" on public.chat_channel_reads
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ============ 2) Conteggio non letti — totale e per canale ============
-- "security definer" perché deve unire chat_messages (limitata dalla RLS ai
-- canali che l'utente può vedere — la stessa condizione è ripetuta qui sotto
-- per lo stesso motivo) con chat_channel_reads (limitata alle proprie righe).
-- Solo messaggi scritti da una persona (mai gli avvisi automatici) e mai i
-- propri.

create or replace function public.unread_chat_count() returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(count(*), 0)::int
  from public.chat_messages m
  left join public.chat_channel_reads r on r.profile_id = auth.uid() and r.channel = m.channel
  where m.author_id is not null
    and m.author_id <> auth.uid()
    and m.created_at > coalesce(r.last_seen_at, '-infinity'::timestamptz)
    and (
      m.channel = 'generale'
      or public.current_role() in ('dirigente', 'amministrazione')
      or m.channel = public.current_department()::text
    )
$$;

create or replace function public.unread_chat_by_channel() returns table (channel text, unread_count integer)
language sql stable security definer set search_path = public as $$
  select m.channel, count(*)::int as unread_count
  from public.chat_messages m
  left join public.chat_channel_reads r on r.profile_id = auth.uid() and r.channel = m.channel
  where m.author_id is not null
    and m.author_id <> auth.uid()
    and m.created_at > coalesce(r.last_seen_at, '-infinity'::timestamptz)
    and (
      m.channel = 'generale'
      or public.current_role() in ('dirigente', 'amministrazione')
      or m.channel = public.current_department()::text
    )
  group by m.channel
$$;
