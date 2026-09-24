-- Solvex CRM — Fase 2b: nuovi tipi di attività guidati ("Schema Nuova
-- Pipeline" di Andrea) + assegnazione multipla con richieste calendarizzate.
--
-- 1) Amplia l'elenco fisso dei tag con i 4 nuovi tipi usati dal form guidato
--    della Pipeline (Prima Visita, Visita Commerciale Cliente, Visita
--    Tecnica Cliente) e dal futuro modulo Fornitori (Reclamo Fornitore —
--    Visita Fornitore esisteva già). Ampliamento puro: i tag già validi
--    restano validi, quindi non serve nessuna pulizia dei record esistenti
--    come nella migration 0016 (che invece restringeva l'elenco).
-- 2) Aggiunge il bucket per gli allegati (foto/video) dei reclami cliente,
--    stesso schema già usato per gli allegati delle richieste d'acquisto
--    (0014_pipeline_acquisti.sql).
--
-- Le richieste generate dall'assegnazione multipla ("Assegnazione attività
-- a") non richiedono nessuna modifica di schema: usano la tabella
-- "requests" già esistente (assignee_id, ref_table/ref_id verso il lead,
-- due_date — già letto dal Calendario, vedi 0004_calendar.sql).

do $$
declare
  allowed text[] := array[
    'PRESENTAZIONE AZIENDALE','RICHIESTA PREZZO','RICHIESTA TECNICA','RICHIESTA DOCUMENTALE',
    'RICHIESTA CERTIFICAZIONE','CAMPIONATURA','CONFERMA ORDINE','NON CONFORMITÀ','RECLAMO CLIENTE',
    'CONTATTO TELEFONICO','CONTATTO EMAIL','INCONTRO IN SEDE','INCONTRO IN FIERA','VISITA FORNITORE',
    'INCONTRO INTERNO','RIUNIONE INTERNA',
    'PRIMA VISITA','VISITA COMMERCIALE CLIENTE','VISITA TECNICA CLIENTE','RECLAMO FORNITORE',
    'ALTRO'
  ];
  tbl text;
  tables text[] := array[
    'deals','requests','clients','appointments','development_projects',
    'research_records','suppliers','purchase_requests','marketing_contacts'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table public.%I drop constraint if exists %I_tags_lista_fissa_check', tbl, tbl);
    execute format(
      'alter table public.%I add constraint %I_tags_lista_fissa_check check (tags <@ %L::text[])',
      tbl, tbl, allowed
    );
  end loop;
end $$;

insert into storage.buckets (id, name, public)
values ('deal-attachments', 'deal-attachments', true)
on conflict (id) do nothing;

drop policy if exists "deal_attachments_read" on storage.objects;
create policy "deal_attachments_read" on storage.objects
  for select using (bucket_id = 'deal-attachments');

drop policy if exists "deal_attachments_write" on storage.objects;
create policy "deal_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'deal-attachments' and public.current_role() in ('commerciale', 'dirigente'));

drop policy if exists "deal_attachments_delete" on storage.objects;
create policy "deal_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'deal-attachments' and public.current_role() in ('commerciale', 'dirigente'));
