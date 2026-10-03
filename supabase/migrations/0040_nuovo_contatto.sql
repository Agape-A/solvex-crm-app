-- Solvex CRM — revisione "Nuovo Contatto" per rendere la pipeline clienti
-- più fruibile a tecnici e commerciali (richiesta di Andrea, ott 2026):
--   1) Rinominato ovunque lato interfaccia: "Nuovo Lead" → "Nuovo Contatto",
--      "Primo Contatto" (fase) → "Sviluppo Contatto", "Proprietario" →
--      "Utente", "Visita" → "Contatto" (vedi Pipeline.tsx, Clients.tsx,
--      types.ts — solo etichette/label, nessun cambio di schema per questa
--      parte).
--   2) "Utente" è ora sempre e solo chi crea la scheda/trattativa — nessuna
--      interfaccia di riassegnazione per nessuno, nemmeno dirigente/
--      amministrazione (risposta di Andrea: "Bloccato per tutti, anche
--      dirigente"). Qui si irrigidisce la RLS lato insert di conseguenza:
--      vedi sezione sotto.
--   3) "Referente Contatto" e "Mansione Referente": nuovi campi comuni a
--      ogni interazione (risposta di Andrea: "Al singolo contatto/
--      interazione", non sulla scheda cliente) — vivono dentro
--      deals.activity_details (jsonb, nessuna colonna/migrazione DB
--      necessaria, vedi types.ts).
--   4) Allegato generico su ogni tipo di attività (risposta di Andrea:
--      "Su tutti i tipi di attività") — stesso motivo, campo
--      attachment_url/attachment_name dentro deals.activity_details,
--      nessuna migrazione DB necessaria.
--   5) Tipo di incontro "Telefonico" aggiunto alle opzioni esistenti — solo
--      un valore in più per un campo di testo libero dentro
--      activity_details, nessuna migrazione DB necessaria.
--
-- Le uniche due cose che richiedono davvero una migrazione sono:
--   a) i 3 tag di attività rinominati ("PRIMA VISITA" → "PRIMO CONTATTO",
--      "VISITA COMMERCIALE CLIENTE" → "CONTATTO COMMERCIALE CLIENTE",
--      "VISITA TECNICA CLIENTE" → "CONTATTO TECNICO CLIENTE") erano già
--      salvati come stringhe dentro deals.activity_details per le
--      trattative esistenti — vanno riscritti, altrimenti le trattative
--      già create smettono di corrispondere a nessun ramo dell'interfaccia
--      (ActivityDetailsView in Pipeline.tsx) e appaiono senza dettagli.
--   b) irrigidire la RLS: "Utente" non è più scelto da nessuno a mano, per
--      cui una nuova scheda cliente/trattativa deve sempre avere
--      owner_id = auth.uid() — nessuna eccezione "owner_id is null" in
--      inserimento (quell'eccezione resta solo in lettura/update/delete,
--      per non spezzare la visibilità delle righe già esistenti create
--      prima di questa revisione con owner_id null, la "vasca comune" di
--      0038_proprietario_clienti_e_validazione_tecnica.sql).

-- ============ (a) Rinomina tag già salvati su deals.activity_details ============

update public.deals
set activity_details = jsonb_set(activity_details, '{tag}', '"PRIMO CONTATTO"')
where activity_details->>'tag' = 'PRIMA VISITA';

update public.deals
set activity_details = jsonb_set(activity_details, '{tag}', '"CONTATTO COMMERCIALE CLIENTE"')
where activity_details->>'tag' = 'VISITA COMMERCIALE CLIENTE';

update public.deals
set activity_details = jsonb_set(activity_details, '{tag}', '"CONTATTO TECNICO CLIENTE"')
where activity_details->>'tag' = 'VISITA TECNICA CLIENTE';

-- ============ (b) RLS: owner_id obbligatoriamente = auth.uid() in insert ============
-- "clients_write" e "deals_insert"/"deals_update"/"deals_delete" restavano
-- unificate per insert/update/delete con la stessa condizione permissiva
-- (owner_id = auth.uid() or owner_id is null). Qui si separa l'insert, che
-- ora non ammette più l'eccezione "is null": l'interfaccia non manda mai
-- più owner_id null o di un altro utente (vedi handleSubmit in
-- Pipeline.tsx e NewClientForm in Clients.tsx), quindi qualsiasi riga
-- creata da qui in avanti ha sempre un owner_id = chi l'ha creata. Update e
-- delete restano permissivi come già erano: non è mai stata parte della
-- richiesta di Andrea restringere QUELLE operazioni, solo togliere la
-- possibilità di SCEGLIERE un proprietario diverso da sé stessi in fase di
-- creazione.

-- --- clients: separare insert (irrigidito) da update/delete (invariati) ---

drop policy if exists "clients_write" on public.clients;

create policy "clients_insert" on public.clients
  for insert with check (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and owner_id = auth.uid())
  );

create policy "clients_update" on public.clients
  for update
  using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  )
  with check (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  );

create policy "clients_delete" on public.clients
  for delete using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  );

-- --- deals: solo l'insert cambia, update/delete restano come in 0038 ---

drop policy if exists "deals_insert" on public.deals;
create policy "deals_insert" on public.deals
  for insert with check (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and owner_id = auth.uid())
  );
