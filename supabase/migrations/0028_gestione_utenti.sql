-- Andrea ha chiesto di poter creare lei gli utenti e gestirne l'accesso, ora
-- che il CRM è online e chiunque conoscesse l'indirizzo poteva in teoria
-- registrarsi da solo con la sua email (il login "link via email" crea un
-- nuovo account automaticamente se quell'indirizzo non esiste ancora).
--
-- Questa migrazione prepara solo il lato database: permette alla direzione
-- di aggiornare il profilo (in particolare il ruolo) di un utente qualsiasi,
-- non solo il proprio. Finora un dirigente poteva correggere il ruolo di un
-- collega solo aprendo la tabella "profiles" da Supabase — ora può farlo
-- direttamente dalla nuova pagina "Utenti" nel CRM.
--
-- Non tocca la creazione di nuovi utenti: quella resta da fare a mano dal
-- pannello Supabase (Authentication → Users → Invite), come spiegato a
-- parte — creare un utente con la sua email/password richiede privilegi
-- (service role) che il CRM, giustamente, non può avere lato browser.

drop policy if exists "profiles_update_dirigente" on public.profiles;
create policy "profiles_update_dirigente" on public.profiles
  for update
  using (public.current_role() = 'dirigente')
  with check (public.current_role() = 'dirigente');

-- Per riconoscere facilmente chi è chi nella pagina "Utenti" (i nomi da soli
-- non bastano se due persone si chiamano allo stesso modo), salviamo anche
-- l'email di ciascun utente sul profilo — finora era visibile solo dentro
-- Supabase (tabella auth.users), non nel CRM.

alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'operatore'),
    new.email
  );
  return new;
end;
$$;
