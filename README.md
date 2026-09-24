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

Il login è passwordless (magic link via email, tramite Supabase Auth): inserisci
la tua email, arriva un link, clicchi ed entri. Al primo accesso il database
crea automaticamente un tuo profilo con ruolo `operatore` di default.

Per assegnarti (o assegnare a un collega) il ruolo giusto — `tecnico`,
`commerciale` o `dirigente` — vai su Supabase, **Table Editor → profiles**, e
modifica il campo `role` della riga corrispondente. In una fase successiva
vale la pena costruire una piccola schermata "Utenti" riservata ai dirigenti
per farlo dall'app, invece che dal pannello Supabase.

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
- **Interfaccia di gestione utenti** per i dirigenti, invece di editare i
  ruoli da Supabase direttamente.

## Note di sicurezza

I permessi per ruolo sono applicati con **Row Level Security** direttamente
nel database (`supabase/migrations/0002_rls.sql`): anche se qualcuno
aggirasse l'interfaccia e chiamasse le API Supabase direttamente, il database
stesso rifiuterebbe le operazioni fuori dal suo ruolo. Il caso più delicato —
il tecnico che può modificare solo il campo "note" di una trattativa — è
applicato da un trigger dedicato (`0003_triggers.sql`), perché la RLS da sola
non distingue tra colonne diverse della stessa riga.
