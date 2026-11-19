-- Solvex CRM — due correzioni emerse dall'analisi di sicurezza richiesta
-- da Andrea (nov 2026), in vista anche di una commercializzazione ad
-- altre aziende: due falle che non richiedono nessun cambiamento
-- all'interfaccia, quindi vengono corrette subito; le altre (vedi il
-- documento consegnato in chat) richiedono più lavoro e restano da
-- programmare a parte.
--
-- ============ 1) AUTO-PROMOZIONE A DIRIGENTE ============
--
-- "profiles_update_own" (0002_rls.sql, mai cambiata da allora) permette a
-- chiunque di modificare la PROPRIA riga, ma senza "with check" controlla
-- SOLO quale riga si può toccare (la propria), non QUALI CAMPI. Significa
-- che un qualsiasi account "operatore" può, con una singola chiamata
-- diretta alle API Supabase (bypassando completamente l'interfaccia —
-- basta il proprio token, già presente in ogni richiesta che il browser
-- fa normalmente), aggiornare la propria riga in "profiles" impostando
-- role='dirigente', un reparto diverso, o "page_overrides" a piacere,
-- diventando amministratore completo del CRM in un colpo solo — da lì
-- può anche gestire/eliminare altri utenti (manage-users ricontrolla il
-- ruolo, ma lo rilegge dalla stessa tabella appena alterata).
--
-- Stesso principio già usato per "deals" (enforce_deal_update_permissions,
-- vedi 0052/0064): un trigger blocca il cambiamento dei campi sensibili a
-- meno che non sia la direzione a farlo, o la Edge Function manage-users
-- (service role, usata per invito/sospensione/riattivazione — deve poter
-- continuare a funzionare).

create or replace function public.enforce_profile_self_service() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- La Edge Function manage-users usa la service role (bypassa la RLS ma
  -- non i trigger) per invitare/sospendere/riattivare: deve poter
  -- continuare a cambiare questi campi. Lo stesso vale per un dirigente
  -- che gestisce un altro account dalla pagina Utenti.
  if auth.role() = 'service_role' or public.current_role() = 'dirigente' then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.department is distinct from old.department
     or new.active is distinct from old.active
     or new.page_overrides is distinct from old.page_overrides
  then
    raise exception 'Non puoi modificare da solo ruolo, reparto, stato attivo o pagine personalizzate del tuo profilo: solo la direzione può farlo.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_self_service_guard on public.profiles;
create trigger profiles_self_service_guard
  before update on public.profiles
  for each row execute function public.enforce_profile_self_service();

-- ============ 2) "deal_deadline_notifications" SENZA RLS ============
--
-- Tabella di appoggio di send_deal_deadline_reminders() (0045), creata
-- senza mai abilitare la Row Level Security: su Supabase, senza RLS,
-- qualunque utente autenticato (e potenzialmente anche anonimo) può
-- leggerla e scriverla direttamente dalle API REST, bypassando la
-- funzione che la usa — in pratica chiunque potrebbe inserire a mano una
-- riga per "deal_id" + oggi per impedire che quel lead risulti notificato
-- in giornata. Nessuna pagina del CRM la usa direttamente (solo la
-- funzione, che gira come proprietario del database e quindi non viene
-- toccata da questo cambiamento): attivare la RLS senza alcuna policy la
-- rende semplicemente irraggiungibile dall'esterno, come già succede per
-- "app_config" (vedi commento in 0045).

alter table public.deal_deadline_notifications enable row level security;
