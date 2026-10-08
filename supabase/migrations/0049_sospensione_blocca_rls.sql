-- Solvex CRM — la sospensione blocca subito anche i dati (RLS), non solo
-- l'accesso futuro (richiesta di Andrea, ott 2026: premendo "Sospendi"
-- l'account deve scollegarsi SUBITO da tutti i suoi dispositivi, non solo
-- al prossimo accesso).
--
-- Un account bannato lato Supabase Auth (manage-users, Admin API) non può
-- più accedere né rinnovare il proprio token, ma un token già valido
-- (di norma fino a un'ora) continuerebbe altrimenti a leggere/scrivere
-- dati normalmente finché non scade da solo, su qualunque dispositivo
-- dove la persona è rimasta loggata — l'abbonamento Realtime aggiunto in
-- AuthContext.tsx (0048) copre solo i dispositivi con l'app aperta in quel
-- momento, non uno chiuso con un token ancora valido in tasca.
--
-- current_role() è la funzione che QUASI TUTTE le regole di sicurezza
-- (RLS) di questo progetto usano per decidere i permessi (vedi
-- 0002_rls.sql e quasi ogni migrazione successiva). Ridefinendola qui
-- perché restituisca NULL per un profilo sospeso, ogni controllo
-- "current_role() = ..." smette di essere vero in un colpo solo, su tutte
-- le tabelle, per tutti i dispositivi — compreso uno con un token ancora
-- formalmente valido. Da quel momento la persona non può più leggere né
-- scrivere nulla nel CRM, anche senza un refresh o un logout esplicito.

create or replace function public.current_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

-- Una persona sospesa non deve potersi riattivare da sola modificando il
-- proprio profilo con una chiamata diretta alle API (la policy
-- "profiles_update_own" permetteva a chiunque di modificare la PROPRIA
-- riga, sospensione inclusa, perché non dipendeva da current_role()).
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid() and active);
