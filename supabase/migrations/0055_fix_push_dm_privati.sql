-- Solvex CRM — fix: le notifiche push della chat arrivavano a chi non
-- c'entrava, ogni volta che due persone si scrivevano in privato.
--
-- Causa: trg_push_new_chat_message() (0045_notifiche_push.sql) è precedente
-- ai messaggi privati 1-a-1 (0053_chat_privata_e_commenti.sql) e non sapeva
-- cosa fare con recipient_id. Per un messaggio privato channel = 'dm', non
-- 'generale', quindi finiva nel ramo "else" pensato per i canali di
-- reparto: "department::text = new.channel" non è mai vero ('dm' non è un
-- reparto), ma "role in ('dirigente', 'amministrazione')" sì — risultato:
-- ogni dirigente riceveva una notifica push per OGNI messaggio privato tra
-- due ALTRE persone, destinatario o no (segnalato da Andrea, ott 2026).
--
-- Corretto aggiungendo un ramo dedicato: quando recipient_id è impostato,
-- avvisa SOLO quella persona — stessa regola di riservatezza già garantita
-- dalla RLS su chat_messages (0053: "nemmeno un dirigente" legge le chat
-- private altrui, quindi a maggior ragione non deve riceverne notifica).

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
      and (department::text = new.channel or role in ('dirigente', 'amministrazione'));
  end if;

  if targets is null or array_length(targets, 1) is null then
    return new;
  end if;

  select full_name into sender_name from public.profiles where id = new.author_id;

  perform public.dispatch_push(targets, coalesce(sender_name, 'Chat'), left(new.body, 140), '/chat');
  return new;
end;
$$;
