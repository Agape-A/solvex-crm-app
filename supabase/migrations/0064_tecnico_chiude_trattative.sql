-- Solvex CRM — il reparto tecnico può ora portare una trattativa fino a
-- "vinto" o "perso" (richiesta di Andrea, nov 2026: "oltre che inserire i
-- leeds, devono poter modificare gli stati fino ad arrivare a definire
-- una trattativa vinta o persa").
--
-- Finora enforce_deal_update_permissions() (0052_semplifica_ruoli.sql)
-- lasciava al tecnico la modifica del solo campo "note": qualunque altro
-- cambiamento, compreso lo stage (lead/qualificato/proposta/trattativa/
-- vinto/perso), veniva bloccato con un errore. Qui si toglie SOLO "stage"
-- da questo blocco — tutto il resto (cliente, prodotto, valore stimato,
-- proprietario, prossima azione, "richiede validazione tecnica") resta
-- non modificabile dal tecnico, come prima.
--
-- Le righe su cui il tecnico può intervenire restano quelle già previste
-- da deals_update (0059_tecnico_crea_contatti.sql): una propria trattativa
-- o una che richiede validazione tecnica — questa migrazione non tocca
-- quella policy, solo il controllo più fine sui campi fatto dal trigger.
--
-- "Devono poter inserire i clienti" (stessa richiesta): già attivo da
-- 0061_tecnico_inserisce_clienti.sql, nessuna modifica necessaria qui —
-- verificare solo che quella migrazione sia stata eseguita.

create or replace function public.enforce_deal_update_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_department() = 'tecnico' and public.current_role() <> 'dirigente' then
    if new.client_id is distinct from old.client_id
       or new.client_name is distinct from old.client_name
       or new.product is distinct from old.product
       or new.value_estimate is distinct from old.value_estimate
       or new.owner_id is distinct from old.owner_id
       or new.next_action is distinct from old.next_action
       or new.requires_tech_validation is distinct from old.requires_tech_validation
    then
      raise exception 'Il reparto tecnico può modificare solo lo stato e il campo "note" di una trattativa';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
