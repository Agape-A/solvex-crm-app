-- Solvex CRM — fix: le richieste inviate non comparivano più nella propria
-- pagina "Inviate" per chi non è dirigente (segnalato da Andrea, ott 2026:
-- "le inviano ma non ne rimane traccia, il ricevente le vede ma non
-- appaiono nella loro pagina").
--
-- Causa: 0051_richieste_inviate_ricevute.sql ha aggiunto created_by e la
-- divisione Inviate/Ricevute solo lato pagina (Requests.tsx filtra
-- "r.created_by === profile.id"), ma la RLS "requests_select" (ridefinita
-- dopo, in 0052_semplifica_ruoli.sql, senza saperlo) non lascia MAI leggere
-- una riga solo perché l'hai creata tu: ogni reparto vede solo le richieste
-- indirizzate al proprio reparto (o di cui è assegnatario). Chi manda una
-- richiesta a un reparto diverso dal proprio, senza assegnarsela, perde
-- subito di vista la propria richiesta — il destinatario la vede (è nel suo
-- reparto), il mittente no (non compare mai nella select, quindi nessun
-- filtro lato pagina può farla apparire in "Inviate").
-- (Il reparto "commerciale" sembrava funzionare per un altro motivo, non
-- legato a created_by: la sua condizione include "or type = 'esterna'", e
-- il modulo di invio richieste imposta sempre type='esterna' — una
-- scappatoia casuale, non una vera regola "le mie richieste".)
--
-- Corretto aggiungendo una condizione esplicita e uguale per tutti:
-- chi ha creato la richiesta la vede sempre, in qualunque reparto l'abbia
-- indirizzata.

drop policy if exists "requests_select" on public.requests;
create policy "requests_select" on public.requests
  for select using (
    public.current_role() = 'dirigente'
    or created_by = auth.uid()
    or (public.current_department() = 'tecnico' and department = 'tecnico')
    or (public.current_department() = 'commerciale' and (department = 'commerciale' or type = 'esterna'))
    or (public.current_department() = 'operativo' and (department = 'operativo' or assignee_id = auth.uid()))
    or (public.current_department() = 'ricerca' and (department = 'ricerca' or assignee_id = auth.uid()))
    or (public.current_department() = 'acquisti' and (department = 'acquisti' or assignee_id = auth.uid()))
  );
