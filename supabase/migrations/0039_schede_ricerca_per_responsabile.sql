-- Solvex CRM — ogni laboratorista (dottore_laboratorio) vede/gestisce solo
-- le proprie schede di ricerca (richiesta di Andrea, ott 2026): stessa
-- logica già applicata a clienti/trattative di commerciale in
-- 0038_proprietario_clienti_e_validazione_tecnica.sql.
--
-- La colonna "owner_id" ("Responsabile") esisteva già su research_records
-- (0013_moduli_ruoli.sql) e viene già impostata di default al creatore
-- della scheda (vedi NewResearchForm in Research.tsx), ma finora non
-- limitava la visibilità: ogni dottore_laboratorio vedeva/modificava TUTTE
-- le schede, di chiunque. Qui si restringe la policy; "Responsabile" resta
-- liberamente riassegnabile solo da dirigente/amministrazione (lato
-- interfaccia, vedi Research.tsx) — un laboratorista può assegnare una
-- scheda solo a se stesso, imposto qui anche lato RLS con "with check".
--
-- Scheda senza responsabile (owner_id null, es. tutte quelle già esistenti
-- se create prima di questa migrazione senza impostarlo): resta visibile a
-- tutto il reparto come "non assegnata", stessa scelta fatta per i clienti
-- non ancora assegnati — evita che schede già in corso spariscano di colpo
-- dalla vista di chiunque il giorno in cui questa migrazione viene eseguita.
--
-- Richieste e Calendario per questo ruolo restano come sono già oggi (vedi
-- 0035_reparto_ricerca.sql e 0037_correzione_appuntamenti.sql: già scoped a
-- "proprie" lì) — non toccati da questa migrazione. Report e Richieste
-- restano fuori dal menu di Ricerca&Sviluppo (scelta confermata da Andrea,
-- ott 2026): nessuna modifica a Layout.tsx o Report.tsx.

create index if not exists research_records_owner_id_idx on public.research_records (owner_id);

drop policy if exists "research_records_select" on public.research_records;
create policy "research_records_select" on public.research_records
  for select using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'dottore_laboratorio' and (owner_id = auth.uid() or owner_id is null))
  );

drop policy if exists "research_records_insert" on public.research_records;
create policy "research_records_insert" on public.research_records
  for insert with check (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'dottore_laboratorio' and (owner_id = auth.uid() or owner_id is null))
  );

drop policy if exists "research_records_update" on public.research_records;
create policy "research_records_update" on public.research_records
  for update
  using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'dottore_laboratorio' and (owner_id = auth.uid() or owner_id is null))
  )
  with check (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'dottore_laboratorio' and (owner_id = auth.uid() or owner_id is null))
  );

drop policy if exists "research_records_delete" on public.research_records;
create policy "research_records_delete" on public.research_records
  for delete using (
    public.current_role() in ('dirigente', 'amministrazione')
    or (public.current_role() = 'dottore_laboratorio' and (owner_id = auth.uid() or owner_id is null))
  );
