-- Solvex CRM — Fase 1: permessi reali (Row Level Security)
-- Questa è la parte che nel prototipo dimostrativo non esisteva: qui i permessi
-- sono applicati dal database stesso, non solo nascosti/mostrati nell'interfaccia.

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.deals enable row level security;
alter table public.requests enable row level security;
alter table public.activity_log enable row level security;

-- Ruolo dell'utente correntemente autenticato (usata in tutte le policy sotto)
create or replace function public.current_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ============ PROFILES ============
-- Tutti possono leggere i profili (servono per mostrare nomi di owner/assegnatari).
-- Ognuno può aggiornare solo il proprio.

create policy "profiles_select_all" on public.profiles
  for select using (true);

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- ============ CLIENTS ============
-- Tabella "Ruoli e permessi" della specifica:
-- operatore nessun accesso · tecnico sola lettura · commerciale/dirigente piena gestione

create policy "clients_select" on public.clients
  for select using (public.current_role() in ('tecnico', 'commerciale', 'dirigente'));

create policy "clients_write" on public.clients
  for all
  using (public.current_role() in ('commerciale', 'dirigente'))
  with check (public.current_role() in ('commerciale', 'dirigente'));

-- ============ DEALS (pipeline) ============
-- Stessa visibilità dei clients. L'inserimento e la cancellazione restano
-- a commerciale/dirigente; il tecnico può aggiornare una riga ma il trigger
-- in 0003_triggers.sql gli permette di toccare solo il campo "note".

create policy "deals_select" on public.deals
  for select using (public.current_role() in ('tecnico', 'commerciale', 'dirigente'));

create policy "deals_insert" on public.deals
  for insert with check (public.current_role() in ('commerciale', 'dirigente'));

create policy "deals_update" on public.deals
  for update
  using (public.current_role() in ('tecnico', 'commerciale', 'dirigente'))
  with check (public.current_role() in ('tecnico', 'commerciale', 'dirigente'));

create policy "deals_delete" on public.deals
  for delete using (public.current_role() in ('commerciale', 'dirigente'));

-- ============ REQUESTS (richieste) ============
-- operatore: proprie o del reparto operativo
-- tecnico: reparto tecnico
-- commerciale: reparto commerciale o richieste esterne
-- dirigente: tutte

create policy "requests_select" on public.requests
  for select using (
    public.current_role() = 'dirigente'
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and (department = 'operativo' or assignee_id = auth.uid()))
  );

-- Chiunque sia autenticato può creare una nuova richiesta (come nel prototipo,
-- il pulsante "Nuova richiesta" è disponibile a tutti i ruoli).
create policy "requests_insert" on public.requests
  for insert with check (auth.uid() is not null);

create policy "requests_update" on public.requests
  for update using (
    public.current_role() = 'dirigente'
    or (public.current_role() = 'tecnico' and department = 'tecnico')
    or (public.current_role() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_role() = 'operatore' and (department = 'operativo' or assignee_id = auth.uid()))
  );

-- ============ ACTIVITY LOG ============
-- Sola lettura per chiunque sia autenticato. Nessuna policy di insert per i
-- client: le righe arrivano solo dai trigger (security definer), vedi 0003.

create policy "activity_log_select" on public.activity_log
  for select using (auth.uid() is not null);
