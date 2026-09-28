-- Solvex CRM — reparto "Ricerca&Sviluppo" (seguito della 0034, che DEVE
-- essere già stata eseguita prima di questo file).
--
-- Richiesta di Andrea (set 2026): "Aggiungi il Reparto Ricerca&Sviluppo, che
-- può vedere lato suo per il momento Ricerca&Sviluppo, Chat ed il suo
-- calendario" — per ora resta così (niente Richieste/Report per questo
-- reparto, vedi Layout.tsx), ma nel database il reparto va comunque
-- impostato come si deve, così Chat e le richieste indirizzate a "tutto il
-- reparto" funzionano correttamente fin da subito.
--
-- 1) Ai profili con ruolo dottore_laboratorio che non hanno ancora un
--    reparto si assegna "ricerca" (finora non esisteva un valore adatto).
-- 2) requests_select/requests_update: come già fatto per l'ufficio acquisti
--    (0033), dottore_laboratorio deve vedere anche le richieste indirizzate
--    all'intero reparto "ricerca", non solo quelle assegnate a lui/lei.
--    Oggi la pagina Richieste resta comunque nascosta per questo reparto
--    (vedi Layout.tsx), ma la policy corretta serve già per il canale Chat
--    "Ricerca&Sviluppo" e per quando in futuro la pagina verrà riaperta.
-- 3) chat_messages: il canale "ricerca" va aggiunto ai canali validi.

-- ============ 1) Reparto sui profili esistenti ============

update public.profiles
  set department = 'ricerca'
  where role = 'dottore_laboratorio' and department is null;

-- ============ 2) requests_select / requests_update ============

drop policy if exists "requests_select" on public.requests;
create policy "requests_select" on public.requests
  for select using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_role() = 'dottore_laboratorio' and (department = 'ricerca' or assignee_id = auth.uid()))
    or (public.current_role() = 'ufficio_acquisti' and (department = 'acquisti' or assignee_id = auth.uid()))
  );

drop policy if exists "requests_update" on public.requests;
create policy "requests_update" on public.requests
  for update using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_role() = 'dottore_laboratorio' and (department = 'ricerca' or assignee_id = auth.uid()))
    or (public.current_role() = 'ufficio_acquisti' and (department = 'acquisti' or assignee_id = auth.uid()))
  );

-- ============ 3) Canale Chat "ricerca" ============

alter table public.chat_messages drop constraint if exists chat_messages_channel_check;
alter table public.chat_messages add constraint chat_messages_channel_check
  check (channel in ('generale', 'commerciale', 'tecnico', 'operativo', 'amministrazione', 'acquisti', 'ricerca'));
