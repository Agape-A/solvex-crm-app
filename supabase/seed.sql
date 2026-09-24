-- Dati di esempio per sviluppo locale — facoltativo, ma consigliato per
-- provare la pipeline a kanban e la gestione richieste con un volume di dati
-- realistico invece che con 2-3 righe.
--
-- Il set di dati rispecchia i tre canali di vendita reali dell'azienda:
-- concerie (vendita diretta), distributori/agenti (Italia ed estero) e
-- aziende chimiche (che rivendono a marchio proprio) — vedi 0005_client_types.sql.
--
-- Puoi eseguirlo più volte senza problemi: ogni esecuzione aggiunge nuove
-- righe (non sovrascrive quelle esistenti). Se vuoi ripartire pulito, vedi la
-- sezione "reset" in fondo a questo file.

-- ============ CLIENTI ============

insert into public.clients (name, sector, client_type, country) values
  -- Concerie — vendita diretta
  ('Conceria Valdarno Srl', 'Concia', 'conceria', 'Italia'),
  ('Concerie Vicentine Srl', 'Concia', 'conceria', 'Italia'),
  ('Pellami Irpinia Srl', 'Concia', 'conceria', 'Italia'),
  ('Conceria Santa Croce SpA', 'Concia', 'conceria', 'Italia'),
  ('Cuoificio Toscano Srl', 'Concia', 'conceria', 'Italia'),
  ('Concia Veneta Group Srl', 'Concia', 'conceria', 'Italia'),
  ('Pelletterie del Chianti Srl', 'Concia', 'conceria', 'Italia'),
  ('Conceria Industriale Salernitana Srl', 'Concia', 'conceria', 'Italia'),
  -- Distributori/agenti — Italia ed estero
  ('Distribuzione Chimica Veneta Srl', 'Distribuzione chimica', 'distributore', 'Italia'),
  ('Agenzia Chimica Toscana Srl', 'Distribuzione chimica', 'distributore', 'Italia'),
  ('Química del Cuero S.L.', 'Distribuzione chimica', 'distributore', 'Spagna'),
  ('Kimya Deri Dış Ticaret A.Ş.', 'Distribuzione chimica', 'distributore', 'Turchia'),
  ('Leather Chem do Brasil Ltda', 'Distribuzione chimica', 'distributore', 'Brasile'),
  -- Aziende chimiche — rivendita a marchio proprio (private label)
  ('ChemBrand Formulazioni Srl', 'Distribuzione chimica', 'azienda_chimica', 'Italia'),
  ('Solfarma Chimica Srl', 'Distribuzione chimica', 'azienda_chimica', 'Italia')
on conflict do nothing;

-- ============ TRATTATIVE (pipeline) ============
-- owner_id lasciato vuoto: una volta che i colleghi avranno fatto il primo
-- accesso, puoi assegnare le trattative dall'app (o da qui via SQL usando gli
-- id reali che trovi in Authentication → Users).

insert into public.deals (client_name, product, value_estimate, stage, requires_tech_validation, note, next_action) values
  ('Conceria Santa Croce SpA', 'Ingrassanti sintetici per pellame', 16400, 'lead', false, '', current_date + 2),
  ('Cuoificio Toscano Srl', 'Coloranti acidi per pelle', 8200, 'lead', false, '', current_date + 5),
  ('Química del Cuero S.L.', 'Ausiliari di riconcia — nuova gamma', 24000, 'lead', false, '', current_date + 3),
  ('Concerie Vicentine Srl', 'Prodotti di rifinizione poliuretanica', 19500, 'qualificato', true, 'In attesa di scheda tecnica aggiornata dal laboratorio.', current_date + 7),
  ('Pellami Irpinia Srl', 'Riconcianti sintetici (syntans)', 12750, 'qualificato', false, '', current_date + 4),
  ('Distribuzione Chimica Veneta Srl', 'Proposta nuova gamma prodotti a catalogo', 9800, 'qualificato', false, '', current_date + 8),
  ('Conceria Valdarno Srl', 'Alternativa a ingrassante concorrente', 14300, 'proposta', true, 'Cliente ha richiesto alternativa a prodotto concorrente già in uso: campione, TDS e MSDS del concorrente richiesti, quantità acquistata comunicata dal cliente. In laboratorio per analisi ed eventuale prototipo.', current_date + 6),
  ('Kimya Deri Dış Ticaret A.Ş.', 'Proposta prodotti finiti per il mercato turco', 31500, 'proposta', true, 'Campione inviato, in attesa di riscontro dal cliente locale del distributore.', current_date + 9),
  ('Conceria Industriale Salernitana Srl', 'Fornitura annuale prodotti di concia', 27800, 'trattativa', false, 'Da chiudere condizioni di fornitura annuale.', current_date - 1),
  ('Leather Chem do Brasil Ltda', 'Linea completa ausiliari conciari', 38200, 'trattativa', true, 'Test in linea programmato presso il cliente finale del distributore.', current_date + 12),
  ('Pelletterie del Chianti Srl', 'Ingrassanti e riconcianti — volumi annuali', 21600, 'trattativa', false, '', current_date + 11),
  ('Concia Veneta Group Srl', 'Fornitura annuale ausiliari conciari', 45900, 'vinto', false, 'Contratto annuale firmato.', null),
  ('ChemBrand Formulazioni Srl', 'Accordo fornitura prodotti a marchio proprio', 33200, 'vinto', false, 'Accordo di private label firmato per la gamma rifinizione.', null),
  ('Solfarma Chimica Srl', 'Solventi e sgrassanti per concia', 6700, 'perso', false, 'Persa su prezzo, concorrente locale.', null),
  ('Agenzia Chimica Toscana Srl', 'Ausiliari conciari — distribuzione regionale', 4100, 'perso', false, 'Cliente ha sospeso il progetto.', null);

-- ============ RICHIESTE ============

insert into public.requests (subject, sender, type, department, priority, status, body, due_date) values
  ('Richiesta scheda di sicurezza (SDS) aggiornata', 'Conceria Santa Croce SpA', 'esterna', 'tecnico', 'alta', 'nuova',
   'Il cliente richiede la SDS in versione aggiornata del lotto consegnato a settembre, per il proprio audit interno.', current_date + 3),
  ('Reclamo lotto ingrassante non conforme', 'Cuoificio Toscano Srl', 'esterna', 'tecnico', 'alta', 'lavorazione',
   'Il cliente segnala viscosità fuori specifica sul lotto ricevuto il 10/09. Richiesta analisi e sostituzione.', current_date),
  ('Domanda tecnica su compatibilità riconciante', 'Concerie Vicentine Srl', 'esterna', 'tecnico', 'media', 'risolta',
   'Richiesta compatibilità tra il nuovo riconciante sintetico e il ciclo di rifinizione già in uso dal cliente.', null),
  ('Richiesta scheda tecnica coloranti', 'Pellami Irpinia Srl', 'esterna', 'tecnico', 'media', 'nuova',
   'Il cliente chiede la scheda tecnica completa con dati di processo per validazione interna.', current_date + 9),
  ('Reintegro ingrassante sintetico — lotto 44', 'Reparto Produzione', 'interna', 'operativo', 'alta', 'lavorazione',
   'Scorta sotto soglia minima sulla linea 2. Serve reintegro entro venerdì per non fermare la produzione.', current_date + 1),
  ('Intervento su reattore linea miscelazione', 'Manutenzione', 'interna', 'operativo', 'alta', 'nuova',
   'Rilevata anomalia di pressione sul reattore R-204. Richiesto intervento prima del prossimo turno.', current_date + 1),
  ('Non conformità fornitore materia prima', 'Ufficio Qualità', 'interna', 'operativo', 'media', 'lavorazione',
   'Materia prima ricevuta fuori specifica su un parametro secondario. Da valutare con il fornitore.', current_date + 5),
  ('Preventivo urgente ausiliari di riconcia', 'Conceria Industriale Salernitana Srl', 'esterna', 'commerciale', 'alta', 'nuova',
   'Richiesta preventivo per fornitura trimestrale, quantitativo indicativo 2 tonnellate/mese.', current_date - 2),
  ('Richiesta campione ingrassante per test', 'Leather Chem do Brasil Ltda', 'esterna', 'commerciale', 'media', 'nuova',
   'Il distributore richiede un campione da 5kg per test interni presso il cliente finale prima della conferma ordine.', current_date + 6),
  ('Approvazione ordine fornitore materie prime', 'Ufficio Acquisti', 'interna', 'amministrazione', 'media', 'lavorazione',
   'Ordine da approvare per rinnovo scorte materie prime, fornitore abituale.', current_date + 4),
  ('Certificazione formazione REACH operatore', 'Risorse Umane', 'interna', 'amministrazione', 'bassa', 'risolta',
   'Attestato di formazione REACH per nuovo assunto, da archiviare nel fascicolo personale.', null),
  ('Verifica fattura fornitore imballaggi', 'Amministrazione', 'interna', 'amministrazione', 'bassa', 'nuova',
   'Discrepanza tra ordine e fattura ricevuta, da verificare prima della registrazione contabile.', current_date + 2);

-- ============ APPUNTAMENTI ============

insert into public.appointments (client_name, subject, appointment_at, type, note) values
  ('Conceria Industriale Salernitana Srl', 'Presentazione gamma ingrassanti', current_date + 2 + time '10:00', 'visita_commerciale', 'Portare schede tecniche aggiornate e listino trimestrale.'),
  ('Concerie Vicentine Srl', 'Sopralluogo linea di rifinizione', current_date + 3 + time '09:30', 'sopralluogo_tecnico', 'Verificare compatibilità del nuovo riconciante con il ciclo esistente.'),
  ('Pelletterie del Chianti Srl', 'Visita di negoziazione contratto annuale', current_date + 5 + time '15:00', 'visita_commerciale', ''),
  ('Leather Chem do Brasil Ltda', 'Test in linea presso cliente finale', current_date + 12 + time '08:30', 'sopralluogo_tecnico', 'Portare campioni per il test programmato con il reparto tecnico del cliente finale.'),
  ('Conceria Valdarno Srl', 'Rinnovo condizioni di fornitura', current_date - 1 + time '11:00', 'visita_commerciale', 'Appuntamento già passato — da ricalendarizzare se non ancora avvenuto.'),
  ('Kimya Deri Dış Ticaret A.Ş.', 'Follow-up proposta prodotti finiti', current_date + 8 + time '14:00', 'visita_commerciale', '');

-- ============ RESET (facoltativo) ============
-- Per ripartire da zero prima di rieseguire questo file, esegui prima queste
-- righe (cancellano solo i dati di esempio, non gli utenti):
--
-- delete from public.appointments;
-- delete from public.requests;
-- delete from public.deals;
-- delete from public.clients;
