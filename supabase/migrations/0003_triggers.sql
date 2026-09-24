-- Solvex CRM — Fase 1: automazioni lato database
-- Creazione profilo automatica, permesso "solo nota" per il tecnico, log attività.

-- ============ Crea automaticamente un profilo alla registrazione ============
-- Il ruolo di default è 'operatore': un dirigente lo corregge dopo, dalla
-- tabella "profiles" nel pannello Supabase (o da un'interfaccia admin futura).

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'operatore')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ Il tecnico può aggiornare una trattativa solo sul campo "note" ============
-- La RLS (0002) lascia al tecnico il permesso di UPDATE sulla riga; questo
-- trigger restringe cosa può davvero cambiare, come descritto nella specifica.

create or replace function public.enforce_deal_update_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() = 'tecnico' then
    if new.client_id is distinct from old.client_id
       or new.client_name is distinct from old.client_name
       or new.product is distinct from old.product
       or new.value_estimate is distinct from old.value_estimate
       or new.stage is distinct from old.stage
       or new.owner_id is distinct from old.owner_id
       or new.next_action is distinct from old.next_action
       or new.requires_tech_validation is distinct from old.requires_tech_validation
    then
      raise exception 'Il ruolo tecnico può modificare solo il campo "note" di una trattativa';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger deals_before_update
  before update on public.deals
  for each row execute function public.enforce_deal_update_permissions();

-- ============ updated_at automatico per le richieste ============

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger requests_before_update
  before update on public.requests
  for each row execute function public.touch_updated_at();

-- ============ Log attività: trattative ============

create or replace function public.log_deal_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'deal_created', 'deals', new.id, 'Nuovo lead aggiunto: ' || new.client_name);
  elsif tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'deal_stage_changed', 'deals', new.id, new.client_name || ' spostato in ' || new.stage);
  end if;
  return new;
end;
$$;

create trigger deals_activity
  after insert or update on public.deals
  for each row execute function public.log_deal_activity();

-- ============ Log attività: richieste ============

create or replace function public.log_request_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'request_created', 'requests', new.id, 'Nuova richiesta: ' || new.subject);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'request_status_changed', 'requests', new.id, new.subject || ' → ' || new.status);
  end if;
  return new;
end;
$$;

create trigger requests_activity
  after insert or update on public.requests
  for each row execute function public.log_request_activity();
