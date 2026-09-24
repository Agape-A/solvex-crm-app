-- Pallino di notifica (badge rosso) accanto a "Chat" e "Richieste" nel menu:
-- serve sapere quando ciascun utente ha aperto per l'ultima volta la chat,
-- per contare i messaggi arrivati dopo. Per "Richieste" non serve nulla di
-- nuovo: si conta semplicemente chi ha status = 'nuova', dato già presente.

alter table public.profiles
  add column if not exists chat_last_seen_at timestamptz not null default now();
