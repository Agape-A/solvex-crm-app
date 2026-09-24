-- Solvex CRM — Fase 1 (estensione): calendario
-- Aggiunge una scadenza alle richieste e una tabella per gli appuntamenti
-- (visite commerciali, sopralluoghi tecnici...), così la sezione Calendario
-- può mostrare in un unico posto: prossime azioni sulle trattative (campo
-- deals.next_action, già esistente), scadenze delle richieste, e appuntamenti.

alter table public.requests add column if not exists due_date date;

-- Ogni utente può ora essere collegato a un reparto: serve per proporre, nel
-- modulo Richieste, un elenco di persone a cui assegnare direttamente una
-- richiesta (invece del solo reparto generico). Si imposta come il ruolo,
-- da Supabase → Table Editor → profiles, finché non esiste una schermata
-- di gestione utenti dedicata.
alter table public.profiles add column if not exists department request_department;

create type appointment_type as enum ('visita_commerciale', 'sopralluogo_tecnico', 'altro');

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  subject text not null,
  appointment_at timestamptz not null,
  type appointment_type not null default 'visita_commerciale',
  assignee_id uuid references public.profiles(id),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index appointments_at_idx on public.appointments(appointment_at);
create index requests_due_date_idx on public.requests(due_date);

-- ============ RLS ============
-- Stessa visibilità di deals: sola lettura per il tecnico, piena gestione per
-- commerciale/dirigente. L'operatore non vede gli appuntamenti (come per la
-- pipeline), ma vede comunque le proprie scadenze sulle richieste tramite la
-- policy già esistente su "requests".

alter table public.appointments enable row level security;

create policy "appointments_select" on public.appointments
  for select using (public.current_role() in ('tecnico', 'commerciale', 'dirigente'));

create policy "appointments_insert" on public.appointments
  for insert with check (public.current_role() in ('commerciale', 'dirigente'));

create policy "appointments_update" on public.appointments
  for update
  using (public.current_role() in ('tecnico', 'commerciale', 'dirigente'))
  with check (public.current_role() in ('tecnico', 'commerciale', 'dirigente'));

create policy "appointments_delete" on public.appointments
  for delete using (public.current_role() in ('commerciale', 'dirigente'));

create trigger appointments_before_update
  before update on public.appointments
  for each row execute function public.touch_updated_at();
