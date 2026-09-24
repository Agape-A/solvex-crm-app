-- I tag passano da testo libero a un elenco fisso e obbligatorio: almeno un
-- tag per record, scelto dalla stessa lista in tutti i moduli operativi
-- (trattative, richieste, clienti, appuntamenti, sviluppo progetto, ricerche,
-- fornitori, acquisti, contatti marketing). L'elenco vive anche in
-- src/lib/types.ts (CRM_TAGS) — le due copie vanno tenute allineate se in
-- futuro cambia.
--
-- "ALTRO" è un tag di scorta: copre i casi che non rientrano negli altri 16 e
-- qui sotto serve anche a sistemare i record già esistenti rimasti senza
-- nessun tag valido, così il vincolo "almeno un tag" vale subito per tutti,
-- non solo per i record nuovi da oggi in poi.

-- Gli appuntamenti non avevano ancora una colonna tag.
alter table public.appointments add column if not exists tags text[] not null default '{}';
create index if not exists appointments_tags_idx on public.appointments using gin (tags);

do $$
declare
  allowed text[] := array[
    'PRESENTAZIONE AZIENDALE','RICHIESTA PREZZO','RICHIESTA TECNICA','RICHIESTA DOCUMENTALE',
    'RICHIESTA CERTIFICAZIONE','CAMPIONATURA','CONFERMA ORDINE','NON CONFORMITÀ','RECLAMO CLIENTE',
    'CONTATTO TELEFONICO','CONTATTO EMAIL','INCONTRO IN SEDE','INCONTRO IN FIERA','VISITA FORNITORE',
    'INCONTRO INTERNO','RIUNIONE INTERNA','ALTRO'
  ];
  tbl text;
  tables text[] := array[
    'deals','requests','clients','appointments','development_projects',
    'research_records','suppliers','purchase_requests','marketing_contacts'
  ];
  fixed_count int;
begin
  foreach tbl in array tables loop
    -- 1) toglie dai record esistenti eventuali tag "vecchi" (testo libero)
    --    che non fanno parte della nuova lista fissa.
    execute format(
      'update public.%I set tags = array(select t from unnest(tags) as t where t = any(%L::text[])) where not (tags <@ %L::text[])',
      tbl, allowed, allowed
    );
    -- 2) i record rimasti senza nessun tag valido (non ne avevano, o li
    --    avevano tutti fuori lista) ricevono "ALTRO" come segnaposto, da
    --    poter precisare meglio con un giro di modifica.
    execute format(
      'update public.%I set tags = array[''ALTRO''] where coalesce(array_length(tags, 1), 0) = 0',
      tbl
    );
    get diagnostics fixed_count = row_count;
    raise notice 'Tabella %: % record sistemati con ALTRO (nessun tag valido rimasto dopo la pulizia)', tbl, fixed_count;

    -- 3) da qui in avanti: solo tag della lista fissa, e almeno uno.
    execute format('alter table public.%I drop constraint if exists %I_tags_lista_fissa_check', tbl, tbl);
    execute format(
      'alter table public.%I add constraint %I_tags_lista_fissa_check check (tags <@ %L::text[])',
      tbl, tbl, allowed
    );
    execute format('alter table public.%I drop constraint if exists %I_tags_obbligatorio_check', tbl, tbl);
    execute format(
      'alter table public.%I add constraint %I_tags_obbligatorio_check check (array_length(tags, 1) > 0)',
      tbl, tbl
    );
  end loop;
end $$;
