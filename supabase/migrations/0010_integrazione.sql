-- Solvex CRM — Fase 1 (estensione): integrazione tra i moduli
-- Fino ad ora richieste e appuntamenti erano collegati a un cliente solo per
-- testo libero (sender / client_name) — bastava un nome scritto in modo
-- leggermente diverso per perdere il collegamento. Questa migration:
-- 1) aggiunge un vero collegamento (client_id) a richieste e appuntamenti;
-- 2) recupera retroattivamente il collegamento sui record già esistenti,
--    quando il nome corrisponde esattamente a un cliente in anagrafica;
-- 3) estende il log attività (finora solo trattative e richieste) ad
--    appuntamenti, clienti e marketing, così la cronologia è completa;
-- 4) aggiunge un piccolo automatismo: quando una trattativa entra in
--    "proposta" o "trattativa" senza una prossima azione già impostata, ne
--    propone una fra 7 giorni, così non sparisce dal radar.

-- ============ 1) Collegamento reale al cliente ============

alter table public.requests add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.appointments add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists requests_client_idx on public.requests(client_id);
create index if not exists appointments_client_idx on public.appointments(client_id);

-- ============ 2) Backfill dei record esistenti ============
-- Solo corrispondenza esatta di nome: un collegamento sbagliato sarebbe
-- peggio di nessun collegamento. Chi importa/crea da qui in avanti userà
-- direttamente la selezione dall'anagrafica.

update public.requests r
set client_id = c.id
from public.clients c
where r.client_id is null and r.sender = c.name;

update public.appointments a
set client_id = c.id
from public.clients c
where a.client_id is null and a.client_name = c.name;

-- ============ 3) Log attività esteso ============

create or replace function public.log_appointment_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'appointment_created', 'appointments', new.id, 'Nuovo appuntamento: ' || new.client_name || ' — ' || new.subject);
  elsif tg_op = 'UPDATE' and new.appointment_at is distinct from old.appointment_at then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'appointment_rescheduled', 'appointments', new.id, 'Appuntamento riprogrammato: ' || new.client_name || ' — ' || new.subject);
  end if;
  return new;
end;
$$;

create or replace trigger appointments_activity
  after insert or update on public.appointments
  for each row execute function public.log_appointment_activity();

create or replace function public.log_client_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
  values (auth.uid(), 'client_created', 'clients', new.id, 'Nuovo cliente in anagrafica: ' || new.name);
  return new;
end;
$$;

create or replace trigger clients_activity
  after insert on public.clients
  for each row execute function public.log_client_activity();

create or replace function public.log_marketing_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.consent_marketing is distinct from old.consent_marketing then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (
      auth.uid(),
      'marketing_consent_changed',
      'marketing_contacts',
      new.id,
      new.full_name || (case when new.consent_marketing then ' ha dato il consenso marketing' else ' non ha più il consenso marketing' end)
    );
  end if;
  return new;
end;
$$;

create or replace trigger marketing_contacts_activity
  after update on public.marketing_contacts
  for each row execute function public.log_marketing_activity();

create or replace function public.log_campaign_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, event_type, ref_table, ref_id, message)
    values (auth.uid(), 'campaign_created', 'marketing_campaigns', new.id, 'Nuova campagna: ' || new.name);
  end if;
  return new;
end;
$$;

create or replace trigger marketing_campaigns_activity
  after insert on public.marketing_campaigns
  for each row execute function public.log_campaign_activity();

-- ============ 4) Auto-followup sulle trattative ============
-- Non tocca nulla se next_action è già impostato: è un suggerimento di
-- default, non una sovrascrittura di una data scelta da chi vende.

create or replace function public.auto_followup_deal() returns trigger
language plpgsql as $$
begin
  if new.stage in ('proposta', 'trattativa')
     and new.next_action is null
     and (tg_op = 'INSERT' or new.stage is distinct from old.stage)
  then
    new.next_action = current_date + 7;
  end if;
  return new;
end;
$$;

create or replace trigger deals_auto_followup
  before insert or update on public.deals
  for each row execute function public.auto_followup_deal();
