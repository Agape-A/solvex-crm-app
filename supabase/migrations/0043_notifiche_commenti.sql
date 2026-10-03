-- Solvex CRM — notifiche per i commenti (richiesta di Andrea, ott 2026,
-- "pipeline clienti" punto 1): "i commenti inviati e ricevuti così come sono
-- adesso sono inutili, perché li legge solo chi li scrive, invece
-- dovrebbero essere inviati ai vari utenti a seconda della necessità".
--
-- Il problema è il "commento pubblico" (record_comments senza alcun
-- destinatario, vedi 0011_collaborazione.sql): resta lì finché qualcuno non
-- riapre per caso quello stesso record. Il percorso "manda come richiesta
-- a…" (tabella "requests", 0011/0033) invece funziona già bene — ha un
-- destinatario obbligatorio e il proprio pallino su "Richieste" — e qui non
-- si tocca.
--
-- Soluzione (confermata da Andrea via domande dirette): il "commento
-- pubblico" scompare, ogni commento richiede un destinatario (persona o
-- reparto, esattamente come già succede per le richieste) ed è segnalato da
-- un pallino di notifica DEDICATO, separato da quello di "Richieste" — i due
-- concetti restano distinti, con due pallini distinti, applicato dappertutto
-- dove c'è <CommentThread> (Pipeline, Richieste, Calendario, Clienti,
-- Fornitori, Ricerca&Sviluppo).
--
-- Stesso pattern "visto per record" già usato per la chat (vedi
-- 0036_notifiche_semplici.sql), qui per (ref_table, ref_id) invece che per
-- canale — altrimenti si ripeterebbe lo stesso bug ("aprire un record segna
-- come letti anche gli altri non ancora aperti mai").

-- ============ 1) Destinatario obbligatorio sui commenti ============

alter table public.record_comments
  add column if not exists recipient_id uuid references public.profiles(id) on delete set null;

alter table public.record_comments
  add column if not exists recipient_department request_department;

-- "not valid": i commenti pubblici già esistenti restano in tabella senza
-- destinatario (dati storici, non li tocchiamo) ma ogni nuovo
-- inserimento/modifica da qui in avanti deve averne esattamente uno — niente
-- migrazione dati per il passato, serve solo per il futuro.
alter table public.record_comments
  drop constraint if exists record_comments_recipient_check;

alter table public.record_comments
  add constraint record_comments_recipient_check
  check (
    (recipient_id is not null and recipient_department is null)
    or (recipient_id is null and recipient_department is not null)
  ) not valid;

-- ============ 2) "Visto per record", come chat_channel_reads ma per i commenti ============

create table if not exists public.record_comment_reads (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  ref_table text not null,
  ref_id uuid not null,
  last_seen_at timestamptz not null default now(),
  primary key (profile_id, ref_table, ref_id)
);

alter table public.record_comment_reads enable row level security;

drop policy if exists "record_comment_reads_select" on public.record_comment_reads;
create policy "record_comment_reads_select" on public.record_comment_reads
  for select using (profile_id = auth.uid());

drop policy if exists "record_comment_reads_insert" on public.record_comment_reads;
create policy "record_comment_reads_insert" on public.record_comment_reads
  for insert with check (profile_id = auth.uid());

drop policy if exists "record_comment_reads_update" on public.record_comment_reads;
create policy "record_comment_reads_update" on public.record_comment_reads
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ============ 3) Conteggio commenti non letti indirizzati a me, per tabella ============
-- "security definer" per lo stesso motivo di unread_chat_by_channel(): deve
-- unire record_comments (leggibile da chiunque sia autenticato, vedi 0011)
-- con record_comment_reads (limitata alle proprie righe). Raggruppato per
-- ref_table, così ogni pagina (Pipeline/Richieste/Calendario/Clienti/
-- Fornitori/Ricerca&Sviluppo) mostra il proprio pallino, non un totale unico
-- che mischierebbe record di pagine diverse. Conta solo i commenti con un
-- destinatario che sono "per me" (la mia persona o il mio reparto), scritti
-- da altri, non ancora visti per quello specifico record.

create or replace function public.unread_record_comments_by_table() returns table (ref_table text, unread_count integer)
language sql stable security definer set search_path = public as $$
  select c.ref_table, count(*)::int as unread_count
  from public.record_comments c
  left join public.record_comment_reads r
    on r.profile_id = auth.uid() and r.ref_table = c.ref_table and r.ref_id = c.ref_id
  where c.author_id is distinct from auth.uid()
    and (c.recipient_id = auth.uid() or c.recipient_department = public.current_department())
    and c.created_at > coalesce(r.last_seen_at, '-infinity'::timestamptz)
  group by c.ref_table
$$;
