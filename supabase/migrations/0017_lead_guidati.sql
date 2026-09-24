-- Solvex CRM — Fase 2: lead guidati per tag attività
-- Per un B2B come Solvex un lead non è quasi mai "vendere una unità": è
-- spesso l'inizio di un percorso (presentazione, richiesta prezzo, ecc.).
-- Questa migration aggiunge due colonne, entrambe pensate per crescere nel
-- tempo senza bisogno di nuove migration ad ogni nuovo tag guidato:
-- 1) clients.is_customer — spunta "acquista già nostri prodotti", utile sia
--    per i lead su un cliente già in anagrafica sia per uno creato al volo;
-- 2) deals.activity_details (jsonb) — i campi specifici del "tag attività"
--    scelto in fase di creazione del lead (es. "PRESENTAZIONE AZIENDALE" →
--    incontro, temi trattati, prodotti presentati, prossimi passi;
--    "RICHIESTA PREZZO" → prodotto da quotare, riferimento, concorrenza,
--    quantità target). Una colonna jsonb invece di tante colonne quasi
--    sempre vuote, perché l'elenco dei tag guidati crescerà in più fasi
--    ("INTANTO FAI QUESTE POI ANDIAMO AVANTI" — Andrea, set 2026).

alter table public.clients add column if not exists is_customer boolean not null default false;

alter table public.deals add column if not exists activity_details jsonb;
