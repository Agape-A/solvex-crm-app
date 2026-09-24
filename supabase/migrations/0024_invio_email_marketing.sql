-- Invio email vero e proprio dalle campagne di Marketing, tramite Resend
-- (https://resend.com), scelto da Andrea tra le opzioni proposte. La chiave
-- API di Resend NON deve mai stare nel codice del browser (chiunque potrebbe
-- leggerla e mandare email a nome dell'azienda): vive solo lato server, come
-- secret della Edge Function "send-campaign" (supabase/functions/send-campaign),
-- che questa migrazione da sola non installa — vedi le istruzioni di setup
-- consegnate insieme a questo file per i passaggi che Andrea deve fare a mano
-- (serve un account Resend, un dominio email verificato, e il deploy della
-- funzione con la Supabase CLI: cose che non posso fare al posto suo).

-- ============ Nuovo stato "inviata" ============
-- Le campagne restano bozza -> pronta come oggi; "inviata" è il terzo stato,
-- raggiunto solo dalla Edge Function dopo un invio riuscito (mai scelto a
-- mano dall'interfaccia, la trovi come sola lettura una volta raggiunta).

alter type marketing_campaign_status add value if not exists 'inviata';

-- ============ Tracciamento dell'invio sulla campagna ============

alter table public.marketing_campaigns add column if not exists sent_at timestamptz;
alter table public.marketing_campaigns add column if not exists sent_count integer not null default 0;
alter table public.marketing_campaigns add column if not exists send_error text;

-- ============ Log per destinatario ============
-- Una riga per ogni email inviata (o tentata) da una campagna: utile per
-- sapere a chi è arrivata davvero una newsletter e per capire, in caso di
-- errore, quali indirizzi non hanno ricevuto nulla. Scritta solo dalla Edge
-- Function (chiave service role, bypassa la RLS): agli utenti del CRM resta
-- visibile solo in lettura.

create table if not exists public.marketing_campaign_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  contact_id uuid not null references public.marketing_contacts(id) on delete cascade,
  email text not null,
  status text not null default 'inviata',
  error text,
  sent_at timestamptz not null default now()
);

create index if not exists marketing_campaign_sends_campaign_idx on public.marketing_campaign_sends (campaign_id);

alter table public.marketing_campaign_sends enable row level security;

drop policy if exists "marketing_campaign_sends_select" on public.marketing_campaign_sends;
create policy "marketing_campaign_sends_select" on public.marketing_campaign_sends
  for select
  using (public.current_role() in ('commerciale', 'dirigente'));

-- Nessuna policy di insert/update/delete per gli utenti normali: solo la
-- Edge Function (con la service role key, che ignora la RLS) scrive qui.
