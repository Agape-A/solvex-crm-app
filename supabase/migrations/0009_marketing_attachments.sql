-- Solvex CRM — Fase 1 (estensione): allegati sulle campagne, rimozione
-- modulo di iscrizione pubblico (non serve, tolto su richiesta).

-- ============ Rimozione iscrizione pubblica ============
-- Toglie il permesso di inserimento pubblico introdotto in 0008: nessuno
-- non autenticato può più scrivere in marketing_contacts.

drop policy if exists "marketing_contacts_public_signup" on public.marketing_contacts;

-- ============ Allegati sulle campagne ============
-- Un file per campagna (es. un PDF prodotto, un listino), caricato in uno
-- storage bucket dedicato. Bucket pubblico in lettura (l'allegato di una
-- newsletter è comunque destinato a essere condiviso), ma solo
-- commerciale/dirigente possono caricarci o cancellarci file.

alter table public.marketing_campaigns add column if not exists attachment_url text;
alter table public.marketing_campaigns add column if not exists attachment_name text;

insert into storage.buckets (id, name, public)
values ('marketing-attachments', 'marketing-attachments', true)
on conflict (id) do nothing;

-- "drop ... if exists" prima di ogni "create policy": Postgres non supporta
-- "create policy if not exists", quindi senza questo, rieseguire per sbaglio
-- questo file (es. incollandolo due volte nell'SQL Editor) darebbe sempre
-- l'errore "policy already exists" invece di limitarsi a non fare nulla.

drop policy if exists "marketing_attachments_read" on storage.objects;
create policy "marketing_attachments_read" on storage.objects
  for select using (bucket_id = 'marketing-attachments');

drop policy if exists "marketing_attachments_write" on storage.objects;
create policy "marketing_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'marketing-attachments' and public.current_role() in ('commerciale', 'dirigente'));

drop policy if exists "marketing_attachments_delete" on storage.objects;
create policy "marketing_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'marketing-attachments' and public.current_role() in ('commerciale', 'dirigente'));
