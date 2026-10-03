-- Solvex CRM — campi obbligatori quando una trattativa passa a "Proposta
-- Inviata" (richiesta di Andrea, ott 2026, "pipeline clienti" punto 4):
-- "quando si fa passare un'attività da Sviluppo cliente a proposta inviata,
-- devi far aprire una finestra per inserire i seguenti campi obbligatori:
-- Tipo di proposta..., Codice riferimento..., Valore se si tratta di Ordine
-- o fattura Proforma, Quantità (idem)". Confermato con Andrea: "Ordine" =
-- "Proposta d'acquisto", quindi Valore/Quantità sono obbligatori per
-- "Proposta d'acquisto" e "Fattura Proforma", non per le altre due.
--
-- Campi sul deal stesso (non dentro activity_details, come invece i
-- "dettagli guidati" di ogni singola interazione — vedi 0040_nuovo_
-- contatto.sql): qui descrivono la proposta della trattativa nel suo
-- complesso, non un'attività puntuale, quindi colonne dedicate come
-- value_estimate/next_action.
--
-- Il vincolo è applicato anche lato trigger (prima di questa riga la UI da
-- sola non bastava a fidarsi, vedi enforce_deal_update_permissions in
-- 0003_triggers.sql per lo stesso principio): si attiva solo quando la fase
-- STA diventando "proposta" (non sui salvataggi successivi a trattativa già
-- in quella fase, altrimenti basterebbe cambiare una nota qualsiasi per
-- ribloccarsi sullo stesso controllo).

-- "create type" non ha una forma "if not exists" in Postgres: va protetta
-- a mano, altrimenti rieseguire il file (anche solo perché un'esecuzione
-- precedente si era fermata più sotto) dà errore "already exists" — stesso
-- problema già risolto altrove con "if not exists (select ...)" (vedi la
-- publication realtime in 0011_collaborazione.sql).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'proposal_type') then
    create type proposal_type as enum ('prima_offerta', 'aggiornamento_prezzi', 'fattura_proforma', 'proposta_acquisto');
  end if;
end $$;

alter table public.deals add column if not exists proposal_type proposal_type;
alter table public.deals add column if not exists proposal_reference_code text;
alter table public.deals add column if not exists proposal_value numeric(12,2);
alter table public.deals add column if not exists proposal_quantity numeric(12,2);

create or replace function public.enforce_proposal_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'proposta' and old.stage is distinct from new.stage then
    if new.proposal_type is null or new.proposal_reference_code is null or trim(new.proposal_reference_code) = '' then
      raise exception 'Tipo di proposta e Codice riferimento sono obbligatori per passare a "Proposta Inviata".';
    end if;
    if new.proposal_type in ('fattura_proforma', 'proposta_acquisto')
       and (new.proposal_value is null or new.proposal_quantity is null) then
      raise exception 'Valore e Quantità sono obbligatori per "Fattura Proforma" e "Proposta d''acquisto".';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists deals_enforce_proposal_fields on public.deals;
create trigger deals_enforce_proposal_fields
  before update on public.deals
  for each row execute function public.enforce_proposal_fields();
