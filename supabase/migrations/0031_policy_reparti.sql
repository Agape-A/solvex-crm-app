-- Solvex CRM — permessi per reparto (Dashboard, pagine e dati dedicati)
-- Da eseguire DOPO 0030_ruolo_amministrazione.sql (che aggiunge il ruolo
-- usato qui sotto — vedi il commento in quel file per il perché della
-- separazione).
--
-- Richiesta di Andrea: ogni reparto deve vedere solo le pagine e i dati che
-- gli servono.
--   - Ricerca&Sviluppo (dottore_laboratorio): Dashboard, le sue Richieste
--     (quelle assegnate a lui/lei), Ricerca&Sviluppo, Calendario (solo le
--     sue scadenze/appuntamenti), Report (solo i suoi lead di analisi
--     campione + le ricerche), Chat.
--   - Ufficio acquisti (ufficio_acquisti): Dashboard, Pipeline acquisti,
--     Fornitori, Calendario, Report, Chat — tutto lato fornitori.
--   - Tecnici e commerciale: Dashboard, Clienti, Pipeline clienti,
--     Richieste, Marketing, Report, Calendario, Chat — tutto lato clienti
--     (Marketing non era ancora aperto al tecnico: lo aggiunge questa
--     migrazione).
--   - Dirigenti e amministrazione (nuovo ruolo, vedi 0030): tutte le pagine,
--     tutti i dati — stesso trattamento ovunque compariva "dirigente".
--
-- Il pezzo mancante per Ricerca&Sviluppo e Ufficio acquisti era la tabella
-- "requests": le richieste calendarizzate create da "Assegnazione attività
-- a" (vedi ActivityAssignment.tsx) hanno assignee_id = quella persona, ma
-- nessuna policy di "requests" riconosceva ancora i ruoli
-- dottore_laboratorio/ufficio_acquisti — quelle righe restavano invisibili
-- (RLS le filtrava a zero) sia nella pagina Richieste sia nel Calendario sia
-- nel Report. Stesso discorso per "appointments".
--
-- Ogni pezzo è scritto per essere sicuro da rieseguire (drop/if-not-exists
-- prima di ogni create), come tutte le migrazioni successive alla 0009.

-- ============ REQUESTS ============

drop policy if exists "requests_select" on public.requests;
create policy "requests_select" on public.requests
  for select using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_role() = 'dottore_laboratorio' and assignee_id = auth.uid())
    or (public.current_role() = 'ufficio_acquisti' and assignee_id = auth.uid())
  );

drop policy if exists "requests_update" on public.requests;
create policy "requests_update" on public.requests
  for update using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_role() = 'dottore_laboratorio' and assignee_id = auth.uid())
    or (public.current_role() = 'ufficio_acquisti' and assignee_id = auth.uid())
  );

-- ============ DEALS (pipeline clienti) ============

drop policy if exists "deals_select" on public.deals;
create policy "deals_select" on public.deals
  for select using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'));

drop policy if exists "deals_insert" on public.deals;
create policy "deals_insert" on public.deals
  for insert with check (public.current_role() in ('commerciale', 'dirigente', 'amministrazione'));

drop policy if exists "deals_update" on public.deals;
create policy "deals_update" on public.deals
  for update
  using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'));

drop policy if exists "deals_delete" on public.deals;
create policy "deals_delete" on public.deals
  for delete using (public.current_role() in ('commerciale', 'dirigente', 'amministrazione'));

-- ============ CLIENTS ============

drop policy if exists "clients_select" on public.clients;
create policy "clients_select" on public.clients
  for select using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'));

drop policy if exists "clients_write" on public.clients;
create policy "clients_write" on public.clients
  for all
  using (public.current_role() in ('commerciale', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('commerciale', 'dirigente', 'amministrazione'));

-- ============ APPOINTMENTS ============
-- Oltre ad amministrazione, aggiunge la visibilità (sola lettura, solo le
-- proprie) per dottore_laboratorio e ufficio_acquisti — "i suoi
-- appuntamenti" nel Calendario del reparto.

drop policy if exists "appointments_select" on public.appointments;
create policy "appointments_select" on public.appointments
  for select using (
    public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione')
    or (public.current_role() in ('dottore_laboratorio', 'ufficio_acquisti') and assignee_id = auth.uid())
  );

drop policy if exists "appointments_insert" on public.appointments;
create policy "appointments_insert" on public.appointments
  for insert with check (public.current_role() in ('commerciale', 'dirigente', 'amministrazione'));

drop policy if exists "appointments_update" on public.appointments;
create policy "appointments_update" on public.appointments
  for update
  using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'));

drop policy if exists "appointments_delete" on public.appointments;
create policy "appointments_delete" on public.appointments
  for delete using (public.current_role() in ('commerciale', 'dirigente', 'amministrazione'));

-- ============ MARKETING ============
-- Aggiunge "tecnico" (finora solo commerciale/dirigente) e "amministrazione".

drop policy if exists "marketing_lists_all" on public.marketing_lists;
create policy "marketing_lists_all" on public.marketing_lists
  for all
  using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'));

drop policy if exists "marketing_contacts_all" on public.marketing_contacts;
create policy "marketing_contacts_all" on public.marketing_contacts
  for all
  using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'));

drop policy if exists "marketing_list_members_all" on public.marketing_list_members;
create policy "marketing_list_members_all" on public.marketing_list_members
  for all
  using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'));

drop policy if exists "marketing_campaigns_all" on public.marketing_campaigns;
create policy "marketing_campaigns_all" on public.marketing_campaigns
  for all
  using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione'));

-- ============ RICERCA&SVILUPPO ============

drop policy if exists "research_records_select" on public.research_records;
create policy "research_records_select" on public.research_records
  for select using (public.current_role() in ('dottore_laboratorio', 'dirigente', 'amministrazione'));

drop policy if exists "research_records_insert" on public.research_records;
create policy "research_records_insert" on public.research_records
  for insert with check (public.current_role() in ('dottore_laboratorio', 'dirigente', 'amministrazione'));

drop policy if exists "research_records_update" on public.research_records;
create policy "research_records_update" on public.research_records
  for update
  using (public.current_role() in ('dottore_laboratorio', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('dottore_laboratorio', 'dirigente', 'amministrazione'));

drop policy if exists "research_records_delete" on public.research_records;
create policy "research_records_delete" on public.research_records
  for delete using (public.current_role() in ('dottore_laboratorio', 'dirigente', 'amministrazione'));

drop policy if exists "research_attachments_write" on storage.objects;
create policy "research_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'research-attachments' and public.current_role() in ('dottore_laboratorio', 'dirigente', 'amministrazione'));

drop policy if exists "research_attachments_delete" on storage.objects;
create policy "research_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'research-attachments' and public.current_role() in ('dottore_laboratorio', 'dirigente', 'amministrazione'));

-- ============ ACQUISTI: fornitori + pipeline acquisti ============

drop policy if exists "suppliers_select" on public.suppliers;
create policy "suppliers_select" on public.suppliers
  for select using (public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'));

drop policy if exists "suppliers_write" on public.suppliers;
create policy "suppliers_write" on public.suppliers
  for all
  using (public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'));

drop policy if exists "purchase_requests_select" on public.purchase_requests;
create policy "purchase_requests_select" on public.purchase_requests
  for select using (public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'));

drop policy if exists "purchase_requests_write" on public.purchase_requests;
create policy "purchase_requests_write" on public.purchase_requests
  for all
  using (public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'));

drop policy if exists "procurement_activities_select" on public.procurement_activities;
create policy "procurement_activities_select" on public.procurement_activities
  for select using (public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'));

drop policy if exists "procurement_activities_write" on public.procurement_activities;
create policy "procurement_activities_write" on public.procurement_activities
  for all
  using (public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'))
  with check (public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'));

drop policy if exists "procurement_attachments_write" on storage.objects;
create policy "procurement_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'procurement-attachments' and public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'));

drop policy if exists "procurement_attachments_delete" on storage.objects;
create policy "procurement_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'procurement-attachments' and public.current_role() in ('ufficio_acquisti', 'dirigente', 'amministrazione'));

-- ============ PROFILES (gestione utenti) ============

drop policy if exists "profiles_update_dirigente" on public.profiles;
create policy "profiles_update_dirigente" on public.profiles
  for update
  using (public.current_role() in ('dirigente', 'amministrazione'))
  with check (public.current_role() in ('dirigente', 'amministrazione'));
