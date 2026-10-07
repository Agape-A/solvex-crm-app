-- Solvex CRM — sospensione/eliminazione utenti e pagine visibili per
-- persona (richiesta di Andrea, ott 2026: "darmi la possibilità... di
-- eliminare un user o sospendere, e spuntare le pagine che può vedere in
-- modo da creare velocemente policy").
--
-- "active": lo stato di sospensione mostrato nella pagina Utenti. Il blocco
-- vero dell'accesso avviene lato Supabase Auth (banned_until, impostato
-- dalla Edge Function manage-users tramite Admin API, che il CRM non può
-- chiamare da browser) — questa colonna serve solo a far vedere subito lo
-- stato "Sospeso"/"Attivo" nella pagina senza dover interrogare auth.users.
--
-- "page_overrides": quando è NULL (il default — nessun cambiamento per chi
-- è già dentro) le pagine visibili nel menu restano quelle previste dal
-- ruolo, come oggi. Quando è impostato (anche a lista vuota) diventa la
-- lista esatta delle pagine (i percorsi tipo "/clienti") che quella persona
-- vede — indipendentemente dal ruolo.
--
-- IMPORTANTE (spiegato anche ad Andrea): questo controlla SOLO il menu e
-- l'apertura diretta delle pagine nel sito (vedi canSeePage() in
-- Layout.tsx e ProtectedRoute.tsx). I permessi veri su cosa si può
-- leggere/modificare restano decisi dal ruolo tramite le regole di
-- sicurezza del database (RLS, supabase/migrations/0002_rls.sql e
-- seguenti) — non vengono toccati da questa migrazione. Scelta discussa
-- con Andrea: una vera policy per-persona anche sui dati richiederebbe
-- riscrivere le RLS di quasi tutte le tabelle, un lavoro molto più grande.

alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists page_overrides text[];
