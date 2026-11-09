-- Solvex CRM — il numero sul pallino rosso dell'icona dell'app (badge
-- iPhone/Android, sotto notifica push ad app chiusa) a volte mostrava un
-- numero molto più alto del reale (es. "50" e poi aprendo l'app solo 6) —
-- segnalato da Andrea, nov 2026.
--
-- Causa: total_unread_count() (0046_badge_icona_app.sql) è una copia a
-- mano della stessa logica di unread_chat_count(), necessaria perché la
-- Edge Function push-send gira senza una sessione utente (quindi senza
-- RLS). Quando unread_chat_count() è stata corretta in
-- 0060_dirigente_no_tutti_canali.sql (il dirigente non deve più contare
-- come "letti" i messaggi di OGNI canale di reparto, solo generale + il
-- proprio), questa copia non è stata aggiornata insieme — per un account
-- dirigente/amministrazione restava quindi gonfiata dai messaggi di tutti
-- i canali di reparto, non solo il proprio, esattamente quando arriva una
-- notifica push ad app chiusa. Qui si applica la stessa correzione.

create or replace function public.total_unread_count(p_profile_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  p_role public.user_role;
  p_department public.request_department;
  chat_count integer;
  comments_count integer;
  requests_count integer;
begin
  select role, department into p_role, p_department from public.profiles where id = p_profile_id;

  if p_role is null then
    return 0;
  end if;

  -- Chat: stessa logica di unread_chat_count() (0060, l'ultima che l'ha
  -- ridefinita) — niente più bypass "dirigente vede tutti i canali".
  select coalesce(count(*), 0)::int into chat_count
  from public.chat_messages m
  left join public.chat_channel_reads r on r.profile_id = p_profile_id and r.channel = m.channel
  where m.author_id is not null
    and m.author_id <> p_profile_id
    and m.created_at > coalesce(r.last_seen_at, '-infinity'::timestamptz)
    and (
      m.channel = 'generale'
      or m.channel = p_department::text
    );

  -- Commenti ricevuti: invariato, stessa logica di
  -- unread_record_comments_by_table() (0043) — non aveva questo problema.
  select coalesce(sum(unread), 0)::int into comments_count
  from (
    select count(*) as unread
    from public.record_comments c
    left join public.record_comment_reads r
      on r.profile_id = p_profile_id and r.ref_table = c.ref_table and r.ref_id = c.ref_id
    where c.author_id is distinct from p_profile_id
      and (c.recipient_id = p_profile_id or c.recipient_department = p_department)
      and c.created_at > coalesce(r.last_seen_at, '-infinity'::timestamptz)
  ) x;

  -- Richieste nuove: invariato, stessa condizione di prima.
  select count(*)::int into requests_count
  from public.requests req
  where req.status = 'nuova'
    and (
      p_role in ('dirigente', 'amministrazione')
      or (p_role = 'tecnico' and req.department = 'tecnico')
      or (p_role = 'commerciale' and (req.department = 'commerciale' or req.type = 'esterna'))
      or (p_role = 'operatore' and (req.department = 'operativo' or req.assignee_id = p_profile_id))
      or (p_role = 'dottore_laboratorio' and (req.department = 'ricerca' or req.assignee_id = p_profile_id))
      or (p_role = 'ufficio_acquisti' and (req.department = 'acquisti' or req.assignee_id = p_profile_id))
    );

  return chat_count + comments_count + requests_count;
end;
$$;
