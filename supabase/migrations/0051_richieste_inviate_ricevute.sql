-- Solvex CRM — distingue le richieste "inviate" (create da te) da quelle
-- "ricevute" (create da qualcun altro, per te o per il tuo reparto), per
-- rendere più semplice la navigazione nella pagina Richieste (richiesta di
-- Andrea, ott 2026).
--
-- Finora chi aveva creato una richiesta si sapeva solo dal campo "sender"
-- (testo libero, il nome al momento della creazione — non cambia se la
-- persona viene rinominata, e non è utilizzabile per un filtro affidabile).
-- Aggiungiamo un collegamento vero alla persona; "sender" resta com'è, per
-- compatibilità con lo storico e per le richieste esterne non ancora
-- collegate a un profilo (integrazione email, Fase 2).

alter table public.requests add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- Recupero storico: dove il nome in "sender" corrisponde a UN SOLO profilo
-- esistente, colleghiamo quella riga a quel profilo. Un'approssimazione
-- volutamente prudente (se il nome è ambiguo o non corrisponde a nessuno,
-- la riga resta senza creatore collegato e compare solo tra le "ricevute").
update public.requests r
set created_by = p.id
from public.profiles p
where r.created_by is null
  and r.sender = p.full_name
  and (select count(*) from public.profiles p2 where p2.full_name = r.sender) = 1;

create index if not exists requests_created_by_idx on public.requests(created_by);
