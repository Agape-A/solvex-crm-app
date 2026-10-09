-- Solvex CRM — Chat: messaggi privati 1-a-1 + commenti di richieste/lead
-- dentro la chat (richiesta di Andrea, ott 2026: "la chat con tutti gli
-- utenti, dopodiché per ogni utente e per reparto" + "dove al suo interno
-- vanno a finire anche tutti i commenti di richieste e leeds").
--
-- Due pezzi:
--
-- 1) Messaggi privati tra due colleghi, oltre a "Generale" e ai canali di
--    reparto già esistenti — SOLO i due coinvolti possono leggerli, NEMMENO
--    un dirigente (confermato da Andrea con una domanda diretta): si
--    riusa chat_messages, con un nuovo campo "recipient_id" invece di una
--    tabella a parte. channel = 'dm' quando è un messaggio privato.
--
-- 2) I commenti con destinatario (record_comments, hanno sempre o una
--    persona o un reparto — vedi 0043_notifiche_commenti.sql) ora compaiono
--    anche dentro la Chat: nel canale del reparto giusto, o nella chat
--    privata tra chi ha scritto il commento e chi è il destinatario — come
--    messaggi veri a cui si può rispondere da lì (la risposta torna come
--    nuovo commento sullo stesso record, non come messaggio generico — vedi
--    Chat.tsx). Non serve cambiare i permessi di record_comments: la Chat
--    mostra solo le conversazioni di cui chi guarda fa parte (come
--    destinatario o come autore), filtrando lato pagina esattamente come
--    già succede per i canali di reparto.

-- ============ 1) Messaggi privati 1-a-1 ============

alter table public.chat_messages add column if not exists recipient_id uuid references public.profiles(id) on delete set null;

alter table public.chat_messages drop constraint if exists chat_messages_channel_check;
alter table public.chat_messages add constraint chat_messages_channel_check
  check (channel in ('generale', 'commerciale', 'tecnico', 'operativo', 'amministrazione', 'acquisti', 'ricerca', 'dm'));

-- channel = 'dm' esattamente quando c'è un destinatario privato — mai una
-- via di mezzo (un messaggio non può essere "un po'" privato e "un po'" di
-- canale).
alter table public.chat_messages drop constraint if exists chat_messages_dm_coerente_check;
alter table public.chat_messages add constraint chat_messages_dm_coerente_check
  check (
    (channel = 'dm' and recipient_id is not null)
    or (channel <> 'dm' and recipient_id is null)
  );

alter table public.chat_messages drop constraint if exists chat_messages_no_self_dm_check;
alter table public.chat_messages add constraint chat_messages_no_self_dm_check
  check (recipient_id is distinct from author_id);

-- IMPORTANTE: quando recipient_id è impostato (messaggio privato), il "case"
-- qui sotto esclude DAVVERO ogni altro accesso, bypass di dirigente incluso
-- — altrimenti un dirigente leggerebbe anche le chat private degli altri,
-- il contrario di quanto confermato da Andrea.
drop policy if exists "chat_messages_select" on public.chat_messages;
create policy "chat_messages_select" on public.chat_messages
  for select using (
    case
      when recipient_id is not null then (author_id = auth.uid() or recipient_id = auth.uid())
      else (
        channel = 'generale'
        or public.current_role() = 'dirigente'
        or channel = public.current_department()::text
      )
    end
  );

drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert" on public.chat_messages
  for insert with check (
    auth.uid() is not null and author_id = auth.uid()
    and case
      when recipient_id is not null then recipient_id <> auth.uid()
      else (
        channel = 'generale'
        or public.current_role() = 'dirigente'
        or channel = public.current_department()::text
      )
    end
  );

-- ============ 2) Non letti: uniscono chat_messages + record_comments ============
-- Stesso meccanismo di "visto per canale" (chat_channel_reads) usato finora
-- solo per chat_messages, riusato anche per i commenti con destinatario e
-- per le chat private — una chiave sintetica "dm:<id dell'altra persona>"
-- al posto del nome del canale, così non serve un'altra tabella né un'altra
-- colonna. Stessa esclusione del bypass dirigente sulle righe private.

create or replace function public.unread_chat_count() returns integer
language sql stable security definer set search_path = public as $$
  with combined as (
    select
      case when m.recipient_id is not null then 'dm:' || m.author_id::text else m.channel end as ch,
      m.created_at
    from public.chat_messages m
    where m.author_id is not null
      and m.author_id <> auth.uid()
      and case
        when m.recipient_id is not null then m.recipient_id = auth.uid()
        else (
          m.channel = 'generale'
          or public.current_role() = 'dirigente'
          or m.channel = public.current_department()::text
        )
      end
    union all
    select
      case when c.recipient_id is not null then 'dm:' || c.author_id::text else c.recipient_department::text end as ch,
      c.created_at
    from public.record_comments c
    where c.author_id is not null
      and c.author_id <> auth.uid()
      and case
        when c.recipient_id is not null then c.recipient_id = auth.uid()
        else (
          c.recipient_department = public.current_department()
          or public.current_role() = 'dirigente'
        )
      end
  )
  select coalesce(count(*), 0)::int
  from combined
  left join public.chat_channel_reads r on r.profile_id = auth.uid() and r.channel = combined.ch
  where combined.created_at > coalesce(r.last_seen_at, '-infinity'::timestamptz)
$$;

create or replace function public.unread_chat_by_channel() returns table (channel text, unread_count integer)
language sql stable security definer set search_path = public as $$
  with combined as (
    select
      case when m.recipient_id is not null then 'dm:' || m.author_id::text else m.channel end as ch,
      m.created_at
    from public.chat_messages m
    where m.author_id is not null
      and m.author_id <> auth.uid()
      and case
        when m.recipient_id is not null then m.recipient_id = auth.uid()
        else (
          m.channel = 'generale'
          or public.current_role() = 'dirigente'
          or m.channel = public.current_department()::text
        )
      end
    union all
    select
      case when c.recipient_id is not null then 'dm:' || c.author_id::text else c.recipient_department::text end as ch,
      c.created_at
    from public.record_comments c
    where c.author_id is not null
      and c.author_id <> auth.uid()
      and case
        when c.recipient_id is not null then c.recipient_id = auth.uid()
        else (
          c.recipient_department = public.current_department()
          or public.current_role() = 'dirigente'
        )
      end
  )
  select combined.ch as channel, count(*)::int as unread_count
  from combined
  left join public.chat_channel_reads r on r.profile_id = auth.uid() and r.channel = combined.ch
  where combined.created_at > coalesce(r.last_seen_at, '-infinity'::timestamptz)
  group by combined.ch
$$;
