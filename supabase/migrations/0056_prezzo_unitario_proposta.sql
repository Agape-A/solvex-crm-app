-- Solvex CRM — aggiunge il prezzo unitario alla finestra "Proposta Inviata"
-- (richiesta di Andrea, ott 2026: "per descrivere la proposta, oltre al
-- valore, va aggiunto anche il prezzo unitario"). Si affianca al Valore,
-- non lo sostituisce: restano due dati distinti, inseriti entrambi a mano
-- (confermato con Andrea con una domanda diretta) — stessa logica di
-- obbligatorietà già in vigore per Valore/Quantità, vedi
-- enforce_proposal_fields() in 0044_proposta_inviata.sql.

alter table public.deals add column if not exists proposal_unit_price numeric(12,2);

create or replace function public.enforce_proposal_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'proposta' and old.stage is distinct from new.stage then
    if new.proposal_type is null or new.proposal_reference_code is null or trim(new.proposal_reference_code) = '' then
      raise exception 'Tipo di proposta e Codice riferimento sono obbligatori per passare a "Proposta Inviata".';
    end if;
    if new.proposal_type in ('fattura_proforma', 'proposta_acquisto')
       and (new.proposal_value is null or new.proposal_quantity is null or new.proposal_unit_price is null) then
      raise exception 'Valore, Quantità e Prezzo unitario sono obbligatori per "Fattura Proforma" e "Proposta d''acquisto".';
    end if;
  end if;
  return new;
end;
$$;
