-- Solvex CRM — proprietario esplicito sui clienti + restrizione "solo i
-- propri clienti/trattative" per commerciale e tecnico (richiesta di
-- Andrea, ott 2026): "gli utenti commerciale e tecnico devono poter aver
-- accesso ognuno alla loro dashboard, ai clienti alle proprie richieste al
-- calendario, report e analytics per la loro parte".
--
-- Riassunto delle decisioni prese insieme ad Andrea:
--   - Report: contenuti diversi per ruolo (gestito via RLS, qui sotto, più
--     un'intestazione diversa in Report.tsx — nessuna query cambia).
--   - Clienti/trattative: ognuno vede solo i propri (commerciale E tecnico,
--     non solo commerciale).
--   - Richieste: nessuna modifica (restano come oggi).
--   - "I propri clienti" per il tecnico non esisteva come concetto (la
--     colonna requires_tech_validation non veniva mai impostata da
--     nessuna parte dell'interfaccia): Andrea ha scelto di aggiungere un
--     vero interruttore "Richiede validazione tecnica" nel modulo
--     trattativa (vedi Pipeline.tsx) invece di lasciare il tecnico senza
--     alcuna trattativa visibile.
--
-- Trattativa/cliente "non assegnato" (owner_id null): resta visibile a
-- TUTTO il reparto commerciale come una specie di "vasca comune", finché
-- la direzione non assegna un proprietario esplicito — questo evita che
-- clienti/trattative già esistenti (o importati) spariscano di colpo dalla
-- vista di chiunque il giorno in cui questa migrazione viene eseguita.
--
-- Il tecnico continua a poter modificare SOLO il campo "note" di una
-- trattativa (trigger enforce_deal_update_permissions, 0003_triggers.sql —
-- non tocco quel trigger): qui gli si restringe solo QUALI trattative/
-- clienti vede, non cosa può cambiarne.

-- ============ CLIENTS: colonna proprietario ============

alter table public.clients add column if not exists owner_id uuid references public.profiles(id) on delete set null;

create index if not exists clients_owner_id_idx on public.clients (owner_id);
create index if not exists deals_owner_id_idx on public.deals (owner_id);

-- Backfill: se un cliente ha già trattative e tutte appartengono a un solo
-- proprietario, il cliente eredita quel proprietario. Se le trattative
-- hanno proprietari diversi, o non ce ne sono, il cliente resta senza
-- proprietario esplicito (null — vedi nota sopra sulla "vasca comune").
update public.clients c
set owner_id = sub.only_owner
from (
  select client_id, (array_agg(owner_id))[1] as only_owner
  from public.deals
  where client_id is not null and owner_id is not null
  group by client_id
  having count(distinct owner_id) = 1
) sub
where c.id = sub.client_id
  and c.owner_id is null;

-- ============ CLIENTS: policy ============

drop policy if exists "clients_select" on public.clients;
create policy "clients_select" on public.clients
  for select using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_role() = 'tecnico' and exists (
          select 1 from public.deals d
          where d.client_id = clients.id and d.requires_tech_validation = true
        ))
  );

drop policy if exists "clients_write" on public.clients;
create policy "clients_write" on public.clients
  for all
  using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  )
  with check (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  );

-- ============ DEALS: policy ============
-- Stessa logica: dirigente/amministrazione tutto, commerciale solo le
-- proprie (+ non assegnate), tecnico solo quelle con
-- requires_tech_validation = true (niente più "vede tutto").

drop policy if exists "deals_select" on public.deals;
create policy "deals_select" on public.deals
  for select using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_role() = 'tecnico' and requires_tech_validation = true)
  );

drop policy if exists "deals_insert" on public.deals;
create policy "deals_insert" on public.deals
  for insert with check (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  );

drop policy if exists "deals_update" on public.deals;
create policy "deals_update" on public.deals
  for update
  using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_role() = 'tecnico' and requires_tech_validation = true)
  )
  with check (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
    or (public.current_role() = 'tecnico' and requires_tech_validation = true)
  );

drop policy if exists "deals_delete" on public.deals;
create policy "deals_delete" on public.deals
  for delete using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'commerciale' and (owner_id = auth.uid() or owner_id is null))
  );
