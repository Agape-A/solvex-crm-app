-- Andrea ha chiesto di rendere i target più liberi: non più un solo target
-- "vendite" + un solo target "acquisti" per persona, ma quanti obiettivi si
-- vuole, ciascuno con un titolo scelto dalla direzione (es. "Vendite 2026",
-- "Nuovi clienti fiera", "Campionature inviate"), assegnabile a chiunque in
-- azienda — non solo a chi vende o acquista.
--
-- Per un obiettivo con nome libero il CRM non ha un dato reale da calcolare
-- da solo (a differenza delle vendite chiuse o degli acquisti confermati,
-- che si leggono dalle tabelle esistenti): l'avanzamento (current_value) lo
-- aggiorna quindi a mano chi è responsabile dell'obiettivo, o la direzione.
--
-- La tabella creata dalla 0026 (con il vincolo "vendite"/"acquisti" e la
-- coppia valore/numero-operazioni) viene sostituita da questa più
-- flessibile. Se avevi già inserito qualche target con la 0026, andrà
-- ricreato a mano con il nuovo modello — il vecchio schema non si può
-- convertire in automatico in uno con un titolo libero che prima non
-- esisteva. Mi scuso per il doppio lavoro.

drop table if exists public.annual_targets;

create table public.annual_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  year integer not null,
  title text not null,
  unit text not null default '',
  target_value numeric not null default 0,
  current_value numeric not null default 0,
  note text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists annual_targets_user_idx on public.annual_targets(user_id);
create index if not exists annual_targets_year_idx on public.annual_targets(year);

alter table public.annual_targets enable row level security;

-- Ognuno vede i propri obiettivi, la direzione li vede tutti, di chiunque.
drop policy if exists "annual_targets_select" on public.annual_targets;
create policy "annual_targets_select" on public.annual_targets
  for select
  using (user_id = auth.uid() or public.current_role() = 'dirigente');

-- Solo la direzione crea un nuovo obiettivo (sceglie a chi assegnarlo,
-- titolo, target).
drop policy if exists "annual_targets_insert" on public.annual_targets;
create policy "annual_targets_insert" on public.annual_targets
  for insert
  with check (public.current_role() = 'dirigente');

-- L'avanzamento lo può aggiornare chi è responsabile dell'obiettivo (il
-- proprietario) oppure la direzione — anche il resto della riga, per
-- restare semplice: non è un dato sensibile e la direzione può comunque
-- sempre correggerlo.
drop policy if exists "annual_targets_update" on public.annual_targets;
create policy "annual_targets_update" on public.annual_targets
  for update
  using (user_id = auth.uid() or public.current_role() = 'dirigente')
  with check (user_id = auth.uid() or public.current_role() = 'dirigente');

-- Solo la direzione può eliminare un obiettivo.
drop policy if exists "annual_targets_delete" on public.annual_targets;
create policy "annual_targets_delete" on public.annual_targets
  for delete
  using (public.current_role() = 'dirigente');

drop trigger if exists annual_targets_before_update on public.annual_targets;
create trigger annual_targets_before_update
  before update on public.annual_targets
  for each row execute function public.touch_updated_at();
