-- I tag spariscono per ora da tutte le pagine (torneranno più avanti, con
-- un disegno da rivedere): tolgo quindi il vincolo "almeno un tag" che la
-- 0016 aveva messo su ogni modulo, altrimenti da oggi nessun modulo
-- riuscirebbe più a salvare un nuovo record (l'interfaccia non chiede più
-- il tag, quindi arriverebbe un array vuoto). Lascio invece intatto il
-- vincolo "solo valori della lista fissa" (tags_lista_fissa_check): non dà
-- fastidio a un array vuoto e i tag già assegnati ai record esistenti
-- restano nel database, pronti per quando li reintrodurremo.

do $$
declare
  tbl text;
  tables text[] := array[
    'deals','requests','clients','appointments','development_projects',
    'research_records','suppliers','purchase_requests','marketing_contacts'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table public.%I drop constraint if exists %I_tags_obbligatorio_check', tbl, tbl);
  end loop;
end $$;

alter table public.procurement_activities drop constraint if exists procurement_activities_tags_obbligatorio_check;
