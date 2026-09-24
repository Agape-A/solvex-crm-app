-- Solvex CRM — Fase 2b: pipeline fornitori più ricca + fornitori come pagina
-- a sé (prima erano un'unica pagina "Fornitori e acquisti")
-- Da eseguire dopo 0013_moduli_ruoli.sql.

-- Nuovi campi sulla richiesta d'acquisto: prezzo unitario, quantità (con
-- un'unità di misura libera, es. "kg", "pezzi"), specifiche d'ordine e un
-- allegato per la documentazione (schede tecniche, conferme, DDT...).
alter table public.purchase_requests add column if not exists unit_price numeric;
alter table public.purchase_requests add column if not exists quantity numeric;
alter table public.purchase_requests add column if not exists quantity_unit text;
alter table public.purchase_requests add column if not exists order_specs text not null default '';
alter table public.purchase_requests add column if not exists attachment_url text;
alter table public.purchase_requests add column if not exists attachment_name text;

-- Il vincolo verso i fornitori era "on delete cascade": cancellare un
-- fornitore avrebbe cancellato in automatico anche tutte le sue richieste
-- d'acquisto. Lo sostituiamo con un vincolo che invece IMPEDISCE la
-- cancellazione finché ci sono richieste collegate (la pagina Fornitori lo
-- controlla comunque anche lato interfaccia, come già succede per i clienti,
-- ma il database resta la barriera di sicurezza vera).
alter table public.purchase_requests drop constraint if exists purchase_requests_supplier_id_fkey;
alter table public.purchase_requests
  add constraint purchase_requests_supplier_id_fkey
  foreign key (supplier_id) references public.suppliers(id);

-- Allegati sulle richieste d'acquisto (bucket dedicato, come per le schede di
-- ricerca in 0013 e le campagne marketing in 0009).
insert into storage.buckets (id, name, public)
values ('purchase-attachments', 'purchase-attachments', true)
on conflict (id) do nothing;

drop policy if exists "purchase_attachments_read" on storage.objects;
create policy "purchase_attachments_read" on storage.objects
  for select using (bucket_id = 'purchase-attachments');

drop policy if exists "purchase_attachments_write" on storage.objects;
create policy "purchase_attachments_write" on storage.objects
  for insert
  with check (bucket_id = 'purchase-attachments' and public.current_role() in ('ufficio_acquisti', 'dirigente'));

drop policy if exists "purchase_attachments_delete" on storage.objects;
create policy "purchase_attachments_delete" on storage.objects
  for delete
  using (bucket_id = 'purchase-attachments' and public.current_role() in ('ufficio_acquisti', 'dirigente'));
