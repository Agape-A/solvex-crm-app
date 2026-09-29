-- Richiesta di Andrea (set 2026), seguito della 0029 (che aggiunge il
-- reparto "acquisti" — DEVE essere già stata eseguita prima di questo file):
--
-- 1) "Richieste": l'ufficio acquisti deve vedere/gestire le richieste del
--    proprio reparto (compresa la "Richiesta analisi campione" creata dalla
--    Pipeline acquisti — vedi PurchasePipeline.tsx) e quelle assegnate a
--    loro personalmente, come già succede per operatore/tecnico/commerciale.
-- 2) Calendario: "il calendario non funziona per loro... non vedono nuovo
--    appuntamento" — l'ufficio acquisti non era incluso nella RLS di
--    "appointments" (0004_calendar.sql), quindi non vedevano né potevano
--    creare appuntamenti, anche se la pagina in sé era già raggiungibile.
--
-- Non si può modificare 0002_rls.sql/0004_calendar.sql già eseguiti: qui si
-- droppano e ricreano le stesse policy con la condizione in più.

-- ============ REQUESTS ============

drop policy if exists "requests_select" on public.requests;
create policy "requests_select" on public.requests
  for select using (
    public.current_role() = 'dirigente'
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_role() = 'ufficio_acquisti' and (department = 'acquisti' or assignee_id = auth.uid()))
  );

drop policy if exists "requests_update" on public.requests;
create policy "requests_update" on public.requests
  for update using (
    public.current_role() = 'dirigente'
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_role() = 'ufficio_acquisti' and (department = 'acquisti' or assignee_id = auth.uid()))
  );

-- ============ APPOINTMENTS ============
-- Stessa visibilità/permessi già dati a commerciale.

drop policy if exists "appointments_select" on public.appointments;
create policy "appointments_select" on public.appointments
  for select using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'ufficio_acquisti'));

drop policy if exists "appointments_insert" on public.appointments;
create policy "appointments_insert" on public.appointments
  for insert with check (public.current_role() in ('commerciale', 'dirigente', 'ufficio_acquisti'));

drop policy if exists "appointments_update" on public.appointments;
create policy "appointments_update" on public.appointments
  for update
  using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'ufficio_acquisti'))
  with check (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'ufficio_acquisti'));

drop policy if exists "appointments_delete" on public.appointments;
create policy "appointments_delete" on public.appointments
  for delete using (public.current_role() in ('commerciale', 'dirigente', 'ufficio_acquisti'));
