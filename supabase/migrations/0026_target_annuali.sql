-- Target annuali: la direzione può impostare, per ogni singolo commerciale
-- / tecnico (target "vendite") o addetto acquisti (target "acquisti"), un
-- obiettivo annuale in valore (€) e in numero di operazioni. Non c'è nessun
-- campo "raggiunto" da aggiornare a mano: la pagina Report calcola sempre il
-- progresso dal vivo confrontando il target con i dati reali (trattative
-- chiuse vinte per chi vende, richieste d'acquisto confermate/ricevute per
-- chi acquista), quindi cresce da solo man mano che si registrano vendite o
-- acquisti, esattamente come chiesto.

create table if not exists public.annual_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  year integer not null,
  metric text not null check (metric in ('vendite', 'acquisti')),
  target_value numeric not null default 0,
  target_count integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, year, metric)
);

create index if not exists annual_targets_user_idx on public.annual_targets(user_id);

alter table public.annual_targets enable row level security;

-- Ognuno vede il proprio target (per sapere a che punto è); la direzione li
-- vede tutti, di chiunque.
drop policy if exists "annual_targets_select" on public.annual_targets;
create policy "annual_targets_select" on public.annual_targets
  for select
  using (user_id = auth.uid() or public.current_role() = 'dirigente');

-- Solo la direzione può impostarli, modificarli o toglierli.
drop policy if exists "annual_targets_write" on public.annual_targets;
create policy "annual_targets_write" on public.annual_targets
  for all
  using (public.current_role() = 'dirigente')
  with check (public.current_role() = 'dirigente');

drop trigger if exists annual_targets_before_update on public.annual_targets;
create trigger annual_targets_before_update
  before update on public.annual_targets
  for each row execute function public.touch_updated_at();
