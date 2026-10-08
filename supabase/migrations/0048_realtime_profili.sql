-- Solvex CRM — attiva la Realtime sulla tabella "profiles" (richiesta di
-- Andrea, ott 2026: sospensione/pagine personalizzate si salvavano ma non
-- arrivavano subito a chi aveva già la pagina del CRM aperta — vedi
-- l'abbonamento aggiunto in AuthContext.tsx). Stesso schema già usato per
-- chat e commenti in 0011_collaborazione.sql: "alter publication ... add
-- table" non ha una forma "if not exists", quindi il controllo manuale
-- sotto serve per poter rieseguire questo file senza errori.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
