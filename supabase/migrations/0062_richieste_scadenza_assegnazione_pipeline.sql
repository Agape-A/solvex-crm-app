-- Solvex CRM — tre correzioni segnalate da Andrea dopo l'uso, nov 2026.

-- ============ 1) Scadenza di una richiesta posticipabile ============
-- "Nelle richieste la possibilità di aggiornare la scadenza, in modo da
-- posticiparla se necessario, tenendo sempre traccia della prima." La
-- colonna "due_date" resta libera di essere aggiornata (lato frontend,
-- Requests.tsx), mentre "due_date_original" si fissa da sola alla prima
-- scadenza impostata e non è più modificabile da nessuno, nemmeno passando
-- un valore diverso in un update — lo garantisce questo trigger, non serve
-- nessun controllo lato client.

alter table public.requests add column if not exists due_date_original date;

create or replace function public.enforce_request_due_date_original() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.due_date_original := new.due_date;
  elsif tg_op = 'UPDATE' then
    new.due_date_original := old.due_date_original;
  end if;
  return new;
end;
$$;

drop trigger if exists requests_before_write_due_date_original on public.requests;
create trigger requests_before_write_due_date_original
  before insert or update on public.requests
  for each row execute function public.enforce_request_due_date_original();

-- Richieste già esistenti: l'originale è la scadenza che hanno oggi (non
-- c'è modo di recuperare una scadenza precedente che non è mai stata
-- registrata come tale).
update public.requests set due_date_original = due_date where due_date_original is null and due_date is not null;

-- ============ 2) Chi ha creato una richiesta può modificarla ============
-- "Lo stato dovrebbe essere possibile da modificare dall'utente che lo ha
-- aperto, retrocedendolo nel caso di modifiche." Causa: requests_update
-- (0052) non aveva il bypass "created_by = auth.uid()" che requests_select
-- aveva già preso (0057) — chi manda una richiesta a un reparto diverso dal
-- proprio la vede (0057) ma non può cambiarne lo stato, la scadenza, o
-- nient'altro: solo chi è nel reparto destinatario (o l'assegnatario) può
-- aggiornarla. Stessa correzione di 0057, qui per l'update.

drop policy if exists "requests_update" on public.requests;
create policy "requests_update" on public.requests
  for update using (
    public.current_role() = 'dirigente'
    or created_by = auth.uid()
    or (public.current_department() = 'tecnico' and department = 'tecnico')
    or (public.current_department() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_department() = 'operativo' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_department() = 'ricerca' and (department = 'ricerca' or assignee_id = auth.uid()))
    or (public.current_department() = 'acquisti' and (department = 'acquisti' or assignee_id = auth.uid()))
  );

-- ============ 3) Commerciale non vedeva nessuna scheda in Pipeline ============
-- "I commerciali lamentano di non vedere nella pipeline clienti nessuna
-- scheda, e quindi di non poter interagire." Causa: un lead creato dal
-- dirigente ha owner_id = il dirigente stesso (voluto: "Utente" è sempre e
-- solo chi crea la trattativa, non più riassegnabile da nessuno — vedi
-- Pipeline.tsx, commento sopra canEditFields, richiesta di Andrea, ott
-- 2026) — ma deals_select per il commerciale mostra solo le trattative
-- proprie o senza nessun utente ("owner_id = auth.uid() or owner_id is
-- null"), quindi un lead creato dalla direzione restava invisibile a
-- TUTTO il commerciale. Corretto allargando la visibilità, SENZA toccare
-- la regola "l'utente non si riassegna": un lead il cui "Utente" è un
-- dirigente/amministrazione diventa visibile a tutto il commerciale,
-- esattamente come uno senza nessun utente.

drop policy if exists "deals_select" on public.deals;
create policy "deals_select" on public.deals
  for select using (
    public.current_role() = 'dirigente'
    or (public.current_department() = 'commerciale' and (
          owner_id = auth.uid()
          or owner_id is null
          or owner_id in (select id from public.profiles where role = 'dirigente')
        ))
    or (public.current_department() = 'tecnico' and (requires_tech_validation = true or owner_id = auth.uid()))
  );
