-- Solvex CRM — secondo intervento dell'audit di sicurezza di nov 2026: i 7
-- bucket di allegati erano tutti pubblici, e la regola di lettura su
-- ciascuno era aperta a chiunque (nessun controllo di ruolo/reparto), a
-- differenza delle regole di scrittura/cancellazione sugli stessi bucket,
-- che invece erano corrette. Risultato: chi conosceva o indovinava
-- l'indirizzo di un file poteva scaricarlo senza nessun account, da
-- qualunque browser al mondo; e anche un dipendente autenticato ma di un
-- reparto diverso poteva leggere tutto chiamando direttamente l'API,
-- bypassando i controlli dell'interfaccia.
--
-- Da qui in avanti il frontend genera un indirizzo firmato e a scadenza
-- (createSignedUrl) ogni volta che un allegato viene aperto, invece di
-- salvare un indirizzo pubblico permanente (vedi src/lib/attachments.ts) —
-- gli allegati caricati PRIMA di questa migrazione restano apribili senza
-- bisogno di toccare i dati già salvati, perché quella funzione riconosce
-- anche il vecchio formato di indirizzo.
--
-- "purchase-attachments" e "supplier-attachments" non sono più usati dal
-- frontend (sostituiti da "procurement-attachments" nel 2021, vedi
-- 0021_pipeline_acquisti_attivita.sql) ma restano bucket reali con
-- eventuali file già caricati: vanno chiusi comunque.

update storage.buckets set public = false
where id in (
  'marketing-attachments', 'research-attachments', 'purchase-attachments',
  'deal-attachments', 'supplier-attachments', 'procurement-attachments',
  'request-attachments'
);

-- ============ Lettura: ora ristretta come scrittura/cancellazione ============

drop policy if exists "marketing_attachments_read" on storage.objects;
create policy "marketing_attachments_read" on storage.objects
  for select using (
    bucket_id = 'marketing-attachments'
    and (public.current_role() = 'dirigente' or public.current_department() = 'commerciale')
  );

drop policy if exists "research_attachments_read" on storage.objects;
create policy "research_attachments_read" on storage.objects
  for select using (
    bucket_id = 'research-attachments'
    and (public.current_role() = 'dirigente' or public.current_department() = 'ricerca')
  );

drop policy if exists "purchase_attachments_read" on storage.objects;
create policy "purchase_attachments_read" on storage.objects
  for select using (
    bucket_id = 'purchase-attachments'
    and (public.current_role() = 'dirigente' or public.current_department() = 'acquisti')
  );

drop policy if exists "deal_attachments_read" on storage.objects;
create policy "deal_attachments_read" on storage.objects
  for select using (
    bucket_id = 'deal-attachments'
    and (public.current_role() = 'dirigente' or public.current_department() = 'commerciale')
  );

drop policy if exists "supplier_attachments_read" on storage.objects;
create policy "supplier_attachments_read" on storage.objects
  for select using (
    bucket_id = 'supplier-attachments'
    and (public.current_role() = 'dirigente' or public.current_department() = 'acquisti')
  );

drop policy if exists "procurement_attachments_read" on storage.objects;
create policy "procurement_attachments_read" on storage.objects
  for select using (
    bucket_id = 'procurement-attachments'
    and (public.current_role() = 'dirigente' or public.current_department() = 'acquisti')
  );

drop policy if exists "request_attachments_read" on storage.objects;
create policy "request_attachments_read" on storage.objects
  for select using (bucket_id = 'request-attachments' and auth.uid() is not null);

-- ============ Bonus: due regole rimaste con un ruolo che non esiste più ============
--
-- "deal_attachments_write/delete" (0018) e "marketing_attachments_write/
-- delete" (0009) controllavano ancora "current_role() in ('commerciale',
-- 'dirigente')": da quando i ruoli sono stati semplificati a operatore/
-- dirigente (0052_semplifica_ruoli.sql), current_role() non restituisce
-- più 'commerciale' per nessuno — quindi, senza che nessuno se ne
-- accorgesse, solo la direzione poteva più caricare o cancellare un
-- allegato su una trattativa o una campagna marketing, non più il
-- commerciale. Corretto qui con lo stesso schema già usato altrove da
-- 0052 in poi (ruolo + reparto).

drop policy if exists "deal_attachments_write" on storage.objects;
create policy "deal_attachments_write" on storage.objects
  for insert
  with check (
    bucket_id = 'deal-attachments'
    and (public.current_role() = 'dirigente' or public.current_department() = 'commerciale')
  );

drop policy if exists "deal_attachments_delete" on storage.objects;
create policy "deal_attachments_delete" on storage.objects
  for delete
  using (
    bucket_id = 'deal-attachments'
    and (public.current_role() = 'dirigente' or public.current_department() = 'commerciale')
  );

drop policy if exists "marketing_attachments_write" on storage.objects;
create policy "marketing_attachments_write" on storage.objects
  for insert
  with check (
    bucket_id = 'marketing-attachments'
    and (public.current_role() = 'dirigente' or public.current_department() = 'commerciale')
  );

drop policy if exists "marketing_attachments_delete" on storage.objects;
create policy "marketing_attachments_delete" on storage.objects
  for delete
  using (
    bucket_id = 'marketing-attachments'
    and (public.current_role() = 'dirigente' or public.current_department() = 'commerciale')
  );
