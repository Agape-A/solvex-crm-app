-- Solvex CRM — due cose in questo file:
--
-- 1) CORREZIONE: le migrazioni 0031_policy_reparti.sql e
--    0031_richieste_calendario_acquisti.sql sono arrivate da due sessioni di
--    lavoro diverse e si sono ritrovate con lo stesso numero (0031),
--    modificando entrambe la stessa policy "requests_select"/"requests_update"
--    in due modi diversi: la prima aggiunge dirigente/amministrazione e
--    dottore_laboratorio; la seconda aggiunge "l'ufficio acquisti vede tutte
--    le richieste del proprio reparto" (department = 'acquisti'). A seconda
--    di quale delle due hai incollato per ultima nell'SQL Editor, l'altra
--    correzione è andata persa — quindi oggi potresti avere l'una o l'altra,
--    non entrambe insieme. Qui sotto si ricreano le stesse policy con
--    ENTRAMBE le condizioni insieme, così il risultato finale è quello
--    giusto indipendentemente da quale delle due 0031 hai incollato per
--    ultima (e va bene anche se non le hai ancora eseguite affatto: questo
--    file da solo basta, purché tu l'abbia incollato dopo la 0030 e la 0032,
--    come indica il numero).
--
-- 2) Chat multi-canale (richiesta di Andrea, set 2026): oltre al canale
--    "Generale" di sempre, un canale per reparto (stessa lista già usata in
--    Richieste/Report: commerciale, tecnico, operativo, amministrazione,
--    acquisti), visibile solo a chi ha quel reparto sul profilo — più
--    dirigente/amministrazione che vedono sempre tutti i canali. I commenti
--    sui singoli record (richieste, trattative, clienti...) restano dove
--    sono, sul record: qui arriva solo un avviso breve quando nasce una
--    richiesta nuova per un reparto, con link diretto alla richiesta, così
--    il reparto se ne accorge anche dalla chat senza duplicare l'intero
--    thread dei commenti.

-- ============ 1) Correzione requests_select / requests_update ============

drop policy if exists "requests_select" on public.requests;
create policy "requests_select" on public.requests
  for select using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_role() = 'dottore_laboratorio' and assignee_id = auth.uid())
    or (public.current_role() = 'ufficio_acquisti' and (department = 'acquisti' or assignee_id = auth.uid()))
  );

drop policy if exists "requests_update" on public.requests;
create policy "requests_update" on public.requests
  for update using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_role() = 'dottore_laboratorio' and assignee_id = auth.uid())
    or (public.current_role() = 'ufficio_acquisti' and (department = 'acquisti' or assignee_id = auth.uid()))
  );

-- ============ 2a) Chat: colonne canale + collegamento record ============

alter table public.chat_messages add column if not exists channel text not null default 'generale';
alter table public.chat_messages add column if not exists ref_table text;
alter table public.chat_messages add column if not exists ref_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_channel_check') then
    alter table public.chat_messages add constraint chat_messages_channel_check
      check (channel in ('generale', 'commerciale', 'tecnico', 'operativo', 'amministrazione', 'acquisti'));
  end if;
end $$;

create index if not exists chat_messages_channel_idx on public.chat_messages(channel, created_at);

-- ============ 2b) Reparto dell'utente corrente (per le policy sotto) ============

create or replace function public.current_department() returns request_department
language sql stable security definer set search_path = public as $$
  select department from public.profiles where id = auth.uid();
$$;

-- ============ 2c) Permessi per canale ============
-- "generale" resta visibile a chiunque sia autenticato, come oggi. Un canale
-- di reparto è visibile solo a chi ha quel reparto sul profilo, più
-- dirigente/amministrazione che vedono sempre tutto (stessa convenzione già
-- usata altrove nel CRM, vedi Layout.tsx/Pipeline.tsx).

drop policy if exists "chat_messages_select" on public.chat_messages;
create policy "chat_messages_select" on public.chat_messages
  for select using (
    channel = 'generale'
    or public.current_role() in ('dirigente', 'amministrazione')
    or channel = public.current_department()::text
  );

drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert" on public.chat_messages
  for insert with check (
    auth.uid() is not null and author_id = auth.uid()
    and (
      channel = 'generale'
      or public.current_role() in ('dirigente', 'amministrazione')
      or channel = public.current_department()::text
    )
  );

drop policy if exists "chat_messages_delete" on public.chat_messages;
create policy "chat_messages_delete" on public.chat_messages
  for delete using (author_id = auth.uid() or public.current_role() in ('dirigente', 'amministrazione'));

-- ============ 2d) Avviso automatico nel canale di reparto ============
-- Ogni nuova richiesta genera un messaggio "di sistema" (author_id nullo) nel
-- canale del proprio reparto, con un riferimento alla richiesta (ref_table/
-- ref_id) così l'interfaccia mostra un link diretto invece di una bolla di
-- chat normale. "security definer" fa sì che il trigger scriva anche se chi
-- ha creato la richiesta non avrebbe, di per sé, il permesso di scrivere in
-- quel canale (es. una richiesta mandata al reparto acquisti da un
-- commerciale, o quelle create automaticamente da CommentThread.tsx/
-- PurchasePipeline.tsx).

create or replace function public.notify_department_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.chat_messages (channel, author_id, body, ref_table, ref_id)
  values (
    new.department::text,
    null,
    '📌 Nuova richiesta di ' || new.sender || ': ' || new.subject,
    'requests',
    new.id
  );
  return new;
end;
$$;

drop trigger if exists requests_chat_notify on public.requests;
create trigger requests_chat_notify
  after insert on public.requests
  for each row execute function public.notify_department_chat();
