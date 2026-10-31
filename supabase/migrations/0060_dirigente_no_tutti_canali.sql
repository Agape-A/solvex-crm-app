-- Solvex CRM — l'account direzione non deve più ricevere automaticamente
-- notifica push e pallino non letti per OGNI canale di reparto (acquisti,
-- tecnico, commerciale, ricerca, operativo), anche di reparti a cui non
-- appartiene — segnalato da Andrea, ott 2026: "l'account direzione vede e
-- riceve tutti i messaggi di tutti" (confermato: si riferisce a
-- notifiche/pallino dei canali, non alle chat private — quelle restano
-- comunque illeggibili a chiunque non sia uno dei due coinvolti, nessuna
-- modifica qui).
--
-- Causa: sia unread_chat_count()/unread_chat_by_channel() (0053/0054) sia
-- trg_push_new_chat_message() (0055) avevano un bypass esplicito
-- "current_role() = 'dirigente'" per i canali di reparto — pensato
-- probabilmente per dare al dirigente visibilità su tutto, ma risultava in
-- pratica nel ricevere una notifica push E un pallino non letti per ogni
-- singolo messaggio scritto in ogni canale di reparto, compresi quelli a
-- cui non appartiene.
--
-- Dopo questa modifica il dirigente riceve notifica/pallino solo per: il
-- canale "generale", il canale del proprio reparto (se ne ha uno — vedi
-- current_department()), i commenti indirizzati al proprio reparto, e le
-- chat private/i commenti dove è lui il destinatario — esattamente come
-- qualunque altro utente. Resta invariata la possibilità di APRIRE e
-- leggere un canale di reparto (chat_messages_select, 0053: non toccata
-- qui) — questa migrazione tocca solo notifica push e conteggio non letti,
-- non la lettura.

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
        when c.recipient_department is not null then c.recipient_department = public.current_department()
        else false
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
        when c.recipient_department is not null then c.recipient_department = public.current_department()
        else false
      end
  )
  select combined.ch as channel, count(*)::int as unread_count
  from combined
  left join public.chat_channel_reads r on r.profile_id = auth.uid() and r.channel = combined.ch
  where combined.created_at > coalesce(r.last_seen_at, '-infinity'::timestamptz)
  group by combined.ch
$$;

create or replace function public.trg_push_new_chat_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  targets uuid[];
  sender_name text;
begin
  if new.author_id is null then
    return new;
  end if;

  if new.recipient_id is not null then
    targets := array[new.recipient_id];
  elsif new.channel = 'generale' then
    select array_agg(id) into targets from public.profiles where id <> new.author_id;
  else
    select array_agg(id) into targets
    from public.profiles
    where id <> new.author_id
      and department::text = new.channel;
  end if;

  if targets is null or array_length(targets, 1) is null then
    return new;
  end if;

  select full_name into sender_name from public.profiles where id = new.author_id;

  perform public.dispatch_push(targets, coalesce(sender_name, 'Chat'), left(new.body, 140), '/chat');
  return new;
end;
$$;
