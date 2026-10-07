-- Solvex CRM — numero sul pallino rosso dell'icona dell'app (richiesta di
-- Andrea, ott 2026: "in alto a destra dell'app non appare il numero delle
-- notifiche nel classico cerchio rosso stile iphone"). Diverso dalla
-- notifica push vera e propria (0045): questo è il badge sull'icona della
-- schermata Home/Dock, stile Mail/WhatsApp, e deve mostrare il TOTALE dei
-- non letti (chat + commenti + richieste nuove), non solo "+1 per evento".
--
-- Il browser aggiorna da solo il badge quando l'app è aperta (vedi
-- AuthContext.tsx), ma quando arriva una notifica push ad app chiusa serve
-- sapere il numero giusto PRIMA di mostrarla — per questo la Edge Function
-- "push-send" chiede qui, per ogni destinatario, quanti non letti ha
-- davvero in quel momento, invece di indovinare un numero.

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

  -- Chat: stessa logica di unread_chat_count() (0036), ma per un profilo
  -- esplicito invece di auth.uid() — qui non c'è una sessione utente, la
  -- chiamata arriva dalla Edge Function con la chiave di servizio.
  select coalesce(count(*), 0)::int into chat_count
  from public.chat_messages m
  left join public.chat_channel_reads r on r.profile_id = p_profile_id and r.channel = m.channel
  where m.author_id is not null
    and m.author_id <> p_profile_id
    and m.created_at > coalesce(r.last_seen_at, '-infinity'::timestamptz)
    and (
      m.channel = 'generale'
      or p_role in ('dirigente', 'amministrazione')
      or m.channel = p_department::text
    );

  -- Commenti ricevuti: stessa logica di unread_record_comments_by_table()
  -- (0043), sommata su tutte le tabelle invece che divisa per tabella.
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

  -- Richieste nuove: stessa condizione della RLS "requests_select"
  -- (0035_reparto_ricerca.sql, l'ultima che l'ha ridefinita), replicata qui
  -- a mano perché questa funzione gira senza una sessione utente e quindi
  -- senza che la RLS si applichi da sola.
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

revoke execute on function public.total_unread_count(uuid) from public;
grant execute on function public.total_unread_count(uuid) to service_role;
