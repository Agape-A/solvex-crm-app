-- Richiesta di Andrea (set 2026): l'ufficio acquisti deve poter usare la
-- pagina "Richieste" come tutti gli altri reparti (finora "acquisti" non
-- esisteva come reparto valido, quindi non c'era modo di far comparire lì
-- le loro richieste).
--
-- Questo file fa SOLO l'aggiunta del nuovo valore all'enum "request_department"
-- — va eseguito ed eseguito DA SOLO (senza altri file insieme nella stessa
-- query) prima della 0030, che aggiunge le policy che lo usano: Postgres non
-- permette di usare un nuovo valore di un enum nella stessa transazione in
-- cui è stato aggiunto, quindi tenerlo separato evita un errore "unsafe use
-- of new value of enum type" in fase di esecuzione.

alter type request_department add value if not exists 'acquisti';
