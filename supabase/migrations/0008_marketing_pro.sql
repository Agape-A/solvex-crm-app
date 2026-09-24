-- Solvex CRM — Fase 1 (estensione): Marketing "prodotto professionale"
-- Quattro pezzi, ispirati a cosa offrono le piattaforme di email marketing
-- professionali (Brevo, Mailchimp, ActiveCampaign...):
--
-- 1) tag sui contatti, per la segmentazione;
-- 2) campagne in bozza (oggetto + contenuto + lista di destinazione), pronte
--    per l'invio quando la connessione email sarà collegata — non inviano
--    ancora nulla da sole;
-- 3) nessuna tabella nuova per la dashboard: usa i dati già presenti;
-- 4) una policy che permette l'iscrizione pubblica (form senza login) alla
--    newsletter, per chi si iscrive da solo da un link condiviso.

-- ============ 1) Tag ============

alter table public.marketing_contacts add column if not exists tags text[] not null default '{}';
create index if not exists marketing_contacts_tags_idx on public.marketing_contacts using gin (tags);

-- ============ 2) Campagne in bozza ============

create type marketing_campaign_status as enum ('bozza', 'pronta');

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body text not null default '',
  list_id uuid references public.marketing_lists(id) on delete set null,
  status marketing_campaign_status not null default 'bozza',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_campaigns enable row level security;

create policy "marketing_campaigns_all" on public.marketing_campaigns
  for all
  using (public.current_role() in ('commerciale', 'dirigente'))
  with check (public.current_role() in ('commerciale', 'dirigente'));

create trigger marketing_campaigns_before_update
  before update on public.marketing_campaigns
  for each row execute function public.touch_updated_at();

-- ============ 4) Iscrizione pubblica ============
-- Chi non è autenticato (ruolo "anon" di Supabase) può inserire una riga in
-- marketing_contacts SOLO se rispetta esattamente questa forma: consenso
-- esplicito a true con la sua data, provenienza "sito_web". Non può leggere,
-- modificare o cancellare nulla — solo inserire la propria iscrizione. Le due
-- policy di insert (questa e quella per commerciale/dirigente) convivono: si
-- applica quella che l'utente soddisfa.

create policy "marketing_contacts_public_signup" on public.marketing_contacts
  for insert
  with check (
    consent_marketing = true
    and consent_date is not null
    and source = 'sito_web'
  );
