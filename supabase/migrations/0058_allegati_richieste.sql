-- Solvex CRM — allegato (facoltativo) su "Richieste" (richiesta di Andrea,
-- ott 2026: poter inserire un file allegato in JPEG, Word, PDF o Excel).
-- Stesso schema già usato per gli allegati di Marketing/Pipeline acquisti
-- (campi attachment_url/attachment_name + bucket Storage dedicato, vedi
-- 0009_marketing_attachments.sql e 0014_pipeline_acquisti.sql) — qui il
-- bucket è aperto in scrittura a chiunque sia autenticato, non a un reparto
-- specifico, perché chiunque può creare una richiesta (requests_insert,
-- 0002_rls.sql, controlla solo "auth.uid() is not null").

alter table public.requests add column if not exists attachment_url text;
alter table public.requests add column if not exists attachment_name text;

insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', true)
on conflict (id) do nothing;

drop policy if exists "request_attachments_read" on storage.objects;
create policy "request_attachments_read" on storage.objects
  for select using (bucket_id = 'request-attachments');

drop policy if exists "request_attachments_write" on storage.objects;
create policy "request_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'request-attachments' and auth.uid() is not null);

drop policy if exists "request_attachments_delete" on storage.objects;
create policy "request_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'request-attachments' and auth.uid() is not null);
