-- Solvex CRM — Fase 2c: fasi della pipeline riviste con Andrea (set 2026).
-- "Qualificato" non era chiaro (diventa "Primo Contatto", solo un cambio di
-- etichetta in src/lib/types.ts, nessuna modifica di dati) e "Trattativa"
-- era poco utile per il loro settore: dopo l'offerta si passa direttamente
-- a vinta o persa.
--
-- Il valore enum "trattativa" resta fisicamente nel tipo deal_stage — in
-- Postgres nativo non si può togliere un valore da un enum senza ricrearlo
-- da zero, ed è uno sforzo/rischio non giustificato per un valore che da
-- oggi l'interfaccia non propone più. Qui ci limitiamo a spostare i pochi
-- record di test eventualmente rimasti su "trattativa" a "proposta" (l'unica
-- fase aperta rimasta prima di vinta/persa), e a togliere "trattativa" dal
-- trigger di auto-followup.

update public.deals set stage = 'proposta' where stage = 'trattativa';

create or replace function public.auto_followup_deal() returns trigger
language plpgsql as $$
begin
  if new.stage = 'proposta'
     and new.next_action is null
     and (tg_op = 'INSERT' or new.stage is distinct from old.stage)
  then
    new.next_action = current_date + 7;
  end if;
  return new;
end;
$$;
