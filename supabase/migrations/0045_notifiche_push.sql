-- Solvex CRM — notifiche push stile WhatsApp (richiesta di Andrea, ott 2026:
-- "è possibile ora far inviare notifiche come app e far apparire una
-- notifica stile whatsapp"). Eventi scelti da Andrea: scadenze dei lead (dal
-- calendario, campo deals.next_action), chat, richieste ricevute, commenti
-- ricevuti.
--
-- Come funziona, in breve: il browser salva una "iscrizione push" (endpoint
-- + chiavi) per ogni dispositivo dove l'app è installata (tabella
-- push_subscriptions, riempita da src/lib/push.ts quando si preme "Attiva
-- notifiche" nel menu). Quando succede uno degli eventi sopra, un trigger
-- qui sotto chiama — tramite l'estensione pg_net, in modo asincrono, senza
-- rallentare l'inserimento — una Edge Function ("push-send", da creare a
-- mano nel pannello Supabase, vedi istruzioni nel README) che manda
-- davvero la notifica al telefono/computer (protocollo Web Push). Le
-- scadenze dei lead non sono un "evento" che qualcuno inserisce apposta:
-- una volta al giorno (pg_cron) un controllo cerca i lead con prossima
-- azione (deals.next_action) in scadenza oggi e avvisa il proprietario.

-- ============ 0) Estensioni richieste ============
-- Se una delle due righe seguenti dà errore: vai su Supabase → Database →
-- Extensions, cerca "pg_net" e "pg_cron" e abilitale da lì, poi rilancia il
-- resto di questo file (le righe già eseguite con successo non vengono
-- ripetute due volte, grazie agli "if not exists").

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ============ 1) Iscrizioni push, una per dispositivo/browser ============

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_profile_idx on public.push_subscriptions(profile_id);

alter table public.push_subscriptions enable row level security;

-- Lettura/cancellazione dirette, limitate alle proprie iscrizioni (utile per
-- un futuro "le mie notifiche" in Impostazioni). L'inserimento/aggiornamento
-- passa invece dalle funzioni security definer qui sotto (save_push_subscription),
-- così un browser che riusa lo stesso dispositivo di un altro utente non va
-- mai in conflitto con la RLS.

drop policy if exists "push_subscriptions_select" on public.push_subscriptions;
create policy "push_subscriptions_select" on public.push_subscriptions
  for select using (profile_id = auth.uid());

drop policy if exists "push_subscriptions_delete" on public.push_subscriptions;
create policy "push_subscriptions_delete" on public.push_subscriptions
  for delete using (profile_id = auth.uid());

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text,
  p_user_agent text default ''
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Serve essere autenticati.';
  end if;

  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth_key, user_agent, last_seen_at)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth_key, p_user_agent, now())
  on conflict (endpoint) do update set
    profile_id = excluded.profile_id,
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key,
    user_agent = excluded.user_agent,
    last_seen_at = now();
end;
$$;

revoke execute on function public.save_push_subscription(text, text, text, text) from public;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid();
end;
$$;

revoke execute on function public.delete_push_subscription(text) from public;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ============ 2) Configurazione: URL della Edge Function + chiave segreta ============
-- Niente policy di lettura: non è raggiungibile dalle API (nemmeno da
-- autenticato), solo dalle funzioni security definer qui sotto (di proprietà
-- di postgres, che bypassa la RLS). Da riempire a mano dopo questa
-- migrazione — vedi README, sezione "Notifiche push".

create table if not exists public.app_config (
  key text primary key,
  value text not null
);

alter table public.app_config enable row level security;

insert into public.app_config (key, value) values
  ('push_edge_function_url', 'DA_COMPILARE'),
  ('push_dispatch_secret', 'DA_COMPILARE')
on conflict (key) do nothing;

-- ============ 3) Invio effettivo: chiama la Edge Function ============
-- "perform" scarta l'id di richiesta che pg_net restituisce: l'invio è
-- asincrono (non blocca mai l'inserimento del commento/richiesta/messaggio
-- che lo ha generato) e il risultato non serve a questa funzione.

create or replace function public.dispatch_push(
  profile_ids uuid[],
  title text,
  body text,
  url text default '/'
) returns void
language plpgsql security definer set search_path = public as $$
declare
  fn_url text;
  secret text;
begin
  if profile_ids is null or array_length(profile_ids, 1) is null then
    return;
  end if;

  select value into fn_url from public.app_config where key = 'push_edge_function_url';
  select value into secret from public.app_config where key = 'push_dispatch_secret';

  if fn_url is null or fn_url = 'DA_COMPILARE' then
    -- Non ancora configurato: non bloccare l'operazione che ha generato
    -- l'evento, semplicemente non manda ancora notifiche.
    return;
  end if;

  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    body := jsonb_build_object('profile_ids', to_jsonb(profile_ids), 'title', title, 'body', body, 'url', url)
  );
end;
$$;

revoke execute on function public.dispatch_push(uuid[], text, text, text) from public;

-- ============ 4) Commenti ricevuti ============

create or replace function public.trg_push_new_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  targets uuid[];
begin
  if new.recipient_id is not null then
    targets := array[new.recipient_id];
  elsif new.recipient_department is not null then
    select array_agg(id) into targets from public.profiles where department = new.recipient_department;
  end if;

  if targets is null then
    return new;
  end if;

  -- non avvisare chi lo ha scritto, se per caso è anche nel reparto destinatario
  select array_agg(p) into targets from unnest(targets) as p where p is distinct from new.author_id;

  if targets is null or array_length(targets, 1) is null then
    return new;
  end if;

  perform public.dispatch_push(targets, 'Nuovo commento', left(new.body, 140), '/');
  return new;
end;
$$;

revoke execute on function public.trg_push_new_comment() from public;

drop trigger if exists push_on_new_comment on public.record_comments;
create trigger push_on_new_comment
  after insert on public.record_comments
  for each row execute function public.trg_push_new_comment();

-- ============ 5) Richieste ricevute ============
-- Copre sia "Richieste" sia le richieste create dalla Pipeline acquisti
-- (es. "Richiesta analisi campione", reparto "acquisti"): entrambe finiscono
-- nella stessa tabella requests.

create or replace function public.trg_push_new_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  targets uuid[];
begin
  if new.assignee_id is not null then
    targets := array[new.assignee_id];
  else
    select array_agg(id) into targets from public.profiles where department = new.department;
  end if;

  if targets is null or array_length(targets, 1) is null then
    return new;
  end if;

  perform public.dispatch_push(targets, 'Nuova richiesta', left(new.subject, 140), '/richieste');
  return new;
end;
$$;

revoke execute on function public.trg_push_new_request() from public;

drop trigger if exists push_on_new_request on public.requests;
create trigger push_on_new_request
  after insert on public.requests
  for each row execute function public.trg_push_new_request();

-- ============ 6) Chat ============
-- Stessa regola di visibilità già usata da unread_chat_count() (0036): mai
-- gli avvisi automatici (author_id nullo), mai il proprio messaggio, canale
-- "generale" per tutti, canale di reparto per chi è in quel reparto più
-- dirigente/amministrazione che vedono sempre tutto.

create or replace function public.trg_push_new_chat_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  targets uuid[];
  sender_name text;
begin
  if new.author_id is null then
    return new;
  end if;

  if new.channel = 'generale' then
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

revoke execute on function public.trg_push_new_chat_message() from public;

drop trigger if exists push_on_new_chat_message on public.chat_messages;
create trigger push_on_new_chat_message
  after insert on public.chat_messages
  for each row execute function public.trg_push_new_chat_message();

-- ============ 7) Scadenze dei lead (dal Calendario), una volta al giorno ============
-- "deal_deadline_notifications" evita di avvisare due volte lo stesso lead
-- nello stesso giorno se il controllo venisse rilanciato per qualche motivo.

create table if not exists public.deal_deadline_notifications (
  deal_id uuid not null references public.deals(id) on delete cascade,
  notified_date date not null,
  primary key (deal_id, notified_date)
);

create or replace function public.send_deal_deadline_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  for rec in
    select d.id, d.client_name, d.owner_id
    from public.deals d
    where d.next_action = current_date
      and d.owner_id is not null
      and not exists (
        select 1 from public.deal_deadline_notifications n
        where n.deal_id = d.id and n.notified_date = current_date
      )
  loop
    perform public.dispatch_push(
      array[rec.owner_id],
      'Scadenza lead oggi',
      rec.client_name || ': prossima azione in programma per oggi.',
      '/pipeline'
    );
    insert into public.deal_deadline_notifications (deal_id, notified_date)
    values (rec.id, current_date)
    on conflict do nothing;
  end loop;
end;
$$;

revoke execute on function public.send_deal_deadline_reminders() from public;

-- 06:30 UTC ≈ 07:30/08:30 in Italia (ora solare/legale) — orario di inizio
-- giornata ragionevole. Per cambiarlo in futuro: ripetere queste due righe
-- con l'orario nuovo (sintassi cron: minuto ora * * *).
select cron.unschedule('push-deal-deadlines') where exists (select 1 from cron.job where jobname = 'push-deal-deadlines');
select cron.schedule('push-deal-deadlines', '30 6 * * *', $$select public.send_deal_deadline_reminders();$$);
