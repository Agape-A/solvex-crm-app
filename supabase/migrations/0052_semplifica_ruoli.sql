-- Solvex CRM — semplifica i ruoli da 7 a 2 (richiesta di Andrea, ott 2026:
-- "avendo inserito il reparto, e la policy personalizzata per utente, è
-- inutile avere una caratterizzazione della mansione... è solo necessario
-- avere operatore e dirigente, dove operatori sono i dipendenti e dirigenti
-- i titolari che possono avere accesso alle modifiche utenti").
--
-- Fino a qui "role" distingueva anche la mansione (tecnico, commerciale,
-- dottore_laboratorio, ufficio_acquisti, amministrazione) e QUESTO decideva
-- i permessi veri sui dati in quasi ogni tabella. Da qui in avanti quei
-- permessi dipendono dal "department" della persona (già presente da
-- tempo, usato finora solo per instradare chat/richieste) — stesse regole
-- di oggi, identiche, solo spostate da "role" a "department". "role" resta
-- con un solo scopo: operatore (dipendente) / dirigente (titolare, accesso
-- pieno a tutto e unico che può gestire gli altri utenti). Confermato con
-- Andrea (AskUserQuestion): chi aveva ruolo "amministrazione" diventa
-- "dirigente" (manteneva comunque accesso pieno a tutto, come un dirigente).
--
-- Corrispondenza vecchio ruolo -> nuovo reparto, usata in ogni policy qui
-- sotto (current_role() = 'X' diventa current_department() = 'Y'):
--   tecnico             -> tecnico
--   commerciale         -> commerciale
--   operatore           -> operativo
--   dottore_laboratorio -> ricerca
--   ufficio_acquisti    -> acquisti
--   dirigente / amministrazione -> resta "role = 'dirigente'" (bypass pieno)

-- ============ 0) current_department(): rispetta anche la sospensione ============
-- Stessa correzione già fatta per current_role() in
-- 0049_sospensione_blocca_rls.sql: senza "and active" un account sospeso
-- avrebbe perso l'accesso solo alle tabelle controllate da current_role(),
-- non a quelle (molte di più da qui in avanti) controllate per reparto.

create or replace function public.current_department() returns request_department
language sql stable security definer set search_path = public as $$
  select department from public.profiles where id = auth.uid() and active;
$$;

-- ============ 1) Dati: profiles.role da 7 valori a 2 ============

update public.profiles set role = 'dirigente' where role in ('dirigente', 'amministrazione');
update public.profiles set role = 'operatore' where role <> 'dirigente';

-- ============ 2) Trigger che controllavano un ruolo specifico ============

-- Il tecnico può modificare solo il campo "note" di una trattativa
-- (0003_triggers.sql) — ora si riconosce dal reparto, non dal ruolo; un
-- dirigente con reparto "tecnico" (se mai capitasse) resta comunque libero.
create or replace function public.enforce_deal_update_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_department() = 'tecnico' and public.current_role() <> 'dirigente' then
    if new.client_id is distinct from old.client_id
       or new.client_name is distinct from old.client_name
       or new.product is distinct from old.product
       or new.value_estimate is distinct from old.value_estimate
       or new.stage is distinct from old.stage
       or new.owner_id is distinct from old.owner_id
       or new.next_action is distinct from old.next_action
       or new.requires_tech_validation is distinct from old.requires_tech_validation
    then
      raise exception 'Il reparto tecnico può modificare solo il campo "note" di una trattativa';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- Solo un dirigente può assegnare/cambiare il "Responsabile cliente"
-- (0041_responsabile_cliente.sql) — prima anche "amministrazione" poteva,
-- ora confluito in "dirigente".
create or replace function public.enforce_client_tech_responsible_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.tech_responsible_id is not null and public.current_role() <> 'dirigente' then
      raise exception 'Solo un dirigente può assegnare il responsabile cliente (tecnico)';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.tech_responsible_id is distinct from old.tech_responsible_id
       and public.current_role() <> 'dirigente' then
      raise exception 'Solo un dirigente può assegnare il responsabile cliente (tecnico)';
    end if;
  end if;
  return new;
end;
$$;

-- ============ 3) REQUESTS ============

drop policy if exists "requests_select" on public.requests;
create policy "requests_select" on public.requests
  for select using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'tecnico' and department = 'tecnico')
    or (public.current_department() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_department() = 'operativo' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_department() = 'ricerca' and (department = 'ricerca' or assignee_id = auth.uid()))
    or (public.current_department() = 'acquisti' and (department = 'acquisti' or assignee_id = auth.uid()))
  );

drop policy if exists "requests_update" on public.requests;
create policy "requests_update" on public.requests
  for update using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'tecnico' and department = 'tecnico')
    or (public.current_department() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_department() = 'operativo' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_department() = 'ricerca' and (department = 'ricerca' or assignee_id = auth.uid()))
    or (public.current_department() = 'acquisti' and (department = 'acquisti' or assignee_id = auth.uid()))
  );

-- ============ 4) DEALS (pipeline clienti) ============

drop policy if exists "deals_select" on public.deals;
create policy "deals_select" on public.deals
  for select using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_department() = 'tecnico' and requires_tech_validation = true)
  );

drop policy if exists "deals_insert" on public.deals;
create policy "deals_insert" on public.deals
  for insert with check (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and owner_id = auth.uid())
  );

drop policy if exists "deals_update" on public.deals;
create policy "deals_update" on public.deals
  for update
  using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_department() = 'tecnico' and requires_tech_validation = true)
  )
  with check (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_department() = 'tecnico' and requires_tech_validation = true)
  );

drop policy if exists "deals_delete" on public.deals;
create policy "deals_delete" on public.deals
  for delete using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  );

-- ============ 5) CLIENTS ============

drop policy if exists "clients_select" on public.clients;
create policy "clients_select" on public.clients
  for select using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_department() = 'tecnico' and exists (
          select 1 from public.deals d
          where d.client_id = clients.id and d.requires_tech_validation = true
        ))
  );

drop policy if exists "clients_insert" on public.clients;
create policy "clients_insert" on public.clients
  for insert with check (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and owner_id = auth.uid())
  );

drop policy if exists "clients_update" on public.clients;
create policy "clients_update" on public.clients
  for update
  using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  )
  with check (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  );

drop policy if exists "clients_delete" on public.clients;
create policy "clients_delete" on public.clients
  for delete using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  );

-- ============ 6) APPOINTMENTS ============

drop policy if exists "appointments_select" on public.appointments;
create policy "appointments_select" on public.appointments
  for select using (
    public.current_role() = 'dirigente'
    or (public.current_department() in ('tecnico', 'commerciale', 'acquisti'))
    or (public.current_department() = 'ricerca' and assignee_id = auth.uid())
  );

drop policy if exists "appointments_insert" on public.appointments;
create policy "appointments_insert" on public.appointments
  for insert with check (
    public.current_role() = 'dirigente'
    or public.current_department() in ('commerciale', 'acquisti')
  );

drop policy if exists "appointments_update" on public.appointments;
create policy "appointments_update" on public.appointments
  for update
  using (
    public.current_role() = 'dirigente'
    or public.current_department() in ('tecnico', 'commerciale', 'acquisti')
  )
  with check (
    public.current_role() = 'dirigente'
    or public.current_department() in ('tecnico', 'commerciale', 'acquisti')
  );

drop policy if exists "appointments_delete" on public.appointments;
create policy "appointments_delete" on public.appointments
  for delete using (
    public.current_role() = 'dirigente'
    or public.current_department() in ('commerciale', 'acquisti')
  );

-- ============ 7) MARKETING ============

drop policy if exists "marketing_lists_all" on public.marketing_lists;
create policy "marketing_lists_all" on public.marketing_lists
  for all
  using (public.current_role() = 'dirigente' or public.current_department() in ('tecnico', 'commerciale'))
  with check (public.current_role() = 'dirigente' or public.current_department() in ('tecnico', 'commerciale'));

drop policy if exists "marketing_contacts_all" on public.marketing_contacts;
create policy "marketing_contacts_all" on public.marketing_contacts
  for all
  using (public.current_role() = 'dirigente' or public.current_department() in ('tecnico', 'commerciale'))
  with check (public.current_role() = 'dirigente' or public.current_department() in ('tecnico', 'commerciale'));

drop policy if exists "marketing_list_members_all" on public.marketing_list_members;
create policy "marketing_list_members_all" on public.marketing_list_members
  for all
  using (public.current_role() = 'dirigente' or public.current_department() in ('tecnico', 'commerciale'))
  with check (public.current_role() = 'dirigente' or public.current_department() in ('tecnico', 'commerciale'));

drop policy if exists "marketing_campaigns_all" on public.marketing_campaigns;
create policy "marketing_campaigns_all" on public.marketing_campaigns
  for all
  using (public.current_role() = 'dirigente' or public.current_department() in ('tecnico', 'commerciale'))
  with check (public.current_role() = 'dirigente' or public.current_department() in ('tecnico', 'commerciale'));

drop policy if exists "marketing_campaign_sends_select" on public.marketing_campaign_sends;
create policy "marketing_campaign_sends_select" on public.marketing_campaign_sends
  for select
  using (public.current_role() = 'dirigente' or public.current_department() = 'commerciale');

-- ============ 8) RICERCA&SVILUPPO ============

drop policy if exists "research_records_select" on public.research_records;
create policy "research_records_select" on public.research_records
  for select using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'ricerca' and (owner_id = auth.uid() or owner_id is null))
  );

drop policy if exists "research_records_insert" on public.research_records;
create policy "research_records_insert" on public.research_records
  for insert with check (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'ricerca' and (owner_id = auth.uid() or owner_id is null))
  );

drop policy if exists "research_records_update" on public.research_records;
create policy "research_records_update" on public.research_records
  for update
  using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'ricerca' and (owner_id = auth.uid() or owner_id is null))
  )
  with check (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'ricerca' and (owner_id = auth.uid() or owner_id is null))
  );

drop policy if exists "research_records_delete" on public.research_records;
create policy "research_records_delete" on public.research_records
  for delete using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'ricerca' and (owner_id = auth.uid() or owner_id is null))
  );

drop policy if exists "research_attachments_write" on storage.objects;
create policy "research_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'research-attachments' and (public.current_role() = 'dirigente' or public.current_department() = 'ricerca'));

drop policy if exists "research_attachments_delete" on storage.objects;
create policy "research_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'research-attachments' and (public.current_role() = 'dirigente' or public.current_department() = 'ricerca'));

-- ============ 9) ACQUISTI: fornitori + pipeline acquisti ============

drop policy if exists "suppliers_select" on public.suppliers;
create policy "suppliers_select" on public.suppliers
  for select using (public.current_role() = 'dirigente' or public.current_department() = 'acquisti');

drop policy if exists "suppliers_write" on public.suppliers;
create policy "suppliers_write" on public.suppliers
  for all
  using (public.current_role() = 'dirigente' or public.current_department() = 'acquisti')
  with check (public.current_role() = 'dirigente' or public.current_department() = 'acquisti');

drop policy if exists "purchase_requests_select" on public.purchase_requests;
create policy "purchase_requests_select" on public.purchase_requests
  for select using (public.current_role() = 'dirigente' or public.current_department() = 'acquisti');

drop policy if exists "purchase_requests_write" on public.purchase_requests;
create policy "purchase_requests_write" on public.purchase_requests
  for all
  using (public.current_role() = 'dirigente' or public.current_department() = 'acquisti')
  with check (public.current_role() = 'dirigente' or public.current_department() = 'acquisti');

drop policy if exists "procurement_activities_select" on public.procurement_activities;
create policy "procurement_activities_select" on public.procurement_activities
  for select using (public.current_role() = 'dirigente' or public.current_department() = 'acquisti');

drop policy if exists "procurement_activities_write" on public.procurement_activities;
create policy "procurement_activities_write" on public.procurement_activities
  for all
  using (public.current_role() = 'dirigente' or public.current_department() = 'acquisti')
  with check (public.current_role() = 'dirigente' or public.current_department() = 'acquisti');

drop policy if exists "procurement_attachments_write" on storage.objects;
create policy "procurement_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'procurement-attachments' and (public.current_role() = 'dirigente' or public.current_department() = 'acquisti'));

drop policy if exists "procurement_attachments_delete" on storage.objects;
create policy "procurement_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'procurement-attachments' and (public.current_role() = 'dirigente' or public.current_department() = 'acquisti'));

drop policy if exists "supplier_activities_select" on public.supplier_activities;
create policy "supplier_activities_select" on public.supplier_activities
  for select using (public.current_role() = 'dirigente' or public.current_department() = 'acquisti');

drop policy if exists "supplier_activities_write" on public.supplier_activities;
create policy "supplier_activities_write" on public.supplier_activities
  for all
  using (public.current_role() = 'dirigente' or public.current_department() = 'acquisti')
  with check (public.current_role() = 'dirigente' or public.current_department() = 'acquisti');

drop policy if exists "supplier_attachments_write" on storage.objects;
create policy "supplier_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'supplier-attachments' and (public.current_role() = 'dirigente' or public.current_department() = 'acquisti'));

drop policy if exists "supplier_attachments_delete" on storage.objects;
create policy "supplier_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'supplier-attachments' and (public.current_role() = 'dirigente' or public.current_department() = 'acquisti'));

drop policy if exists "purchase_attachments_write" on storage.objects;
create policy "purchase_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'purchase-attachments' and (public.current_role() = 'dirigente' or public.current_department() = 'acquisti'));

drop policy if exists "purchase_attachments_delete" on storage.objects;
create policy "purchase_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'purchase-attachments' and (public.current_role() = 'dirigente' or public.current_department() = 'acquisti'));

-- ============ 10) PROFILES / CHAT (solo "amministrazione" -> "dirigente") ============

drop policy if exists "profiles_update_dirigente" on public.profiles;
create policy "profiles_update_dirigente" on public.profiles
  for update
  using (public.current_role() = 'dirigente')
  with check (public.current_role() = 'dirigente');

drop policy if exists "chat_messages_select" on public.chat_messages;
create policy "chat_messages_select" on public.chat_messages
  for select using (
    channel = 'generale'
    or public.current_role() = 'dirigente'
    or channel = public.current_department()::text
  );

drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert" on public.chat_messages
  for insert with check (
    auth.uid() is not null and author_id = auth.uid()
    and (
      channel = 'generale'
      or public.current_role() = 'dirigente'
      or channel = public.current_department()::text
    )
  );

drop policy if exists "chat_messages_delete" on public.chat_messages;
create policy "chat_messages_delete" on public.chat_messages
  for delete using (author_id = auth.uid() or public.current_role() = 'dirigente');

-- Conteggio non letti (0036_notifiche_semplici.sql) — stessa condizione di
-- "chat_messages_select" qui sopra, duplicata in queste due funzioni
-- "security definer" per lo stesso motivo spiegato lì.
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
      or public.current_role() = 'dirigente'
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
      or public.current_role() = 'dirigente'
      or m.channel = public.current_department()::text
    )
  group by m.channel
$$;
