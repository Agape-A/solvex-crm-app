-- Solvex CRM — correzione policy "appointments" (stessa collisione già
-- corretta per "requests" in 0033_chat_reparti_1.sql, qui però mai
-- risolta finora — trovata durante la verifica delle migrazioni in
-- sospeso, set 2026).
--
-- Le due migrazioni 0031_policy_reparti.sql e
-- 0031_richieste_calendario_acquisti.sql modificano ENTRAMBE la stessa
-- policy "appointments_select" (e insert/update/delete) in due modi
-- incompatibili:
--   - 0031_policy_reparti.sql: tecnico/commerciale/dirigente/amministrazione
--     vedono tutto; dottore_laboratorio e ufficio_acquisti vedono solo i
--     PROPRI appuntamenti (assignee_id = auth.uid()).
--   - 0031_richieste_calendario_acquisti.sql: tecnico/commerciale/dirigente/
--     ufficio_acquisti vedono tutto (ufficio_acquisti compreso, non solo i
--     propri) — ma non menziona affatto "amministrazione" né
--     "dottore_laboratorio".
-- A seconda di quale delle due hai incollato per ultima, o "amministrazione"
-- o "dottore_laboratorio" restano senza alcuna visibilità sul Calendario —
-- e la richiesta di Andrea (set 2026) è proprio che Ricerca&Sviluppo veda
-- "il suo calendario". Qui si ricreano le policy con TUTTE le condizioni
-- insieme, indipendentemente da quale delle due 0031 hai incollato per
-- ultima (e va bene anche se non le hai ancora eseguite affatto).

drop policy if exists "appointments_select" on public.appointments;
create policy "appointments_select" on public.appointments
  for select using (
    public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione', 'ufficio_acquisti')
    or (public.current_role() = 'dottore_laboratorio' and assignee_id = auth.uid())
  );

drop policy if exists "appointments_insert" on public.appointments;
create policy "appointments_insert" on public.appointments
  for insert with check (public.current_role() in ('commerciale', 'dirigente', 'amministrazione', 'ufficio_acquisti'));

drop policy if exists "appointments_update" on public.appointments;
create policy "appointments_update" on public.appointments
  for update
  using (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione', 'ufficio_acquisti'))
  with check (public.current_role() in ('tecnico', 'commerciale', 'dirigente', 'amministrazione', 'ufficio_acquisti'));

drop policy if exists "appointments_delete" on public.appointments;
create policy "appointments_delete" on public.appointments
  for delete using (public.current_role() in ('commerciale', 'dirigente', 'amministrazione', 'ufficio_acquisti'));
