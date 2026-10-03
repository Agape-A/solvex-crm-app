-- Solvex CRM — "Responsabile cliente" per i tecnici (richiesta di Andrea,
-- ott 2026, lato cliente): "ogni utente tecnico dovrà avere assegnato un
-- tot di clienti... un campo... responsabile cliente... ogni utente potrà
-- filtrare la lista clienti per ritrovare tutti i clienti di un dato
-- utente responsabile".
--
-- Decisioni prese insieme ad Andrea (AskUserQuestion):
--   - È un campo NUOVO e separato da "owner_id"/"Utente" (il commerciale
--     creatore, automatico e bloccato per tutti dalla revisione "Nuovo
--     Contatto" — vedi 0040_nuovo_contatto.sql): qui non si tocca owner_id.
--   - Solo dirigente/amministrazione possono assegnarlo/cambiarlo — i
--     tecnici non si auto-assegnano clienti.
--   - Resta SOLO un campo informativo + filtro: non cambia la visibilità
--     dei clienti per il tecnico, che continua a essere quella di
--     0038_proprietario_clienti_e_validazione_tecnica.sql (basata su
--     "requires_tech_validation" sulle trattative collegate). Qualsiasi
--     ruolo può leggere/filtrare per "Responsabile cliente" — la select
--     "clients_select" non cambia qui.

alter table public.clients add column if not exists tech_responsible_id uuid references public.profiles(id) on delete set null;

create index if not exists clients_tech_responsible_id_idx on public.clients (tech_responsible_id);

-- Solo dirigente/amministrazione possono impostare o cambiare questo campo.
-- La RLS (clients_insert/clients_update, 0040) permette già a commerciale e
-- dirigente/amministrazione di scrivere sulla riga per altri motivi; questo
-- trigger restringe, come già fatto per il tecnico sulle trattative in
-- enforce_deal_update_permissions (0003_triggers.sql), QUALE campo può
-- davvero toccare chi non è dirigente/amministrazione.

create or replace function public.enforce_client_tech_responsible_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.tech_responsible_id is not null and public.current_role() not in ('dirigente', 'amministrazione') then
      raise exception 'Solo dirigente o amministrazione possono assegnare il responsabile cliente (tecnico)';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.tech_responsible_id is distinct from old.tech_responsible_id
       and public.current_role() not in ('dirigente', 'amministrazione') then
      raise exception 'Solo dirigente o amministrazione possono assegnare il responsabile cliente (tecnico)';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_before_write_tech_responsible on public.clients;
create trigger clients_before_write_tech_responsible
  before insert or update on public.clients
  for each row execute function public.enforce_client_tech_responsible_permissions();
