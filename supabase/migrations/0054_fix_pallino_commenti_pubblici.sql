-- Solvex CRM — fix: il pallino di "Chat" restava bloccato (es. "6") anche
-- senza nessun pallino visibile su un canale o una chat privata.
--
-- Causa: in 0053_chat_privata_e_commenti.sql il bypass per il dirigente
-- ("public.current_role() = 'dirigente'") è stato aggiunto anche al ramo dei
-- commenti SENZA controllare che recipient_department non sia null. Esistono
-- commenti vecchi, scritti prima di 0043_notifiche_commenti.sql, "pubblici"
-- (nessun destinatario: sia recipient_id che recipient_department null —
-- tenuti in tabella da un "not valid" sulla constraint, vedi 0043). Per un
-- dirigente, quel bypass li faceva contare come "non letti" anche se non
-- hanno nessun destinatario — e la loro chiave di canale (ch) risultava
-- null, che non corrisponde a NESSUNA scheda della pagina Chat: restavano
-- quindi per sempre nel totale del pallino, senza poter mai essere "visti"
-- da nessuna parte (né un canale né una chat privata li mostra).
--
-- La funzione originale (pre-0053) per il pallino dei commenti sui record
-- (unread_record_comments_by_table, vedi 0043) non aveva questo problema:
-- non aveva nessun bypass per il dirigente su quel ramo. La correzione qui
-- è la stessa idea: il bypass del dirigente vale solo quando il commento ha
-- davvero un reparto come destinatario — un commento senza destinatario non
-- fa parte della Chat per nessuno, dirigente compreso.

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
        when c.recipient_department is not null then (
          c.recipient_department = public.current_department()
          or public.current_role() = 'dirigente'
        )
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
        when c.recipient_department is not null then (
          c.recipient_department = public.current_department()
          or public.current_role() = 'dirigente'
        )
        else false
      end
  )
  select combined.ch as channel, count(*)::int as unread_count
  from combined
  left join public.chat_channel_reads r on r.profile_id = auth.uid() and r.channel = combined.ch
  where combined.created_at > coalesce(r.last_seen_at, '-infinity'::timestamptz)
  group by combined.ch
$$;
