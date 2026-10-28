-- Solvex CRM — il reparto tecnico può ora creare nuovi contatti nella
-- Pipeline clienti, non solo commerciale/dirigente (richiesta di Andrea,
-- ott 2026, dopo che un utente tecnico non vedeva il pulsante "+ Nuovo
-- Contatto"). Prima era una scelta voluta (vedi 0052_semplifica_ruoli.sql,
-- "il tecnico vede solo le trattative con validazione tecnica attiva"),
-- Andrea ha confermato di volerla estendere.
--
-- Oltre all'insert, serve toccare anche select/update: altrimenti un
-- tecnico che crea una propria trattativa senza "Richiede validazione
-- tecnica" (che resta un campo scelto da chi crea, come per commerciale)
-- la perderebbe subito di vista — stessa logica già in vigore per
-- commerciale ("owner_id = auth.uid() or owner_id is null"). Resta
-- invariato il vincolo lato trigger (enforce_deal_update_permissions,
-- 0052): il reparto tecnico può comunque modificare solo il campo "note",
-- anche sulle proprie trattative — qui si abilita solo la creazione, non
-- un controllo più ampio successivo. Resta invariato anche deals_delete
-- (non richiesto).

drop policy if exists "deals_select" on public.deals;
create policy "deals_select" on public.deals
  for select using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_department() = 'tecnico' and (requires_tech_validation = true or owner_id = auth.uid()))
  );

drop policy if exists "deals_insert" on public.deals;
create policy "deals_insert" on public.deals
  for insert with check (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and owner_id = auth.uid())
    or (public.current_department() = 'tecnico' and owner_id = auth.uid())
  );

drop policy if exists "deals_update" on public.deals;
create policy "deals_update" on public.deals
  for update
  using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_department() = 'tecnico' and (requires_tech_validation = true or owner_id = auth.uid()))
  )
  with check (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_department() = 'tecnico' and (requires_tech_validation = true or owner_id = auth.uid()))
  );
