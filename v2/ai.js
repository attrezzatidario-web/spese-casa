/* Spese Casa — IA nell'app (Google Gemini con la chiave dell'utente)
   La chiave resta su questo dispositivo: le richieste vanno direttamente a Google. */
(function () {
  'use strict';
  const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/';
  const MODEL_KEY = 'v2_sc_aimodel';
  const DETR_TIPI = ['sanitarie', 'veterinarie', 'ristrutturazione', 'mobili', 'risparmio', 'interessi', 'istruzione', 'sport', 'assicurazioni', 'altro'];
  const METODI = ['Carta', 'Bancomat', 'Contanti', 'Bonifico', 'Addebito in conto', 'Altro'];
  const S = (type, extra) => Object.assign({ type: type }, extra || {});
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };

  const PROMPTS = {
    test: {
      prompt: () => 'Rispondi con {"ok": true}',
      schema: () => S('OBJECT', { properties: { ok: S('BOOLEAN') }, required: ['ok'] })
    },

    receipt: {
      prompt: (cats, oggi, req) =>
        'Sei un assistente per la contabilità domestica italiana. Analizza la foto dello scontrino/ricevuta.\n' +
        'Estrai: negozio (nome commerciale breve, es. "Conad", "Leroy Merlin"), importo TOTALE pagato in euro (numero), ' +
        'data in formato YYYY-MM-DD (se non leggibile usa ' + oggi + '), metodo di pagamento tra: Carta, Bancomat, Contanti, Bonifico, Addebito in conto, Altro. ' +
        'Scegli la categoria più adatta SOLO tra: ' + cats.join(', ') + '. ' +
        'sito: dominio web ufficiale del negozio in Italia (es. "conad.it"), stringa vuota se non lo sai. ' +
        'note: elenco breve dei principali articoli (max 120 caratteri). ' +
        'Se è un rifornimento di carburante: litri erogati (numero) e prezzoLitro in €/L, altrimenti 0 e 0. ' +
        'detrazione: se la spesa è detraibile nel 730 indica il tipo tra ' + DETR_TIPI.join(', ') + ' (farmacia, visite, ticket, ottico = sanitarie; veterinario = veterinarie), altrimenti stringa vuota. ' +
        'acquistati: tra questi prodotti della lista della spesa ' + JSON.stringify(req.lista || []) + ' restituisci SOLO quelli (scritti esattamente come nella lista) che risultano acquistati nello scontrino; array vuoto se nessuno. ' +
        'Se l\'immagine non è uno scontrino imposta valido=false.',
      schema: cats => S('OBJECT', {
        properties: {
          valido: S('BOOLEAN'), negozio: S('STRING'), importo: S('NUMBER'), data: S('STRING'),
          categoria: S('STRING', { enum: cats }), metodo: S('STRING', { enum: METODI }),
          sito: S('STRING'), note: S('STRING'), litri: S('NUMBER'), prezzoLitro: S('NUMBER'),
          detrazione: S('STRING', { enum: [''].concat(DETR_TIPI) }), acquistati: S('ARRAY', { items: S('STRING') })
        },
        required: ['valido', 'negozio', 'importo', 'data', 'categoria', 'metodo', 'sito', 'note', 'litri', 'prezzoLitro', 'detrazione', 'acquistati']
      })
    },

    text: {
      prompt: (cats, oggi, req) =>
        'Sei un assistente per la contabilità domestica italiana. Oggi è ' + oggi + '.\n' +
        'Trasforma il testo dell\'utente in una o più spese. Interpreta date relative (ieri, lunedì scorso...). ' +
        'Importi in euro come numeri. descrizione: nome del negozio o breve descrizione (es. "Eni", "Pizzeria"). ' +
        'Categoria SOLO tra: ' + cats.join(', ') + '. Metodo tra: Carta, Bancomat, Contanti, Bonifico, Addebito in conto, Altro (Carta se non indicato). ' +
        'sito: dominio web ufficiale del negozio se è un marchio noto, altrimenti stringa vuota.\n' +
        'Testo: """' + String(req.testo || '').slice(0, 1000) + '"""',
      schema: cats => S('OBJECT', {
        properties: {
          spese: S('ARRAY', { items: S('OBJECT', {
            properties: {
              importo: S('NUMBER'), descrizione: S('STRING'), data: S('STRING'),
              categoria: S('STRING', { enum: cats }), metodo: S('STRING', { enum: METODI }),
              sito: S('STRING')
            },
            required: ['importo', 'descrizione', 'data', 'categoria', 'metodo', 'sito']
          }) })
        },
        required: ['spese']
      })
    },

    bill: {
      prompt: (cats, oggi) =>
        'Sei un assistente per la contabilità domestica italiana. Oggi è ' + oggi + '. Analizza la foto della bolletta/fattura.\n' +
        'nome: tipo + fornitore, breve (es. "Luce Enel", "Gas Plenitude", "Acqua Acea", "Fibra TIM", "TARI Comune"). ' +
        'importo: TOTALE da pagare in euro. scadenza: data di scadenza del pagamento YYYY-MM-DD. ' +
        'numero: numero della fattura (stringa vuota se assente). emissione: data di emissione YYYY-MM-DD (vuota se assente). ' +
        'periodoDa / periodoA: periodo di riferimento/fatturazione YYYY-MM-DD (vuoti se assenti). ' +
        'consumo: consumo totale fatturato nel periodo (numero, 0 se assente). unita: unità del consumo tra kWh, Smc, m³, GB, minuti oppure stringa vuota. ' +
        'voci: TUTTE le voci di costo del riepilogo importi (es. "Spesa per la materia energia", "Spesa per il trasporto e la gestione del contatore", ' +
        '"Spesa per oneri di sistema", "Imposte", "IVA", "Canone RAI", "Altre partite", "Quota fissa", "Depurazione"...), ciascuna con il suo importo in euro (negativo se è uno sconto/bonus). ' +
        'La somma delle voci deve avvicinarsi al totale. ' +
        'frequenza tra: mensile, bimestrale, trimestrale, quadrimestrale, semestrale, annuale, una tantum (deducila dal periodo). ' +
        'Categoria SOLO tra: ' + cats.join(', ') + '. ' +
        'note: codice cliente / POD / PDR / offerta se presenti (max 150 caratteri). ' +
        'Se non è una bolletta imposta valido=false.',
      schema: cats => S('OBJECT', {
        properties: {
          valido: S('BOOLEAN'), nome: S('STRING'), importo: S('NUMBER'), scadenza: S('STRING'),
          numero: S('STRING'), emissione: S('STRING'), periodoDa: S('STRING'), periodoA: S('STRING'),
          consumo: S('NUMBER'), unita: S('STRING'),
          voci: S('ARRAY', { items: S('OBJECT', { properties: { descrizione: S('STRING'), importo: S('NUMBER') }, required: ['descrizione', 'importo'] }) }),
          frequenza: S('STRING', { enum: ['mensile', 'bimestrale', 'trimestrale', 'quadrimestrale', 'semestrale', 'annuale', 'una tantum'] }),
          categoria: S('STRING', { enum: cats }), note: S('STRING')
        },
        required: ['valido', 'nome', 'importo', 'scadenza', 'numero', 'emissione', 'periodoDa', 'periodoA', 'consumo', 'unita', 'voci', 'frequenza', 'categoria', 'note']
      })
    },

    statement: {
      prompt: (cats, oggi, req) =>
        'Sei un esperto di estratti conto bancari italiani. Oggi è ' + oggi + '. Questa immagine è la pagina ' + (req.pagina || 1) + ' di un estratto conto o di una lista movimenti (conto o carta).\n' +
        'Estrai TUTTI i movimenti presenti nella pagina, nell\'ordine in cui compaiono. Ignora saldi iniziali/finali, totali, riepiloghi e intestazioni.\n' +
        'data: data contabile o dell\'operazione YYYY-MM-DD (se manca l\'anno deducilo dal periodo dell\'estratto). ' +
        'descrizione: testo del movimento ripulito e leggibile (es. "PAGAMENTO POS 12/10 CONAD SUPERSTORE ROMA CARTA 1234" -> "Conad Superstore Roma"; "SDD ENEL ENERGIA" -> "Enel Energia"). ' +
        'esercente: nome commerciale breve dell\'azienda/esercente o controparte (es. "Conad", "Enel Energia", "Amazon", "Mario Rossi" per un bonifico). ' +
        'importo: valore positivo in euro. segno: "uscita" per addebiti/dare/pagamenti, "entrata" per accrediti/avere. ' +
        'categoria: SOLO tra: ' + cats.join(', ') + '. ' +
        'box: riquadro che contiene l\'intera riga del movimento (tutte le colonne, incluse eventuali righe di descrizione a capo) come [ymin, xmin, ymax, xmax] con coordinate normalizzate da 0 a 1000 rispetto all\'immagine. ' +
        'banca, periodoDa, periodoA se visibili (altrimenti stringa vuota). Se l\'immagine non è un estratto conto imposta valido=false.',
      schema: cats => S('OBJECT', {
        properties: {
          valido: S('BOOLEAN'), banca: S('STRING'), periodoDa: S('STRING'), periodoA: S('STRING'),
          movimenti: S('ARRAY', { items: S('OBJECT', {
            properties: {
              data: S('STRING'), descrizione: S('STRING'), esercente: S('STRING'), importo: S('NUMBER'),
              segno: S('STRING', { enum: ['uscita', 'entrata'] }), categoria: S('STRING', { enum: cats }),
              box: S('ARRAY', { items: S('INTEGER') })
            },
            required: ['data', 'descrizione', 'esercente', 'importo', 'segno', 'categoria', 'box']
          }) })
        },
        required: ['valido', 'banca', 'periodoDa', 'periodoA', 'movimenti']
      })
    },

    payslip: {
      prompt: (cats, oggi) =>
        'Sei un esperto di buste paga italiane. Oggi è ' + oggi + '. Analizza il documento (cedolino/busta paga).\n' +
        'netto: importo NETTO in busta (netto a pagare) in euro. lordo: retribuzione lorda del mese (0 se assente). ' +
        'mese: mese di competenza YYYY-MM. data: data di pagamento/accredito YYYY-MM-DD se indicata, altrimenti l\'ultimo giorno del mese di competenza. ' +
        'tipo tra: Stipendio, Tredicesima, Bonus, Altro (se la busta contiene la tredicesima o quattordicesima usa Tredicesima). ' +
        'datore: nome breve del datore di lavoro. note: max 120 caratteri con eventuali voci rilevanti (es. straordinari, trattenute particolari). ' +
        'Se non è una busta paga imposta valido=false.',
      schema: () => S('OBJECT', {
        properties: { valido: S('BOOLEAN'), netto: S('NUMBER'), lordo: S('NUMBER'), mese: S('STRING'), data: S('STRING'), tipo: S('STRING', { enum: ['Stipendio', 'Tredicesima', 'Bonus', 'Altro'] }), datore: S('STRING'), note: S('STRING') },
        required: ['valido', 'netto', 'lordo', 'mese', 'data', 'tipo', 'datore', 'note']
      })
    },

    ask: {
      prompt: (cats, oggi, req) =>
        'Sei l\'assistente dell\'app Spese Casa di una famiglia italiana. Oggi è ' + oggi + '. Rispondi in italiano alla domanda usando SOLO i dati qui sotto.\n' +
        'Regole: risposta breve e diretta (massimo 5 righe, niente markdown), numeri precisi presi dagli aggregati già calcolati (non ricalcolare somme se l\'aggregato esiste), ' +
        'importi nel formato 1.234,56 €, date in formato gg/mm/aaaa. Se il dato non c\'è dillo in una frase. "Quest\'anno" = anno corrente, "il mese scorso" = mese precedente.\n' +
        'Domanda: """' + String(req.domanda || '').slice(0, 500) + '"""\nDati (JSON): ' + JSON.stringify(req.dati).slice(0, 90000),
      schema: () => S('OBJECT', { properties: { risposta: S('STRING') }, required: ['risposta'] })
    },

    detraz: {
      prompt: (cats, oggi, req) =>
        'Sei un esperto fiscale italiano (modello 730). Per ogni spesa indica se è detraibile e il tipo tra: ' + DETR_TIPI.join(', ') + ', oppure "no". ' +
        'sanitarie: farmacia, medicinali, visite mediche, dentista, analisi, ticket, ottico, occhiali, apparecchi medici, fisioterapia. veterinarie: veterinario, farmaci per animali. ' +
        'ristrutturazione: lavori straordinari edilizi/impianti (idraulico, elettricista, infissi, caldaia nuova). mobili: mobili ed elettrodomestici classe A+ acquistati per un immobile in ristrutturazione. ' +
        'risparmio: risparmio energetico (pompa di calore, cappotto, pannelli solari). interessi: interessi passivi del mutuo prima casa. istruzione: scuola, università, mensa scolastica. ' +
        'sport: iscrizione sportiva ragazzi 5-18 anni. assicurazioni: polizze vita/infortuni (non RC auto, non casa). altro: altre spese detraibili. ' +
        'Sii prudente: se non è chiaramente detraibile rispondi "no". Rispondi con lo stesso indice "i".\nSpese (JSON): ' + JSON.stringify(req.spese || []).slice(0, 30000),
      schema: () => S('OBJECT', {
        properties: { voci: S('ARRAY', { items: S('OBJECT', { properties: { i: S('INTEGER'), tipo: S('STRING', { enum: ['no'].concat(DETR_TIPI) }) }, required: ['i', 'tipo'] }) }) },
        required: ['voci']
      })
    },

    insights: {
      prompt: (cats, oggi, req) =>
        'Sei un consulente di finanza familiare italiano, esperto e concreto. Oggi è ' + oggi + '. Rispondi in italiano.\n' +
        'Analizza in profondità i dati di una famiglia per il mese ' + req.mese + ' usando TUTTO il contesto: ultimi 12 mesi (spese, entrate, risparmio, categorie), stesso mese dell\'anno scorso, ' +
        'limite mensile e budget per categoria, previsione di fine mese, negozi (scontrino medio, frequenza, trend ultimi 6 mesi contro i 6 precedenti), spese per giorno della settimana, ' +
        'abbonamenti e spese fisse (costo mensile equivalente e aumenti di prezzo), bollette (consumi e costo unitario), auto (litri, prezzo medio, km), entrate per persona, chi ha pagato, obiettivi di risparmio, progetti, avvisi automatici.\n' +
        'REGOLE: ogni osservazione deve contenere numeri precisi presi dai dati (importi in formato 1.234 €, percentuali), confronti con la media o con il periodo precedente, e indicare il perché. ' +
        'Niente consigli generici: ogni consiglio deve riferirsi a una voce reale (un negozio, un abbonamento, una bolletta, una categoria). Non inventare dati. Se il mese è in corso, ragiona sulla proiezione.\n' +
        'Cerca in particolare: categorie in crescita anomala, negozi dove lo scontrino medio è alto rispetto ad alternative già usate, abbonamenti sovrapposti o aumentati, bollette con costo unitario in salita o consumi stagionali anomali, ' +
        'spese concentrate nel weekend, acquisti d\'impulso (molte spese piccole), tasso di risparmio rispetto al 20% consigliato, obiettivi: quanto serve al mese per raggiungerli in tempo, budget a rischio, previsione di fine mese.\n' +
        'OUTPUT: voto 0-100 sulla salute finanziaria del mese (considera risparmio, rispetto dei budget, andamento, spese fisse sul reddito) con votoMotivo (max 8 parole); sintesi di 2 frasi; ' +
        'punti: da 5 a 8 osservazioni, ognuna con tipo (attenzione/positivo/info), area (una tra: Spesa alimentare, Abbonamenti, Bollette, Auto, Entrate, Risparmio, Budget, Casa, Abitudini, Obiettivi, Salute), titolo breve (max 5 parole), testo (max 35 parole) e impatto = risparmio mensile stimato in euro ottenibile (0 se non applicabile); ' +
        'azioni: da 3 a 5 azioni concrete per questo mese, ognuna con risparmioMensile stimato; risparmioPotenziale = somma realistica in euro al mese; previsione.fineMese = saldo previsto (usa previsioneFineMese.saldoPrevisto se presente, altrimenti 0) e previsione.commento (1 frase).\n' +
        'Dati (JSON): ' + JSON.stringify(req.dati).slice(0, 60000),
      schema: () => S('OBJECT', {
        properties: {
          voto: S('INTEGER'), votoMotivo: S('STRING'), sintesi: S('STRING'), risparmioPotenziale: S('NUMBER'),
          previsione: S('OBJECT', { properties: { fineMese: S('NUMBER'), commento: S('STRING') }, required: ['fineMese', 'commento'] }),
          punti: S('ARRAY', { items: S('OBJECT', { properties: { tipo: S('STRING', { enum: ['attenzione', 'positivo', 'info'] }), area: S('STRING'), titolo: S('STRING'), testo: S('STRING'), impatto: S('NUMBER') }, required: ['tipo', 'area', 'titolo', 'testo', 'impatto'] }) }),
          azioni: S('ARRAY', { items: S('OBJECT', { properties: { testo: S('STRING'), risparmioMensile: S('NUMBER') }, required: ['testo', 'risparmioMensile'] }) })
        },
        required: ['voto', 'votoMotivo', 'sintesi', 'risparmioPotenziale', 'previsione', 'punti', 'azioni']
      })
    }
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function listModels(key) {
    const r = await tfetch(GEMINI_BASE + 'models?pageSize=200', { headers: { 'x-goog-api-key': key } }, null, 15000);
    const j = await r.json().catch(() => ({}));
    return (j.models || []).filter(m => (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0).map(m => m.name.replace('models/', ''));
  }
  // sceglie automaticamente il modello "Flash" più recente disponibile
  async function pickModel(key, tried, ancheLite) {
    let list;
    try { list = await listModels(key); } catch (e) { return null; }
    list = list.filter(n => /flash/.test(n) && !(ancheLite ? /image|tts|audio|live|thinking|exp/ : /lite|image|tts|audio|live|thinking|exp/).test(n) && !tried[n]);
    const ver = n => { const m = n.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    list.sort((a, b) => (ver(b) - ver(a)) || (/preview/.test(a) - /preview/.test(b)));
    return list[0] || null;
  }

  // fetch con limite di tempo: se Google non risponde non resto bloccato
  async function tfetch(url, opts, signal, ms) {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms);
    const onAbort = () => ctl.abort();
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort); }
    try { return await fetch(url, Object.assign({}, opts, { signal: ctl.signal })); }
    catch (e) {
      if (signal && signal.aborted) throw e;
      if (e.name === 'AbortError') throw new Error('Google non risponde: controlla la connessione e riprova');
      throw new Error('Connessione assente, riprova');
    } finally { clearTimeout(tm); if (signal) signal.removeEventListener('abort', onAbort); }
  }

  async function gemini(key, parts, schema, signal, ms) {
    const tried = {};
    let model = lsGet(MODEL_KEY) || 'gemini-flash-latest';
    let ripiego = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      tried[model] = true;
      const res = await tfetch(GEMINI_BASE + 'models/' + model + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: parts }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema }
        })
      }, signal, ms || 90000);
      const code = res.status;
      const body = await res.json().catch(() => ({}));
      if (code === 200) {
        if (!ripiego) lsSet(MODEL_KEY, model);
        const p = (((body.candidates || [])[0] || {}).content || {}).parts || [];
        const txt = p.filter(x => x.text && !x.thought).map(x => x.text).join('');
        if (!txt) throw new Error('Risposta IA vuota');
        return JSON.parse(txt);
      }
      const msg = (body.error && body.error.message) || ('Errore ' + code);
      if (code === 401 || ((code === 400 || code === 403) && /API key|API_KEY|permission|credential/i.test(msg))) throw new Error('Google rifiuta la chiave: ' + msg.split('. ')[0]);
      if (code === 429) throw new Error('Limite gratuito IA raggiunto, riprova tra poco');
      if (code === 503 || code === 500 || /high demand|overloaded|unavailable/i.test(msg)) {
        // Gemini sovraccarico: aspetto un attimo e provo anche un altro modello
        await sleep(1500 * (attempt + 1));
        const alt = await pickModel(key, tried, true);
        if (alt) { model = alt; ripiego = true; }
        if (attempt === 2) throw new Error('L\'IA di Google è sovraccarica in questo momento, riprova tra un minuto');
        continue;
      }
      if (code === 404 || (code === 400 && /model/i.test(msg))) {
        const next = await pickModel(key, tried);
        if (!next) throw new Error('Nessun modello Gemini disponibile');
        model = next;
        continue;
      }
      throw new Error(msg);
    }
    throw new Error('IA non disponibile');
  }

  // req: { task, categorie, oggi, image?, mime?, ...dati del compito }
  async function run(key, req, signal, ms) {
    if (!key) throw new Error('Chiave IA non impostata');
    const T = PROMPTS[req.task];
    if (!T) throw new Error('Funzione IA sconosciuta');
    const cats = (req.categorie && req.categorie.length) ? req.categorie : ['Altro'];
    const oggi = req.oggi || new Date().toISOString().slice(0, 10);
    const parts = [{ text: T.prompt(cats, oggi, req) }];
    if (req.image) parts.push({ inline_data: { mime_type: req.mime || 'image/jpeg', data: req.image } });
    return gemini(key, parts, T.schema(cats), signal, ms);
  }

  window.SC_AI = { run: run, tasks: Object.keys(PROMPTS), resetModel: () => lsSet(MODEL_KEY, null) };
})();
