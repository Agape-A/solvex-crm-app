-- Solvex CRM — Fase 3: richieste collegabili a qualsiasi record + invio
-- diretto a una persona da qualunque reparto
--
-- Andrea vuole poter mandare una richiesta ("posso accettare questo prezzo?")
-- collegata a un lead (o a un cliente, un progetto, una ricerca, un
-- fornitore...) a un collega specifico, non solo al proprio reparto. Due
-- modifiche:
-- 1) due colonne generiche "ref_table" + "ref_id" su "requests" (stesso
--    principio già usato per commenti e tag: un riferimento generico invece
--    di una colonna per ciascun modulo);
-- 2) le policy RLS di lettura/scrittura ora fanno sempre vedere una
--    richiesta a chi ne è l'assegnatario, indipendentemente dal reparto —
--    prima questa eccezione valeva solo per il ruolo "operatore".

alter table public.requests add column if not exists ref_table text;
alter table public.requests add column if not exists ref_id uuid;
create index if not exists requests_ref_idx on public.requests(ref_table, ref_id);

drop policy if exists "requests_select" on public.requests;
create policy "requests_select" on public.requests
  for select using (
    public.current_role() = 'dirigente'
    or assignee_id = auth.uid()
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and department = 'operativo')
  );

drop policy if exists "requests_update" on public.requests;
create policy "requests_update" on public.requests
  for update using (
    public.current_role() = 'dirigente'
    or assignee_id = auth.uid()
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and department = 'operativo')
  );
