-- Solvex CRM — anche il reparto tecnico può ora inserire un nuovo cliente
-- in Clienti/Pipeline clienti, non solo commerciale/dirigente (richiesta di
-- Andrea, nov 2026: "devi dare la possibilità a tecnici e commerciali di
-- inserire nuovi clienti"). Stessa estensione già fatta per le trattative
-- in 0059_tecnico_crea_contatti.sql — qui per la scheda cliente stessa.
--
-- Oltre all'insert, serve toccare anche select: altrimenti un tecnico che
-- crea un proprio cliente (owner_id = auth.uid(), come già fa il modulo
-- "+ Nuovo cliente" per chiunque) lo perderebbe subito di vista — il suo
-- ramo select attuale mostra solo i clienti con una trattativa a cui serve
-- "validazione tecnica" attiva, niente che riguardi un cliente appena
-- creato senza ancora nessuna trattativa. Stessa logica già in vigore per
-- commerciale ("owner_id = auth.uid() or owner_id is null").
--
-- Resta INVARIATO tutto il resto: un tecnico può creare un proprio cliente
-- ma non può modificarlo né eliminarlo dopo averlo creato (clients_update/
-- clients_delete qui non toccate — lato frontend Clients.tsx lo mostra di
-- sola lettura, come già per qualunque altro cliente che un tecnico può
-- vedere), e non può assegnarsi/assegnare un responsabile cliente (vincolo
-- separato, invariato, vedi enforce_client_tech_responsible_permissions).

drop policy if exists "clients_select" on public.clients;
create policy "clients_select" on public.clients
  for select using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_department() = 'tecnico' and (
          owner_id = auth.uid()
          or exists (
            select 1 from public.deals d
            where d.client_id = clients.id and d.requires_tech_validation = true
          )
        ))
  );

drop policy if exists "clients_insert" on public.clients;
create policy "clients_insert" on public.clients
  for insert with check (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and owner_id = auth.uid())
    or (public.current_department() = 'tecnico' and owner_id = auth.uid())
  );
