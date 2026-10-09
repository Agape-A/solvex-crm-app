# Solvex CRM — scheletro Fase 1

Questo progetto è lo scheletro reale della Fase 1 descritta nella "Specifica
tecnica CRM Solvex": login vero, ruoli applicati dal database (non solo
dall'interfaccia), modello dati, pipeline clienti e richieste. Non include
ancora l'integrazione email (Fase 2) né tutta la rifinitura visiva del
prototipo dimostrativo — qui l'obiettivo è un'architettura corretta su cui
costruire, non l'aspetto finale.

## Struttura

```
supabase/migrations/   → schema, permessi (RLS) e trigger del database
supabase/seed.sql      → dati di esempio opzionali per lo sviluppo locale
src/lib/                → client Supabase e tipi TypeScript
src/context/            → autenticazione e ruolo dell'utente corrente
src/pages/               → Dashboard, Pipeline, Richieste, Login
```

## 1. Crea il progetto Supabase

1. Vai su [supabase.com](https://supabase.com), crea un account e un nuovo progetto (piano gratuito per iniziare).
2. Scegli una regione in UE se i dati dei clienti devono restare in Europa.
3. In **Project Settings → API** trovi `Project URL` e `anon public key`: ti serviranno al passo 4.

## 2. Esegui le migrazioni

Nel pannello Supabase, apri **SQL Editor** ed esegui, in ordine, il contenuto dei tre file in `supabase/migrations/`:

1. `0001_schema.sql` — crea le tabelle
2. `0002_rls.sql` — attiva i permessi per ruolo
3. `0003_triggers.sql` — automazioni (profilo automatico, log attività, limite del ruolo tecnico)

(Se preferisci la riga di comando, con [Supabase CLI](https://supabase.com/docs/guides/cli) installata: `supabase link` seguito da `supabase db push`.)

Facoltativo, solo per provare l'app con dati finti: dopo aver fatto il primo
accesso (passo 5), esegui anche `supabase/seed.sql`.

## 3. Configura l'ambiente locale

```bash
cp .env.example .env
```

Apri `.env` e incolla `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` dal passo 1.

## 4. Installa e avvia

```bash
npm install
npm run dev
```

L'app parte su `http://localhost:5173`.

## 5. Primo accesso e ruoli

Il tuo primo accesso (quello di chi crea il progetto) è passwordless (magic
link via email, tramite Supabase Auth): inserisci la tua email, arriva un
link, clicchi ed entri. Al primo accesso il database crea automaticamente un
tuo profilo con ruolo `operatore` di default — correggilo subito in
`dirigente` da Supabase, **Table Editor → profiles**, modificando il campo
`role` della tua riga (è l'unica volta che serve passare da Supabase: dopo
questo primo passaggio puoi invitare tutti gli altri dalla pagina "Utenti"
del CRM).

**Ruoli e reparti (dalla migrazione `0052`):** i ruoli sono solo due —
`operatore` (dipendente) e `dirigente` (titolare: accesso pieno a tutti i
dati e unico che può gestire gli altri utenti, dalla pagina "Utenti"). I
permessi veri su cosa un operatore può leggere/modificare (pipeline clienti,
richieste, ricerca&sviluppo, acquisti, ecc.) dipendono dal suo **reparto**
(`tecnico`, `commerciale`, `operativo`, `ricerca`, `acquisti`), non più da
una mansione nel ruolo — quindi ricordati di impostare/controllare il
reparto di ogni collega dalla pagina "Utenti": prima era più indicativo,
ora è il vero confine di accesso.

Per ogni collega successivo, niente più Supabase: dalla pagina **Utenti**
(visibile solo a dirigente) compila nome, email, ruolo e reparto e premi
"Invita" — arriva un'email con il link di accesso, già con il ruolo giusto
impostato. Dalla stessa pagina puoi anche:

- **Sospendere/riattivare** una persona: blocca subito l'accesso (non può
  più entrare) senza toccare il suo storico — trattative, richieste,
  commenti restano. È la via consigliata per chi lascia l'azienda.
- **Eliminare per sempre** un account — sempre, anche se la persona ha
  ancora trattative, richieste, commenti o altro storico collegato: quelle
  righe restano nel CRM, solo senza più il nome della persona eliminata
  (il campo proprietario/assegnatario/autore resta vuoto). Se invece vuoi
  bloccare l'accesso MA conservare quel collegamento, usa "Sospendi".
- **Scegliere quali pagine del menu vede**, persona per persona, spuntandole
  — indipendentemente dal reparto. Attenzione: questo decide solo cosa si
  *vede* nel sito (menu e apertura delle pagine); i permessi veri su cosa si
  può leggere/modificare restano decisi dal reparto, come sempre.

Tutto questo richiede di creare la Edge Function "manage-users" (vedi
sezione 6 qui sotto) e di eseguire la migrazione `0047` — finché non sono
fatte, l'unico modo per aggiungere qualcuno resta Supabase,
**Authentication → Users → Invite**, seguito dalla correzione manuale del
ruolo nella pagina "Utenti"; sospensione/eliminazione/pagine non sono
disponibili.

## 6. Gestione utenti: la funzione "manage-users" (da creare una volta sola)

Stessi passi della funzione "push-send" (sezione 7), ma più semplice: niente
segreti da impostare, e **la verifica JWT va lasciata ATTIVA** (il contrario
di push-send) perché qui a chiamare è il browser di chi è loggato, non il
database.

1. Esegui, dalla SQL Editor di Supabase, nell'ordine:
   - `supabase/migrations/0047_sospensione_pagine_utenti.sql` (aggiunge le
     colonne `active` e `page_overrides` a `profiles`);
   - `supabase/migrations/0048_realtime_profili.sql` (fa sì che chi è già
     collegato veda subito l'effetto di una sospensione o di un cambio
     pagine, senza dover ricaricare);
   - `supabase/migrations/0049_sospensione_blocca_rls.sql` (fa sì che una
     sospensione blocchi SUBITO anche i dati, non solo il prossimo accesso —
     vedi i commenti nel file per il perché);
   - `supabase/migrations/0050_eliminazione_utenti_storico.sql` (fa sì che
     eliminare un account funzioni sempre, anche con storico collegato —
     prima il database rifiutava la cancellazione in quel caso).
   - `supabase/migrations/0051_richieste_inviate_ricevute.sql` (aggiunge
     `created_by` a `requests`, per poter dividere la pagina Richieste in
     "Inviate"/"Ricevute").
   - `supabase/migrations/0052_semplifica_ruoli.sql` (riduce i ruoli a
     `operatore`/`dirigente` e sposta i permessi veri sui dati dal ruolo al
     reparto — vedi il paragrafo "Ruoli e reparti" al passo 5 qui sopra;
     dopo averla eseguita controlla/imposta il reparto di ogni collega).
   - `supabase/migrations/0053_chat_privata_e_commenti.sql` (aggiunge alla
     pagina Chat i messaggi privati 1-a-1 con ciascun collega — SOLO i due
     coinvolti li leggono, nemmeno un dirigente — e fa comparire lì anche i
     commenti con destinatario scritti nelle schede di richieste/
     trattative/clienti/ecc., come messaggi veri a cui si risponde
     direttamente dalla chat).
   Se non li hai già eseguiti con `supabase db push` o incollandoli a mano.
2. Supabase → **Edge Functions** → **Deploy a new function** → **Via
   Editor** → nome esatto `manage-users`.
   - Se avevi già creato una funzione chiamata `invite-user` nelle settimane
     scorse: lasciala pure, non serve cancellarla, ma il CRM ora chiama
     `manage-users` — senza questa il pulsante "Invita" (e i nuovi
     "Sospendi"/"Elimina") non funzionano.
3. Incolla il contenuto di `supabase/functions/manage-users/index.ts` e fai
   **Deploy**.
4. Non serve impostare nessun segreto: la funzione usa solo le variabili che
   Supabase fornisce già da sola a ogni funzione.
5. Prova: dalla pagina "Utenti" del CRM, invita te stesso con un'altra tua
   email (o un collega) e verifica che arrivi l'email di invito; prova poi
   "Sospendi" su un account di prova e verifica che non riesca più ad
   accedere.

**Importante — a differenza del resto del sito (che si aggiorna da solo a
ogni `git push`), questa funzione va rincollata a mano nel pannello Supabase
ogni volta che il suo codice cambia** (`supabase/functions/manage-users/index.ts`):
un `git push` da solo NON aggiorna quello che gira davvero su Supabase. Se
dopo un aggiornamento di questo file "Sospendi"/"Elimina" sembrano non avere
alcun effetto (nessun errore, ma nessun cambiamento), la causa più comune è
proprio questa: il pannello Supabase sta ancora eseguendo la versione
precedente — ripeti il passo 3 qui sopra.

## 7. Notifiche push (opzionale)

Con l'app installata (schermata Home su iPhone, Dock su Mac) può anche
mandare notifiche push vere e proprie — banner, suono, badge, anche a
schermo bloccato, come WhatsApp — per: scadenze dei lead dal Calendario,
chat, richieste ricevute, commenti ricevuti. Finché non completi questi
passaggi l'app funziona comunque normalmente, semplicemente non manda
notifiche (vedi il commento nella migrazione 0045).

**1) Esegui la migrazione** — SQL Editor, incolla ed esegui
`supabase/migrations/0045_notifiche_push.sql`. Se dà errore sulle righe
`create extension`, vai su **Database → Extensions**, abilita `pg_net` e
`pg_cron` da lì, poi rilancia il file.

**2) Crea la Edge Function** — **Edge Functions → Create a new function**,
chiamala `push-send`, incolla dentro tutto il contenuto di
`supabase/functions/push-send/index.ts` e salva/esegui il deploy (nessuna
riga di comando: si fa tutto dal pannello, come per le migrazioni).

**3) Imposta i segreti della funzione** — **Edge Functions → push-send →
Secrets** (o le impostazioni dei segreti del progetto, a seconda della
versione del pannello), aggiungi:

- `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` — la coppia di chiavi già
  generata per te (te le ho mandate in chat, non sono scritte qui perché
  sono segrete: la privata in particolare non deve mai finire su GitHub).
- `VAPID_SUBJECT` — `mailto:` seguito da una tua email di contatto, es.
  `mailto:info@solvex.it`.
- `PUSH_DISPATCH_SECRET` — anche questo te l'ho mandato in chat: è la
  "password" che solo il database e la funzione si scambiano, per
  impedire a chiunque altro di far comparire notifiche a caso.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` li imposta già Supabase da
solo per ogni Edge Function: non serve aggiungerli.

**4) Collega la funzione al database** — SQL Editor, esegui (sostituendo
`<project-ref>` con quello del tuo progetto, visibile nell'URL del pannello
o in Project Settings → API, e `<stesso-valore-di-PUSH_DISPATCH_SECRET>`
con il segreto del punto 3):

```sql
update public.app_config set value = 'https://<project-ref>.supabase.co/functions/v1/push-send'
  where key = 'push_edge_function_url';
update public.app_config set value = '<stesso-valore-di-PUSH_DISPATCH_SECRET>'
  where key = 'push_dispatch_secret';
```

**5) Aggiungi la chiave pubblica al frontend** — è già nel tuo `.env`
locale (`VITE_VAPID_PUBLIC_KEY`, non è segreta: viaggia comunque fino al
browser). Aggiungi la stessa riga anche su **Vercel → Project Settings →
Environment Variables** con lo stesso valore, poi fai un redeploy (anche
solo "Redeploy" sull'ultimo deployment, senza bisogno di un nuovo push).

**6) Prova** — apri l'app installata, menu laterale → **"Attiva
notifiche"** (sopra "Esci"), accetta il permesso del browser. Da un altro
utente scrivi un commento/messaggio/richiesta indirizzato a te: la
notifica dovrebbe comparire entro pochi secondi. Le scadenze dei lead si
controllano una volta al giorno (06:30 UTC, modificabile rilanciando le
ultime due righe della migrazione 0045 con un altro orario).

Limite di iOS: le notifiche push funzionano solo se l'app è stata aggiunta
alla schermata Home (non nella scheda di Safari) e con iOS 16.4 o
successivo.

## Cosa manca ancora (prossimi passi)

- **Integrazione email (Fase 2)**: la colonna `source_email_id` sulla tabella
  `requests` è già pronta a riceverla; manca la funzione serverless che
  ascolta Microsoft Graph e scrive le richieste, come descritto nella
  specifica tecnica.
- **Interfaccia pipeline a kanban trascinabile**: qui la pipeline è mostrata
  come elenco raggruppato per fase; il prototipo dimostrativo aveva colonne
  trascinabili — è un miglioramento di interfaccia, non di architettura.
- **Report e grafici**: la sezione Report del prototipo non è ancora
  collegata a dati reali.
- **Allegati** (schede tecniche/SDS): la tabella `clients`/`deals` non ha
  ancora un campo per i file; Supabase Storage è la scelta naturale quando
  servirà.

## Note di sicurezza

I permessi per ruolo sono applicati con **Row Level Security** direttamente
nel database (`supabase/migrations/0002_rls.sql`): anche se qualcuno
aggirasse l'interfaccia e chiamasse le API Supabase direttamente, il database
stesso rifiuterebbe le operazioni fuori dal suo ruolo. Il caso più delicato —
il tecnico che può modificare solo il campo "note" di una trattativa — è
applicato da un trigger dedicato (`0003_triggers.sql`), perché la RLS da sola
non distingue tra colonne diverse della stessa riga.
