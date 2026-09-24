-- Andrea ha deciso che collegare l'invio diretto a Resend è troppo
-- complesso da attivare per ora (serviva un account Resend, un dominio
-- email verificato e il deploy di una funzione da riga di comando) — si
-- torna quindi alla situazione precedente: le campagne restano bozza ->
-- pronta, senza invio. Contatti, liste, bozze di campagna ed export CSV NON
-- sono toccati da questa migrazione: continuano a funzionare come sempre.
-- L'unica cosa che sparisce è il tracciamento dell'invio introdotto dalla
-- 0024, che non ha mai fatto in tempo a essere usato davvero (la Edge
-- Function collegata non è mai stata pubblicata).
--
-- Nota sull'enum: la 0024 ha aggiunto il valore 'inviata' al tipo
-- marketing_campaign_status. Postgres non permette di togliere un valore da
-- un enum senza ricrearlo interamente (rischioso se altro nel frattempo lo
-- usasse): restare con un valore in più ma ormai inutilizzato dall'interfaccia
-- non causa alcun problema, quindi non lo tolgo.

drop table if exists public.marketing_campaign_sends;

alter table public.marketing_campaigns drop column if exists sent_at;
alter table public.marketing_campaigns drop column if exists sent_count;
alter table public.marketing_campaigns drop column if exists send_error;
