-- Solvex CRM — "Mansione referente" sulla scheda cliente (richiesta di
-- Andrea, ott 2026): "aggiungi anche la mansione del referente cliente
-- sulla scheda cliente". Semplice campo di testo libero accanto a
-- "Referente" (contact_name) — non diverso da email/telefono referente
-- come scrittura/permessi: nessuna policy RLS da toccare, le policy
-- "clients_update" (0040_nuovo_contatto.sql) già permettono a commerciale
-- e dirigente/amministrazione di scrivere su qualsiasi campo della riga
-- (a parte "tech_responsible_id", bloccato dal trigger di
-- 0041_responsabile_cliente.sql, che qui non tocco).
--
-- Da non confondere con "mansione_referente" dentro
-- deals.activity_details (0040_nuovo_contatto.sql): quella è compilata ad
-- ogni singola interazione/attività, questa invece è permanente sulla
-- scheda cliente, come "contact_name".

alter table public.clients add column if not exists contact_role text;
