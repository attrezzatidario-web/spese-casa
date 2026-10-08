/* Spese Casa — app.js */
(() => {
  'use strict';

  /* ================= Storage ================= */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  const METODI = ['Carta', 'Bancomat', 'Contanti', 'Bonifico', 'Addebito in conto', 'Altro'];
  const FREQ = {
    mensile: 1, bimestrale: 2, trimestrale: 3, quadrimestrale: 4, semestrale: 6, annuale: 12, 'una tantum': 0
  };

  let url = LS.get('sc_url', '');
  let db = LS.get('sc_data', { spese: [], bollette: [], categorie: [], config: {}, fatture: [], fisse: [], veicoli: [], estratti: [] });
  if (!db.estratti) db.estratti = [];
  ['persone', 'entrate', 'entrateFisse', 'obiettivi', 'lista', 'documenti'].forEach(k => { if (!db[k]) db[k] = []; });
  if (!db.fisse) db.fisse = [];
  if (!db.veicoli) db.veicoli = [];
  if (!db.config) db.config = {};
  if (!db.fatture) db.fatture = [];
  let queue = LS.get('sc_queue', []);
  let syncing = false;
  let online = navigator.onLine;

  const isLocal = () => url === 'local';
  const save = () => { LS.set('sc_data', db); LS.set('sc_queue', queue); };

  /* ================= Utils ================= */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // formato euro con separatore delle migliaia sempre presente (1.000,00 €)
  const fmtNum = (n, dec) => {
    const v = Number(n) || 0, neg = v < 0;
    const [i, d] = Math.abs(v).toFixed(dec).split('.');
    return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? ',' + d : '');
  };
  const eur = n => fmtNum(n, 2) + ' €';
  const eur0 = n => fmtNum(Math.round(Number(n) || 0), 0) + ' €';
  const isDesk = () => matchMedia('(min-width: 900px)').matches;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const parseD = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const ym = s => String(s).slice(0, 7);
  const ymOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const monthName = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }); };
  const monthShort = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'short' }).replace('.', ''); };
  const dayLabel = s => parseD(s).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const shortDate = s => parseD(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
  const daysTo = s => Math.round((parseD(s) - parseD(today())) / 864e5);
  const num = v => { const n = parseFloat(String(v).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
  const addMonths = (s, n) => {
    const d = parseD(s); const day = d.getDate();
    const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    t.setDate(Math.min(day, last));
    return ymd(t);
  };
  const initials = s => (String(s || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();
  const sum = arr => arr.reduce((a, s) => a + (Number(s.importo) || 0), 0);

  function toast(msg) {
    const t = $('#toast');
    t.innerHTML = `<svg viewBox="0 0 24 24" class="t-ic"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/></svg><span>${esc(msg)}</span>`;
    t.hidden = false; t.classList.remove('out'); void t.offsetWidth; t.classList.add('in');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.classList.add('out'); setTimeout(() => (t.hidden = true), 250); }, 2400);
  }

  /* ================= Motion ================= */
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let animate = true; // animazioni d'ingresso al cambio pagina
  const ease = t => 1 - Math.pow(1 - t, 3);
  // numeri che "contano" fino al valore
  function countTo(el, value, fmt = eur) {
    if (!el) return;
    const to = Number(value) || 0;
    const from = el._v != null ? el._v : 0;
    el._v = to;
    if (reduced() || Math.abs(to - from) < 0.005) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 750;
    cancelAnimationFrame(el._raf);
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(from + (to - from) * ease(k));
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }
  // card che entrano in sequenza
  function stagger(root) {
    if (reduced()) return;
    const els = $$('.month-switch, .kpi, .card, .bill, .day, .filters, .sum-row', root).filter(e => e.offsetParent !== null);
    els.forEach((e, i) => {
      e.classList.remove('rise'); void e.offsetWidth;
      e.style.animationDelay = Math.min(i * 45, 420) + 'ms';
      e.classList.add('rise');
      e.addEventListener('animationend', () => { e.classList.remove('rise'); e.style.animationDelay = ''; }, { once: true });
    });
  }


  /* ================= Riconoscimento negozi ================= */
  // [parole chiave, dominio per il logo, categoria suggerita]
  const AB = 'Abbonamenti', RF = 'Rate e finanziamenti';
  const SA = 'Spesa alimentare', AT = 'Auto e trasporti', IT = 'Internet e telefono', MA = 'Manutenzione', AR = 'Arredamento', EL = 'Elettrodomestici', PC = 'Pulizia e casa', AS = 'Assicurazioni', AL = 'Altro';
  const MERCHANTS = [
    ['conad', 'conad.it', SA], ['coop', 'e-coop.it', SA], ['esselunga', 'esselunga.it', SA], ['lidl', 'lidl.it', SA],
    ['eurospin', 'eurospin.it', SA], ['carrefour', 'carrefour.it', SA], ['pam|panorama', 'pampanorama.it', SA],
    ['todis', 'todis.it', SA], ['md discount|\\bmd\\b', 'mdspa.it', SA], ['penny', 'pennymarket.it', SA],
    ['despar|eurospar|interspar', 'despar.it', SA], ['aldi', 'aldi.it', SA], ['famila', 'famila.it', SA],
    ['tigre', 'gruppogabrielli.it', SA], ['sigma', 'supersigma.com', SA], ['crai', 'crai-supermercati.it', SA],
    ['iper\\b|la grande i', 'iper.it', SA], ['ins mercato|\\bins\\b', 'insmercato.it', SA], ['tuod[iì]', 'tuodi.it', SA],
    ['prix', 'prixquality.com', SA], ['dec[oò]\\b', 'supermercatideco.it', SA], ['bennet', 'bennet.com', SA],
    ['u2|unes', 'unes.it', SA], ['elite', 'supermercatielite.it', SA], ['ard\\b', 'arddiscount.com', SA],
    ['amazon', 'amazon.it', AL], ['ikea', 'ikea.com', AR], ['leroy', 'leroymerlin.it', MA], ['bricocenter', 'bricocenter.it', MA],
    ['bricoman', 'bricoman.it', MA], ['brico ?io', 'bricoio.it', MA], ['bricofer', 'bricofer.it', MA], ['\\bobi\\b', 'obi-italia.it', MA],
    ['mediaworld', 'mediaworld.it', EL], ['unieuro', 'unieuro.it', EL], ['euronics', 'euronics.it', EL], ['expert', 'expertonline.it', EL],
    ['decathlon', 'decathlon.it', AL], ['acqua ?(e|&) ?sapone', 'acquaesapone.it', PC], ['tigot[aà]', 'tigota.it', PC],
    ['risparmio casa', 'risparmiocasa.com', PC], ['maury', 'maurys.it', PC], ['action\\b', 'action.com', PC],
    ['mondo convenienza', 'mondoconvenienza.it', AR], ['maison du monde', 'maisonsdumonde.com', AR], ['zara home', 'zarahome.com', AR],
    ['\\beni\\b|enilive', 'enilive.it', AT], ['\\bq8\\b', 'q8.it', AT], ['\\bip\\b|api ip', 'gruppoapi.com', AT], ['esso', 'esso.it', AT],
    ['tamoil', 'tamoil.it', AT], ['telepass', 'telepass.com', AT], ['autostrad', 'autostrade.it', AT], ['trenitalia', 'trenitalia.com', AT],
    ['italo', 'italotreno.com', AT], ['atac', 'atac.roma.it', AT],
    ['enel', 'enel.it', 'Luce'], ['edison', 'edison.it', 'Luce'], ['a2a', 'a2a.it', 'Luce'], ['sorgenia', 'sorgenia.it', 'Luce'],
    ['plenitude', 'eniplenitude.com', 'Gas'], ['hera', 'gruppohera.it', 'Gas'], ['iren', 'iren.it', 'Gas'], ['italgas', 'italgas.it', 'Gas'],
    ['acea', 'acea.it', 'Acqua'],
    ['\\btim\\b', 'tim.it', IT], ['vodafone', 'vodafone.it', IT], ['wind|windtre', 'windtre.it', IT], ['iliad', 'iliad.it', IT],
    ['fastweb', 'fastweb.it', IT], ['ho\\.? ?mobile', 'ho-mobile.it', IT], ['very mobile', 'verymobile.it', IT],
    ['sky\\b', 'sky.it', AB, 'Abbonamento'], ['netflix', 'netflix.com', AB, 'Abbonamento'], ['spotify', 'spotify.com', AB, 'Abbonamento'], ['disney', 'disneyplus.com', AB, 'Abbonamento'],
    ['dazn', 'dazn.com', AB, 'Abbonamento'], ['poste', 'poste.it', AL], ['paypal', 'paypal.com', AL],
    ['unipol', 'unipol.it', AS, 'Assicurazione'], ['generali', 'generali.it', AS, 'Assicurazione'], ['allianz', 'allianz.it', AS, 'Assicurazione'], ['zurich', 'zurich.it', AS, 'Assicurazione'],
    ['prima\\.it|prima assicura', 'prima.it', AS], ['genertel', 'genertel.it', AS, 'Assicurazione'], ['linear', 'linear.it', AS, 'Assicurazione'],
    ['timvision', 'timvision.it', AB, 'Abbonamento'], ['now ?tv', 'nowtv.it', AB, 'Abbonamento'], ['paramount', 'paramountplus.com', AB, 'Abbonamento'],
    ['apple|icloud', 'apple.com', AB, 'Abbonamento'], ['youtube', 'youtube.com', AB, 'Abbonamento'], ['google one', 'google.com', AB, 'Abbonamento'],
    ['chatgpt|openai', 'openai.com', AB, 'Abbonamento'], ['claude', 'claude.ai', AB, 'Abbonamento'], ['microsoft|office 365|xbox', 'microsoft.com', AB, 'Abbonamento'],
    ['playstation', 'playstation.com', AB, 'Abbonamento'], ['nintendo', 'nintendo.com', AB, 'Abbonamento'], ['audible', 'audible.it', AB, 'Abbonamento'],
    ['canva', 'canva.com', AB, 'Abbonamento'], ['adobe', 'adobe.com', AB, 'Abbonamento'], ['dropbox', 'dropbox.com', AB, 'Abbonamento'],
    ['mcfit', 'mcfit.com', AB, 'Abbonamento'], ['virgin active', 'virginactive.it', AB, 'Abbonamento'], ['canone rai|\\brai\\b', 'rai.it', 'Tasse e tributi', 'Tassa'],
    ['findomestic', 'findomestic.it', RF, 'Rata'], ['\\bagos\\b', 'agos.it', RF, 'Rata'], ['compass', 'compass.it', RF, 'Rata'], ['cofidis', 'cofidis.it', RF, 'Rata'],
    ['santander', 'santanderconsumer.it', RF, 'Rata'], ['scalapay', 'scalapay.com', RF, 'Rata'], ['klarna', 'klarna.com', RF, 'Rata'],
    ['leasys', 'leasys.com', RF, 'Rata'], ['ayvens', 'ayvens.com', RF, 'Rata'], ['arval', 'arval.it', RF, 'Rata'],
    ['fineco', 'finecobank.com', RF, 'Rata'], ['intesa', 'intesasanpaolo.com', RF, 'Rata'], ['unicredit', 'unicredit.it', RF, 'Rata'], ['\\bbnl\\b', 'bnl.it', RF, 'Rata'],
    ['bper', 'bper.it', RF, 'Rata'], ['mediolanum', 'bancamediolanum.it', RF, 'Rata'],
    ['verti', 'verti.it', AS, 'Assicurazione'], ['conte\\.it|conte assicura', 'conte.it', AS, 'Assicurazione'], ['quixa', 'quixa.it', AS, 'Assicurazione'],
    ['\\baxa\\b', 'axa.it', AS, 'Assicurazione'], ['reale mutua', 'realemutua.it', AS, 'Assicurazione'], ['cattolica', 'cattolica.it', AS, 'Assicurazione'],
    ['vittoria', 'vittoriaassicurazioni.com', AS, 'Assicurazione'], ['helvetia', 'helvetia.com', AS, 'Assicurazione'], ['groupama', 'groupama.it', AS, 'Assicurazione'],
    ['jysk', 'jysk.it', AR], ['deghi', 'deghi.it', AR], ['tecnomat', 'tecnomat.it', MA], ['vorwerk|folletto|bimby|kobold', 'vorwerk.com', EL],
    ['farmacia', '', 'Salute'], ['mcdonald', 'mcdonalds.it', AL], ['burger king', 'burgerking.it', AL]
  ].map(([k, domain, cat, tipo]) => ({ re: new RegExp(k, 'i'), domain, cat, tipo }));

  // negozi aggiunti dall'utente (Altro > Negozi e loghi)
  const customShops = () => (db.config && Array.isArray(db.config.negozi) ? db.config.negozi : []);
  const escRe = x => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function findMerchant(text) {
    if (!text) return null;
    const t = String(text);
    const c = customShops().find(n => n.nome && new RegExp(escRe(n.nome), 'i').test(t));
    if (c) return { domain: c.dominio, cat: c.categoria || '', tipo: '' };
    return MERCHANTS.find(m => m.re.test(t)) || null;
  }
  const domainOf = u => { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const logoUrl = d => `https://www.google.com/s2/favicons?domain=${d}&sz=128`;
  // icona: logo del negozio se riconosciuto, altrimenti iniziali
  function iconHTML(text, fallback, sito) {
    const m = findMerchant(text);
    const domain = (m && m.domain) || String(sito || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    if (domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      return `<div class="ic logo"><img src="${logoUrl(domain)}" alt="""" loading="lazy" onerror="this.parentNode.classList.remove('logo');this.parentNode.textContent='${esc(initials(fallback || text)).replace(/'/g, '')}'"></div>`;
    }
    if (fallback === '?') return `<div class="ic ph"><svg viewBox="0 0 24 24"><path d="M4 9l1.5-4h13L20 9M4 9v10h16V9M4 9h16M9 19v-5h6v5"/></svg></div>`;
    return `<div class="ic">${esc(initials(fallback || text))}</div>`;
  }

  /* ================= Data layer ================= */
  const KEY = { Spese: 'spese', Bollette: 'bollette', Categorie: 'categorie', Fatture: 'fatture', Fisse: 'fisse', Veicoli: 'veicoli', Estratti: 'estratti', Persone: 'persone', Entrate: 'entrate', EntrateFisse: 'entrateFisse', Obiettivi: 'obiettivi', Lista: 'lista', Documenti: 'documenti' };

  function applyLocal(op) {
    const k = KEY[op.sheet];
    if (op.sheet === 'Config') {
      db.config = db.config || {};
      if (op.action === 'upsert') { try { db.config[op.row.chiave] = JSON.parse(op.row.valore); } catch { db.config[op.row.chiave] = op.row.valore; } }
      else delete db.config[op.id];
      return;
    }
    if (op.sheet === 'Categorie') {
      const nome = op.action === 'upsert' ? op.row.nome : op.id;
      db.categorie = db.categorie.filter(c => c !== nome);
      if (op.action === 'upsert') db.categorie.push(nome);
      return;
    }
    const id = op.action === 'upsert' ? op.row.id : op.id;
    db[k] = db[k].filter(r => String(r.id) !== String(id));
    if (op.action === 'upsert') db[k].push(op.row);
  }

  function write(ops) {
    const watch = ops.some(o => o.sheet === 'Spese');
    const before = watch ? budgetTotal(ymOf(new Date())) : null, beforeCat = watch ? catTotals(ymOf(new Date())) : null;
    ops.forEach(applyLocal);
    if (before != null) setTimeout(() => { if (!budgetCrossCheck(before)) catCrossCheck(beforeCat); }, 50);
    if (!isLocal()) queue.push(...ops);
    save(); render(); flush();
  }

  const setConfig = (chiave, value) => write([value == null ? { action: 'delete', sheet: 'Config', id: chiave } : { action: 'upsert', sheet: 'Config', row: { chiave, valore: JSON.stringify(value) } }]);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function syncNow() {
    for (let i = 0; i < 15 && queue.length; i++) { await flush(); if (queue.length) await sleep(700); }
    if (queue.length) throw new Error('Salvataggio non riuscito, controlla la connessione');
  }
  async function api(action, extra) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...extra }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Errore');
    return j.result;
  }

  async function flush() {
    if (isLocal() || syncing || !queue.length || !url) return setSync();
    syncing = true; setSync();
    const batch = queue.slice();
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'batch', ops: batch }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Errore');
      queue = queue.slice(batch.length); save();
      online = true;
    } catch (e) {
      if (e instanceof TypeError) online = false;
      else toast('Errore salvataggio: ' + e.message);
    } finally {
      syncing = false; setSync();
    }
    if (queue.length && online) setTimeout(flush, 4000);
  }

  async function pull(showToast) {
    if (isLocal()) { if (showToast) toast('Modalità solo dispositivo'); return; }
    try {
      setSync('Aggiorno…');
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=all&t=' + Date.now());
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      db = { spese: j.data.spese || [], bollette: j.data.bollette || [], fatture: j.data.fatture || [], fisse: j.data.fisse || [], veicoli: j.data.veicoli || [], estratti: j.data.estratti || [], persone: j.data.persone || [], entrate: j.data.entrate || [], entrateFisse: j.data.entrateFisse || [], obiettivi: j.data.obiettivi || [], lista: j.data.lista || [], documenti: j.data.documenti || [], categorie: j.data.categorie || [], config: j.data.config || {}, ai: !!j.data.ai };
      queue.forEach(applyLocal); // operazioni non ancora inviate restano visibili
      online = true; save(); render();
      if (showToast) toast('Dati aggiornati');
    } catch (e) {
      online = false;
      if (showToast) toast('Impossibile collegarsi');
    }
    setSync();
    flush();
  }

  function setSync(txt) {
    _setSync(txt);
    const a = $('#sync'), b = $('#sync-side');
    if (a && b) { b.className = a.className; b.textContent = a.textContent; }
  }
  function _setSync(txt) {
    const el = $('#sync'); if (!el) return;
    el.className = 'sync';
    if (txt) { el.textContent = txt; return; }
    if (isLocal()) { el.textContent = 'Solo dispositivo'; el.classList.add('offline'); return; }
    if (syncing) { el.textContent = 'Salvo…'; el.classList.add('pending'); return; }
    if (queue.length) { el.textContent = `${queue.length} da inviare`; el.classList.add('pending'); return; }
    if (!online) { el.textContent = 'Offline'; el.classList.add('offline'); return; }
    el.textContent = 'Sincronizzato';
  }

  /* ================= State ================= */
  let view = 'home';
  let homeMonth = ymOf(new Date());
  const f = { q: '', month: ymOf(new Date()), cat: '' };

  const cats = () => [...db.categorie].sort((a, b) => a.localeCompare(b, 'it'));
  const activeBills = () => db.bollette.filter(b => b.attiva !== false && String(b.attiva).toUpperCase() !== 'FALSE');
  const inactiveBills = () => db.bollette.filter(b => !activeBills().includes(b));

  function billStatus(b) {
    const d = daysTo(b.scadenza);
    if (d < 0) return { cls: 'late', txt: d === -1 ? 'Scaduta ieri' : `Scaduta da ${-d} gg` };
    if (d === 0) return { cls: 'late', txt: 'Scade oggi' };
    if (d <= 7) return { cls: 'soon', txt: d === 1 ? 'Domani' : `Tra ${d} gg` };
    return { cls: '', txt: shortDate(b.scadenza) };
  }

  /* ================= Router ================= */
  const TITLES = { home: 'Home', spese: 'Spese', entrate: 'Entrate', fisse: 'Spese fisse', auto: 'Auto', estratto: 'Estratto conto', affitto: 'Affitto', bollette: 'Bollette', lista: 'Lista della spesa', documenti: 'Documenti', detrazioni: 'Riepilogo 730', impostazioni: 'Impostazioni' };
  const SUBS = { home: '', spese: 'Tutti i movimenti', entrate: 'Stipendi, entrate e risparmi', fisse: 'Abbonamenti, rate e calendario', auto: 'Veicoli, carburante e scadenze', estratto: 'Confronto con le spese registrate', affitto: 'Canone, pagamenti e promemoria', bollette: 'Spese ricorrenti e scadenze', lista: 'Condivisa con la famiglia', documenti: 'Tutti i tuoi file', detrazioni: 'Spese detraibili e rimborso stimato', impostazioni: 'Collegamento, IA e categorie' };
  function route() {
    view = (location.hash || '#home').slice(1);
    if (!TITLES[view]) view = 'home';
    document.body.dataset.view = view;
    $$('.view').forEach(v => (v.hidden = v.id !== 'v-' + view));
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view || (a.dataset.view === 'impostazioni' && ['affitto', 'estratto', 'lista', 'documenti', 'detrazioni'].includes(view) && !isDesk())));
    $('#title').textContent = TITLES[view];
    $('#add-top-lbl').textContent = view === 'fisse' ? 'Nuova spesa fissa' : view === 'auto' ? 'Rifornimento' : view === 'entrate' ? 'Nuova entrata' : view === 'documenti' ? 'Carica documento' : view === 'lista' ? 'Aggiungi prodotto' : 'Nuova spesa';
    const sub = view === 'home' ? new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) : SUBS[view];
    $('#subtitle').textContent = sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : '';
    animate = true;
    render();
    stagger($('#v-' + view));
    animate = false;
    window.scrollTo(0, 0);
  }

  function render() {
    if (!render._auto) { render._auto = true; try { autoDebit(); autoIncome(); } finally { render._auto = false; } }
    renderBadge();
    if (view === 'home') renderHome();
    if (view === 'spese') renderSpese();
    if (view === 'bollette') renderBills();
    if (view === 'affitto') renderRent();
    if (view === 'fisse') renderFisse();
    if (view === 'auto') renderAuto();
    if (view === 'entrate') renderEntrate();
    if (view === 'estratto') renderStmt();
    if (view === 'impostazioni') renderSettings();
    if (view === 'lista') renderLista();
    if (view === 'documenti') renderDocs();
    if (view === 'detrazioni') renderDetr();
    setSync();
  }

  function renderBadge() {
    if (!renderBadge._busy) { renderBadge._busy = true; ensureRentStart(); renderBadge._busy = false; }
    const n = activeBills().filter(b => daysTo(b.scadenza) <= 0).length;
    const el = $('#badge'); el.hidden = !n; el.textContent = n;
    const r = rentArrears().length;
    const er = $('#badge-rent'); er.hidden = !r; er.textContent = r;
    const eo = $('#badge-more'); if (eo) { eo.hidden = !r; eo.textContent = r; }
    const tr = $('#tile-rent-badge'); if (tr) { tr.hidden = !r; tr.textContent = r; }
    const al = autoScadenze().filter(x => daysTo(x.date) < 0).length;
    const ea = $('#badge-auto'); ea.hidden = !al; ea.textContent = al;
    const fl = fisseActive().filter(f => !isOn(f.auto) && f.prossima && daysTo(f.prossima) < 0).length;
    const ef = $('#badge-fx'); ef.hidden = !fl; ef.textContent = fl;
  }

  /* ================= Item templates ================= */
  function speseItem(s) {
    const sub = [s.categoria, s.metodo].filter(Boolean).join(' · ');
    return `<div class="item" data-spesa="${esc(s.id)}">
      ${String(s.bollettaId || '').startsWith('affitto:') ? `<div class="ic rent-ic">${ICO_KEY}</div>` : iconHTML(s.descrizione, s.categoria, s.sito)}
      <div class="main"><div class="t">${esc(s.descrizione || s.categoria || 'Spesa')}${s.verificato ? ' <i class="vchk">✓</i>' : ''}${s.allegato ? ` <i class="clip">${ICO_CLIP}</i>` : ''}</div><div class="s">${esc(sub)}</div></div>
      <div class="amt">${eur(s.importo)}</div></div>`;
  }
  function dueItem(b) {
    const st = billStatus(b);
    return `<div class="item" data-bill="${esc(b.id)}">
      ${iconHTML(b.nome)}
      <div class="main"><div class="t">${esc(b.nome)}</div><div class="s"><span class="chip ${st.cls}">${esc(st.txt)}</span></div></div>
      <div class="right"><div class="amt">${eur(b.importo)}</div><button class="btn sm" data-pay="${esc(b.id)}">Paga</button></div></div>`;
  }

  function rentDueItem(r) {
    const st = rentChip(r);
    return `<div class="item" data-go="affitto">
      <div class="ic rent-ic">${ICO_KEY}</div>
      <div class="main"><div class="t">Affitto ${esc(monthShortY(r.month))}</div><div class="s"><span class="chip ${st.cls}">${esc(st.txt)}</span></div></div>
      <div class="right"><div class="amt">${eur(r.importo)}</div><button class="btn sm" data-rentpay="${r.month}">Paga</button></div></div>`;
  }

  function speseTable(list, withDate = true) {
    return `<table class="tbl"><thead><tr>${withDate ? '<th>Data</th>' : ''}<th>Descrizione</th><th>Categoria</th><th>Metodo</th><th class="r">Importo</th></tr></thead><tbody>
      ${list.map(s => `<tr data-spesa="${esc(s.id)}">
        ${withDate ? `<td class="d">${esc(parseD(s.data).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }).replace('.', ''))}</td>` : ''}
        <td><div class="tcell">${String(s.bollettaId || '').startsWith('affitto:') ? `<div class="ic rent-ic">${ICO_KEY}</div>` : iconHTML(s.descrizione, s.categoria, s.sito)}<div class="tt"><b>${esc(s.descrizione || s.categoria || 'Spesa')}${s.verificato ? ' <i class="vchk" title="Verificata nell\'estratto conto">✓</i>' : ''}${s.allegato ? ` <i class="clip" title="Scontrino allegato">${ICO_CLIP}</i>` : ''}</b>${s.note ? `<small>${esc(s.note)}</small>` : ''}</div></div></td>
        <td><span class="chip">${esc(s.categoria || '—')}</span></td>
        <td class="m2">${esc(s.metodo || '')}</td>
        <td class="r amt">${eur(s.importo)}</td></tr>`).join('')}
      </tbody></table>`;
  }

  /* ================= HOME ================= */
  function renderHome() {
    $('.month-label').textContent = monthName(homeMonth);
    const ms = db.spese.filter(s => ym(s.data) === homeMonth);
    const tot = sum(ms);
    countTo($('#h-total'), tot);

    const [y, m] = homeMonth.split('-').map(Number);
    const prevKey = ymOf(new Date(y, m - 2, 1));
    const prev = sum(db.spese.filter(s => ym(s.data) === prevKey));
    const dEl = $('#h-delta');
    if (prev > 0) {
      const p = Math.round(((tot - prev) / prev) * 100);
      dEl.innerHTML = `<span class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${Math.abs(p)}%</span> rispetto a ${esc(monthShort(prevKey))} (${eur0(prev)})`;
    } else dEl.textContent = `${ms.length} ${ms.length === 1 ? 'spesa' : 'spese'}`;

    // scadenze: bollette + affitto
    const ab = activeBills().map(b => ({ kind: 'bill', due: b.scadenza, importo: b.importo, b }));
    const rents = rentUpcoming().map(r => ({ kind: 'rent', due: r.due, importo: r.importo, r }));
    const fxs = fisseActive().filter(f => f.prossima && daysTo(f.prossima) <= 30).map(f => ({ kind: 'fx', due: f.prossima, importo: f.importo, f }));
    const aus = autoScadenze().filter(x => daysTo(x.date) <= 30).map(x => ({ kind: 'auto', due: x.date, importo: x.importo, x }));
    const all = [...ab, ...rents, ...fxs, ...aus].sort((a, b) => a.due.localeCompare(b.due));
    const due30 = all.filter(x => daysTo(x.due) <= 30);
    const late = all.filter(x => daysTo(x.due) < 0);
    countTo($('#h-bills'), sum(due30));
    $('#h-bills-sub').innerHTML = late.length
      ? `<span class="chip late">${late.length} scadut${late.length === 1 ? 'o' : 'i'}</span> · ${due30.length} pagament${due30.length === 1 ? 'o' : 'i'}`
      : `${due30.length} pagament${due30.length === 1 ? 'o' : 'i'}`;
    $('#h-due').innerHTML = all.slice(0, 6).map(x => x.kind === 'rent' ? rentDueItem(x.r) : x.kind === 'fx' ? fxItem(x.f, true) : x.kind === 'auto' ? autoDueItem(x.x) : dueItem(x.b)).join('') || `<div class="empty">Nessuna scadenza. <a class="link" href="#bollette">Aggiungi una bolletta</a></div>`;

    // affitto del mese
    const rc = rentCfg();
    if (rc) {
      const r = rentMonth(ymOf(new Date()));
      countTo($('#h-rent'), rc.canone);
      const st = rentChip(r);
      $('#h-rent-sub').innerHTML = `<span class="chip ${st.cls}">${esc(st.txt)}</span>`;
    } else {
      $('#h-rent').textContent = '—'; $('#h-rent')._v = null;
      $('#h-rent-sub').innerHTML = '<span class="link">Configura →</span>';
    }

    // categorie
    const byCat = {};
    ms.forEach(s => (byCat[s.categoria || 'Altro'] = (byCat[s.categoria || 'Altro'] || 0) + Number(s.importo || 0)));
    const lims = catLimits();
    const budHtml = catBudgetRows(byCat, homeMonth === ymOf(new Date()));
    const rows = Object.entries(byCat).filter(([c]) => !lims[c]).sort((a, b) => b[1] - a[1]);
    const max = rows[0] ? rows[0][1] : 1;
    const top = rows.slice(0, 6);
    if (rows.length > 6) top.push(['Altre categorie', rows.slice(6).reduce((a, r) => a + r[1], 0)]);
    $('#h-cat').innerHTML = top.map(([c, v]) => `<div class="bar-row">
      <div class="bar-top"><span>${esc(c)} <span class="muted">${tot ? Math.round(v / tot * 100) : 0}%</span></span><span>${eur(v)}</span></div>
      <div class="bar-track"><div class="bar-fill" data-w="${Math.max(2, (v / max) * 100)}" style="width:${animate && !reduced() ? 0 : Math.max(2, (v / max) * 100)}%"></div></div></div>`).join('');
    $('#h-cat').innerHTML = (budHtml ? `<div class="cb-sec">${budHtml}</div>${top.length ? '<div class="cb-sep">Altre categorie</div>' : ''}` : '') + $('#h-cat').innerHTML;
    if (!budHtml && !top.length) $('#h-cat').innerHTML = '<div class="empty">Nessuna spesa in questo mese</div>';

    if (animate) requestAnimationFrame(() => requestAnimationFrame(() => $$('#h-cat .bar-fill').forEach(b => (b.style.width = b.dataset.w + '%'))));
    renderChart();
    renderBudget();
    renderSaldoKpi();
    renderForecast();
    renderInsights();

    const last = [...db.spese].sort((a, b) => (b.data + (b.creato || '')).localeCompare(a.data + (a.creato || ''))).slice(0, matchMedia('(min-width: 900px)').matches ? 8 : 5);
    $('#h-last').innerHTML = !last.length ? '<div class="empty">Ancora nessuna spesa. Tocca + per iniziare.</div>'
      : isDesk() ? speseTable(last) : last.map(speseItem).join('');
  }

  function renderChart() {
    const [y, m] = homeMonth.split('-').map(Number);
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(ymOf(new Date(y, m - 1 - i, 1)));
    const vals = months.map(k => sum(db.spese.filter(s => ym(s.data) === k)));
    const nonZero = vals.filter(v => v > 0);
    const avg = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
    $('#h-avg').textContent = avg ? `media ${eur0(avg)}/mese` : '';
    countTo($('#h-avg-big'), avg);

    const el = $('#h-chart');
    const W = Math.max(280, el.clientWidth || 600), H = 180, pt = 14, pb = 22, pl = 0, pr = 48;
    const max = Math.max(...vals, 1);
    const nice = niceMax(max);
    const bw = (W - pl - pr) / 12;
    const barW = Math.min(28, bw * 0.6);
    const yS = v => H - pb - (v / nice) * (H - pb - pt);
    let g = '';
    (vals.some(v => v > 0) ? [0.5, 1] : []).forEach(p => {
      const yy = yS(nice * p);
      g += `<line class="grid" x1="0" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text class="axis" x="${W}" y="${yy + 4}" text-anchor="end">${eur0(nice * p)}</text>`;
    });
    g += `<line class="grid" x1="0" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}"/>`;
    months.forEach((k, i) => {
      const cx = pl + bw * i + bw / 2;
      const v = vals[i];
      const top = yS(v);
      const h = Math.max(0, H - pb - top);
      const r = Math.min(4, h);
      const x = cx - barW / 2;
      const path = h > 0
        ? `M${x},${H - pb} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${H - pb} Z`
        : '';
      g += `<rect class="hit" x="${pl + bw * i}" y="0" width="${bw}" height="${H}" data-i="${i}"/>`;
      g += `<path class="b ${k === homeMonth ? 'cur' : ''}${animate && !reduced() ? ' grow' : ''}" style="animation-delay:${120 + i * 40}ms" d="${path}"/>`;
      g += `<text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(monthShort(k))}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Spese ultimi 12 mesi">${g}</svg>`;
    const svg = el.querySelector('svg');
    let tip;
    const show = e => {
      const i = +e.target.dataset.i;
      if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip); }
      tip.innerHTML = `${esc(monthName(months[i]))}<br><b>${eur(vals[i])}</b>`;
      const rect = svg.getBoundingClientRect();
      const sx = rect.width / W, sy = rect.height / H;
      tip.style.left = Math.min(Math.max((pl + bw * i + bw / 2) * sx, 60), rect.width - 60) + 'px';
      tip.style.top = yS(vals[i]) * sy + 'px';
      $$('.b', svg).forEach((b, j) => b.classList.toggle('hover', j === i));
    };
    const hide = () => { tip && tip.remove(); tip = null; $$('.b', svg).forEach(b => b.classList.remove('hover')); };
    $$('.hit', svg).forEach(h => {
      h.addEventListener('mouseenter', show);
      h.addEventListener('mouseleave', hide);
      h.addEventListener('click', e => { show(e); homeMonth = months[+e.target.dataset.i]; setTimeout(() => { hide(); renderHome(); }, 600); });
    });
  }
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  /* ================= SPESE ================= */
  function fillSpeseFilters() {
    const keys = new Set(db.spese.map(s => ym(s.data)));
    keys.add(ymOf(new Date()));
    const sorted = [...keys].filter(Boolean).sort().reverse();
    const ms = $('#f-month');
    ms.innerHTML = `<option value="">Tutti i mesi</option>` + sorted.map(k => `<option value="${k}">${esc(monthName(k))}</option>`).join('');
    ms.value = f.month;
    const cs = $('#f-cat');
    cs.innerHTML = `<option value="">Tutte le categorie</option>` + cats().map(c => `<option>${esc(c)}</option>`).join('');
    cs.value = f.cat;
  }

  function renderSpese() {
    fillSpeseFilters();
    const q = f.q.trim().toLowerCase();
    const list = db.spese
      .filter(s => !f.month || ym(s.data) === f.month)
      .filter(s => !f.cat || s.categoria === f.cat)
      .filter(s => !q || [s.descrizione, s.categoria, s.note, s.metodo].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.data + (b.creato || '')).localeCompare(a.data + (a.creato || '')));
    $('#f-count').textContent = `${list.length} ${list.length === 1 ? 'spesa' : 'spese'}`;
    countTo($('#f-total'), sum(list));
    if (isDesk()) {
      $('#spese-list').innerHTML = list.length ? `<div class="card tbl-card">${speseTable(list)}</div>` : '<div class="card empty">Nessuna spesa trovata</div>';
      return;
    }
    const groups = {};
    list.forEach(s => (groups[s.data] = groups[s.data] || []).push(s));
    $('#spese-list').innerHTML = Object.keys(groups).map(d => `<div class="day">
      <div class="day-h"><span>${esc(dayLabel(d))}</span><span>${eur(sum(groups[d]))}</span></div>
      ${groups[d].map(speseItem).join('')}</div>`).join('') || '<div class="card empty">Nessuna spesa trovata</div>';
  }

  /* ================= BOLLETTE ================= */
  function billCard(b, inactive) {
    const st = billStatus(b);
    const lf = billFatture(b)[0];
    const extra = lf && Number(lf.consumo) > 0 ? `<div class="s cons">Ultima: ${esc(fmtNum(lf.consumo, 0))} ${esc(lf.unita || '')} · ${eur(lf.importo)}${lf.unita ? ` · ${esc(fmtNum(lf.importo / lf.consumo, 3))} €/${esc(lf.unita)}` : ''}</div>`
      : lf ? `<div class="s cons">${billFatture(b).length} fatture registrate</div>` : '';
    return `<div class="bill" data-bill="${esc(b.id)}">
      ${iconHTML(b.nome)}
      <div class="main"><div class="t">${esc(b.nome)}</div>
        <div class="s">${esc([b.categoria, b.frequenza].filter(Boolean).join(' · '))}</div>${extra}</div>
      <div class="right"><div class="amt">${eur(b.importo)}</div>
        ${inactive ? '<span class="chip">Disattivata</span>' : `<span class="chip ${st.cls}">${esc(st.txt)}</span>`}
        ${inactive ? '' : `<button class="btn sm" data-pay="${esc(b.id)}">Segna pagata</button>`}</div></div>`;
  }
  function renderBills() {
    const ab = activeBills().sort((a, b) => a.scadenza.localeCompare(b.scadenza));
    $('#bill-photo').hidden = !aiReady();
    $('#bills-list').innerHTML = ab.map(b => billCard(b)).join('') || '<div class="card empty">Nessuna bolletta. Aggiungi luce, gas, mutuo, assicurazioni… e l\'app ti ricorderà le scadenze.</div>';
    const ib = inactiveBills();
    $('#bills-off').innerHTML = ib.length ? `<div class="off-title">Disattivate / pagate (una tantum)</div>` + ib.map(b => billCard(b, true)).join('') : '';
  }

  /* ================= IMPOSTAZIONI ================= */
  function renderSettings() {
    $('#conn-info').textContent = isLocal()
      ? 'Modalità solo dispositivo: i dati restano su questo browser e non sono condivisi.'
      : `Collegato al Foglio Google. ${db.spese.length} spese, ${db.bollette.length} bollette.`;
    $('#btn-sync').hidden = isLocal();
    renderAISettings();
    renderLockSettings();
    $('#shop-list').innerHTML = customShops().map((n, i) => `<div class="item shop">
      <div class="ic logo"><img src="${logoUrl(n.dominio)}" alt=""></div>
      <div class="main"><div class="t">${esc(n.nome)}</div><div class="s">${esc(n.dominio)}${n.categoria ? ' · ' + esc(n.categoria) : ''}</div></div>
      <button class="icon-btn" data-delshop="${i}" aria-label="Rimuovi">✕</button></div>`).join('') || '<p class="muted small" style="margin:0">Nessun negozio aggiunto.</p>';
    $('#shop-cat').innerHTML = '<option value="">Categoria</option>' + cats().map(c => `<option>${esc(c)}</option>`).join('');
    $('#cat-list').innerHTML = cats().map(c => `<span class="chip">${esc(c)}<button data-delcat="${esc(c)}" aria-label="Elimina ${esc(c)}">✕</button></span>`).join('');
  }

  function exportCSV() {
    const h = ['data', 'importo', 'categoria', 'descrizione', 'metodo', 'note'];
    const rows = [...db.spese].sort((a, b) => a.data.localeCompare(b.data))
      .map(s => h.map(k => k === 'importo' ? String(Number(s[k] || 0).toFixed(2)).replace('.', ',') : `"${String(s[k] ?? '').replace(/"/g, '""')}"`).join(';'));
    const blob = new Blob(['﻿' + [h.join(';'), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `spese-casa-${today()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }



  /* ================= AFFITTO ================= */
  const ICO_KEY = '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/></svg>';
  const monthShortY = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'short', year: 'numeric' }).replace('.', ''); };
  const rentCfg = () => (db.config.affitto && db.config.affitto.attivo && Number(db.config.affitto.canone) > 0) ? db.config.affitto : null;
  const rentKey = mk => 'affitto:' + mk;
  let rentYear = new Date().getFullYear();

  function rentMonth(mk) {
    const c = rentCfg() || {};
    const [y, m] = mk.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const due = ymd(new Date(y, m - 1, Math.min(Number(c.giorno) || 1, last)));
    const paid = db.spese.find(s => s.bollettaId === rentKey(mk)) || null;
    const start = c.inizio ? String(c.inizio).slice(0, 7) : (firstRentPaid() || ymOf(new Date()));
    return { month: mk, due, paid, importo: Number(c.canone) || 0, before: !!(start && mk < start), days: daysTo(due) };
  }
  function rentChip(r) {
    if (r.paid) return { cls: 'paid', txt: 'Pagato il ' + parseD(r.paid.data).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) };
    if (r.days < 0) return { cls: 'late', txt: `Scaduto da ${-r.days} gg` };
    if (r.days === 0) return { cls: 'late', txt: 'Scade oggi' };
    if (r.days <= 7) return { cls: 'soon', txt: r.days === 1 ? 'Scade domani' : `Scade tra ${r.days} gg` };
    return { cls: '', txt: 'Scade il ' + parseD(r.due).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) };
  }
  // mesi non pagati già scaduti (ultimi 12)
  function rentArrears() {
    if (!rentCfg()) return [];
    const now = new Date(), out = [];
    for (let i = 12; i >= 0; i--) {
      const r = rentMonth(ymOf(new Date(now.getFullYear(), now.getMonth() - i, 1)));
      if (!r.before && !r.paid && r.days < 0) out.push(r);
    }
    return out;
  }
  // da mostrare nelle scadenze: arretrati + mese corrente + prossimo se non pagati
  function rentUpcoming() {
    if (!rentCfg()) return [];
    const now = new Date();
    const list = rentArrears();
    [0, 1].forEach(o => { const r = rentMonth(ymOf(new Date(now.getFullYear(), now.getMonth() + o, 1))); if (!r.before && !r.paid && r.days >= 0) list.push(r); });
    return list;
  }
  function rentCat() {
    return db.categorie.find(c => c === 'Affitto / Mutuo') || db.categorie.find(c => /affitt/i.test(c)) || pickCat('Altro');
  }

  const firstRentPaid = () => db.spese.filter(x => String(x.bollettaId || '').startsWith('affitto:')).map(x => x.bollettaId.slice(8)).sort()[0] || null;
  // se l'inizio contratto non è stato scelto: parte dal primo affitto registrato (salvato, così anche le email lo rispettano)
  function ensureRentStart() {
    const c = rentCfg();
    if (!c || (c.inizio && !c.inizioAuto)) return;
    const first = firstRentPaid();
    if (first && first !== c.inizio) setConfig('affitto', { ...c, inizio: first, inizioAuto: true });
  }

  function renderRent() {
    ensureRentStart();
    const c = rentCfg();
    $('#rent-empty').hidden = !!c;
    $('#rent-main').hidden = !c;
    if (!c) return;
    const cur = ymOf(new Date());
    const arr = rentArrears();
    // mostra il primo mese arretrato, altrimenti il corrente
    const r = arr[0] || rentMonth(cur);
    const st = rentChip(r);
    $('#r-month').textContent = 'Affitto di ' + monthName(r.month);
    countTo($('#r-amount'), c.canone);
    $('#r-status').innerHTML = `<span class="chip ${st.cls}">${esc(st.txt)}</span>${arr.length > 1 ? ` <span class="chip late">${arr.length} mesi arretrati</span>` : ''}`;
    const pay = $('#r-pay');
    pay.hidden = !!r.paid;
    pay.dataset.month = r.month;
    $('#r-info').innerHTML = [
      c.proprietario ? `<div><span class="muted small">Proprietario</span><strong>${esc(c.proprietario)}</strong></div>` : '',
      c.iban ? `<div><span class="muted small">IBAN</span><strong class="mono">${esc(c.iban)}</strong> <button class="btn sm" data-copy="${esc(c.iban)}">Copia</button></div>` : '',
      `<div><span class="muted small">Causale</span><strong>${esc((c.causale || 'Affitto {mese}').replace('{mese}', monthName(r.month)))}</strong></div>`
    ].join('');

    // griglia anno
    $('#r-year').textContent = rentYear;
    let paidN = 0, paidTot = 0, dueN = 0;
    $('#r-months').innerHTML = Array.from({ length: 12 }, (_, i) => {
      const mk = `${rentYear}-${pad(i + 1)}`;
      const x = rentMonth(mk);
      const name = new Date(rentYear, i, 1).toLocaleDateString('it-IT', { month: 'short' }).replace('.', '');
      let cls = 'future', txt = '';
      if (x.before) { cls = 'off'; txt = '—'; }
      else if (x.paid) { cls = 'paid'; txt = eur0(x.paid.importo); paidN++; paidTot += Number(x.paid.importo) || 0; }
      else if (x.days < 0) { cls = 'late'; txt = 'Scaduto'; dueN++; }
      else if (mk === cur || x.days <= 31) { cls = 'due'; txt = 'Da pagare'; }
      else txt = '';
      const check = cls === 'paid' ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '';
      return `<button class="m ${cls}${mk === cur ? ' cur' : ''}" data-rentmonth="${mk}">
        <span class="mn">${esc(name)}</span>${check}<span class="mv">${esc(txt)}</span></button>`;
    }).join('');
    $('#r-count').textContent = `${paidN} mesi pagati${dueN ? ` · ${dueN} non pagati` : ''}`;
    countTo($('#r-total'), paidTot);

    // notifiche
    const n = db.config.notifiche || {};
    const on = n.email || n.calendario;
    $('#r-notify').innerHTML = on ? `<ul class="nlist">
        ${n.calendario ? `<li><b>Calendario Google</b><span>Affitto${n.fisse !== false ? ' e spese fisse' : ''}: promemoria sul telefono ${n.giorniPrima ? n.giorniPrima + ' gg prima e ' : ''}il giorno della scadenza, alle ${n.ora}:00</span></li>` : ''}
        ${n.email ? `<li><b>Email</b><span>Ogni giorno alle ${n.ora}:00 controllo automatico: ti scrivo solo se non hai ancora pagato${n.bollette ? ' (anche bollette)' : ''}</span></li>` : ''}
      </ul>${n.email ? '<button class="btn sm" data-rent="testmail">Invia email di prova</button>' : ''}`
      : `<p class="muted small" style="margin:0">Nessuna notifica attiva. Configura un promemoria sul calendario o via email.</p>`;

    // contratto
    const kv = [
      ['Canone mensile', eur(c.canone)],
      ['Scadenza', `il giorno ${c.giorno} di ogni mese`],
      ['Pagamento', c.metodo || 'Bonifico'],
      c.inizio ? ['Inizio contratto', monthName(String(c.inizio).slice(0, 7))] : null,
      c.note ? ['Note', c.note] : null
    ].filter(Boolean);
    $('#r-contract').innerHTML = kv.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  }

  function formRent() {
    const c = db.config.affitto || { canone: '', giorno: 5, proprietario: '', iban: '', metodo: 'Bonifico', inizio: '', causale: 'Affitto {mese}', note: '' };
    const days = Array.from({ length: 31 }, (_, i) => String(i + 1));
    openSheet('Contratto d\'affitto', `
      <div class="f-row">
        <label class="f"><span>Canone mensile (€)</span><input name="canone" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(fmtAmt(c.canone))}" required data-focus></label>
        <label class="f"><span>Giorno di scadenza</span><select name="giorno" class="amount-input">${opt(days, String(c.giorno || 5))}</select></label>
      </div>
      <label class="f"><span>Proprietario</span><input name="proprietario" placeholder="Nome e cognome" value="${esc(c.proprietario)}"></label>
      <label class="f"><span>IBAN</span><input name="iban" placeholder="IT00 X000 0000 0000 0000 0000 000" value="${esc(c.iban)}" autocapitalize="characters"></label>
      <div class="f-row">
        <label class="f"><span>Metodo</span><select name="metodo">${opt(METODI, c.metodo || 'Bonifico')}</select></label>
        <label class="f"><span>Inizio contratto</span><input name="inizio" type="month" value="${esc(String(c.inizio || '').slice(0, 7))}"></label>
      </div>
      <label class="f"><span>Causale bonifico</span><input name="causale" value="${esc(c.causale || 'Affitto {mese}')}"><div class="hint muted">{mese} viene sostituito con il mese pagato</div></label>
      <label class="f"><span>Note</span><textarea name="note" rows="2" placeholder="Durata, deposito cauzionale, spese incluse…">${esc(c.note)}</textarea></label>`,
      async fd => {
        const canone = num(fd.get('canone'));
        if (canone <= 0) return toast('Inserisci il canone');
        const inizio = fd.get('inizio');
        const v = { inizioAuto: !!(c.inizioAuto && inizio === String(c.inizio || '').slice(0, 7)), attivo: true, canone, giorno: Number(fd.get('giorno')), proprietario: fd.get('proprietario').trim(), iban: fd.get('iban').replace(/\s+/g, ' ').trim().toUpperCase(), metodo: fd.get('metodo'), inizio, causale: fd.get('causale').trim(), note: fd.get('note').trim() };
        setConfig('affitto', v);
        closeSheet(); toast('Affitto salvato');
        const n = db.config.notifiche || {};
        if (n.calendario && !isLocal()) { try { await syncNow(); await api('reminders'); } catch (e) { toast(e.message); } }
      },
      db.config.affitto ? () => {
        if (!confirm('Eliminare la configurazione dell\'affitto? I pagamenti registrati restano tra le spese.')) return;
        setConfig('affitto', null); closeSheet(); toast('Affitto eliminato');
      } : null);
  }

  function formRentPay(mk) {
    const c = rentCfg(); if (!c) return formRent();
    const r = rentMonth(mk);
    if (r.paid) return formSpesa(r.paid);
    // mesi selezionabili: 12 indietro, 2 avanti, non pagati
    const now = new Date(), opts = [];
    for (let i = -12; i <= 2; i++) {
      const k = ymOf(new Date(now.getFullYear(), now.getMonth() + i, 1));
      const x = rentMonth(k);
      if (!x.paid) opts.push(k);
    }
    if (!opts.includes(mk)) opts.push(mk);
    openSheet('Pagamento affitto', `
      <label class="f"><span>Importo pagato (€)</span><input name="importo" class="amount-input" inputmode="decimal" value="${esc(fmtAmt(c.canone))}" required data-focus></label>
      <div class="f-row">
        <label class="f"><span>Mese di riferimento</span><select name="mese">${opts.sort().map(k => `<option value="${k}"${k === mk ? ' selected' : ''}>${esc(monthName(k))}</option>`).join('')}</select></label>
        <label class="f"><span>Data pagamento</span><input name="data" type="date" value="${today()}" required></label>
      </div>
      <label class="f"><span>Metodo</span><select name="metodo">${opt(METODI, c.metodo || 'Bonifico')}</select></label>
      <label class="f"><span>Note</span><input name="note" placeholder="Es. CRO bonifico" value=""></label>`,
      fd => {
        const importo = num(fd.get('importo'));
        if (importo <= 0) return toast('Inserisci un importo valido');
        const m = fd.get('mese');
        const spesa = { id: uid(), data: fd.get('data'), importo, categoria: rentCat(), descrizione: 'Affitto ' + monthName(m), metodo: fd.get('metodo'), note: fd.get('note').trim(), bollettaId: rentKey(m), creato: new Date().toISOString(), sito: '' };
        write([{ action: 'upsert', sheet: 'Spese', row: spesa }]);
        closeSheet(); toast('Affitto di ' + monthName(m) + ' registrato');
      }, null, 'Registra pagamento');
  }

  function formNotify() {
    const n = { email: false, calendario: false, bollette: true, giorniPrima: 3, ora: 9, ...(db.config.notifiche || {}) };
    if (isLocal()) return toast('Le notifiche richiedono il collegamento al Foglio Google');
    const hours = Array.from({ length: 15 }, (_, i) => String(i + 7));
    openSheet('Notifiche', `
      <label class="sw"><input type="checkbox" name="calendario" ${n.calendario ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Calendario Google</b><small>Crea eventi ricorrenti con promemoria per affitto e spese fisse: arrivano come notifica sul telefono.</small></span></label>
      <label class="sw"><input type="checkbox" name="email" ${n.email ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Email intelligente</b><small>Controllo ogni giorno: ti scrivo solo se il pagamento non è ancora registrato.</small></span></label>
      <label class="sw"><input type="checkbox" name="bollette" ${n.bollette ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Includi le bollette</b><small>Nell'email anche le bollette in scadenza.</small></span></label>
      <label class="sw"><input type="checkbox" name="fisse" ${n.fisse !== false ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Includi le spese fisse</b><small>Abbonamenti, rate e assicurazioni con l'avviso attivo.</small></span></label>
      <label class="sw"><input type="checkbox" name="auto" ${n.auto !== false ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Includi le scadenze auto</b><small>Assicurazione, bollo, revisione e tagliando (anche un mese prima).</small></span></label>
      <div class="f-row" style="margin-top:6px">
        <label class="f"><span>Avvisami</span><select name="giorniPrima">${[0, 1, 2, 3, 5, 7].map(d => `<option value="${d}"${Number(n.giorniPrima) === d ? ' selected' : ''}>${d === 0 ? 'Solo il giorno stesso' : d + (d === 1 ? ' giorno prima' : ' giorni prima')}</option>`).join('')}</select></label>
        <label class="f"><span>Orario</span><select name="ora">${hours.map(hh => `<option value="${hh}"${String(n.ora) === hh ? ' selected' : ''}>${hh}:00</option>`).join('')}</select></label>
      </div>
      <p class="muted small" style="margin:0 0 8px">Le email arrivano all'indirizzo Gmail del tuo account Google.</p>`,
      async fd => {
        const v = { calendario: fd.get('calendario') === 'on', email: fd.get('email') === 'on', bollette: fd.get('bollette') === 'on', fisse: fd.get('fisse') === 'on', auto: fd.get('auto') === 'on', giorniPrima: Number(fd.get('giorniPrima')), ora: Number(fd.get('ora')) };
        if (v.calendario && !rentCfg() && !fisseActive().length && !vehActive().length) return toast('Aggiungi prima l\'affitto o una spesa fissa');
        setConfig('notifiche', v);
        setConfig('appUrl', location.href.split('#')[0]);
        closeSheet(); busy('Attivo le notifiche…');
        try {
          await syncNow();
          const r = await api('reminders');
          busy();
          toast(r.calendario || r.email ? 'Notifiche attivate' + (r.indirizzo ? ' · ' + r.indirizzo : '') : 'Notifiche disattivate');
        } catch (e) {
          busy();
          toast(/autorizz|permission|permess/i.test(e.message) ? 'Serve un permesso: esegui la funzione "autorizza" nello script' : e.message);
        }
        render();
      }, null, 'Salva notifiche');
  }








  /* ================= ALLEGATI (PDF / foto) ================= */
  const ICO_CLIP = '<svg viewBox="0 0 24 24"><path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5"/></svg>';
  // sceglie un PDF o un'immagine; le foto vengono ridotte
  function pickDoc() {
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/pdf,image/*'; pauseLock();
      inp.onchange = async () => {
        const file = inp.files && inp.files[0];
        if (!file) return reject(new Error('annullato'));
        try {
          if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
            if (file.size > 12 * 1024 * 1024) throw new Error('PDF troppo grande (max 12 MB)');
            const b64 = await blobB64(file);
            return resolve({ b64, mime: 'application/pdf', name: file.name });
          }
          const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Immagine non leggibile')); im.src = URL.createObjectURL(file); });
          const k = Math.min(1, 2000 / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve({ b64: c.toDataURL('image/jpeg', 0.85).split(',')[1], mime: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg' });
        } catch (e) { reject(e); }
      };
      inp.click();
    });
  }
  async function uploadDoc(doc, cartella, name) {
    if (isLocal()) throw new Error('Gli allegati richiedono il collegamento al Foglio Google');
    const r = await api('upload', { b64: doc.b64, mime: doc.mime, name: name || doc.name, cartella });
    return r.id;
  }
  // riquadro allegato dentro un form: gestisce file nuovo (in attesa) o già salvato
  function attachBox(opts) {
    const st = { pending: opts.pending || null, id: opts.id || '', removed: false };
    const box = $('#att-box');
    const draw = () => {
      if (st.pending) box.innerHTML = `<div class="att on">${ICO_CLIP}<div class="att-m"><b>${esc(st.pending.name)}</b><small>Verrà salvato su Google Drive</small></div>
        ${opts.onRead && aiReady() ? `<button type="button" class="btn sm ai-inline" id="att-ai">${ICO.spark}Leggi con IA</button>` : ''}<button type="button" class="icon-btn" id="att-x" aria-label="Rimuovi">✕</button></div>`;
      else if (st.id && !st.removed) box.innerHTML = `<div class="att on">${ICO_CLIP}<div class="att-m"><b>${esc(opts.label)} allegata</b><small>Salvata su Google Drive</small></div>
        <button type="button" class="btn sm" id="att-open">Apri</button><button type="button" class="icon-btn" id="att-x" aria-label="Rimuovi">✕</button></div>`;
      else box.innerHTML = `<button type="button" class="att add" id="att-add">${ICO_CLIP}<span>Allega ${esc(opts.label.toLowerCase())} <small>PDF o foto</small></span></button>`;
      const a = $('#att-add'), x = $('#att-x'), o = $('#att-open'), ai = $('#att-ai');
      if (a) a.onclick = async () => { try { st.pending = await pickDoc(); draw(); if (opts.onRead && aiReady() && opts.autoRead) opts.onRead(st.pending); } catch (e) { if (e.message !== 'annullato') toast(e.message); } };
      if (x) x.onclick = () => { if (st.pending) st.pending = null; else st.removed = true; draw(); };
      if (o) o.onclick = () => openDoc(st.id, { fileId: st.id, nome: opts.label, ref: null });
      if (ai) ai.onclick = () => opts.onRead(st.pending);
    };
    draw();
    // da chiamare al salvataggio: restituisce l'id finale dell'allegato
    st.commit = async (name) => {
      if (st.pending) { busy('Salvo l\'allegato…'); try { const id = await uploadDoc(st.pending, opts.cartella, name); busy(); return id; } catch (e) { busy(); toast(e.message); return st.id && !st.removed ? st.id : ''; } }
      return st.removed ? '' : st.id;
    };
    return st;
  }

  /* ---------- Calendario entrate ---------- */
  let inCalMonth = ymOf(new Date()), inCalSel = today();
  function inEvents(from, to) {
    const ev = [];
    db.entrate.filter(e => e.data >= from && e.data <= to).forEach(e => { const p = personaById(e.personaId); ev.push({ date: e.data, title: e.descrizione || e.tipo, importo: Number(e.importo) || 0, p, tipo: e.tipo, st: 'in', ref: e.id, att: !!e.allegato }); });
    ricorrentiOf('all').forEach(r => {
      let d = r.prossima, g = 0;
      while (d && d <= to && g++ < 14) { if (d >= from && d > today()) ev.push({ date: d, title: r.descrizione || r.tipo, importo: Number(r.importo) || 0, p: personaById(r.personaId), tipo: r.tipo, st: 'plan', rec: r.id }); d = nextMonthDay(d, Number(r.giorno) || 27); }
    });
    return ev.sort((a, b) => a.date.localeCompare(b.date));
  }
  function renderInCal() {
    const grid = $('#inc-grid'); if (!grid) return;
    const [y, m] = inCalMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
    const from = ymd(first), to = ymd(last);
    const ev = inEvents(from, to);
    $('#inc-title').textContent = monthName(inCalMonth);
    const got = ev.filter(e => e.st === 'in').reduce((a, e) => a + e.importo, 0), exp = ev.filter(e => e.st === 'plan').reduce((a, e) => a + e.importo, 0);
    $('#inc-tot').innerHTML = `<span><i class="dot paid"></i>Ricevute <b>${eur(got)}</b></span>${exp ? `<span><i class="dot plan"></i>In arrivo <b>${eur(exp)}</b></span>` : ''}`;
    const lead = (first.getDay() + 6) % 7, desk = isDesk(), t = today();
    if (inCalSel.slice(0, 7) !== inCalMonth) inCalSel = inCalMonth === ym(t) ? t : from;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cd out"></div>');
    for (let d = 1; d <= last.getDate(); d++) {
      const ds = `${inCalMonth}-${pad(d)}`, de = ev.filter(e => e.date === ds);
      const body = desk
        ? de.slice(0, 3).map(e => `<div class="ev in-ev ${e.st === 'plan' ? 'st-plan' : ''}" style="--c:${pColor(e.p)}">${avatar(e.p, 'xxs')}<span class="evt">${esc(e.title)}</span><b>${esc(eur0(e.importo))}</b></div>`).join('') + (de.length > 3 ? `<div class="ev-more">+${de.length - 3}</div>` : '')
        : `<div class="dots">${de.slice(0, 4).map(e => `<i class="dot ${e.st === 'plan' ? 'plan' : ''}" style="${e.st === 'plan' ? '' : 'background:' + pColor(e.p)}"></i>`).join('')}</div>${de.length ? `<div class="ctot pos-t">+${esc(fmtNum(de.reduce((a, e) => a + e.importo, 0), 0))}</div>` : ''}`;
      cells.push(`<button type="button" class="cd${ds === t ? ' today' : ''}${ds === inCalSel ? ' sel' : ''}${de.some(e => e.st === 'in') ? ' has-in' : ''}" data-inday="${ds}" style="animation-delay:${Math.min((lead + d) * 12, 400)}ms"><span class="cn">${d}</span>${body}</button>`);
    }
    grid.innerHTML = cells.join('');
    const de = ev.filter(e => e.date === inCalSel);
    const label = parseD(inCalSel).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#inc-agenda').innerHTML = `<div class="ag-h"><b>${esc(label.charAt(0).toUpperCase() + label.slice(1))}</b><span class="small pos-t">${de.length ? '+' + eur(de.reduce((a, e) => a + e.importo, 0)) : ''}</span></div>
      ${de.length ? `<div class="list">${de.map(e => `<div class="item ag" ${e.st === 'in' ? `data-inid="${esc(e.ref)}"` : `data-inrec="${esc(e.rec)}"`}>${tipoInIcon(e.tipo, e.p)}
        <div class="main"><div class="t">${esc(e.title)}${e.att ? ` <i class="clip">${ICO_CLIP}</i>` : ''}</div><div class="s">${e.p ? esc(e.p.nome) + ' · ' : ''}<span class="chip ${e.st === 'in' ? 'paid' : ''}">${e.st === 'in' ? 'Ricevuta' : 'In arrivo'}</span></div></div>
        <div class="amt pos-t">+${eur(e.importo)}</div></div>`).join('')}</div>`
      : `<div class="empty">Nessuna entrata · <button type="button" class="link-btn" data-inact="addday">Aggiungi in questo giorno</button></div>`}`;
  }

  /* ================= ENTRATE ================= */
  const P_COLORS = ['#17795a', '#2563eb', '#c026d3', '#ea580c', '#0891b2', '#ca8a04'];
  const TIPI_IN = {
    Stipendio: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    Tredicesima: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
    Bonus: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    Rimborso: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    Vendita: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    'Affitto percepito': '<path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5"/>',
    Regalo: '<rect x="3" y="8" width="18" height="4"/><path d="M5 12v9h14v-9M12 8v13M12 8s-2-5-5-4 1 4 5 4zM12 8s2-5 5-4-1 4-5 4z"/>',
    Interessi: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    Altro: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
  };
  const TIPO_LBL = { Tredicesima: '13ª / 14ª', 'Affitto percepito': 'Affitto' };
  const personaById = id => db.persone.find(p => p.id === id) || null;
  const personeAttive = () => db.persone.filter(p => p.attiva === '' || p.attiva == null || isOn(p.attiva));
  const pColor = p => (p && p.colore) || P_COLORS[0];
  const avatar = (p, cls = '') => `<span class="av ${cls}" style="--c:${pColor(p)}">${esc(initials(p ? p.nome : '?'))}</span>`;
  const tipoInIcon = (t, p) => `<div class="ic tin-ic" style="--c:${pColor(p)}"><svg viewBox="0 0 24 24">${TIPI_IN[t] || TIPI_IN.Altro}</svg></div>`;
  let inSel = 'all', inAll = false;
  const entrateOf = sel => db.entrate.filter(e => sel === 'all' || e.personaId === sel).sort((a, b) => (b.data + (b.creato || '')).localeCompare(a.data + (a.creato || '')));
  const ricorrentiOf = sel => db.entrateFisse.filter(r => (r.attiva === '' || r.attiva == null || isOn(r.attiva)) && (sel === 'all' || r.personaId === sel));
  const dayIn = (y, m0, g) => ymd(new Date(y, m0, Math.min(g, new Date(y, m0 + 1, 0).getDate())));
  const nextMonthDay = (d, g) => { const x = parseD(d); return dayIn(x.getFullYear(), x.getMonth() + 1, g); };
  const nextPay = (g, from) => { const x = parseD(from); const a = dayIn(x.getFullYear(), x.getMonth(), g); return a >= from ? a : dayIn(x.getFullYear(), x.getMonth() + 1, g); };

  // entrate ricorrenti: registrate da sole alla data di accredito (id fisso = nessun doppione)
  function autoIncome() {
    const t = today(), ops = [];
    ricorrentiOf('all').filter(r => r.prossima && r.prossima <= t).forEach(r => {
      let d = r.prossima, g = 0;
      while (d <= t && g++ < 24) {
        const id = 'in-' + r.id + '-' + d;
        if (!db.entrate.some(e => e.id === id)) ops.push({ action: 'upsert', sheet: 'Entrate', row: { id, data: d, importo: Number(r.importo) || 0, personaId: r.personaId, tipo: r.tipo, descrizione: r.descrizione || r.tipo, note: 'Accredito automatico', ricorrenteId: r.id, creato: new Date().toISOString() } });
        d = nextMonthDay(d, Number(r.giorno) || 27);
      }
      ops.push({ action: 'upsert', sheet: 'EntrateFisse', row: { ...r, prossima: d } });
    });
    if (ops.length) write(ops);
  }

  function renderEntrate() {
    const pp = personeAttive();
    $('#in-empty').hidden = !!pp.length;
    $('#in-body').hidden = !pp.length;
    renderGoals();
    if (!pp.length) return;
    if (!pp.some(p => p.id === inSel)) inSel = pp[0].id;
    const p = personaById(inSel);
    renderInCal();
    $('#in-tabs').innerHTML = pp.map(x => `<button class="veh-tab${x.id === inSel ? ' on' : ''}" data-insel="${esc(x.id)}">${avatar(x, 'xs')}<span>${esc(x.nome)}</span></button>`).join('')
      + `<button class="veh-tab add" data-inact="newp">+ Persona</button>`;

    const mk = ymOf(new Date()), y = String(new Date().getFullYear());
    const list = entrateOf(inSel);
    const month = sum(list.filter(e => ym(e.data) === mk));
    const year = sum(list.filter(e => e.data.startsWith(y)));
    const famIn = sum(db.entrate.filter(e => ym(e.data) === mk));
    const famOut = sum(db.spese.filter(s => ym(s.data) === mk));
    const famYear = sum(db.entrate.filter(e => e.data.startsWith(y)));
    const rec = ricorrentiOf(inSel);

    const hero = $('#in-hero');
    hero.style.setProperty('--c', p ? pColor(p) : '#17795a');
    hero.innerHTML = p
      ? `${avatar(p, 'lg')}<div class="vh-main"><h3>${esc(p.nome)}</h3><div class="vh-sub">${rec.length ? rec.map(r => `<span>${esc(r.descrizione || r.tipo)} ${eur0(r.importo)} il ${r.giorno}</span>`).join('<span>·</span>') : '<span>Nessuna entrata ricorrente</span>'}</div></div>
         <div class="vh-km"><span>Quota delle entrate ${y}</span><b>${famYear ? Math.round(year / famYear * 100) + '%' : '—'}</b></div>
         <button class="btn sm" data-inact="editp">Modifica</button>`
      : `<span class="av-stack lg">${pp.map(x => avatar(x, 'lg')).join('')}</span><div class="vh-main"><h3>Famiglia</h3><div class="vh-sub"><span>${pp.map(x => esc(x.nome)).join(' · ')}</span></div></div>
         <div class="vh-km"><span>Saldo del mese</span><b>${famIn - famOut >= 0 ? '+' : '−'}${eur0(Math.abs(famIn - famOut))}</b></div>`;

    countTo($('#in-month'), month);
    countTo($('#in-year'), year);
    $('#in-k3-l').textContent = p ? 'Media mensile' : 'Risparmio del mese';
    if (p) {
      const nm = new Set(list.filter(e => e.data.startsWith(y)).map(e => ym(e.data))).size || 1;
      countTo($('#in-k3'), year / nm); $('#in-k3-sub').textContent = 'anno ' + y;
    } else {
      const rate = famIn ? Math.round((famIn - famOut) / famIn * 100) : 0;
      const k3 = $('#in-k3'); k3.textContent = famIn ? rate + '%' : '—'; k3._v = null;
      k3.classList.toggle('neg-t', famIn && rate < 0);
      $('#in-k3-sub').textContent = famIn ? `entrate ${eur0(famIn)} · spese ${eur0(famOut)}` : 'registra le entrate del mese';
    }

    // grafico entrate vs spese (12 mesi)
    const now = new Date(), ms = [];
    for (let i = 11; i >= 0; i--) ms.push(ymOf(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    const vin = ms.map(k => sum(list.filter(e => ym(e.data) === k)));
    const showOut = !p;
    const vout = ms.map(k => showOut ? sum(db.spese.filter(s => ym(s.data) === k)) : 0);
    const mx = Math.max(1, ...vin, ...vout);
    $('#in-chart').innerHTML = `<div class="legend"><span><i style="background:var(--accent)"></i>Entrate</span>${showOut ? '<span><i style="background:#94a3b8"></i>Spese</span>' : ''}</div>
      <div class="mbars dual">${ms.map((k, i) => `<div class="mb" title="${esc(monthName(k))}&#10;Entrate ${esc(eur(vin[i]))}${showOut ? `&#10;Spese ${esc(eur(vout[i]))}&#10;Saldo ${esc(eur(vin[i] - vout[i]))}` : ''}">
        ${showOut ? `<span class="mbv ${vin[i] - vout[i] >= 0 ? 'pos-t' : 'neg-t'}">${vin[i] || vout[i] ? (vin[i] - vout[i] >= 0 ? '+' : '−') + esc(fmtNum(Math.abs(vin[i] - vout[i]) / 1000, 1)) + 'k' : ''}</span>` : `<span class="mbv">${vin[i] ? esc(eur0(vin[i])) : ''}</span>`}
        <div class="mb2"><i class="in" style="height:${vin[i] ? Math.max(3, vin[i] / mx * 100) : 0}%;animation-delay:${i * 35}ms"></i>${showOut ? `<i class="out" style="height:${vout[i] ? Math.max(3, vout[i] / mx * 100) : 0}%;animation-delay:${i * 35 + 60}ms"></i>` : ''}</div>
        <span class="mbl">${esc(monthShort(k))}</span></div>`).join('')}</div>`;

    $('#in-rec').innerHTML = rec.length ? `<div class="list">${rec.map(r => { const pr = personaById(r.personaId); return `<div class="item" data-inrec="${esc(r.id)}">${tipoInIcon(r.tipo, pr)}
      <div class="main"><div class="t">${esc(r.descrizione || r.tipo)}</div><div class="s">${pr && inSel === 'all' ? esc(pr.nome) + ' · ' : ''}ogni mese il ${r.giorno} · prossimo ${esc(shortDate(r.prossima))}</div></div>
      <div class="right"><div class="amt pos-t">+${eur(r.importo)}</div><span class="chip">Auto</span></div></div>`; }).join('')}</div>`
      : '<p class="muted small" style="margin:0">Aggiungi lo stipendio come entrata ricorrente: verrà registrato da solo ogni mese.</p>';

    const byT = {}; list.filter(e => e.data.startsWith(y)).forEach(e => (byT[e.tipo || 'Altro'] = (byT[e.tipo || 'Altro'] || 0) + (Number(e.importo) || 0)));
    const rows = Object.entries(byT).sort((a, b) => b[1] - a[1]); const mxT = rows[0] ? rows[0][1] : 1, totT = rows.reduce((a, r) => a + r[1], 0);
    $('#in-tipi').innerHTML = rows.map(([k, v]) => `<div class="bar-row"><div class="bar-top"><span>${esc(TIPO_LBL[k] || k)} <span class="muted">${Math.round(v / totT * 100)}%</span></span><span>${eur(v)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, v / mxT * 100)}%"></div></div></div>`).join('') || '<div class="empty">Nessuna entrata quest\'anno</div>';

    $('#in-contrib-card').hidden = !!p || pp.length < 2;
    if (!p && pp.length > 1) {
      const fy = pp.map(x => [x, sum(db.entrate.filter(e => e.personaId === x.id && e.data.startsWith(y)))]); const tt = fy.reduce((a, r) => a + r[1], 0) || 1;
      $('#in-contrib').innerHTML = `<div class="stack">${fy.map(([x, v]) => `<i style="width:${v / tt * 100}%;background:${pColor(x)}" title="${esc(x.nome)}"></i>`).join('')}</div>
        <div class="list">${fy.map(([x, v]) => `<div class="item" data-insel="${esc(x.id)}">${avatar(x)}<div class="main"><div class="t">${esc(x.nome)}</div><div class="s">${Math.round(v / tt * 100)}% delle entrate ${y}</div></div><div class="amt">${eur(v)}</div></div>`).join('')}</div>`;
    }

    const lim = inAll ? 400 : 10;
    $('#in-list').innerHTML = list.length ? `<div class="list">${list.slice(0, lim).map(e => { const pr = personaById(e.personaId); return `<div class="item" data-inid="${esc(e.id)}">${tipoInIcon(e.tipo, pr)}
      <div class="main"><div class="t">${esc(e.descrizione || e.tipo)}${e.allegato ? ` <i class="clip">${ICO_CLIP}</i>` : ''}</div><div class="s">${esc(shortDate(e.data))} · ${esc(TIPO_LBL[e.tipo] || e.tipo)}${pr && inSel === 'all' ? ' · ' + esc(pr.nome) : ''}${e.ricorrenteId ? ' · auto' : ''}</div></div>
      <div class="amt pos-t">+${eur(e.importo)}</div></div>`; }).join('')}</div>${list.length > lim ? `<button class="btn block more-btn" data-inact="all">Mostra tutte (${list.length})</button>` : ''}`
      : '<div class="empty">Nessuna entrata registrata</div>';
  }

  const whoPicker = (pp, sel) => pp.length > 1
    ? `<div class="who">${pp.map(x => `<label class="whop"><input type="radio" name="personaId" value="${esc(x.id)}" ${x.id === sel ? 'checked' : ''}><span>${avatar(x, 'xs')}${esc(x.nome)}</span></label>`).join('')}</div>`
    : `<input type="hidden" name="personaId" value="${esc((pp[0] || {}).id || '')}">`;

  function formPersona(p) {
    const isNew = !p;
    p = p || { id: uid(), nome: '', colore: P_COLORS[db.persone.length % P_COLORS.length], attiva: true };
    openSheet(isNew ? 'Nuova persona' : p.nome, `
      <label class="f"><span>Nome</span><input name="nome" placeholder="Es. Dario" value="${esc(p.nome)}" required data-focus></label>
      <label class="f"><span>Colore</span><div class="colors">${P_COLORS.map(c => `<label class="cl"><input type="radio" name="colore" value="${c}" ${c === p.colore ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></label>`,
      fd => {
        const nome = String(fd.get('nome') || '').trim(); if (!nome) return toast('Inserisci il nome');
        const row = { ...p, nome, colore: fd.get('colore') || p.colore, attiva: true };
        write([{ action: 'upsert', sheet: 'Persone', row }]); inSel = row.id; closeSheet(); toast(isNew ? nome + ' aggiunto' : 'Salvato');
        if (isNew) setTimeout(() => formRicorrente(row), 450);
      },
      isNew ? null : () => { if (!confirm('Eliminare ' + p.nome + '? Le entrate registrate restano.')) return; write([{ action: 'delete', sheet: 'Persone', id: p.id }]); inSel = 'all'; closeSheet(); });
  }

  function formEntrata(e, pre) {
    const isNew = !e;
    const pp = personeAttive();
    e = e || { id: uid(), data: today(), importo: '', personaId: inSel !== 'all' ? inSel : (pp[0] || {}).id, tipo: 'Stipendio', descrizione: '', note: '', ricorrenteId: '' };
    if (pre) e = { ...e, ...pre };
    openSheet(isNew ? 'Nuova entrata' : 'Modifica entrata', `
      ${whoPicker(pp, e.personaId)}
      <div class="tipi in-tipi">${Object.keys(TIPI_IN).map(t => `<label class="tp"><input type="radio" name="tipo" value="${t}" ${t === e.tipo ? 'checked' : ''}><span><svg viewBox="0 0 24 24">${TIPI_IN[t]}</svg>${TIPO_LBL[t] || t}</span></label>`).join('')}</div>
      <div class="f-row">
        <label class="f"><span>Importo (€)</span><input name="importo" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(fmtAmt(e.importo))}" required data-focus></label>
        <label class="f"><span>Data</span><input name="data" type="date" class="amount-sel" value="${esc(e.data)}" required></label>
      </div>
      <label class="f"><span>Descrizione</span><input name="descrizione" placeholder="Es. Stipendio ottobre, Rimborso 730…" value="${esc(e.descrizione)}"></label>
      <div id="att-box" class="att-wrap"></div>
      <label class="f"><span>Note</span><textarea name="note" rows="2">${esc(e.note)}</textarea></label>
      ${isNew ? `<button type="button" class="btn block ghost" data-inact="rec">↻ Oppure imposta un'entrata ricorrente mensile</button>` : ''}`,
      async fd => {
        const importo = num(fd.get('importo')); if (importo <= 0) return toast('Inserisci l\'importo');
        const pn = (personaById(fd.get('personaId')) || {}).nome || '';
        const allegato = await att.commit(`Busta paga ${pn} ${ym(fd.get('data'))}`.trim() + (att.pending && att.pending.mime === 'application/pdf' ? '.pdf' : '.jpg'));
        const row = { ...e, importo, data: fd.get('data'), tipo: fd.get('tipo') || 'Altro', personaId: fd.get('personaId') || '', descrizione: String(fd.get('descrizione') || '').trim(), note: fd.get('note').trim(), creato: e.creato || new Date().toISOString(), allegato };
        write([{ action: 'upsert', sheet: 'Entrate', row }]); closeSheet(); toast(isNew ? 'Entrata registrata' : 'Entrata aggiornata');
      },
      isNew ? null : () => { if (!confirm('Eliminare questa entrata?')) return; write([{ action: 'delete', sheet: 'Entrate', id: e.id }]); closeSheet(); toast('Eliminata'); });
    const att = attachBox({ id: e.allegato || '', label: 'Busta paga', cartella: 'Buste paga', autoRead: isNew,
      onRead: async doc => {
        busy('Leggo la busta paga…');
        try {
          const r = await aiCall('payslip', { image: doc.b64, mime: doc.mime }); busy();
          if (r.valido === false) return toast('Non sembra una busta paga');
          const F = n => $('#sheet-body [name=' + n + ']');
          if (r.netto) F('importo').value = fmtAmt(r.netto);
          if (/^\d{4}-\d{2}-\d{2}$/.test(r.data || '')) F('data').value = r.data;
          const tp = $(`#sheet-body [name=tipo][value="${r.tipo}"]`); if (tp) tp.checked = true;
          if (/^\d{4}-\d{2}$/.test(r.mese || '')) F('descrizione').value = (r.tipo === 'Tredicesima' ? 'Tredicesima ' : 'Stipendio ') + monthName(r.mese) + (r.datore ? ' · ' + r.datore : '');
          if (r.note) F('note').value = r.note + (r.lordo ? ` (lordo ${eur(r.lordo)})` : '');
          toast('Dati letti dalla busta paga: controlla e salva');
        } catch (er) { busy(); toast(er.message); }
      } });
  }

  function formRicorrente(p, r) {
    const isNew = !r;
    const pp = personeAttive();
    r = r || { id: uid(), personaId: p ? p.id : (inSel !== 'all' ? inSel : (pp[0] || {}).id), tipo: 'Stipendio', descrizione: 'Stipendio', importo: '', giorno: 27, prossima: '', attiva: true };
    const t = today();
    openSheet(isNew ? 'Entrata ricorrente' + (p ? ' · ' + p.nome : '') : 'Modifica ricorrente', `
      <p class="muted small" style="margin:0 0 12px">Ogni mese, nel giorno indicato, l'entrata viene registrata da sola. Se un mese l'importo cambia, lo modifichi dall'elenco.</p>
      ${whoPicker(pp, r.personaId)}
      <div class="f-row">
        <label class="f"><span>Tipo</span><select name="tipo">${Object.keys(TIPI_IN).map(k => `<option value="${k}"${k === r.tipo ? ' selected' : ''}>${TIPO_LBL[k] || k}</option>`).join('')}</select></label>
        <label class="f"><span>Descrizione</span><input name="descrizione" value="${esc(r.descrizione)}" placeholder="Es. Stipendio"></label>
      </div>
      <div class="f-row">
        <label class="f"><span>Importo netto (€)</span><input name="importo" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(fmtAmt(r.importo))}" required data-focus></label>
        <label class="f"><span>Giorno di accredito</span><select name="giorno" class="amount-sel">${opt(Array.from({ length: 31 }, (_, i) => String(i + 1)), String(r.giorno || 27))}</select></label>
      </div>
      <label class="f"><span>Registra anche i mesi passati dal <i class="opt">facoltativo</i></span><input name="dal" type="month" max="${ymOf(new Date())}" value=""><div class="hint muted">Crea in un colpo solo le entrate già ricevute dal mese scelto fino a oggi.</div></label>
      ${isNew ? `<label class="sw"><input type="checkbox" name="questo"><span class="sw-ui"></span><span class="sw-t"><b>Registra anche questo mese</b><small>Se l'accredito di questo mese è già arrivato.</small></span></label>`
        : `<label class="sw"><input type="checkbox" name="attiva" ${r.attiva === '' || isOn(r.attiva) ? 'checked' : ''}><span class="sw-ui"></span><span class="sw-t"><b>Attiva</b><small>Disattiva se l'entrata finisce.</small></span></label>`}`,
      fd => {
        const importo = num(fd.get('importo')); if (importo <= 0) return toast('Inserisci l\'importo');
        const giorno = Number(fd.get('giorno')) || 27;
        const row = { ...r, personaId: fd.get('personaId') || r.personaId, tipo: fd.get('tipo'), descrizione: String(fd.get('descrizione') || '').trim() || fd.get('tipo'), importo, giorno, attiva: isNew ? true : fd.get('attiva') === 'on' };
        const ops = [];
        if (isNew) {
          const now = new Date(), thisDate = dayIn(now.getFullYear(), now.getMonth(), giorno);
          if (fd.get('questo') === 'on') {
            ops.push({ action: 'upsert', sheet: 'Entrate', row: { id: 'in-' + row.id + '-' + thisDate, data: thisDate <= t ? thisDate : t, importo, personaId: row.personaId, tipo: row.tipo, descrizione: row.descrizione, note: '', ricorrenteId: row.id, creato: new Date().toISOString() } });
            row.prossima = nextMonthDay(thisDate, giorno);
          } else row.prossima = thisDate > t ? thisDate : nextMonthDay(thisDate, giorno);
        } else if (Number(r.giorno) !== giorno) row.prossima = nextPay(giorno, t);
        // mesi passati
        const dal = fd.get('dal');
        let nb = 0;
        if (dal && /^\d{4}-\d{2}$/.test(dal)) {
          let [yy, mm] = dal.split('-').map(Number);
          for (let g = 0; g < 60; g++) {
            const dd = dayIn(yy, mm - 1, giorno);
            if (dd > t || (row.prossima && dd >= row.prossima)) break;
            const id = 'in-' + row.id + '-' + dd;
            if (!db.entrate.some(x => x.id === id) && !ops.some(o => o.row && o.row.id === id)) { ops.push({ action: 'upsert', sheet: 'Entrate', row: { id, data: dd, importo, personaId: row.personaId, tipo: row.tipo, descrizione: row.descrizione, note: '', ricorrenteId: row.id, creato: new Date().toISOString() } }); nb++; }
            mm++; if (mm > 12) { mm = 1; yy++; }
          }
        }
        ops.push({ action: 'upsert', sheet: 'EntrateFisse', row });
        if (nb) setTimeout(() => toast(`Registrate anche ${nb} entrate dei mesi passati`), 2600);
        write(ops); closeSheet(); toast(isNew ? 'Entrata ricorrente attivata' : 'Aggiornata');
      },
      isNew ? null : () => { if (!confirm('Eliminare questa entrata ricorrente? Le entrate già registrate restano.')) return; write([{ action: 'delete', sheet: 'EntrateFisse', id: r.id }]); closeSheet(); });
  }

  /* ---------- Obiettivi di risparmio ---------- */
  const GOAL_ICO = {
    Vacanza: '<path d="M2 20h20M5 20l7-14 7 14M12 6V3"/>', Casa: '<path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5"/>', Auto: '<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/>',
    Emergenze: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M12 9v4M12 16h.01"/>', Matrimonio: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="14" r="5"/><path d="M10 4h4l-2 3z"/>',
    Studio: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>', Tecnologia: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', Altro: '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>'
  };
  const goalHist = g => { try { return JSON.parse(g.storico || '[]'); } catch { return []; } };
  function renderGoals() {
    const gs = db.obiettivi.filter(g => g.attivo === '' || g.attivo == null || isOn(g.attivo));
    const totV = gs.reduce((a, g) => a + (Number(g.versato) || 0), 0), totT = gs.reduce((a, g) => a + (Number(g.target) || 0), 0);
    $('#goals-sum').textContent = gs.length ? `${eur0(totV)} di ${eur0(totT)}` : '';
    $('#goals').innerHTML = gs.map((g, i) => {
      const v = Number(g.versato) || 0, t = Number(g.target) || 1, pct = Math.min(100, v / t * 100), done = v >= t;
      let hint;
      if (done) hint = '<span class="ok-t">Raggiunto!</span>';
      else if (g.scadenza) {
        const m = Math.max(1, Math.round((parseD(g.scadenza) - parseD(today())) / (30.44 * 864e5)));
        hint = `${eur0((t - v) / m)}/mese per ${m} ${m === 1 ? 'mese' : 'mesi'}`;
      } else hint = `mancano ${eur0(t - v)}`;
      return `<div class="goal${done ? ' done' : ''}" style="animation-delay:${i * 60}ms">
        <div class="g-ring"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" class="gr-bg"/><circle cx="32" cy="32" r="27" class="gr-fg" style="stroke-dashoffset:${(170 - 170 * pct / 100).toFixed(1)}"/></svg><span class="g-ic"><svg viewBox="0 0 24 24">${GOAL_ICO[g.icona] || GOAL_ICO.Altro}</svg></span></div>
        <div class="g-main" data-goal="${esc(g.id)}"><b>${esc(g.nome)}</b><span class="g-amt">${eur0(v)} <span class="muted">di ${eur0(t)}</span></span><small class="muted">${Math.round(pct)}% · ${hint}</small></div>
        <button class="btn sm" data-goalv="${esc(g.id)}">+ Versa</button></div>`;
    }).join('') || '<p class="muted small" style="margin:0">Crea un obiettivo (vacanza, fondo emergenze, auto…) e segui quanto hai messo da parte.</p>';
  }
  function formGoal(g) {
    const isNew = !g;
    g = g || { id: uid(), nome: '', icona: 'Vacanza', target: '', versato: '', scadenza: '', storico: '[]', attivo: true };
    const h = goalHist(g);
    openSheet(isNew ? 'Nuovo obiettivo' : g.nome, `
      <div class="tipi goal-ico">${Object.keys(GOAL_ICO).map(k => `<label class="tp"><input type="radio" name="icona" value="${k}" ${k === g.icona ? 'checked' : ''}><span><svg viewBox="0 0 24 24">${GOAL_ICO[k]}</svg>${k}</span></label>`).join('')}</div>
      <label class="f"><span>Nome</span><input name="nome" placeholder="Es. Vacanza in Grecia" value="${esc(g.nome)}" required data-focus></label>
      <div class="f-row">
        <label class="f"><span>Obiettivo (€)</span><input name="target" class="amount-input" inputmode="decimal" placeholder="0" value="${esc(fmtAmt(g.target))}" required></label>
        <label class="f"><span>Entro il <i class="opt">facoltativo</i></span><input name="scadenza" type="date" class="amount-sel" value="${esc(g.scadenza)}"></label>
      </div>
      ${isNew ? `<label class="f"><span>Già messo da parte (€)</span><input name="versato" inputmode="decimal" placeholder="0,00"></label>` : ''}
      ${h.length ? `<div class="hist"><h3 style="margin-bottom:6px">Movimenti · ${eur(Number(g.versato) || 0)}</h3>${h.slice().reverse().slice(0, 12).map(x => `<div class="item"><div class="main"><div class="t">${esc(shortDate(x[0]))}</div></div><div class="amt ${x[1] < 0 ? 'neg-t' : 'pos-t'}">${x[1] < 0 ? '−' : '+'}${eur(Math.abs(x[1]))}</div></div>`).join('')}</div>` : ''}`,
      fd => {
        const target = num(fd.get('target')); const nome = String(fd.get('nome') || '').trim();
        if (!nome || target <= 0) return toast('Inserisci nome e obiettivo');
        const row = { ...g, nome, icona: fd.get('icona'), target, scadenza: fd.get('scadenza') || '', attivo: true, creato: g.creato || today() };
        if (isNew) { const v0 = num(fd.get('versato') || 0); row.versato = v0; row.storico = JSON.stringify(v0 ? [[today(), v0]] : []); }
        write([{ action: 'upsert', sheet: 'Obiettivi', row }]); closeSheet(); toast(isNew ? 'Obiettivo creato' : 'Salvato');
      },
      isNew ? null : () => { if (!confirm('Eliminare questo obiettivo?')) return; write([{ action: 'delete', sheet: 'Obiettivi', id: g.id }]); closeSheet(); });
  }
  function formVersa(g) {
    const v = Number(g.versato) || 0, t = Number(g.target) || 0;
    openSheet(g.nome, `
      <div class="seg vers"><label><input type="radio" name="dir" value="1" checked><span>Metti da parte</span></label><label><input type="radio" name="dir" value="-1"><span>Preleva</span></label></div>
      <label class="f"><span>Importo (€)</span><input name="importo" class="amount-input" inputmode="decimal" placeholder="0,00" required data-focus></label>
      <div class="quick">${[50, 100, 200, 500].map(x => `<button type="button" class="chip vtip" data-quick="${x}">${x} €</button>`).join('')}${t > v ? `<button type="button" class="chip vtip" data-quick="${(t - v).toFixed(2)}">Completa ${eur0(t - v)}</button>` : ''}</div>`,
      fd => {
        const imp = num(fd.get('importo')) * Number(fd.get('dir') || 1); if (!imp) return toast('Inserisci l\'importo');
        const nv = Math.max(0, Math.round((v + imp) * 100) / 100);
        const h = goalHist(g); h.push([today(), imp]);
        write([{ action: 'upsert', sheet: 'Obiettivi', row: { ...g, versato: nv, storico: JSON.stringify(h.slice(-60)) } }]);
        closeSheet();
        if (v < t && nv >= t) { confetti(); toast('Obiettivo "' + g.nome + '" raggiunto!'); } else toast(imp > 0 ? 'Messi da parte ' + eur(imp) : 'Prelevati ' + eur(-imp));
      }, null, 'Conferma');
    $$('#sheet-body [data-quick]').forEach(b => (b.onclick = () => { $('#sheet-body [name=importo]').value = String(b.dataset.quick).replace('.', ','); }));
  }
  function confetti() {
    if (reduced()) return;
    const c = document.createElement('div'); c.className = 'confetti';
    const cols = ['#17795a', '#3fae84', '#f59e0b', '#2563eb', '#ec4899'];
    c.innerHTML = Array.from({ length: 70 }, (_, i) => `<i style="left:${(Math.random() * 100).toFixed(1)}%;background:${cols[i % 5]};animation-delay:${(Math.random() * 0.4).toFixed(2)}s;animation-duration:${(1.6 + Math.random() * 1.2).toFixed(2)}s"></i>`).join('');
    document.body.appendChild(c); setTimeout(() => c.remove(), 3500);
  }

  /* ---------- Home: saldo e previsione fine mese ---------- */
  function renderSaldoKpi() {
    const inM = sum(db.entrate.filter(e => ym(e.data) === homeMonth));
    const outM = sum(db.spese.filter(s => ym(s.data) === homeMonth));
    const el = $('#h-saldo');
    if (!db.entrate.length && !db.entrateFisse.length) { el.textContent = '—'; el._v = null; el.classList.remove('neg-t'); $('#h-saldo-sub').innerHTML = '<span class="link">Aggiungi le entrate →</span>'; return; }
    countTo(el, inM - outM, v => (v >= 0 ? '+' : '−') + eur(Math.abs(v)));
    el.classList.toggle('neg-t', inM - outM < 0);
    $('#h-saldo-sub').textContent = `entrate ${eur0(inM)}${inM ? ' · risparmio ' + Math.round((inM - outM) / inM * 100) + '%' : ''}`;
  }

  function forecastData() {
    const t = today(), d0 = new Date(), mk = ymOf(d0);
    const days = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate(), left = days - d0.getDate();
    const from = mk + '-01', to = mk + '-' + pad(days);
    const inReg = sum(db.entrate.filter(e => ym(e.data) === mk));
    const inExp = ricorrentiOf('all').filter(r => r.prossima && r.prossima > t && r.prossima <= to).map(r => ({ title: r.descrizione || r.tipo, importo: Number(r.importo) || 0, date: r.prossima }));
    const outReg = sum(db.spese.filter(s => ym(s.data) === mk));
    const planned = calEvents(from, to).filter(e => e.st !== 'paid' && !(e.st === 'auto' && e.date <= t));
    // spese variabili: media giornaliera degli ultimi 3 mesi (escluse bollette, spese fisse e affitto)
    const p0 = ymd(new Date(d0.getFullYear(), d0.getMonth() - 3, 1)), p1 = ymd(new Date(d0.getFullYear(), d0.getMonth(), 0));
    const pastVar = sum(db.spese.filter(s => !s.bollettaId && s.data >= p0 && s.data <= p1));
    const pastDays = Math.max(1, (parseD(p1) - parseD(p0)) / 864e5 + 1);
    const varEst = Math.round(pastVar / pastDays * left);
    const plannedTot = planned.reduce((a, e) => a + e.importo, 0), inExpTot = inExp.reduce((a, e) => a + e.importo, 0);
    return { inReg, inExp, inExpTot, outReg, planned, plannedTot, varEst, left, result: inReg + inExpTot - outReg - plannedTot - varEst };
  }

  function renderForecast() {
    const card = $('#h-fc'); if (!card) return;
    const isCur = homeMonth === ymOf(new Date());
    card.hidden = !isCur;
    if (!isCur) return;
    const f = forecastData();
    const noIn = !db.entrate.length && !db.entrateFisse.length;
    const pos = f.result >= 0;
    const rows = [
      ['Entrate ricevute', f.inReg, 'pos'], ['Entrate in arrivo', f.inExpTot, 'pos', f.inExp.length],
      ['Spese già fatte', -f.outReg, 'neg'], ['Pagamenti in arrivo', -f.plannedTot, 'neg', f.planned.length], ['Spese variabili (stima)', -f.varEst, 'neg']
    ];
    const mx = Math.max(1, ...rows.map(r => Math.abs(r[1])));
    $('#fc-body').innerHTML = `
      <div class="fc-top"><div><span class="muted small">Chiuderai il mese con circa</span><div class="fc-big ${pos ? 'pos-t' : 'neg-t'}" id="fc-big">0</div></div>
        <span class="chip ${pos ? 'paid' : 'late'}">${pos ? 'In positivo' : 'In negativo'}</span></div>
      ${noIn ? '<p class="small muted" style="margin:6px 0 4px">Aggiungi le entrate (es. lo stipendio) nella sezione <a class="link" href="#entrate">Entrate</a> per una previsione completa.</p>' : ''}
      <div class="fc-rows">${rows.map(([l, v, k, n], i) => `<div class="fc-row" style="animation-delay:${i * 60}ms"><span class="fc-l">${esc(l)}${n ? ` <i>${n}</i>` : ''}</span>
        <span class="fc-bar"><i class="${k}" style="width:${(Math.abs(v) / mx * 100).toFixed(1)}%"></i></span><b class="${v < 0 ? 'neg-t' : v > 0 ? 'pos-t' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${eur0(Math.abs(v))}</b></div>`).join('')}</div>
      ${f.planned.length ? `<details class="fc-det"><summary>Pagamenti in arrivo questo mese</summary><div class="list">${f.planned.slice(0, 12).map(e => `<div class="item" style="cursor:default">${e.icon}<div class="main"><div class="t">${esc(e.title)}</div><div class="s">${esc(shortDate(e.date))}${e.est ? ' · stima' : ''}</div></div><div class="amt">${eur(e.importo)}</div></div>`).join('')}</div></details>` : ''}`;
    countTo($('#fc-big'), f.result, v => (v >= 0 ? '+' : '−') + eur0(Math.abs(v)));
  }

  /* ================= LIMITE DI SPESA MENSILE ================= */
  const budgetCfg = () => db.config.budget || {};
  function budgetTotal(mk) {
    const b = budgetCfg();
    return sum(db.spese.filter(s => ym(s.data) === mk && !(b.escludiAffitto && String(s.bollettaId || '').startsWith('affitto:'))));
  }
  function budgetCrossCheck(before) {
    const b = budgetCfg(), lim = Number(b.limite) || 0;
    if (!lim) return false;
    let shown = false;
    const mk = ymOf(new Date()), now = budgetTotal(mk);
    if (before <= lim && now > lim) {
      toast(`Attenzione: hai superato il limite di ${eur0(lim)} questo mese`); shown = true;
      const t = $('#toast'); t.classList.add('alert');
      setTimeout(() => t.classList.remove('alert'), 3000);
      if (!isLocal() && b.email !== false) api('budgetAlert', { mese: mk, totale: now }).catch(() => {});
    } else if (before <= lim * 0.8 && now > lim * 0.8 && now <= lim) {
      toast(`Hai raggiunto l'80% del limite mensile (${eur0(now)} di ${eur0(lim)})`); shown = true;
    }
    return shown;
  }

  function renderBudget() {
    const el = $('#bud-chart'); if (!el) return;
    const b = budgetCfg(), lim = Number(b.limite) || 0;
    const [y, m] = homeMonth.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const isCur = homeMonth === ymOf(new Date());
    const isPast = homeMonth < ymOf(new Date());
    const per = Array(days + 1).fill(0);
    let maxDay = 0;
    db.spese.filter(s => ym(s.data) === homeMonth && !(b.escludiAffitto && String(s.bollettaId || '').startsWith('affitto:'))).forEach(s => { const d = Number(s.data.slice(8, 10)); per[d] += Number(s.importo) || 0; maxDay = Math.max(maxDay, d); });
    const lastDay = isCur ? Math.max(new Date().getDate(), maxDay) : isPast ? days : maxDay;
    const cum = []; let acc = 0;
    for (let d = 1; d <= days; d++) { acc += per[d]; cum[d] = acc; }
    const tot = lastDay ? cum[lastDay] : 0;
    const rate = lastDay ? tot / lastDay : 0;
    const proj = isCur ? tot + rate * (days - lastDay) : tot;

    // stato
    const st = $('#bud-status');
    if (lim) {
      const pct = Math.round(tot / lim * 100);
      const cls = tot > lim ? 'late' : pct >= 80 ? 'soon' : 'paid';
      st.innerHTML = `<div class="bs-top"><span><b>${eur(tot)}</b> <span class="muted">di ${eur(lim)}</span></span>
        <span class="chip ${cls}">${tot > lim ? 'Superato di ' + eur(tot - lim) : pct + '% del limite'}</span></div>
        <div class="bs-bar"><i class="${cls}" style="width:${Math.min(100, pct)}%"></i></div>
        ${isCur ? `<p class="muted small">${tot > lim ? 'Limite superato: da qui a fine mese ogni spesa va oltre il budget.'
          : proj > lim ? `Restano <b>${eur0(lim - tot)}</b> · <span class="warn-t">a questo ritmo arriveresti a ${eur0(proj)}</span>`
          : `Restano <b>${eur0(lim - tot)}</b>${days - lastDay ? ` per ${days - lastDay} giorni (${eur0((lim - tot) / (days - lastDay))} al giorno)` : ''} · proiezione ${eur0(proj)}`}</p>` : ''}`;
    } else {
      st.innerHTML = `<div class="bs-top"><span><b>${eur(tot)}</b> <span class="muted">spesi${isCur ? ' finora' : ''}</span></span><button class="link-btn" id="bud-set2">Imposta un limite →</button></div>`;
      $('#bud-set2').onclick = formBudget;
    }

    $('#bud-btn-t').textContent = lim ? 'Limite ' + eur0(lim) : 'Imposta limite';
    // grafico cumulativo
    const W = Math.max(280, el.clientWidth || 600), H = isDesk() ? 220 : 180, pt = 16, pb = 22, pl = 0, pr = 52;
    const maxV = Math.max(lim * 1.18, tot * 1.12, (lim && tot > lim ? 0 : lim ? Math.min(proj, Math.max(lim, tot) * 1.6) * 1.02 : proj * 1.05), 1);
    const nice = niceMax(maxV);
    const X = d => pl + (d - 1) / Math.max(1, days - 1) * (W - pl - pr);
    const Y = v => H - pb - v / nice * (H - pb - pt);
    let g = '';
    [0.5, 1].forEach(p => { const yy = Y(nice * p); g += `<line class="grid" x1="0" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text class="axis" x="${W}" y="${yy + 4}" text-anchor="end">${eur0(nice * p)}</text>`; });
    g += `<line class="grid" x1="0" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}"/>`;
    [1, 8, 15, 22, days].forEach(d => { g += `<text class="axis" x="${X(d)}" y="${H - 6}" text-anchor="${d === 1 ? 'start' : d === days ? 'end' : 'middle'}">${d}</text>`; });
    if (lastDay) {
      const pts = []; for (let d = 1; d <= lastDay; d++) pts.push([X(d), Y(cum[d])]);
      const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      const area = line + ` L${pts[pts.length - 1][0].toFixed(1)},${H - pb} L${pts[0][0].toFixed(1)},${H - pb} Z`;
      const ly = lim ? Y(lim) : -10;
      g += `<defs><clipPath id="bud-under"><rect x="0" y="${ly}" width="${W}" height="${H}"/></clipPath><clipPath id="bud-over"><rect x="0" y="0" width="${W}" height="${Math.max(0, ly)}"/></clipPath>
        <linearGradient id="bud-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient>
        <linearGradient id="bud-grad-r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dc2626" stop-opacity=".30"/><stop offset="1" stop-color="#dc2626" stop-opacity=".05"/></linearGradient></defs>`;
      g += `<path class="bud-area" d="${area}" fill="url(#bud-grad)" ${lim ? 'clip-path="url(#bud-under)"' : ''}/>`;
      if (lim) g += `<path class="bud-area" d="${area}" fill="url(#bud-grad-r)" clip-path="url(#bud-over)"/>`;
      g += `<path class="bud-line" d="${line}" ${lim ? 'clip-path="url(#bud-under)"' : ''}/>`;
      if (lim) g += `<path class="bud-line over" d="${line}" clip-path="url(#bud-over)"/>`;
      if (isCur && lastDay < days && !(lim && tot > lim)) g += `<path class="bud-proj" d="M${X(lastDay)},${Y(tot)} L${X(days)},${Y(proj)}"/><circle class="bud-pd" cx="${X(days)}" cy="${Y(proj)}" r="3.5"/>`;
      const lp = pts[pts.length - 1];
      g += `<circle class="bud-dot${lim && tot > lim ? ' over' : ''}" cx="${lp[0]}" cy="${lp[1]}" r="5"/>`;
    }
    if (lim) g += `<line class="bud-lim" x1="0" x2="${W - pr}" y1="${Y(lim)}" y2="${Y(lim)}"/><rect class="bud-lim-tag" x="${W - pr + 4}" y="${Y(lim) - 10}" width="${pr - 4}" height="20" rx="6"/><text class="bud-lim-t" x="${W - pr / 2 + 2}" y="${Y(lim) + 4}" text-anchor="middle">${esc(fmtNum(lim, 0))}</text>`;
    g += `<line class="bud-x" x1="0" x2="0" y1="${pt}" y2="${H - pb}" style="display:none"/><rect class="bud-hit" x="0" y="0" width="${W - pr}" height="${H}"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="${animate && !reduced() ? 'anim' : ''}" role="img" aria-label="Spesa cumulativa del mese">${g}</svg><div class="tip" hidden></div>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), xl = svg.querySelector('.bud-x');
    const hit = svg.querySelector('.bud-hit');
    const move = ev => {
      const r = svg.getBoundingClientRect(); const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
      const d = Math.max(1, Math.min(lastDay || 1, Math.round((px - pl) / (W - pl - pr) * (days - 1) + 1)));
      if (!lastDay) return;
      xl.style.display = ''; xl.setAttribute('x1', X(d)); xl.setAttribute('x2', X(d));
      tip.hidden = false; tip.innerHTML = `${d} ${esc(monthShort(homeMonth))}<br><b>${eur(cum[d])}</b>${per[d] ? `<br><span style="opacity:.7">+${eur(per[d])} quel giorno</span>` : ''}`;
      tip.style.left = Math.min(Math.max(X(d) * r.width / W, 60), r.width - 60) + 'px'; tip.style.top = Y(cum[d]) * r.height / H + 'px';
    };
    const out = () => { xl.style.display = 'none'; tip.hidden = true; };
    hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', move, { passive: true }); hit.addEventListener('touchstart', move, { passive: true });
    hit.addEventListener('mouseleave', out); hit.addEventListener('touchend', () => setTimeout(out, 1500));
  }

  function formBudget() {
    const b = { limite: '', email: true, escludiAffitto: false, ...budgetCfg() };
    openSheet('Limite di spesa mensile', `
      <p class="muted small" style="margin:0 0 12px">La linea rossa sul grafico segna il limite. Quando lo superi ricevi un avviso nell'app e un'email.</p>
      <label class="f"><span>Limite al mese (€)</span><input name="limite" class="amount-input" inputmode="decimal" placeholder="Es. 1.500" value="${esc(b.limite ? fmtAmt(b.limite) : '')}" data-focus></label>
      <label class="sw"><input type="checkbox" name="email" ${b.email !== false ? 'checked' : ''}><span class="sw-ui"></span><span class="sw-t"><b>Avvisami via email</b><small>Una sola email al mese, appena superi il limite.</small></span></label>
      <label class="sw"><input type="checkbox" name="escludiAffitto" ${b.escludiAffitto ? 'checked' : ''}><span class="sw-ui"></span><span class="sw-t"><b>Escludi l'affitto</b><small>Conta solo le altre spese.</small></span></label>`,
      fd => {
        const lim = num(fd.get('limite'));
        setConfig('budget', lim > 0 ? { limite: lim, email: fd.get('email') === 'on', escludiAffitto: fd.get('escludiAffitto') === 'on' } : null);
        if (lim > 0) setConfig('appUrl', location.href.split('#')[0]);
        closeSheet(); toast(lim > 0 ? 'Limite impostato a ' + eur0(lim) : 'Limite rimosso');
        if (lim > 0 && !isLocal() && fd.get('email') === 'on' && budgetTotal(ymOf(new Date())) > lim) api('budgetAlert', { mese: ymOf(new Date()), totale: budgetTotal(ymOf(new Date())) }).catch(() => {});
      }, budgetCfg().limite ? () => { setConfig('budget', null); closeSheet(); toast('Limite rimosso'); } : null);
    const del = $('#sheet-del'); if (!del.hidden) del.textContent = 'Rimuovi limite';
  }

  /* ================= ESTRATTO CONTO (riconciliazione IA) ================= */
  let stmt = null;          // analisi corrente (in memoria)
  let stmtFilter = 'all';
  const loadJS = src => new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error('Impossibile caricare ' + src)); document.head.appendChild(sc); });
  async function libPdf() { await loadJS('lib-pdf.min.js'); window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib-pdf.worker.min.js'; return window.pdfjsLib; }
  async function libPdfLib() { await loadJS('lib-pdf-lib.min.js'); return window.PDFLib; }
  const ST_LBL = { ok: 'Coincide', prob: 'Da verificare', miss: 'Non registrata', in: 'Entrata da registrare', inok: 'Entrata registrata' };
  const ST_COL = { ok: [0.09, 0.63, 0.38], prob: [0.96, 0.62, 0.04], miss: [0.86, 0.15, 0.15], inok: [0.15, 0.39, 0.92] };
  const dDiff = (a, b) => Math.abs((parseD(a) - parseD(b)) / 864e5);
  const words = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !/^(pagamento|pos|carta|presso|del|per|con|sdd|addebito|bonifico|favore|disposizione|operazione|roma|italia|srl|spa)$/.test(w));

  function canvasToB64(c) { return c.toDataURL('image/jpeg', 0.85).split(',')[1]; }

  async function readStatementFile(files) {
    const pages = [];
    const f0 = files[0];
    const isPdf = f0.type === 'application/pdf' || /\.pdf$/i.test(f0.name);
    if (isPdf) {
      const lib = await libPdf();
      const bytes = new Uint8Array(await f0.arrayBuffer());
      const doc = await lib.getDocument({ data: bytes.slice() }).promise;
      const n = Math.min(doc.numPages, 12);
      for (let i = 1; i <= n; i++) {
        busy(`Preparo pagina ${i} di ${n}…`);
        const page = await doc.getPage(i);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(2.2, 1700 / vp0.width) });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        pages.push({ canvas: c });
      }
      return { kind: 'pdf', name: f0.name, bytes, pages, total: doc.numPages };
    }
    for (const f of files) {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Immagine non leggibile')); im.src = URL.createObjectURL(f); });
      const k = Math.min(1, 2000 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      pages.push({ canvas: c });
    }
    return { kind: 'img', name: f0.name, pages, total: pages.length };
  }

  async function analyzeStatement(files) {
    if (!aiReady()) return toast('Attiva prima l\'IA in Altro → Intelligenza artificiale');
    let doc;
    try { busy('Apro il file…'); doc = await readStatementFile(files); }
    catch (e) { busy(); return toast(e.message || 'File non leggibile'); }
    const movs = [];
    let banca = '', da = '', a = '';
    try {
      for (let i = 0; i < doc.pages.length; i++) {
        busy(`L'IA legge la pagina ${i + 1} di ${doc.pages.length}…`);
        const r = await aiCall('statement', { image: canvasToB64(doc.pages[i].canvas), mime: 'image/jpeg', pagina: i + 1 });
        if (r.valido === false && !r.movimenti?.length) continue;
        banca = banca || r.banca; da = da || r.periodoDa; a = r.periodoA || a;
        (r.movimenti || []).forEach(m => {
          const imp = Math.abs(Number(m.importo) || 0);
          if (!imp) return;
          movs.push({ id: uid(), page: i, data: validDate(m.data), descrizione: m.descrizione, esercente: m.esercente || '', importo: Math.round(imp * 100) / 100, segno: m.segno, categoria: m.categoria, box: Array.isArray(m.box) && m.box.length === 4 ? m.box : null });
        });
      }
    } catch (e) { busy(); return toast(e.message); }
    busy();
    if (!movs.length) return toast('Non ho trovato movimenti nel file');
    stmt = { ...doc, banca, periodoDa: da, periodoA: a, movs, created: new Date().toISOString() };
    reconcile();
    stmtFilter = 'all';
    renderStmt(); stagger($('#v-estratto'));
    toast(`${movs.length} movimenti letti`);
  }

  // abbinamento movimenti ↔ spese registrate (uno a uno, i migliori per primi)
  function reconcile() {
    const out = stmt.movs.filter(m => m.segno !== 'entrata');
    if (!out.length) { stmt.movs.forEach(m => { m.st = 'in'; m.match = null; }); stmt.onlyApp = []; return; }
    const dates = out.map(m => m.data).sort();
    const from = addMonths(dates[0], 0), to = dates[dates.length - 1];
    const lo = ymd(new Date(parseD(from).getTime() - 12 * 864e5)), hi = ymd(new Date(parseD(to).getTime() + 12 * 864e5));
    const cand = db.spese.filter(s => s.data >= lo && s.data <= hi && s.metodo !== 'Contanti');
    const pairs = [];
    out.forEach(m => cand.forEach(s => {
      const diff = Math.abs((Number(s.importo) || 0) - m.importo);
      const dd = dDiff(s.data, m.data);
      let sc = 0;
      if (diff < 0.005) sc = 100; else if (diff <= Math.max(0.5, m.importo * 0.01)) sc = 62; else return;
      if (dd > 12) return;
      sc -= dd * 3;
      const mw = words(m.descrizione), sw = words(s.descrizione + ' ' + (s.note || ''));
      const fm = findMerchant(m.descrizione), fs = findMerchant(s.descrizione);
      if ((fm && fs && fm.domain === fs.domain) || mw.some(w => sw.includes(w))) sc += 20;
      pairs.push({ m, s, sc });
    }));
    pairs.sort((x, y) => y.sc - x.sc);
    const usedM = new Set(), usedS = new Set();
    stmt.movs.forEach(m => { m.st = m.segno === 'entrata' ? 'in' : 'miss'; m.match = null; });
    const usedE = new Set();
    stmt.movs.filter(m => m.segno === 'entrata').forEach(m => {
      const e2 = db.entrate.filter(x => !usedE.has(x.id) && Math.abs((Number(x.importo) || 0) - m.importo) < 0.01 && dDiff(x.data, m.data) <= 7).sort((a, b) => dDiff(a.data, m.data) - dDiff(b.data, m.data))[0];
      if (e2) { usedE.add(e2.id); m.st = 'inok'; m.matchIn = e2.id; }
    });
    pairs.forEach(p => {
      if (usedM.has(p.m.id) || usedS.has(p.s.id)) return;
      usedM.add(p.m.id); usedS.add(p.s.id);
      p.m.match = p.s.id; p.m.st = p.sc >= 85 ? 'ok' : 'prob';
    });
    // spese registrate nel periodo dell'estratto ma assenti
    const pFrom = stmt.periodoDa && /^\d{4}-\d{2}-\d{2}$/.test(stmt.periodoDa) ? stmt.periodoDa : from;
    const pTo = stmt.periodoA && /^\d{4}-\d{2}-\d{2}$/.test(stmt.periodoA) ? stmt.periodoA : to;
    stmt.onlyApp = db.spese.filter(s => s.data >= pFrom && s.data <= pTo && s.metodo !== 'Contanti' && !usedS.has(s.id)).sort((x, y) => x.data.localeCompare(y.data));
  }

  function stmtCounts() {
    const c = { ok: 0, prob: 0, miss: 0, in: 0, inok: 0, tot: 0, missAmt: 0, outAmt: 0, okAmt: 0 };
    stmt.movs.forEach(m => { c[m.st]++; if (m.st !== 'in' && m.st !== 'inok') { c.tot++; c.outAmt += m.importo; } if (m.st === 'miss') c.missAmt += m.importo; if (m.st === 'ok' || m.st === 'prob') c.okAmt += m.importo; });
    return c;
  }

  const stF = { q: '', es: '', cat: '', from: '', to: '', min: '', max: '' };
  let stView = 'list';
  const escName = m => (m.esercente || String(m.descrizione || '').split(/\s+/).slice(0, 2).join(' ')).trim() || '—';
  function stFiltered() {
    const q = stF.q.trim().toLowerCase();
    const mn = stF.min ? num(stF.min) : null, mx = stF.max ? num(stF.max) : null;
    return stmt.movs.filter(m => (stmtFilter === 'all' || m.st === stmtFilter)
      && (!q || (m.descrizione + ' ' + escName(m) + ' ' + (m.categoria || '')).toLowerCase().includes(q))
      && (!stF.es || escName(m) === stF.es) && (!stF.cat || m.categoria === stF.cat)
      && (!stF.from || m.data >= stF.from) && (!stF.to || m.data <= stF.to)
      && (mn == null || m.importo >= mn) && (mx == null || m.importo <= mx));
  }
  const stActive = () => Object.values(stF).some(Boolean);

  function renderStmt() {
    const has = !!stmt;
    $('#st-upload').hidden = has;
    $('#st-result').hidden = !has;
    renderStmtHistory();
    if (!has) return;
    const c = stmtCounts();
    const pct = c.tot ? Math.round((c.ok + c.prob) / c.tot * 100) : 0;
    const np = stmt.pages ? stmt.pages.length : stmt.npages || 0;
    $('#st-head').innerHTML = `
      <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="rg-bg"/><circle cx="60" cy="60" r="52" class="rg-fg" style="stroke-dashoffset:${327 - 327 * pct / 100}"/></svg><div><b>${pct}%</b><span>riconciliato</span></div></div>
      <div class="st-info"><h3>${esc(stmt.banca || 'Estratto conto')}${stmt.savedId ? ' <span class="chip paid">Salvata</span>' : ''}</h3>
        <p class="muted small">${esc(stmt.name)}${np ? ` · ${np} ${np === 1 ? 'pagina' : 'pagine'}` : ''}${stmt.periodoDa ? ' · ' + esc(shortDate(stmt.periodoDa)) + ' – ' + esc(shortDate(stmt.periodoA || stmt.periodoDa)) : ''}</p>
        <div class="st-kpis">
          <div class="sk ok"><b>${c.ok}</b><span>Coincidono</span></div>
          <div class="sk prob"><b>${c.prob}</b><span>Da verificare</span></div>
          <div class="sk miss"><b>${c.miss}</b><span>Non registrate</span></div>
          <div class="sk sk-app"><b>${stmt.onlyApp.length}</b><span>Solo in app</span></div>
        </div>
        <p class="small st-sum">Uscite nell'estratto <b>${eur(c.outAmt)}</b> · trovate in app <b>${eur(c.okAmt)}</b>${c.miss ? ` · mancano <b class="warn-t">${eur(c.missAmt)}</b>` : ''}${c.in ? ` · ${c.in} entrate` : ''}</p>
      </div>
      <div class="st-actions">
        ${stmt.pages && stmt.pages.length ? `<button class="btn primary btn-ic" data-stmt="download"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Scarica file evidenziato</button>` : ''}
        ${stmt.fileUrl && stmt.savedId && !(stmt.pages && stmt.pages.length) ? `<button class="btn btn-ic primary" data-stmt="getfile:${esc(stmt.savedId)}"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Scarica file evidenziato</button>` : ''}
        <button class="btn btn-ic" data-stmt="save"><svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>${stmt.savedId ? 'Aggiorna salvataggio' : 'Salva analisi'}</button>
        ${c.miss ? `<button class="btn btn-ic" data-stmt="addall"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Aggiungi ${c.miss} mancanti</button>` : ''}
        <button class="btn ghost" data-stmt="reset">Nuova analisi</button>
      </div>`;

    // filtri
    const F = [['all', 'Tutti', stmt.movs.length], ['ok', 'Coincidono', c.ok], ['prob', 'Da verificare', c.prob], ['miss', 'Non registrate', c.miss], ['app', 'Solo in app', stmt.onlyApp.length], ['in', 'Entrate da registrare', c.in], ['inok', 'Entrate registrate', c.inok]];
    const escs = [...new Set(stmt.movs.map(escName))].sort((x, y) => x.localeCompare(y, 'it'));
    const catsS = [...new Set(stmt.movs.map(m => m.categoria).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'it'));
    $('#st-filters').innerHTML = `
      <div class="st-fbar">
        <input type="search" id="stf-q" placeholder="Cerca esercente, descrizione…" value="${esc(stF.q)}">
        <div class="st-view"><button class="${stView === 'list' ? 'on' : ''}" data-stmt="v:list">Movimenti</button><button class="${stView === 'group' ? 'on' : ''}" data-stmt="v:group">Per esercente</button></div>
      </div>
      <div class="st-fgrid">
        <select id="stf-es"><option value="">Tutti gli esercenti</option>${escs.map(x => `<option${x === stF.es ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <select id="stf-cat"><option value="">Tutte le categorie</option>${catsS.map(x => `<option${x === stF.cat ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <label class="mini"><span>Dal</span><input type="date" id="stf-from" value="${esc(stF.from)}"></label>
        <label class="mini"><span>Al</span><input type="date" id="stf-to" value="${esc(stF.to)}"></label>
        <label class="mini"><span>Min €</span><input id="stf-min" inputmode="decimal" value="${esc(stF.min)}" placeholder="0"></label>
        <label class="mini"><span>Max €</span><input id="stf-max" inputmode="decimal" value="${esc(stF.max)}" placeholder="∞"></label>
      </div>
      <div class="st-chips">${F.filter(f => f[2] || f[0] === 'all').map(([k, l, n]) => `<button class="fchip${stmtFilter === k ? ' on' : ''}" data-stmt="f:${k}">${l} <i>${n}</i></button>`).join('')}
        ${stActive() ? '<button class="fchip clear" data-stmt="clear">✕ Azzera filtri</button>' : ''}</div>`;
    $('#stf-q').addEventListener('input', e => { stF.q = e.target.value; renderStmtRows(); });
    [['stf-es', 'es'], ['stf-cat', 'cat'], ['stf-from', 'from'], ['stf-to', 'to'], ['stf-min', 'min'], ['stf-max', 'max']].forEach(([id, k]) => {
      $('#' + id).addEventListener(id.includes('min') || id.includes('max') ? 'input' : 'change', e => { stF[k] = e.target.value; renderStmtRows(); });
    });
    renderStmtRows();

    // anteprime
    $('#st-pages').innerHTML = '';
    if (stmt.pages && stmt.pages.length) stmt.pages.forEach((p, i) => {
      const c2 = drawHighlights(p.canvas, i, 520);
      const wrap = document.createElement('div'); wrap.className = 'st-page';
      wrap.appendChild(c2);
      const lb = document.createElement('span'); lb.textContent = 'Pagina ' + (i + 1); wrap.appendChild(lb);
      $('#st-pages').appendChild(wrap);
    });
    else $('#st-pages').innerHTML = `<div class="empty-state small-es"><div class="es-ic"><svg viewBox="0 0 24 24">${ICO_DOC.replace(/<\/?svg[^>]*>/g, '')}</svg></div>
      <p class="muted small">${stmt.fileUrl ? 'Il file evidenziato è salvato nel tuo Google Drive.' : 'Anteprima non disponibile per le analisi salvate.'}</p>
      ${stmt.fileUrl && stmt.savedId ? `<button class="btn sm" data-stmt="getfile:${esc(stmt.savedId)}">Scarica il file</button>` : ''}</div>`;
  }

  function renderStmtRows() {
    const sp = id => db.spese.find(x => x.id === id);
    const dl = d => esc(parseD(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }));
    let rows, info;
    if (stmtFilter === 'app') {
      const l = stmt.onlyApp.filter(s => (!stF.q || (s.descrizione + ' ' + s.categoria).toLowerCase().includes(stF.q.toLowerCase())) && (!stF.from || s.data >= stF.from) && (!stF.to || s.data <= stF.to));
      info = `${l.length} spese · ${eur(sum(l))}`;
      rows = l.map(s => `<div class="st-row"><div class="st-d">${dl(s.data)}</div>
        <div class="st-m">${iconHTML(s.descrizione, s.categoria, s.sito)}<div><b>${esc(s.descrizione)}</b><small>${esc(s.categoria)} · ${esc(s.metodo || '')} · non trovata nell'estratto</small></div></div>
        <span class="chip">Solo in app</span><div class="amt">${eur(s.importo)}</div><div></div></div>`).join('');
    } else {
      const l = stFiltered();
      const out = l.filter(m => m.segno !== 'entrata'), inn = l.filter(m => m.segno === 'entrata');
      info = `${l.length} movimenti · uscite <b>${eur(sum(out))}</b>${inn.length ? ` · entrate <b>${eur(sum(inn))}</b>` : ''}`;
      if (stView === 'group') {
        const g = {};
        l.filter(m => stmtFilter === 'in' || m.segno !== 'entrata').forEach(m => { const k = escName(m); (g[k] = g[k] || { n: 0, tot: 0, ok: 0, miss: 0, cat: m.categoria, ex: m }); g[k].n++; g[k].tot += (m.segno === 'entrata' ? -1 : 1) * m.importo; if (m.st === 'ok' || m.st === 'prob') g[k].ok++; if (m.st === 'miss') g[k].miss++; });
        const arr = Object.entries(g).sort((a, b) => Math.abs(b[1].tot) - Math.abs(a[1].tot));
        const mx = Math.max(1, ...arr.map(x => Math.abs(x[1].tot)));
        rows = arr.map(([k, v]) => `<div class="st-grp" data-stmt="es:${esc(k)}">
          ${iconHTML(k, k)}
          <div class="sg-main"><div class="sg-top"><b>${esc(k)}</b><span class="amt">${v.tot < 0 ? '+' : ''}${eur(Math.abs(v.tot))}</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.abs(v.tot) / mx * 100)}%"></div></div>
            <small>${v.n} moviment${v.n === 1 ? 'o' : 'i'} · ${esc(v.cat || '')}${v.ok ? ` · <span class="ok-t">${v.ok} in app</span>` : ''}${v.miss ? ` · <span class="warn-t">${v.miss} non registrat${v.miss === 1 ? 'a' : 'e'}</span>` : ''}</small></div></div>`).join('');
      } else {
        rows = l.map(m => {
          const s2 = m.match && sp(m.match);
          return `<div class="st-row st-${m.st}"><div class="st-d">${dl(m.data)}</div>
            <div class="st-m">${iconHTML(escName(m), escName(m))}<div><b>${esc(m.descrizione)}</b><small>${s2 ? `In app: ${esc(s2.descrizione)} · ${esc(shortDate(s2.data))}${Math.abs(s2.importo - m.importo) > 0.004 ? ' · ' + eur(s2.importo) : ''}` : m.st === 'inok' ? (() => { const e2 = db.entrate.find(x => x.id === m.matchIn); const p = e2 && personaById(e2.personaId); return 'In app: ' + esc(e2 ? e2.tipo + (p ? ' · ' + p.nome : '') : 'entrata'); })() : m.st === 'in' ? 'Accredito non registrato' : esc(m.categoria || '')}${m.page != null ? ' · pag. ' + (m.page + 1) : ''}</small></div></div>
            <span class="chip ${m.st === 'ok' || m.st === 'inok' ? 'paid' : m.st === 'prob' ? 'soon' : m.st === 'miss' ? 'late' : ''}">${ST_LBL[m.st]}</span>
            <div class="amt">${m.segno === 'entrata' ? '+' : '−'}${eur(m.importo)}</div>
            <div class="st-act">${m.st === 'miss' ? `<button class="btn sm" data-stmt="add:${m.id}">Aggiungi</button>` : m.st === 'prob' ? `<button class="btn sm" data-stmt="ok:${m.id}">Conferma</button><button class="icon-btn" data-stmt="un:${m.id}" title="Non coincide">✕</button>` : m.st === 'ok' ? `<button class="icon-btn" data-stmt="un:${m.id}" title="Scollega">✕</button>` : m.st === 'in' ? `<button class="btn sm" data-stmt="addin:${m.id}">Registra</button>` : ''}</div></div>`;
        }).join('');
      }
    }
    $('#st-rows').innerHTML = `<div class="st-info2 small muted">${info}</div>` + (rows || '<div class="empty">Nessun movimento con questi filtri</div>');
  }

  function drawHighlights(src, pageIdx, maxW) {
    const k = maxW ? Math.min(1, maxW / src.width) : 1;
    const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const ctx = c.getContext('2d'); ctx.drawImage(src, 0, 0, c.width, c.height);
    stmt.movs.filter(m => m.page === pageIdx && m.box && m.st !== 'in').forEach(m => {
      const [y0, x0, y1, x1] = m.box;
      const x = x0 / 1000 * c.width, y = y0 / 1000 * c.height, w = (x1 - x0) / 1000 * c.width, h = (y1 - y0) / 1000 * c.height;
      const col = ST_COL[m.st].map(v => Math.round(v * 255)).join(',');
      ctx.fillStyle = `rgba(${col},${m.st === 'miss' ? 0.10 : 0.28})`; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = Math.max(1, 2 * k * (src.width / 1000)); ctx.strokeRect(x, y, w, h);
    });
    return c;
  }


  // crea il file evidenziato: { blob, name, mime }
  async function buildStatementFile() {
    const L = await libPdfLib();
    const { rgb, StandardFonts } = L;
    let pdf;
    if (stmt.kind === 'pdf') {
      pdf = await L.PDFDocument.load(stmt.bytes, { ignoreEncryption: true });
      pdf.getPages().forEach((pg, i) => {
        if (i >= stmt.pages.length) return;
        const { width: W, height: H } = pg.getSize();
        stmt.movs.filter(m => m.page === i && m.box && m.st !== 'in').forEach(m => {
          const [y0, x0, y1, x1] = m.box, col = rgb(...ST_COL[m.st]);
          pg.drawRectangle({ x: x0 / 1000 * W, y: H - y1 / 1000 * H, width: (x1 - x0) / 1000 * W, height: (y1 - y0) / 1000 * H, color: col, opacity: m.st === 'miss' ? 0.08 : 0.25, borderColor: col, borderWidth: 1, borderOpacity: 0.9 });
        });
      });
    } else {
      if (stmt.pages.length === 1) {
        const c = drawHighlights(stmt.pages[0].canvas, 0);
        return { blob: await new Promise(r => c.toBlob(r, 'image/png')), name: stmt.name.replace(/\.[^.]+$/, '') + '-evidenziato.png', mime: 'image/png' };
      }
      pdf = await L.PDFDocument.create();
      for (let i = 0; i < stmt.pages.length; i++) {
        const c = drawHighlights(stmt.pages[i].canvas, i);
        const jpg = await pdf.embedJpg(Uint8Array.from(atob(c.toDataURL('image/jpeg', 0.88).split(',')[1]), ch => ch.charCodeAt(0)));
        const pg = pdf.addPage([c.width * 0.5, c.height * 0.5]);
        pg.drawImage(jpg, { x: 0, y: 0, width: c.width * 0.5, height: c.height * 0.5 });
      }
    }
      // pagina di resoconto finale
      const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const safe = t => String(t || '').replace(/[^\x20-\x7E -ÿ€]/g, '').replace(/€/g, 'EUR');
      const cnt = stmtCounts();
      let pg = pdf.addPage([595, 842]), y = 790;
      const line = (t, o = {}) => { if (y < 60) { pg = pdf.addPage([595, 842]); y = 790; } pg.drawText(safe(t), { x: o.x || 48, y, size: o.size || 10, font: o.bold ? bold : font, color: o.color || rgb(0.1, 0.1, 0.12) }); y -= o.gap || 15; };
      line('Spese Casa - Resoconto estratto conto', { size: 18, bold: true, gap: 24, color: rgb(0.09, 0.47, 0.35) });
      line(`${stmt.banca || ''} ${stmt.name}  -  generato il ${new Date().toLocaleDateString('it-IT')}`, { size: 9, gap: 22, color: rgb(0.4, 0.4, 0.45) });
      [['Coincidono', cnt.ok, 'ok'], ['Da verificare', cnt.prob, 'prob'], ['Non registrate in app', cnt.miss, 'miss']].forEach(([l, n, k]) => {
        pg.drawRectangle({ x: 48, y: y - 3, width: 12, height: 12, color: rgb(...ST_COL[k]), opacity: 0.6 });
        line(`${l}: ${n}`, { x: 68, size: 11, gap: 18 });
      });
      line(`Spese in app non presenti nell'estratto: ${stmt.onlyApp.length}`, { size: 11, gap: 18 });
      line(`Uscite estratto ${fmtNum(cnt.outAmt, 2)} EUR  -  trovate in app ${fmtNum(cnt.okAmt, 2)} EUR  -  mancanti ${fmtNum(cnt.missAmt, 2)} EUR`, { size: 10, gap: 26 });
      const section = (title, list, fn) => { if (!list.length) return; line(title, { size: 12, bold: true, gap: 18 }); list.forEach(x => line(fn(x), { size: 9, gap: 13 })); y -= 10; };
      const mv = m => `${parseD(m.data).toLocaleDateString('it-IT')}   ${fmtNum(m.importo, 2).padStart(10)} EUR   ${String(m.descrizione).slice(0, 70)}`;
      section('Non registrate in app', stmt.movs.filter(m => m.st === 'miss'), mv);
      section('Da verificare', stmt.movs.filter(m => m.st === 'prob'), mv);
      section('Solo in app (non trovate nell\'estratto)', stmt.onlyApp, s2 => `${parseD(s2.data).toLocaleDateString('it-IT')}   ${fmtNum(s2.importo, 2).padStart(10)} EUR   ${String(s2.descrizione).slice(0, 70)}`);
      section('Coincidono', stmt.movs.filter(m => m.st === 'ok'), mv);
      const out = await pdf.save();
    return { blob: new Blob([out], { type: 'application/pdf' }), name: stmt.name.replace(/\.[^.]+$/, '') + '-evidenziato.pdf', mime: 'application/pdf' };
  }
  async function downloadStatement() {
    busy('Creo il file evidenziato…');
    try { const f = await buildStatementFile(); busy(); saveBlob(f.blob, f.name); }
    catch (e) { busy(); toast('Errore nel creare il file: ' + e.message); }
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('File scaricato');
  }
  const blobB64 = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });

  // salvataggio compatto (una riga nel foglio "Estratti")
  const packMovs = () => JSON.stringify(stmt.movs.map(m => [m.data, String(m.descrizione).slice(0, 80), String(m.esercente || '').slice(0, 40), m.importo, m.segno === 'entrata' ? 1 : 0, m.categoria || '', m.box ? m.box.join(',') : '', m.st, m.match || '', m.page == null ? '' : m.page]));
  const unpackMovs = txt => { try { return JSON.parse(txt || '[]').map(a => ({ id: uid(), data: a[0], descrizione: a[1], esercente: a[2], importo: Number(a[3]), segno: a[4] ? 'entrata' : 'uscita', categoria: a[5], box: a[6] ? a[6].split(',').map(Number) : null, st: a[7], match: a[8] || null, page: a[9] === '' ? null : Number(a[9]) })); } catch { return []; } };

  async function saveStatement() {
    if (isLocal()) return toast('Il salvataggio richiede il collegamento al Foglio Google');
    busy('Salvo l\'analisi…');
    try {
      const ids = stmt.movs.filter(x => x.st === 'ok' && x.match).map(x => x.match);
      const ops = ids.map(id => db.spese.find(x => x.id === id)).filter(sp => sp && !sp.verificato).map(sp => ({ action: 'upsert', sheet: 'Spese', row: { ...sp, verificato: today() } }));
      if (ops.length) { write(ops); await syncNow(); }
      let pdf = '', mime = '', fileName = '';
      if (stmt.pages && stmt.pages.length) { const f = await buildStatementFile(); pdf = await blobB64(f.blob); mime = f.mime; fileName = f.name; }
      const c = stmtCounts();
      const id = stmt.savedId || uid();
      const row = { id, data: today(), nome: stmt.name, banca: stmt.banca || '', periodoDa: stmt.periodoDa || '', periodoA: stmt.periodoA || '', ok: c.ok, prob: c.prob, miss: c.miss, tot: c.tot, fileUrl: stmt.fileUrl || '', movimenti: packMovs(), onlyApp: JSON.stringify(stmt.onlyApp.map(s => s.id)) };
      const r = await api('saveStatement', { row, pdf, mime, fileName });
      stmt.savedId = id; stmt.fileUrl = r.fileUrl || stmt.fileUrl;
      const meta = { ...row, fileUrl: stmt.fileUrl }; delete meta.movimenti; delete meta.onlyApp;
      db.estratti = [meta, ...(db.estratti || []).filter(x => x.id !== id)]; save();
      busy(); renderStmt(); toast('Analisi salvata' + (r.fileUrl ? ' · file su Google Drive' : ''));
    } catch (e) {
      busy();
      toast(/drive|permission|permess|autorizz/i.test(e.message) ? 'Serve un permesso: esegui la funzione "autorizza" nello script' : 'Errore: ' + e.message);
    }
  }

  // scarica il file evidenziato salvato su Drive passando dallo script (funziona con qualsiasi account Google aperto nel browser)
  async function downloadSavedFile(id) {
    busy('Scarico il file…');
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=estrattoFile&id=' + encodeURIComponent(id) + '&t=' + Date.now());
      const j = await r.json(); if (!j.ok) throw new Error(j.error);
      const bin = atob(j.data.b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      busy(); saveBlob(new Blob([arr], { type: j.data.mime }), j.data.name);
    } catch (e) { busy(); toast(/drive|permission|permess|autorizz/i.test(e.message) ? 'Serve un permesso: esegui la funzione "autorizza" nello script' : 'Impossibile scaricare: ' + e.message); }
  }

  async function openSavedStatement(id) {
    busy('Apro l\'analisi…');
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=estratto&id=' + encodeURIComponent(id) + '&t=' + Date.now());
      const j = await r.json(); if (!j.ok) throw new Error(j.error);
      const d = j.data;
      let only = []; try { only = JSON.parse(d.onlyApp || '[]'); } catch {}
      stmt = { savedId: d.id, kind: 'saved', name: d.nome, banca: d.banca, periodoDa: d.periodoDa, periodoA: d.periodoA, fileUrl: d.fileUrl, movs: unpackMovs(d.movimenti), pages: [], onlyApp: only.map(x => db.spese.find(s => s.id === x)).filter(Boolean) };
      Object.keys(stF).forEach(k => (stF[k] = '')); stmtFilter = 'all'; stView = 'list';
      busy(); renderStmt(); stagger($('#v-estratto')); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { busy(); toast('Impossibile aprire: ' + e.message); }
  }

  function stmtAction(act, el) {
    if (act === 'pick') { pauseLock(); return $('#st-file').click(); }
    if (act === 'reset') { stmt = null; Object.keys(stF).forEach(k => (stF[k] = '')); stmtFilter = 'all'; renderStmt(); return; }
    if (act === 'download') return downloadStatement();
    if (act === 'save') return saveStatement();
    if (act === 'clear') { Object.keys(stF).forEach(k => (stF[k] = '')); stmtFilter = 'all'; renderStmt(); return; }
    if (act.startsWith('f:')) { stmtFilter = act.slice(2); renderStmt(); return; }
    if (act.startsWith('v:')) { stView = act.slice(2); renderStmt(); return; }
    if (act.startsWith('es:')) { stF.es = act.slice(3); stView = 'list'; renderStmt(); return; }
    if (act.startsWith('open:')) return openSavedStatement(act.slice(5));
    if (act.startsWith('getfile:')) return downloadSavedFile(act.slice(8));
    if (act.startsWith('del:')) {
      const id = act.slice(4);
      if (!confirm('Eliminare questa analisi salvata? Il file su Google Drive resta.')) return;
      write([{ action: 'delete', sheet: 'Estratti', id }]);
      if (stmt && stmt.savedId === id) stmt.savedId = null;
      renderStmt(); toast('Analisi eliminata'); return;
    }
    const mid = act.split(':')[1];
    const m = stmt && stmt.movs.find(x => x.id === mid);
    const toSpesa = mm => ({ id: uid(), data: mm.data, importo: mm.importo, categoria: pickCat(mm.categoria), descrizione: mm.esercente || mm.descrizione, metodo: 'Carta', note: 'Da estratto conto: ' + mm.descrizione, bollettaId: '', creato: new Date().toISOString(), sito: '', verificato: today() });
    if (act.startsWith('addin:') && m) {
      const p = db.persone[0];
      const tipo = /stipend|emolument|retribuz|salari|cedolino/i.test(m.descrizione) ? 'Stipendio' : /rimbors/i.test(m.descrizione) ? 'Rimborso' : 'Altro';
      const en = { id: uid(), data: m.data, importo: m.importo, personaId: p ? p.id : '', tipo, descrizione: m.esercente || m.descrizione, note: 'Da estratto conto', ricorrenteId: '', creato: new Date().toISOString() };
      write([{ action: 'upsert', sheet: 'Entrate', row: en }]); m.st = 'inok'; m.matchIn = en.id; renderStmt(); toast('Entrata registrata' + (p ? ' per ' + p.nome : '')); return;
    }
    if (act.startsWith('add:') && m) { const sp = toSpesa(m); write([{ action: 'upsert', sheet: 'Spese', row: sp }]); m.st = 'ok'; m.match = sp.id; renderStmt(); toast('Spesa aggiunta'); return; }
    if (act.startsWith('ok:') && m) { m.st = 'ok'; renderStmt(); return; }
    if (act.startsWith('un:') && m) { m.st = 'miss'; m.match = null; reconcileOnlyApp(); renderStmt(); return; }
    if (act === 'addall') {
      const miss = stmt.movs.filter(x => x.st === 'miss');
      if (!confirm(`Aggiungere ${miss.length} spese all'app?`)) return;
      const ops = miss.map(x => { const sp = toSpesa(x); x.st = 'ok'; x.match = sp.id; return { action: 'upsert', sheet: 'Spese', row: sp }; });
      write(ops); renderStmt(); toast(`${ops.length} spese aggiunte`); return;
    }
  }
  function reconcileOnlyApp() {
    const used = new Set(stmt.movs.filter(m => m.match).map(m => m.match));
    const ds = stmt.movs.map(m => m.data).sort();
    const pFrom = stmt.periodoDa || ds[0], pTo = stmt.periodoA || ds[ds.length - 1];
    stmt.onlyApp = db.spese.filter(s => s.data >= pFrom && s.data <= pTo && s.metodo !== 'Contanti' && !used.has(s.id));
  }

  function renderStmtHistory() {
    const h = (db.estratti || []).slice().sort((a, b) => String(b.data).localeCompare(String(a.data)));
    $('#st-hist').innerHTML = h.length ? `<div class="list">${h.map(x => {
      const p = Number(x.tot) ? Math.round((Number(x.ok) + Number(x.prob || 0)) / Number(x.tot) * 100) : 0;
      return `<div class="item st-h${stmt && stmt.savedId === x.id ? ' cur' : ''}" data-stmt="open:${esc(x.id)}">
        <div class="mini-ring" style="--p:${p}"><span>${p}%</span></div>
        <div class="main"><div class="t">${esc(x.banca || x.nome)}</div><div class="s">${x.periodoDa ? esc(shortDate(x.periodoDa)) + ' – ' + esc(shortDate(x.periodoA || x.periodoDa)) : esc(x.nome)} · ${x.ok} ok · ${x.miss} non registrate</div></div>
        <div class="right row">${x.fileUrl ? `<button class="icon-btn" data-stmt="getfile:${esc(x.id)}" title="Scarica il file">↓</button>` : ''}<button class="icon-btn" data-stmt="del:${esc(x.id)}" title="Elimina">✕</button></div></div>`;
    }).join('')}</div>` : '<p class="muted small" style="margin:0">Nessuna analisi salvata. Dopo un\'analisi premi "Salva analisi".</p>';
  }

  /* ================= AUTO ================= */
  const ICO_CAR = '<svg viewBox="0 0 24 24"><path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3zM5 11h14"/><circle cx="7.5" cy="13.5" r=".8"/><circle cx="16.5" cy="13.5" r=".8"/></svg>';
  const VOCI_AUTO = {
    Carburante: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10"/><path d="M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
    Manutenzione: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    Tagliando: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    Pneumatici: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>',
    Assicurazione: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    Bollo: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 14h6M10 17h4"/>',
    Revisione: '<circle cx="12" cy="10" r="6"/><path d="M9.5 10l1.8 1.8L15 8.2M8.5 15.5L7 21l5-2 5 2-1.5-5.5"/>',
    Pedaggio: '<path d="M8 3L4 21M16 3l4 18M12 4v3M12 10v3M12 16v3"/>',
    Parcheggio: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 17V7h3a3 3 0 0 1 0 6h-3"/>',
    Lavaggio: '<path d="M12 3s-5 6-5 10a5 5 0 0 0 10 0c0-4-5-10-5-10z"/>',
    Multa: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    Altro: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
  };
  const SCAD = [['Assicurazione', 'scadAssicurazione', 'impAssicurazione', 12], ['Bollo', 'scadBollo', 'impBollo', 12], ['Revisione', 'scadRevisione', '', 24], ['Tagliando', 'scadTagliando', '', 12]];
  const ALIM = ['Gasolio', 'Benzina', 'GPL', 'Metano', 'Ibrida', 'Elettrica'];
  const AUTO_CAT = 'Auto e trasporti';
  const vehActive = () => (db.veicoli || []).filter(v => v.attiva === '' || v.attiva == null || isOn(v.attiva));
  let autoVid = null, autoAll = false;
  const curVeh = () => { const l = vehActive(); return l.find(v => v.id === autoVid) || l[0] || null; };
  const vehOf = sp => db.veicoli.find(v => v.id === sp.veicolo) || null;
  const voceIcon = (voce, cls = '') => `<div class="ic voce-ic ${cls}"><svg viewBox="0 0 24 24">${VOCI_AUTO[voce] || VOCI_AUTO.Altro}</svg></div>`;
  const FUEL_RE = /benzin|gasolio|diesel|carburant|rifornim|\bgpl\b|metano|enilive|\beni\b|\bq8\b|\bip\b|esso|tamoil|api\b|shell|repsol|total/i;
  function autoVoce(sp) {
    if (sp.voceAuto) return sp.voceAuto;
    const t = String(sp.descrizione || '') + ' ' + String(sp.note || '');
    if (FUEL_RE.test(t)) return 'Carburante';
    if (/telepass|autostrad|pedagg/i.test(t)) return 'Pedaggio';
    if (/parchegg|easypark|mycicero/i.test(t)) return 'Parcheggio';
    if (/lavagg/i.test(t)) return 'Lavaggio';
    if (/gomm|pneumat/i.test(t)) return 'Pneumatici';
    if (/tagliand/i.test(t)) return 'Tagliando';
    if (/revision/i.test(t)) return 'Revisione';
    if (/bollo/i.test(t)) return 'Bollo';
    if (/multa|contravv/i.test(t)) return 'Multa';
    if (/officin|meccanic|carrozz|ricambi|manutenz/i.test(t)) return 'Manutenzione';
    return 'Altro';
  }
  // spese del veicolo: assegnate, oppure spese auto non assegnate se c'è un solo veicolo
  function autoSpese(v) {
    const single = vehActive().length === 1;
    return db.spese.filter(sp => sp.veicolo ? sp.veicolo === v.id : (single && sp.categoria === AUTO_CAT)).sort((a, b) => (b.data + (b.creato || '')).localeCompare(a.data + (a.creato || '')));
  }
  function autoScadenze() {
    const out = [];
    vehActive().forEach(v => SCAD.forEach(([voce, k, ki]) => {
      if (v[k]) out.push({ date: String(v[k]).slice(0, 10), titolo: `${voce} ${v.nome}`, importo: ki ? Number(v[ki]) || 0 : 0, voce, vid: v.id, v });
    }));
    return out;
  }
  function autoChip(d) {
    const n = daysTo(d);
    if (n < 0) return { cls: 'late', txt: `Scaduta da ${-n} gg` };
    if (n === 0) return { cls: 'late', txt: 'Scade oggi' };
    if (n <= 30) return { cls: 'soon', txt: `Tra ${n} gg` };
    return { cls: '', txt: shortDate(d) };
  }
  function autoDueItem(x) {
    const st = autoChip(x.date);
    return `<div class="item" data-go="auto">${voceIcon(x.voce, 'car')}
      <div class="main"><div class="t">${esc(x.titolo)}</div><div class="s"><span class="chip ${st.cls}">${esc(st.txt)}</span></div></div>
      <div class="right"><div class="amt">${x.importo ? eur(x.importo) : ''}</div><button class="btn sm" data-calpay="auto:${esc(x.vid)}:${esc(x.voce)}">Fatto</button></div></div>`;
  }
  function autoStats(v) {
    const sp = autoSpese(v);
    const y = String(new Date().getFullYear()), mk = ymOf(new Date());
    const fills = sp.filter(x => autoVoce(x) === 'Carburante');
    const withL = fills.filter(x => Number(x.litri) > 0);
    const kmFills = withL.filter(x => Number(x.km) > 0).sort((a, b) => Number(a.km) - Number(b.km));
    let kml = 0, ckm = 0;
    if (kmFills.length >= 2) {
      const after = kmFills.slice(1);
      const dk = Number(kmFills[kmFills.length - 1].km) - Number(kmFills[0].km);
      const lit = after.reduce((a, x) => a + Number(x.litri), 0);
      if (dk > 0 && lit > 0) { kml = dk / lit; ckm = sum(after) / dk; }
    }
    const kmAll = sp.map(x => Number(x.km) || 0).concat(Number(v.kmIniziali) || 0);
    return {
      sp, fills, year: sum(sp.filter(x => x.data.startsWith(y))), fuelMonth: sum(fills.filter(x => ym(x.data) === mk)),
      priceL: withL.length ? sum(withL) / withL.reduce((a, x) => a + Number(x.litri), 0) : 0,
      kml, ckm, km: Math.max(...kmAll)
    };
  }

  function renderAuto() {
    const list = vehActive();
    $('#auto-empty').hidden = !!list.length;
    $('#auto-body').hidden = !list.length;
    if (!list.length) return;
    const v = curVeh(); autoVid = v.id;
    $('#veh-tabs').innerHTML = list.map(x => `<button class="veh-tab${x.id === v.id ? ' on' : ''}" data-veh="${esc(x.id)}">${ICO_CAR}<span>${esc(x.nome)}</span></button>`).join('') + `<button class="veh-tab add" data-autoact="newveh">+ Veicolo</button>`;
    const st = autoStats(v);
    $('#veh-hero').innerHTML = `
      <div class="vh-ic">${ICO_CAR}</div>
      <div class="vh-main"><h3>${esc(v.nome)}</h3>
        <div class="vh-sub">${v.targa ? `<span class="plate"><i>I</i>${esc(v.targa)}</span>` : ''}<span>${esc([v.alimentazione, v.anno].filter(Boolean).join(' · '))}</span></div></div>
      <div class="vh-km"><span>Contachilometri</span><b>${st.km ? fmtNum(st.km, 0) + ' km' : '—'}</b></div>
      <button class="btn sm" data-autoact="editveh">Modifica</button>`;
    countTo($('#au-year'), st.year);
    countTo($('#au-fuel'), st.fuelMonth);
    $('#au-kml').textContent = st.kml ? fmtNum(st.kml, 1) + ' km/l' : '—';
    $('#au-kml-sub').textContent = st.ckm ? fmtNum(st.ckm, 3) + ' €/km' : 'servono 2 rifornimenti con i km';
    $('#au-price').textContent = st.priceL ? fmtNum(st.priceL, 3) + ' €/l' : '—';

    // scadenze
    $('#au-scad').innerHTML = SCAD.map(([voce, k, ki]) => {
      const d = v[k];
      const ch = d ? autoChip(String(d).slice(0, 10)) : null;
      return `<div class="sc ${ch ? ch.cls : 'none'}">
        ${voceIcon(voce)}
        <div class="sc-main"><b>${voce}</b><span>${d ? esc(shortDate(String(d).slice(0, 10))) : 'Non impostata'}${voce === 'Tagliando' && v.kmTagliando ? ' · ' + esc(fmtNum(v.kmTagliando, 0)) + ' km' : ''}</span></div>
        ${ch ? `<span class="chip ${ch.cls}">${esc(ch.txt.startsWith('Tra') || ch.cls ? ch.txt : 'OK')}</span>` : ''}
        <button class="btn sm" data-autoact="${d ? 'scad:' + voce : 'editveh'}">${d ? 'Fatto' : 'Imposta'}</button></div>`;
    }).join('');

    // per voce
    const byV = {};
    st.sp.filter(x => x.data.startsWith(String(new Date().getFullYear()))).forEach(x => { const k = autoVoce(x); byV[k] = (byV[k] || 0) + (Number(x.importo) || 0); });
    const rows = Object.entries(byV).sort((a, b) => b[1] - a[1]);
    const max = rows[0] ? rows[0][1] : 1, tot = rows.reduce((a, r) => a + r[1], 0);
    $('#au-voci').innerHTML = rows.map(([k, val]) => `<div class="bar-row"><div class="bar-top"><span>${esc(k)} <span class="muted">${Math.round(val / tot * 100)}%</span></span><span>${eur(val)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, val / max * 100)}%"></div></div></div>`).join('') || '<div class="empty">Nessuna spesa quest\'anno</div>';

    // grafico 12 mesi
    const now = new Date(), months = [];
    for (let i = 11; i >= 0; i--) months.push(ymOf(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    const vals = months.map(k => sum(st.sp.filter(x => ym(x.data) === k)));
    const mx = Math.max(1, ...vals);
    $('#au-chart').innerHTML = months.map((k, i) => `<div class="mb" title="${esc(monthName(k))}: ${esc(eur(vals[i]))}"><span class="mbv">${vals[i] ? esc(eur0(vals[i])) : ''}</span><i class="${i === 11 ? 'cur' : ''}" style="height:${vals[i] ? Math.max(3, vals[i] / mx * 100) : 0}%;animation-delay:${i * 35}ms"></i><span class="mbl">${esc(monthShort(k))}</span></div>`).join('');

    // spese fisse collegate
    const fx = fisseActive().filter(f => f.veicolo === v.id || (!f.veicolo && f.categoria === AUTO_CAT && list.length === 1));
    $('#au-fisse').innerHTML = fx.length ? `<div class="list">${fx.map(f => fxItem(f)).join('')}</div>` : '<p class="muted small" style="margin:0">Collega rata, leasing o assicurazione dalla sezione Spese fisse (categoria "Auto e trasporti").</p>';

    // movimenti
    const lim = autoAll ? 300 : 10;
    $('#au-list').innerHTML = st.sp.length ? `<div class="list">${st.sp.slice(0, lim).map(x => {
      const vo = autoVoce(x);
      const det = vo === 'Carburante' && Number(x.litri) > 0 ? `${fmtNum(x.litri, 2)} l · ${fmtNum(x.importo / x.litri, 3)} €/l` : vo;
      return `<div class="item" data-aspesa="${esc(x.id)}">${findMerchant(x.descrizione) || x.sito ? iconHTML(x.descrizione, x.descrizione, x.sito) : voceIcon(vo)}
        <div class="main"><div class="t">${esc(x.descrizione || vo)}</div><div class="s">${esc(shortDate(x.data))} · ${esc(det)}${Number(x.km) ? ' · ' + esc(fmtNum(x.km, 0)) + ' km' : ''}</div></div>
        <div class="amt">${eur(x.importo)}</div></div>`;
    }).join('')}</div>${st.sp.length > lim ? `<button class="btn block more-btn" data-autoact="all">Mostra tutti (${st.sp.length})</button>` : ''}` : '<div class="empty">Nessuna spesa registrata per questo veicolo</div>';
  }

  function vehSelect(sel) {
    const l = vehActive();
    if (l.length < 2) return `<input type="hidden" name="veicolo" value="${esc((l[0] || {}).id || '')}">`;
    return `<label class="f"><span>Veicolo</span><select name="veicolo">${l.map(v => `<option value="${esc(v.id)}"${v.id === sel ? ' selected' : ''}>${esc(v.nome)}</option>`).join('')}</select></label>`;
  }
  const ensureAutoCat = ops => { if (!db.categorie.includes(AUTO_CAT)) ops.unshift({ action: 'upsert', sheet: 'Categorie', row: { nome: AUTO_CAT } }); return ops; };

  function formRifornimento(sp, pre) {
    const isNew = !sp;
    const v = (sp && vehOf(sp)) || curVeh();
    const lastFuel = db.spese.filter(x => autoVoce(x) === 'Carburante').sort((a, b) => b.data.localeCompare(a.data))[0];
    sp = sp || { id: uid(), data: today(), importo: '', descrizione: lastFuel ? lastFuel.descrizione : '', metodo: lastFuel ? lastFuel.metodo : 'Carta', litri: '', km: '', note: '', sito: '' };
    if (pre) sp = { ...sp, ...pre };
    const pl = Number(sp.litri) > 0 && Number(sp.importo) > 0 ? (sp.importo / sp.litri).toFixed(3).replace('.', ',') : '';
    openSheet(isNew ? 'Rifornimento' : 'Modifica rifornimento', `
      ${sp._ai ? `<div class="ai-note">${ICO.spark}<span>Letto dallo scontrino: controlla e salva</span></div>` : ''}
      ${vehSelect(v && v.id)}
      <label class="f"><span>Distributore</span><div class="desc-wrap"><span id="desc-ic">${sp.descrizione ? iconHTML(sp.descrizione, sp.descrizione, sp.sito) : voceIcon('Carburante')}</span><input name="descrizione" placeholder="Es. Eni, Q8, IP…" value="${esc(sp.descrizione)}"></div></label>
      <div class="f-row">
        <label class="f"><span>Importo (€)</span><input name="importo" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(fmtAmt(sp.importo))}" required data-focus></label>
        <label class="f"><span>Litri</span><input name="litri" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(sp.litri === '' || sp.litri == null ? '' : String(sp.litri).replace('.', ','))}"></label>
      </div>
      <div class="f-row">
        <label class="f"><span>Prezzo al litro</span><input name="prezzo" inputmode="decimal" placeholder="Calcolato" value="${esc(pl)}"></label>
        <label class="f"><span>Km contachilometri</span><input name="km" inputmode="numeric" placeholder="${(() => { const s2 = v && autoStats(v); return s2 && s2.km ? 'ultimo ' + fmtNum(s2.km, 0) : 'Es. 123456'; })()}" value="${esc(sp.km)}"></label>
      </div>
      <div class="f-row">
        <label class="f"><span>Data</span><input name="data" type="date" value="${esc(sp.data)}" required></label>
        <label class="f"><span>Metodo</span><select name="metodo">${opt(METODI, sp.metodo || 'Carta')}</select></label>
      </div>
      <p class="muted small" style="margin:0 0 8px">Inserendo i km a ogni rifornimento l'app calcola consumo (km/l) e costo al km.</p>`,
      fd => {
        const importo = num(fd.get('importo')), litri = num(fd.get('litri'));
        if (importo <= 0) return toast('Inserisci l\'importo');
        const vid = fd.get('veicolo') || (v && v.id) || '';
        const desc = String(fd.get('descrizione') || '').trim() || 'Rifornimento';
        const row = { ...sp, importo, litri: litri || '', km: fd.get('km') ? parseInt(String(fd.get('km')).replace(/\D/g, ''), 10) || '' : '', data: fd.get('data'), metodo: fd.get('metodo'),
          descrizione: desc, categoria: AUTO_CAT, veicolo: vid, voceAuto: 'Carburante', creato: sp.creato || new Date().toISOString(),
          note: litri ? `${fmtNum(litri, 2)} l · ${fmtNum(importo / litri, 3)} €/l` : '', sito: desc === sp.descrizione ? (sp.sito || '') : '' };
        delete row._ai;
        write(ensureAutoCat([{ action: 'upsert', sheet: 'Spese', row }]));
        closeSheet(); toast(isNew ? 'Rifornimento registrato' : 'Rifornimento aggiornato');
      },
      isNew ? null : () => { if (!confirm('Eliminare questo rifornimento?')) return; write([{ action: 'delete', sheet: 'Spese', id: sp.id }]); closeSheet(); toast('Eliminato'); });
    // calcolo automatico prezzo/litri
    const I = $('#sheet-body [name=importo]'), L = $('#sheet-body [name=litri]'), P = $('#sheet-body [name=prezzo]');
    let last = [];
    const touch = n => { last = [n, ...last.filter(x => x !== n)].slice(0, 2); calc(); };
    const calc = () => {
      const i = num(I.value), l = num(L.value), p = num(P.value);
      if (!last.includes('p') && i && l) P.value = (i / l).toFixed(3).replace('.', ',');
      else if (!last.includes('l') && i && p) L.value = (i / p).toFixed(2).replace('.', ',');
      else if (!last.includes('i') && l && p) I.value = (l * p).toFixed(2).replace('.', ',');
    };
    I.addEventListener('input', () => touch('i')); L.addEventListener('input', () => touch('l')); P.addEventListener('input', () => touch('p'));
    const D = $('#sheet-body [name=descrizione]');
    D.addEventListener('input', () => { $('#desc-ic').innerHTML = findMerchant(D.value) ? iconHTML(D.value, D.value) : voceIcon('Carburante'); });
  }

  function formAutoSpesa(v, sp, pre) {
    const isNew = !sp;
    sp = sp || { id: uid(), data: today(), importo: '', descrizione: '', metodo: 'Carta', km: '', note: '', voceAuto: 'Manutenzione', sito: '' };
    if (pre) sp = { ...sp, ...pre };
    const voce0 = autoVoce(sp);
    const sc = SCAD.find(x => x[0] === voce0);
    if (isNew && sc && sc[2] && !Number(sp.importo)) sp.importo = Number(v[sc[2]]) || '';
    const voci = Object.keys(VOCI_AUTO).filter(k => k !== 'Carburante');
    const nextFor = voce => { const x = SCAD.find(s2 => s2[0] === voce); if (!x) return ''; const base = v[x[1]] && String(v[x[1]]).slice(0, 10) > today() ? String(v[x[1]]).slice(0, 10) : (v[x[1]] ? String(v[x[1]]).slice(0, 10) : today()); return addMonths(base, x[3]); };
    openSheet(isNew ? 'Spesa auto · ' + v.nome : 'Modifica spesa auto', `
      <div class="tipi auto-voci">${voci.map(k => `<label class="tp"><input type="radio" name="voce" value="${k}" ${k === voce0 ? 'checked' : ''}><span><svg viewBox="0 0 24 24">${VOCI_AUTO[k]}</svg>${k}</span></label>`).join('')}</div>
      ${vehSelect(v.id)}
      <div class="f-row">
        <label class="f"><span>Importo (€)</span><input name="importo" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(fmtAmt(sp.importo))}" required data-focus></label>
        <label class="f"><span>Data</span><input name="data" type="date" value="${esc(sp.data)}" required class="amount-sel"></label>
      </div>
      <label class="f"><span>Descrizione</span><div class="desc-wrap"><span id="desc-ic">${sp.descrizione && (findMerchant(sp.descrizione) || sp.sito) ? iconHTML(sp.descrizione, sp.descrizione, sp.sito) : voceIcon(voce0)}</span><input name="descrizione" placeholder="Es. Officina Rossi, Telepass…" value="${esc(sp.descrizione)}"></div></label>
      <div class="f-row">
        <label class="f"><span>Km <i class="opt">facoltativo</i></span><input name="km" inputmode="numeric" value="${esc(sp.km)}"></label>
        <label class="f"><span>Metodo</span><select name="metodo">${opt(METODI, sp.metodo || 'Carta')}</select></label>
      </div>
      <div id="scad-upd"></div>
      <label class="f"><span>Note</span><textarea name="note" rows="2">${esc(sp.note)}</textarea></label>`,
      fd => {
        const importo = num(fd.get('importo'));
        if (importo < 0 || (importo === 0 && !['Revisione', 'Tagliando'].includes(fd.get('voce')))) return toast('Inserisci l\'importo');
        const voce = fd.get('voce');
        const vid = fd.get('veicolo') || v.id;
        const row = { ...sp, importo, data: fd.get('data'), descrizione: String(fd.get('descrizione') || '').trim() || voce + ' ' + v.nome, metodo: fd.get('metodo'),
          km: fd.get('km') ? parseInt(String(fd.get('km')).replace(/\D/g, ''), 10) || '' : '', note: fd.get('note').trim(), categoria: AUTO_CAT, veicolo: vid, voceAuto: voce, creato: sp.creato || new Date().toISOString() };
        delete row._ai;
        const ops = [{ action: 'upsert', sheet: 'Spese', row }];
        if (fd.get('upd') === 'on') {
          const x = SCAD.find(s2 => s2[0] === voce);
          const vv = { ...(db.veicoli.find(y => y.id === vid) || v), [x[1]]: fd.get('nextdate') };
          if (x[2]) vv[x[2]] = importo;
          if (voce === 'Tagliando' && fd.get('nextkm')) vv.kmTagliando = parseInt(String(fd.get('nextkm')).replace(/\D/g, ''), 10) || '';
          ops.push({ action: 'upsert', sheet: 'Veicoli', row: vv });
        }
        write(ensureAutoCat(ops));
        closeSheet(); toast(isNew ? 'Spesa auto registrata' : 'Spesa aggiornata');
        if (fd.get('upd') === 'on') refreshCalendarReminders(true);
      },
      isNew ? null : () => { if (!confirm('Eliminare questa spesa?')) return; write([{ action: 'delete', sheet: 'Spese', id: sp.id }]); closeSheet(); toast('Eliminata'); });
    $('#sheet-form').classList.add('wide');
    const upd = () => {
      const voce = ($('#sheet-body [name=voce]:checked') || {}).value;
      const x = SCAD.find(s2 => s2[0] === voce);
      $('#scad-upd').innerHTML = x ? `<div class="voci-box"><label class="sw"><input type="checkbox" name="upd" ${isNew ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Aggiorna la prossima scadenza</b><small>${esc(voce)}: imposta la nuova data per i promemoria.</small></span></label>
        <div class="f-row"><label class="f"><span>Prossima scadenza</span><input name="nextdate" type="date" value="${esc(nextFor(voce))}"></label>
        ${voce === 'Tagliando' ? `<label class="f"><span>Prossimo a km</span><input name="nextkm" inputmode="numeric" value="${esc(v.kmTagliando || '')}" placeholder="Es. 150000"></label>` : '<div></div>'}</div></div>` : '';
      if (!$('#sheet-body [name=descrizione]').value) $('#desc-ic').innerHTML = voceIcon(voce);
    };
    $$('#sheet-body [name=voce]').forEach(r => r.addEventListener('change', upd));
    upd();
  }

  function formVeicolo(v) {
    const isNew = !v;
    v = v || { id: uid(), nome: '', targa: '', alimentazione: 'Gasolio', anno: '', kmIniziali: '', scadAssicurazione: '', impAssicurazione: '', scadBollo: '', impBollo: '', scadRevisione: '', scadTagliando: '', kmTagliando: '', note: '', attiva: true };
    openSheet(isNew ? 'Nuovo veicolo' : v.nome, `
      <div class="f-row">
        <label class="f"><span>Nome</span><input name="nome" placeholder="Es. Fiat Panda" value="${esc(v.nome)}" required data-focus></label>
        <label class="f"><span>Targa</span><input name="targa" placeholder="AB123CD" value="${esc(v.targa)}" autocapitalize="characters" style="text-transform:uppercase"></label>
      </div>
      <div class="tipi alim">${ALIM.map(a => `<label class="tp"><input type="radio" name="alimentazione" value="${a}" ${a === (v.alimentazione || 'Gasolio') ? 'checked' : ''}><span>${a}</span></label>`).join('')}</div>
      <div class="f-row">
        <label class="f"><span>Anno</span><input name="anno" inputmode="numeric" placeholder="Es. 2019" value="${esc(v.anno)}"></label>
        <label class="f"><span>Km attuali</span><input name="kmIniziali" inputmode="numeric" placeholder="Es. 85000" value="${esc(v.kmIniziali)}"></label>
      </div>
      <div class="voci-box"><div class="voci-h"><h3>Scadenze</h3><span class="muted small">per i promemoria</span></div>
        <div class="f-row"><label class="f"><span>Assicurazione</span><input name="scadAssicurazione" type="date" value="${esc(v.scadAssicurazione)}"></label><label class="f"><span>Premio (€)</span><input name="impAssicurazione" inputmode="decimal" value="${esc(fmtAmt(v.impAssicurazione))}" placeholder="0,00"></label></div>
        <div class="f-row"><label class="f"><span>Bollo</span><input name="scadBollo" type="date" value="${esc(v.scadBollo)}"></label><label class="f"><span>Importo bollo (€)</span><input name="impBollo" inputmode="decimal" value="${esc(fmtAmt(v.impBollo))}" placeholder="0,00"></label></div>
        <div class="f-row"><label class="f"><span>Revisione</span><input name="scadRevisione" type="date" value="${esc(v.scadRevisione)}"></label><label class="f"><span>Tagliando</span><input name="scadTagliando" type="date" value="${esc(v.scadTagliando)}"></label></div>
        <label class="f" style="margin:0"><span>Tagliando a km <i class="opt">facoltativo</i></span><input name="kmTagliando" inputmode="numeric" value="${esc(v.kmTagliando)}" placeholder="Es. 100000"></label>
      </div>
      <label class="f"><span>Note</span><textarea name="note" rows="2" placeholder="Compagnia assicurativa, n. polizza, telaio…">${esc(v.note)}</textarea></label>`,
      fd => {
        const nome = String(fd.get('nome') || '').trim();
        if (!nome) return toast('Inserisci il nome');
        const n2 = k => { const x = String(fd.get(k) || '').replace(/\D/g, ''); return x ? parseInt(x, 10) : ''; };
        const row = { ...v, nome, targa: String(fd.get('targa') || '').toUpperCase().replace(/\s+/g, ''), alimentazione: fd.get('alimentazione'), anno: n2('anno'), kmIniziali: n2('kmIniziali'),
          scadAssicurazione: fd.get('scadAssicurazione') || '', impAssicurazione: fd.get('impAssicurazione') ? num(fd.get('impAssicurazione')) : '',
          scadBollo: fd.get('scadBollo') || '', impBollo: fd.get('impBollo') ? num(fd.get('impBollo')) : '',
          scadRevisione: fd.get('scadRevisione') || '', scadTagliando: fd.get('scadTagliando') || '', kmTagliando: n2('kmTagliando'), note: fd.get('note').trim(), attiva: true };
        autoVid = row.id;
        write(ensureAutoCat([{ action: 'upsert', sheet: 'Veicoli', row }]));
        closeSheet(); toast(isNew ? 'Veicolo aggiunto' : 'Veicolo aggiornato');
        refreshCalendarReminders(true);
      },
      isNew ? null : () => {
        if (!confirm('Eliminare il veicolo? Le spese registrate restano.')) return;
        write([{ action: 'delete', sheet: 'Veicoli', id: v.id }]); autoVid = null; closeSheet(); toast('Veicolo eliminato'); refreshCalendarReminders(true);
      });
    $('#sheet-form').classList.add('wide');
  }

  /* ================= SPESE FISSE ================= */
  const isOn = v => v === true || String(v).toUpperCase() === 'TRUE';
  const TIPI = ['Abbonamento', 'Rata', 'Assicurazione', 'Utenza', 'Tassa', 'Altro'];
  const TIPO_CAT = { Abbonamento: 'Abbonamenti', Rata: 'Rate e finanziamenti', Assicurazione: 'Assicurazioni', Utenza: 'Internet e telefono', Tassa: 'Tasse e tributi', Altro: 'Altro' };
  const TIPO_ICO = {
    Abbonamento: '<path d="M4 6h16v12H4z"/><path d="M10 9.5v5l4-2.5z"/>',
    Rata: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>',
    Assicurazione: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    Utenza: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    Tassa: '<path d="M4 10l8-5 8 5M6 10v8M10 10v8M14 10v8M18 10v8M4 20h16"/>',
    Altro: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'
  };
  const FREQ_FX = { settimanale: 0.25, mensile: 1, bimestrale: 2, trimestrale: 3, quadrimestrale: 4, semestrale: 6, annuale: 12 };
  const tipoIcon = t => `<div class="ic tipo-ic"><svg viewBox="0 0 24 24">${TIPO_ICO[t] || TIPO_ICO.Altro}</svg></div>`;
  const fxIcon = f => (findMerchant(f.nome) || f.sito) ? iconHTML(f.nome, f.nome, f.sito) : tipoIcon(f.tipo);
  const fisseActive = () => (db.fisse || []).filter(f => f.attiva === '' || f.attiva == null || isOn(f.attiva));
  const fxPaid = f => db.spese.filter(s => s.bollettaId === 'fissa:' + f.id);
  const nextDate = (d, freq) => freq === 'settimanale' ? ymd(new Date(parseD(d).getTime() + 7 * 864e5)) : addMonths(d, FREQ_FX[freq] || 1);
  const perMonth = f => (Number(f.importo) || 0) / (FREQ_FX[f.frequenza] || 1);
  function fxEnded(f, date, paidCount) {
    if (f.fine && date > f.fine) return true;
    if (Number(f.rate) > 0 && paidCount >= Number(f.rate)) return true;
    return false;
  }
  // date previste da "prossima" in avanti fino a "to"
  function fxOccurrences(f, to) {
    const out = [];
    if (!f.prossima) return out;
    let d = f.prossima, n = fxPaid(f).length, i = 0;
    while (d <= to && i < 120) {
      if (fxEnded(f, d, n)) break;
      out.push(d); d = nextDate(d, f.frequenza); n++; i++;
    }
    return out;
  }
  function fxChip(f) {
    if (!f.prossima) return { cls: '', txt: '—' };
    const d = daysTo(f.prossima);
    if (isOn(f.auto)) return { cls: d <= 3 ? 'soon' : '', txt: d === 0 ? 'Addebito oggi' : d === 1 ? 'Addebito domani' : 'Addebito ' + parseD(f.prossima).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) };
    if (d < 0) return { cls: 'late', txt: `Scaduta da ${-d} gg` };
    if (d === 0) return { cls: 'late', txt: 'Scade oggi' };
    if (d <= 7) return { cls: 'soon', txt: d === 1 ? 'Domani' : `Tra ${d} gg` };
    return { cls: '', txt: parseD(f.prossima).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) };
  }

  // addebiti automatici: registra da soli i pagamenti scaduti (id fisso = nessun doppione)
  function autoDebit() {
    if (!db.fisse || !db.fisse.length) return;
    const t = today(), ops = [];
    fisseActive().filter(f => isOn(f.auto) && f.prossima && f.prossima <= t).forEach(f => {
      let d = f.prossima, n = fxPaid(f).length, guard = 0, row = { ...f };
      while (d <= t && guard++ < 60) {
        if (fxEnded(f, d, n)) { row.attiva = false; break; }
        const id = 'fx-' + f.id + '-' + d;
        if (!db.spese.some(s => s.id === id)) ops.push({ action: 'upsert', sheet: 'Spese', row: { id, data: d, importo: Number(f.importo) || 0, categoria: f.categoria, descrizione: f.nome, metodo: f.metodo || 'Addebito in conto', note: 'Addebito automatico', bollettaId: 'fissa:' + f.id, creato: new Date().toISOString(), sito: f.sito || '' } });
        n++; d = nextDate(d, f.frequenza);
      }
      row.prossima = d;
      if (fxEnded(f, d, n)) row.attiva = false;
      ops.push({ action: 'upsert', sheet: 'Fisse', row });
    });
    if (ops.length) write(ops);
  }

  function fxItem(f, home) {
    const st = fxChip(f);
    const paid = fxPaid(f).length, tot = Number(f.rate) || 0;
    const sub = home ? `<span class="chip ${st.cls}">${esc(st.txt)}</span>`
      : `${esc(f.frequenza)}${f.metodo ? ' · ' + esc(f.metodo) : ''}${tot ? ` · rata ${Math.min(paid + 1, tot)}/${tot}` : ''}`;
    return `<div class="item fx" data-fx="${esc(f.id)}">
      ${fxIcon(f)}
      <div class="main"><div class="t">${esc(f.nome)}</div><div class="s">${sub}</div>
        ${!home && tot ? `<div class="prog"><i style="width:${Math.min(100, paid / tot * 100)}%"></i></div>` : ''}</div>
      <div class="right"><div class="amt">${eur(f.importo)}</div>
        ${home ? (isOn(f.auto) ? '<span class="chip">Auto</span>' : `<button class="btn sm" data-fxpay="${esc(f.id)}">Paga</button>`)
          : `<span class="chip ${st.cls}">${esc(st.txt)}</span>`}</div></div>`;
  }

  let fxTab = 'cal';
  let calMonth = ymOf(new Date());
  let calSel = today();

  function renderFisse() {
    const list = fisseActive();
    const month = list.reduce((a, f) => a + perMonth(f), 0);
    countTo($('#fx-month'), month);
    countTo($('#fx-year'), month * 12);
    const nx = list.filter(f => f.prossima).sort((a, b) => a.prossima.localeCompare(b.prossima))[0];
    if (nx) { countTo($('#fx-next'), nx.importo); $('#fx-next-sub').textContent = nx.nome + ' · ' + parseD(nx.prossima).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); }
    else { $('#fx-next').textContent = '—'; $('#fx-next')._v = null; $('#fx-next-sub').textContent = 'nessuna in programma'; }
    $('#fx-count').textContent = list.length;
    const byT = TIPI.map(t => [t, list.filter(f => (f.tipo || 'Altro') === t).length]).filter(x => x[1]);
    const PL = { Abbonamento: ['abbonamento', 'abbonamenti'], Rata: ['rata', 'rate'], Assicurazione: ['assicurazione', 'assicurazioni'], Utenza: ['utenza', 'utenze'], Tassa: ['tassa', 'tasse'], Altro: ['altra', 'altre'] };
    $('#fx-count-sub').textContent = byT.length ? byT.slice(0, 3).map(([t, n]) => `${n} ${PL[t][n === 1 ? 0 : 1]}`).join(' · ') : 'aggiungi la prima';

    $('#fx-grid').dataset.tab = fxTab;
    $$('[data-fxtab]').forEach(b => b.classList.toggle('on', b.dataset.fxtab === fxTab));

    // elenco per tipo
    const sorted = list.slice().sort((a, b) => String(a.prossima || '9').localeCompare(String(b.prossima || '9')));
    $('#fx-list').innerHTML = list.length ? TIPI.map(t => {
      const g = sorted.filter(f => (f.tipo || 'Altro') === t);
      if (!g.length) return '';
      return `<div class="fx-group"><div class="fx-gh"><span>${esc(t === 'Rata' ? 'Rate' : t === 'Utenza' ? 'Utenze' : t === 'Tassa' ? 'Tasse' : t === 'Assicurazione' ? 'Assicurazioni' : t === 'Abbonamento' ? 'Abbonamenti' : 'Altro')}</span><b>${eur(g.reduce((a, f) => a + perMonth(f), 0))}/mese</b></div>
        <div class="list">${g.map(f => fxItem(f)).join('')}</div></div>`;
    }).join('') : `<div class="empty-state"><div class="es-ic"><svg viewBox="0 0 24 24">${TIPO_ICO.Altro}</svg></div><h3>Nessuna spesa fissa</h3><p class="muted small">Aggiungi abbonamenti, rate, assicurazioni: l'app calcola quanto spendi al mese e ti avvisa prima di ogni pagamento.</p></div>`;
    const off = (db.fisse || []).filter(f => !fisseActive().includes(f));
    $('#fx-off').innerHTML = off.length ? `<div class="fx-gh muted"><span>Concluse / disattivate</span></div><div class="list dim">${off.map(f => fxItem(f)).join('')}</div>` : '';
    renderCal();
  }

  /* ---------- Calendario ---------- */
  function calEvents(from, to) {
    const ev = [];
    const t = today();
    const status = d => d < t ? 'late' : daysTo(d) <= 7 ? 'soon' : 'plan';
    // spese pagate
    db.spese.filter(s => s.data >= from && s.data <= to).forEach(s => {
      const b = String(s.bollettaId || '');
      ev.push({ date: s.data, title: s.descrizione || s.categoria, importo: Number(s.importo) || 0, st: 'paid',
        kind: b.startsWith('affitto:') ? 'rent' : b.startsWith('fissa:') ? 'fx' : b ? 'bill' : 'spesa',
        icon: b.startsWith('affitto:') ? `<div class="ic rent-ic">${ICO_KEY}</div>` : iconHTML(s.descrizione, s.categoria, s.sito), ref: s.id });
    });
    // spese fisse previste
    fisseActive().forEach(f => fxOccurrences(f, to).filter(d => d >= from).forEach(d => {
      ev.push({ date: d, title: f.nome, importo: Number(f.importo) || 0, st: isOn(f.auto) ? (d < t ? 'paid' : 'auto') : status(d), kind: 'fx', icon: fxIcon(f), ref: f.id, payable: !isOn(f.auto) && d === f.prossima });
    }));
    // bollette (prossima scadenza + proiezioni stimate)
    activeBills().forEach(b => {
      let d = b.scadenza, i = 0;
      const months = FREQ[b.frequenza] || 0;
      while (d && d <= to && i++ < 24) {
        if (d >= from) ev.push({ date: d, title: b.nome, importo: Number(b.importo) || 0, st: i === 1 ? status(d) : 'plan', kind: 'bill', icon: iconHTML(b.nome), ref: b.id, payable: i === 1, est: i > 1 });
        if (!months) break;
        d = addMonths(d, months);
      }
    });
    // fatture non pagate con scadenza diversa
    db.fatture.filter(f => !f.spesaId && f.scadenza && f.scadenza >= from && f.scadenza <= to).forEach(f => {
      const b = db.bollette.find(x => x.id === f.bollettaId);
      if (!b || f.scadenza === b.scadenza) return;
      ev.push({ date: f.scadenza, title: b.nome + ' · fattura', importo: Number(f.importo) || 0, st: status(f.scadenza), kind: 'fatt', icon: iconHTML(b.nome), ref: f.id, payable: true });
    });
    // affitto
    if (rentCfg()) {
      let m = ym(from);
      while (m <= ym(to)) {
        const r = rentMonth(m);
        if (!r.paid && !r.before && r.due >= from && r.due <= to) ev.push({ date: r.due, title: 'Affitto', importo: r.importo, st: status(r.due), kind: 'rent', icon: `<div class="ic rent-ic">${ICO_KEY}</div>`, ref: m, payable: r.due <= addMonths(t, 1) });
        const [y, mm] = m.split('-').map(Number); m = ymOf(new Date(y, mm, 1));
      }
    }
    autoScadenze().filter(x => x.date >= from && x.date <= to).forEach(x => ev.push({ date: x.date, title: x.titolo, importo: x.importo, st: status(x.date), kind: 'auto', icon: `<div class="ic car-ic">${ICO_CAR}</div>`, ref: x.vid + ':' + x.voce, payable: true }));
    return ev.sort((a, b) => a.date.localeCompare(b.date) || (a.st === 'paid') - (b.st === 'paid'));
  }

  const ST_TXT = { paid: 'Pagato', late: 'Scaduto', soon: 'In scadenza', plan: 'Previsto', auto: 'Addebito automatico' };
  function renderCal() {
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
    const from = ymd(first), to = ymd(last);
    const ev = calEvents(from, to);
    $('#cal-title').textContent = monthName(calMonth);
    const paid = ev.filter(e => e.st === 'paid').reduce((a, e) => a + e.importo, 0);
    const plan = ev.filter(e => e.st !== 'paid').reduce((a, e) => a + e.importo, 0);
    $('#cal-tot').innerHTML = `<span><i class="dot paid"></i>Pagato <b>${eur(paid)}</b></span><span><i class="dot plan"></i>Previsto <b>${eur(plan)}</b></span>`;
    const lead = (first.getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cd out"></div>');
    const desk = isDesk(), t = today();
    if (calSel.slice(0, 7) !== calMonth) calSel = calMonth === ym(t) ? t : from;
    for (let d = 1; d <= last.getDate(); d++) {
      const ds = `${calMonth}-${pad(d)}`;
      const de = ev.filter(e => e.date === ds);
      const tot = de.reduce((a, e) => a + e.importo, 0);
      const worst = de.some(e => e.st === 'late') ? 'late' : de.some(e => e.st === 'soon') ? 'soon' : de.length && de.every(e => e.st === 'paid') ? 'paid' : de.length ? 'plan' : '';
      const body = desk
        ? de.slice(0, 3).map(e => `<div class="ev st-${e.st}">${e.icon}<span class="evt">${esc(e.title)}</span><b>${esc(eur0(e.importo))}</b></div>`).join('') + (de.length > 3 ? `<div class="ev-more">+${de.length - 3} altre</div>` : '')
        : `<div class="dots">${de.slice(0, 4).map(e => `<i class="dot ${e.st}"></i>`).join('')}</div>${tot ? `<div class="ctot">${esc(fmtNum(tot, 0))}</div>` : ''}`;
      cells.push(`<button type="button" class="cd${ds === t ? ' today' : ''}${ds === calSel ? ' sel' : ''}${worst ? ' has-' + worst : ''}" data-day="${ds}" style="animation-delay:${Math.min((lead + d) * 12, 400)}ms">
        <span class="cn">${d}</span>${body}</button>`);
    }
    $('#cal-grid').innerHTML = cells.join('');
    renderAgenda(ev);
  }

  function renderAgenda(ev) {
    ev = ev || calEvents(calSel, calSel);
    const de = ev.filter(e => e.date === calSel);
    const label = parseD(calSel).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#cal-agenda').innerHTML = `<div class="ag-h"><b>${esc(label.charAt(0).toUpperCase() + label.slice(1))}</b><span class="muted small">${de.length ? eur(de.reduce((a, e) => a + e.importo, 0)) : ''}</span></div>
      ${de.length ? `<div class="list">${de.map(e => `<div class="item ag" ${e.kind === 'spesa' || e.st === 'paid' ? `data-spesa="${esc(e.ref)}"` : e.kind === 'fx' ? `data-fx="${esc(e.ref)}"` : e.kind === 'bill' ? `data-bill="${esc(e.ref)}"` : e.kind === 'fatt' ? `data-fatt="${esc(e.ref)}"` : e.kind === 'auto' ? 'data-go="auto"' : 'data-go="affitto"'}>
        ${e.icon}<div class="main"><div class="t">${esc(e.title)}</div><div class="s"><span class="chip ${e.st === 'plan' || e.st === 'auto' ? '' : e.st}">${esc(e.est ? 'Stima' : ST_TXT[e.st])}</span></div></div>
        <div class="right"><div class="amt">${eur(e.importo)}</div>${e.payable && e.st !== 'paid' ? `<button class="btn sm" data-calpay="${e.kind}:${esc(e.ref)}">Paga</button>` : ''}</div></div>`).join('')}</div>`
      : '<div class="empty">Nessuna spesa in questo giorno</div>'}`;
  }

  function formFissa(f, pre) {
    const isNew = !f;
    f = f || { id: uid(), nome: '', tipo: 'Abbonamento', categoria: '', importo: '', frequenza: 'mensile', prossima: today(), fine: '', rate: '', metodo: 'Carta', sito: '', auto: false, notifica: true, attiva: true, note: '' };
    if (pre) f = { ...f, ...pre };
    const cat0 = f.categoria || TIPO_CAT[f.tipo] || 'Altro';
    const catList = cats(); if (!catList.includes(cat0)) catList.push(cat0);
    const hist = fxPaid(f).sort((a, b) => b.data.localeCompare(a.data));
    const tot = Number(f.rate) || 0;
    openSheet(isNew ? 'Nuova spesa fissa' : f.nome, `
      <div class="tipi">${TIPI.map(t => `<label class="tp"><input type="radio" name="tipo" value="${t}" ${t === (f.tipo || 'Altro') ? 'checked' : ''}><span><svg viewBox="0 0 24 24">${TIPO_ICO[t]}</svg>${t}</span></label>`).join('')}</div>
      <label class="f"><span>Nome</span><div class="desc-wrap"><span id="desc-ic">${f.nome ? fxIcon(f) : iconHTML('', '?')}</span><input name="descrizione" placeholder="Es. Netflix, Rata auto, Assicurazione casa…" value="${esc(f.nome)}" required data-focus></div><div class="hint" id="desc-hint"></div></label>
      <div class="f-row">
        <label class="f"><span>Importo (€)</span><input name="importo" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(fmtAmt(f.importo))}" required></label>
        <label class="f"><span>Frequenza</span><select name="frequenza" class="amount-sel">${Object.keys(FREQ_FX).map(k => `<option${k === f.frequenza ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
      </div>
      <div class="f-row">
        <label class="f"><span>Prossimo pagamento</span><input name="prossima" type="date" value="${esc(f.prossima)}" required></label>
        <label class="f"><span>Metodo</span><select name="metodo">${opt(METODI, f.metodo || 'Carta')}</select></label>
      </div>
      <div class="f-row">
        <label class="f"><span>Termina il <i class="opt">facoltativo</i></span><input name="fine" type="date" value="${esc(f.fine)}"></label>
        <label class="f"><span>N. rate totali <i class="opt">facoltativo</i></span><input name="rate" inputmode="numeric" placeholder="Es. 36" value="${esc(f.rate)}"></label>
      </div>
      <div class="f-row">
        <label class="f"><span>Categoria</span><select name="categoria">${opt(catList.sort((a, b) => a.localeCompare(b, 'it')), cat0)}</select></label>
        <label class="f"><span>Sito per il logo <i class="opt">facoltativo</i></span><input name="sito" placeholder="es. netflix.com" value="${esc(f.sito)}" autocapitalize="off"></label>
      </div>
      ${vehActive().length ? `<label class="f"><span>Veicolo collegato <i class="opt">facoltativo</i></span><select name="veicolo"><option value="">Nessuno</option>${vehActive().map(v => `<option value="${esc(v.id)}"${v.id === f.veicolo ? ' selected' : ''}>${esc(v.nome)}</option>`).join('')}</select></label>` : ''}
      <label class="sw"><input type="checkbox" name="auto" ${isOn(f.auto) ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Addebito automatico</b><small>Il pagamento viene registrato da solo alla data prevista (es. carta o RID).</small></span></label>
      <label class="sw"><input type="checkbox" name="notifica" ${f.notifica === '' || f.notifica == null || isOn(f.notifica) ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Avvisami</b><small>Promemoria su calendario e/o email secondo le impostazioni notifiche.</small></span></label>
      ${!isNew ? `<label class="sw"><input type="checkbox" name="attiva" ${f.attiva === '' || isOn(f.attiva) ? 'checked' : ''}><span class="sw-ui"></span><span class="sw-t"><b>Attiva</b><small>Disattiva quando la disdici o è terminata.</small></span></label>` : ''}
      <label class="f"><span>Note</span><textarea name="note" rows="2" placeholder="Numero contratto, polizza, scadenza disdetta…">${esc(f.note)}</textarea></label>
      ${!isNew ? `<div class="hist"><h3 style="margin-bottom:6px">Pagamenti · ${eur(sum(hist))}</h3>
        ${tot ? `<div class="rate-box"><div class="prog big"><i style="width:${Math.min(100, hist.length / tot * 100)}%"></i></div><span class="small muted">${hist.length} di ${tot} rate pagate · residuo ${eur(Math.max(0, tot - hist.length) * (Number(f.importo) || 0))}</span></div>` : ''}
        ${hist.slice(0, 12).map(s => `<div class="item"><div class="main"><div class="t">${esc(shortDate(s.data))}</div><div class="s">${esc(s.metodo || '')}${s.note ? ' · ' + esc(s.note) : ''}</div></div><div class="amt">${eur(s.importo)}</div></div>`).join('') || '<p class="muted small">Nessun pagamento registrato.</p>'}</div>` : ''}`,
      fd => {
        const importo = num(fd.get('importo'));
        const nome = String(fd.get('descrizione') || '').trim();
        if (!nome) return toast('Inserisci il nome');
        if (importo <= 0) return toast('Inserisci un importo valido');
        const row = { ...f, nome, tipo: fd.get('tipo') || 'Altro', importo, frequenza: fd.get('frequenza'), prossima: fd.get('prossima'), fine: fd.get('fine') || '',
          rate: fd.get('rate') ? Math.max(0, parseInt(fd.get('rate'), 10) || 0) || '' : '', metodo: fd.get('metodo'), categoria: fd.get('categoria'),
          sito: domainOf(String(fd.get('sito') || '').trim()) || '', auto: fd.get('auto') === 'on', notifica: fd.get('notifica') === 'on',
          attiva: isNew ? true : fd.get('attiva') === 'on', note: fd.get('note').trim(), veicolo: fd.get('veicolo') || '' };
        if (!String(fd.get('sito') || '').trim()) row.sito = '';
        const ops = [];
        if (!db.categorie.includes(row.categoria)) ops.push({ action: 'upsert', sheet: 'Categorie', row: { nome: row.categoria } });
        ops.push({ action: 'upsert', sheet: 'Fisse', row });
        write(ops);
        closeSheet(); toast(isNew ? 'Spesa fissa aggiunta' : 'Spesa fissa aggiornata');
        refreshCalendarReminders();
      },
      isNew ? null : () => {
        if (!confirm('Eliminare questa spesa fissa? I pagamenti già registrati restano.')) return;
        write([{ action: 'delete', sheet: 'Fisse', id: f.id }]); closeSheet(); toast('Spesa fissa eliminata'); refreshCalendarReminders();
      });
    $('#sheet-form').classList.add('wide');
    // logo e categoria dal nome; categoria dal tipo
    const inp = $('#sheet-body [name=descrizione]'), sel = $('#sheet-body [name=categoria]');
    let catTouched = !isNew;
    sel.addEventListener('change', () => (catTouched = true));
    const setCat = c => { if (catTouched || !c) return; if (![...sel.options].some(o => o.value === c)) sel.add(new Option(c, c)); sel.value = c; };
    $$('#sheet-body [name=tipo]').forEach(r => r.addEventListener('change', () => setCat(TIPO_CAT[r.value])));
    inp.addEventListener('input', () => {
      const mm = findMerchant(inp.value);
      $('#desc-ic').innerHTML = mm ? iconHTML(inp.value, inp.value) : iconHTML('', '?');
      if (mm && mm.tipo && isNew) { const r = $(`#sheet-body [name=tipo][value="${mm.tipo}"]`); if (r && !r.checked) { r.checked = true; } }
      if (mm && isNew) setCat(mm.cat || TIPO_CAT[(($('#sheet-body [name=tipo]:checked') || {}).value)]);
      $('#desc-hint').textContent = mm && mm.tipo && isNew ? `Riconosciuto: ${mm.tipo.toLowerCase()}` : '';
    });
  }

  function formPayFissa(f) {
    const due = f.prossima || today();
    const next = nextDate(due, f.frequenza);
    const n = fxPaid(f).length + 1;
    const ends = fxEnded(f, next, n);
    openSheet('Paga ' + f.nome, `
      <label class="f"><span>Importo pagato (€)</span><input name="importo" class="amount-input" inputmode="decimal" value="${esc(fmtAmt(f.importo))}" required data-focus></label>
      <div class="f-row">
        <label class="f"><span>Data pagamento</span><input name="data" type="date" value="${today()}" required></label>
        <label class="f"><span>Metodo</span><select name="metodo">${opt(METODI, f.metodo || 'Carta')}</select></label>
      </div>
      <p class="muted small" style="margin:0 0 10px">Scadenza ${esc(shortDate(due))}${Number(f.rate) ? ` · rata ${n} di ${f.rate}` : ''}. ${ends ? 'È l\'ultimo pagamento: la spesa fissa verrà conclusa.' : `Prossimo pagamento: <b>${esc(shortDate(next))}</b>.`}</p>`,
      fd => {
        const importo = num(fd.get('importo'));
        if (importo <= 0) return toast('Inserisci un importo valido');
        const spesa = { id: uid(), data: fd.get('data'), importo, categoria: f.categoria, descrizione: f.nome, metodo: fd.get('metodo'), note: 'Scadenza ' + shortDate(due) + (Number(f.rate) ? ` · rata ${n}/${f.rate}` : ''), bollettaId: 'fissa:' + f.id, creato: new Date().toISOString(), sito: f.sito || '' };
        write([{ action: 'upsert', sheet: 'Spese', row: spesa }, { action: 'upsert', sheet: 'Fisse', row: ends ? { ...f, prossima: next, attiva: false } : { ...f, prossima: next } }]);
        closeSheet(); toast('Pagamento registrato');
      }, null, 'Conferma pagamento');
  }

  // aggiorna gli eventi del calendario Google in background
  function refreshCalendarReminders(forAuto) {
    const n = db.config.notifiche || {};
    if (isLocal() || !n.calendario || (forAuto ? n.auto === false : n.fisse === false)) return;
    syncNow().then(() => api('reminders')).catch(() => {});
  }

  /* ================= FATTURE (dettaglio bollette) ================= */
  const ICO_DOC = '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>';
  const UNITA = ['', 'kWh', 'Smc', 'm³', 'GB', 'minuti'];
  const VOCI_TIPICHE = {
    Luce: ['Spesa per la materia energia', 'Spesa per il trasporto e la gestione del contatore', 'Spesa per oneri di sistema', 'Imposte (accise)', 'IVA', 'Canone RAI', 'Altre partite'],
    Gas: ['Spesa per la materia gas naturale', 'Spesa per il trasporto e la gestione del contatore', 'Spesa per oneri di sistema', 'Accise e addizionale regionale', 'IVA', 'Altre partite'],
    Acqua: ['Quota fissa', 'Servizio acquedotto', 'Fognatura', 'Depurazione', 'Oneri perequativi', 'IVA'],
    'Internet e telefono': ['Canone mensile', 'Modem / noleggio', 'Servizi aggiuntivi', 'Traffico extra', 'IVA'],
    _: ['Quota fissa', 'Quota variabile', 'Imposte', 'IVA', 'Altre partite']
  };
  const UNITA_CAT = { Luce: 'kWh', Gas: 'Smc', Acqua: 'm³' };
  const parseVoci = f => { try { const v = typeof f.voci === 'string' ? JSON.parse(f.voci || '[]') : (f.voci || []); return Array.isArray(v) ? v : []; } catch { return []; } };
  const billFatture = b => db.fatture.filter(f => f.bollettaId === b.id).sort((a, c) => String(c.periodoA || c.scadenza || c.emissione || '').localeCompare(String(a.periodoA || a.scadenza || a.emissione || '')));
  const mShort = d => parseD(d).toLocaleDateString('it-IT', { month: 'short' }).replace('.', '');
  function fattLabel(f) {
    if (f.periodoDa && f.periodoA) {
      const y = String(f.periodoA).slice(0, 4);
      return ym(f.periodoDa) === ym(f.periodoA) ? `${mShort(f.periodoA)} ${y}` : `${mShort(f.periodoDa)}–${mShort(f.periodoA)} ${y}`;
    }
    if (f.numero) return 'n. ' + f.numero;
    return f.scadenza ? 'scad. ' + shortDate(f.scadenza) : 'senza data';
  }
  function fattStatus(f) {
    if (f.spesaId) return { cls: 'paid', txt: 'Pagata' };
    if (!f.scadenza) return { cls: '', txt: 'Da pagare' };
    const d = daysTo(f.scadenza);
    if (d < 0) return { cls: 'late', txt: 'Scaduta' };
    if (d <= 7) return { cls: 'soon', txt: d === 0 ? 'Scade oggi' : `Tra ${d} gg` };
    return { cls: '', txt: 'Scad. ' + parseD(f.scadenza).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) };
  }

  function billDetail(b) {
    const list = billFatture(b);
    const st = billStatus(b);
    const active = b.attiva !== false && String(b.attiva).toUpperCase() !== 'FALSE';
    const avg = list.length ? sum(list) / list.length : 0;
    const withC = list.filter(f => Number(f.consumo) > 0);
    const unit = (withC[0] && withC[0].unita) || '';
    const avgC = withC.length ? withC.reduce((a, f) => a + Number(f.consumo), 0) / withC.length : 0;
    const perU = withC.length ? sum(withC) / withC.reduce((a, f) => a + Number(f.consumo), 0) : 0;
    const chartF = list.slice(0, 8).reverse();
    const maxF = Math.max(1, ...chartF.map(f => Number(f.importo) || 0));
    const paidTot = sum(db.spese.filter(x => x.bollettaId === b.id));
    openSheet(b.nome, `
      <div class="bd-head">
        ${iconHTML(b.nome)}
        <div class="main"><div class="s">${esc([b.categoria, b.frequenza].filter(Boolean).join(' · '))}</div>
          <div class="bd-line">${active ? `<span class="chip ${st.cls}">${esc(st.txt)}</span><b class="bd-amt">${eur(b.importo)}</b>` : '<span class="chip">Disattivata</span>'}</div></div>
      </div>
      <div class="bd-act">
          ${aiReady() ? `<button type="button" class="btn sm ai-inline" data-billact="photo" data-id="${esc(b.id)}">${ICO.camera}Da foto</button>` : ''}
          <button type="button" class="btn sm" data-billact="edit" data-id="${esc(b.id)}">Modifica bolletta</button>
      </div>
      <div class="bd-stats">
        <div><span>Media fattura</span><b>${list.length ? eur(avg) : '—'}</b></div>
        <div><span>Consumo medio</span><b>${avgC ? esc(fmtNum(avgC, 0)) + ' ' + esc(unit) : '—'}</b></div>
        <div><span>Costo unitario</span><b>${perU && unit ? esc(fmtNum(perU, 3)) + ' €/' + esc(unit) : '—'}</b></div>
        <div><span>Pagato in totale</span><b>${eur(paidTot)}</b></div>
      </div>
      ${chartF.length > 1 ? `<div class="bd-chart">${chartF.map((f, i) => `<div class="bdc" title="${esc(fattLabel(f))}: ${esc(eur(f.importo))}">
          <span class="bdv">${esc(eur0(f.importo))}</span>
          <i style="height:${Math.max(4, (Number(f.importo) || 0) / maxF * 100)}%;animation-delay:${i * 50}ms"></i>
          <span class="bdl">${esc(f.periodoA ? mShort(f.periodoA) : f.scadenza ? mShort(f.scadenza) : '')}</span></div>`).join('')}</div>` : ''}
      <div class="bd-list-h"><h3>Fatture</h3><span class="muted small">${list.length}</span></div>
      <div class="list">${list.map(f => {
        const fs = fattStatus(f), nv = parseVoci(f).length;
        return `<div class="item" data-fatt="${esc(f.id)}">
          <div class="ic doc-ic">${ICO_DOC}</div>
          <div class="main"><div class="t">${esc(fattLabel(f))}${f.allegato ? ` <i class="clip">${ICO_CLIP}</i>` : ''}</div>
            <div class="s">${[Number(f.consumo) > 0 ? esc(fmtNum(f.consumo, 0) + ' ' + (f.unita || '')) : '', nv ? nv + ' voci' : '', f.numero ? 'n. ' + esc(f.numero) : ''].filter(Boolean).join(' · ') || '&nbsp;'}</div></div>
          <div class="right"><div class="amt">${eur(f.importo)}</div>
            ${f.spesaId ? `<span class="chip paid">Pagata</span>` : `<button type="button" class="btn sm" data-fpay="${esc(f.id)}">Paga</button>`}</div></div>`;
      }).join('') || '<div class="empty">Nessuna fattura. Aggiungi la prima per tenere traccia di consumi e voci.</div>'}</div>`,
      () => formFattura(b), null, '+ Aggiungi fattura');
    $('#sheet-form').classList.add('wide');
  }

  // righe voci
  function addVoce(desc, imp) {
    const box = $('#voci'); if (!box) return;
    const row = document.createElement('div');
    row.className = 'voce';
    row.innerHTML = `<input name="vd" placeholder="Voce" value="${esc(desc)}"><input name="vi" class="vi" inputmode="decimal" placeholder="0,00" value="${esc(imp === '' || imp == null ? '' : fmtAmt(imp))}"><button type="button" class="icon-btn vx" data-vdel aria-label="Rimuovi">✕</button>`;
    box.appendChild(row);
    row.querySelector('.vi').addEventListener('input', updVoci);
    (desc ? row.querySelector('.vi') : row.querySelector('input')).focus();
    updVoci();
  }
  function updVoci() {
    const box = $('#voci-sum'); if (!box) return;
    const tot = $$('#voci .vi').reduce((a, i) => a + num(i.value), 0);
    const target = num(($('#sheet-body [name=importo]') || {}).value || 0);
    const diff = Math.round((target - tot) * 100) / 100;
    const n = $$('#voci .voce').length;
    box.innerHTML = n ? `<span>Somma voci <b>${eur(tot)}</b></span>${target && Math.abs(diff) >= 0.01 ? `<span class="${Math.abs(diff) > 1 ? 'warn-t' : 'muted'}">Differenza ${eur(diff)}</span>` : target ? '<span class="ok-t">Quadra con il totale</span>' : ''}` : '';
  }

  function formFattura(b, f, pre, newBill, pendingDoc) {
    const isNew = !f;
    f = f || { id: uid(), bollettaId: b.id, numero: '', emissione: '', periodoDa: '', periodoA: '', consumo: '', unita: UNITA_CAT[b.categoria] || '', importo: '', scadenza: b.scadenza || today(), voci: '[]', spesaId: '', note: '' };
    if (pre) f = { ...f, ...pre };
    const voci = parseVoci(f);
    const tip = (VOCI_TIPICHE[b.categoria] || VOCI_TIPICHE._).filter(t => !voci.some(v => String(v.descrizione).toLowerCase() === t.toLowerCase()));
    const unpaid = !f.spesaId;
    const defUpd = unpaid && (!b.scadenza || (f.scadenza || '') >= b.scadenza || newBill);
    openSheet((isNew ? 'Nuova fattura · ' : 'Fattura · ') + b.nome, `
      ${f._ai ? `<div class="ai-note">${ICO.spark}<span>${newBill ? `Nuova bolletta “${esc(b.nome)}” letta dall'IA` : 'Letta dall\'IA'}: controlla e salva</span></div>` : ''}
      <label class="f"><span>Totale fattura (€)</span><input name="importo" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(fmtAmt(f.importo))}" required data-focus></label>
      <div class="f-row">
        <label class="f"><span>Scadenza</span><input name="scadenza" type="date" value="${esc(f.scadenza)}"></label>
        <label class="f"><span>N. fattura</span><input name="numero" value="${esc(f.numero)}" placeholder="Facoltativo"></label>
      </div>
      <div class="f-row">
        <label class="f"><span>Periodo dal</span><input name="periodoDa" type="date" value="${esc(f.periodoDa)}"></label>
        <label class="f"><span>al</span><input name="periodoA" type="date" value="${esc(f.periodoA)}"></label>
      </div>
      <div class="f-row">
        <label class="f"><span>Consumo</span><input name="consumo" inputmode="decimal" placeholder="Es. 320" value="${esc(f.consumo === '' || f.consumo == null ? '' : String(f.consumo).replace('.', ','))}"></label>
        <label class="f"><span>Unità</span><select name="unita">${UNITA.map(u => `<option value="${esc(u)}"${u === (f.unita || '') ? ' selected' : ''}>${u || '—'}</option>`).join('')}</select></label>
      </div>
      <div class="voci-box">
        <div class="voci-h"><h3>Voci della bolletta</h3><button type="button" class="btn sm" data-vadd="1">+ Voce</button></div>
        <div id="voci"></div>
        ${tip.length ? `<div class="vtips">${tip.map(t => `<button type="button" class="chip vtip" data-vadd="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>` : ''}
        <div id="voci-sum" class="voci-sum"></div>
      </div>
      <div id="att-box" class="att-wrap"></div>
      <label class="f"><span>Note</span><textarea name="note" rows="2" placeholder="Codice cliente, POD/PDR, offerta…">${esc(f.note)}</textarea></label>
      ${unpaid ? `<label class="sw"><input type="checkbox" name="upd" ${defUpd ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Aggiorna la bolletta</b><small>Usa importo e scadenza di questa fattura per i promemoria.</small></span></label>` : `<p class="muted small"><span class="chip paid">Pagata</span> collegata al pagamento registrato.</p>`}`,
      async fd => {
        const importo = num(fd.get('importo'));
        if (importo <= 0) return toast('Inserisci il totale');
        const allegato = await att.commit(`Bolletta ${b.nome} ${fd.get('periodoA') || fd.get('scadenza') || today()}`.replace(/[\/:*?"<>|]/g, '-') + (att.pending && att.pending.mime === 'application/pdf' ? '.pdf' : '.jpg'));
        const vd = fd.getAll('vd'), vi = fd.getAll('vi');
        const vv = vd.map((d, i) => ({ descrizione: String(d).trim(), importo: num(vi[i]) })).filter(v => v.descrizione || v.importo);
        const c = String(fd.get('consumo') || '').trim();
        const row = { ...f, importo, scadenza: fd.get('scadenza') || '', numero: fd.get('numero').trim(), periodoDa: fd.get('periodoDa') || '', periodoA: fd.get('periodoA') || '',
          consumo: c ? num(c) : '', unita: fd.get('unita'), voci: JSON.stringify(vv), note: fd.get('note').trim(), allegato };
        delete row._ai;
        const ops = [];
        let bill = b;
        if (newBill || fd.get('upd') === 'on') {
          bill = { ...b, importo, scadenza: row.scadenza || b.scadenza };
          ops.push({ action: 'upsert', sheet: 'Bollette', row: bill });
        }
        ops.push({ action: 'upsert', sheet: 'Fatture', row });
        write(ops);
        toast(isNew ? 'Fattura salvata' : 'Fattura aggiornata');
        billDetail(bill);
      },
      isNew ? null : () => {
        if (!confirm('Eliminare questa fattura?')) return;
        write([{ action: 'delete', sheet: 'Fatture', id: f.id }]); toast('Fattura eliminata'); billDetail(b);
      });
    $('#sheet-form').classList.add('wide');
    const fillFromAI = r => {
      const F = n => $('#sheet-body [name=' + n + ']');
      if (r.importo) F('importo').value = fmtAmt(r.importo);
      ['scadenza', 'periodoDa', 'periodoA'].forEach(k => { if (/^\d{4}-\d{2}-\d{2}$/.test(r[k] || '')) F(k).value = r[k]; });
      if (r.numero) F('numero').value = r.numero;
      if (Number(r.consumo) > 0) F('consumo').value = String(r.consumo).replace('.', ',');
      if (r.unita && UNITA.includes(r.unita)) F('unita').value = r.unita;
      if (r.note && !F('note').value) F('note').value = r.note;
      if ((r.voci || []).length) { $('#voci').innerHTML = ''; r.voci.forEach(v => addVoce(v.descrizione, v.importo)); }
      updVoci();
    };
    const att = attachBox({ id: f.allegato || '', pending: pendingDoc || null, label: 'Bolletta', cartella: 'Bollette',
      onRead: async doc => { busy('Leggo la bolletta…'); try { const r = await aiCall('bill', { image: doc.b64, mime: doc.mime }); busy(); if (r.valido === false) return toast('Non sembra una bolletta'); fillFromAI(r); toast('Dati letti dalla bolletta'); } catch (e) { busy(); toast(e.message); } } });
    voci.forEach(v => addVoce(v.descrizione, v.importo));
    $('#sheet-body [name=importo]').addEventListener('input', updVoci);
    updVoci();
  }

  /* ================= IA ================= */
  const ICO = {
    camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>'
  };
  const aiReady = () => !isLocal() && !!db.ai;

  function busy(txt) {
    let el = $('#busy');
    if (!txt) { if (el) el.hidden = true; return; }
    if (!el) { el = document.createElement('div'); el.id = 'busy'; el.className = 'busy'; document.body.appendChild(el); }
    el.innerHTML = `<div class="busy-box"><div class="spin"></div><span>${esc(txt)}</span></div>`;
    el.hidden = false;
  }

  async function aiCall(task, extra) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ai', task, categorie: cats(), oggi: today(), ...extra }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Errore IA');
    return j.result;
  }

  // scatta/sceglie una foto e la riduce (più veloce da inviare)
  function pickImage() {
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment'); pauseLock();
      inp.onchange = () => {
        const file = inp.files && inp.files[0];
        if (!file) return reject(new Error('annullato'));
        const img = new Image();
        img.onload = () => {
          const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(img.src);
          resolve({ image: c.toDataURL('image/jpeg', 0.82).split(',')[1], mime: 'image/jpeg' });
        };
        img.onerror = () => reject(new Error('Immagine non leggibile'));
        img.src = URL.createObjectURL(file);
      };
      inp.click();
    });
  }

  const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : today();
  const pickCat = c => db.categorie.includes(c) ? c : (db.categorie.includes('Altro') ? 'Altro' : cats()[0]);

  async function aiReceipt() {
    let img;
    try { img = await pickImage(); } catch { return; }
    closeSheet(); busy('Leggo lo scontrino…');
    try {
      const open = lsOpen();
      const r = await aiCall('receipt', { ...img, lista: open.slice(0, 80).map(x => x.nome) });
      busy();
      if (!r.valido) return toast('Non sembra uno scontrino, riprova');
      const bought = (r.acquistati || []).map(n => open.find(x => lsKey(x.nome) === lsKey(n))).filter(Boolean);
      const doc = { b64: img.image, mime: img.mime, name: 'scontrino.jpg' };
      if (Number(r.litri) > 0 && vehActive().length) return formRifornimento(null, { _ai: true, importo: r.importo, litri: r.litri, descrizione: r.negozio, data: validDate(r.data), metodo: r.metodo, sito: r.sito || '' });
      formSpesa(null, { _ai: true, importo: r.importo, descrizione: r.negozio, data: validDate(r.data), categoria: pickCat(r.categoria), metodo: r.metodo, note: r.note || '', sito: r.sito || '', detrazione: DETR[r.detrazione] ? r.detrazione : '', _doc: doc, _lista: bought.map(x => x.id) });
    } catch (e) { busy(); toast(e.message); }
  }

  function aiTextForm() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    openSheet('Scrivi o detta', `
      <p class="muted small" style="margin:0 0 10px">Es. “ieri 45 euro benzina Eni e 12,50 farmacia in contanti”</p>
      <div class="dict">
        <textarea name="testo" rows="3" placeholder="Descrivi la spesa…" data-focus></textarea>
        ${SR ? `<button type="button" class="mic" id="mic" aria-label="Detta">${ICO.mic}</button>` : ''}
      </div>
      ${SR ? '' : '<p class="muted small" style="margin:6px 0 0">Per dettare usa il microfono della tastiera.</p>'}`,
      async fd => {
        const testo = String(fd.get('testo') || '').trim();
        if (!testo) return toast('Scrivi qualcosa');
        closeSheet(); busy('Creo la spesa…');
        try {
          const r = await aiCall('text', { testo });
          busy();
          const list = (r.spese || []).filter(x => Number(x.importo) > 0);
          if (!list.length) return toast('Non ho trovato importi, riprova');
          const rows = list.map(x => ({ id: uid(), importo: Math.round(Number(x.importo) * 100) / 100, descrizione: x.descrizione, data: validDate(x.data), categoria: pickCat(x.categoria), metodo: x.metodo || 'Carta', note: '', sito: x.sito || '' }));
          if (rows.length === 1) return formSpesa(null, { _ai: true, ...rows[0] });
          confirmMany(rows);
        } catch (e) { busy(); toast(e.message); }
      }, null, 'Crea');
    const mic = $('#mic');
    if (mic) {
      let rec = null;
      mic.onclick = () => {
        if (rec) { rec.stop(); return; }
        rec = new SR(); rec.lang = 'it-IT'; rec.interimResults = false;
        const ta = $('#sheet-body [name=testo]');
        mic.classList.add('on');
        rec.onresult = e => { ta.value = (ta.value + ' ' + [...e.results].map(x => x[0].transcript).join(' ')).trim(); };
        rec.onend = rec.onerror = () => { mic.classList.remove('on'); rec = null; };
        rec.start();
      };
    }
  }

  function confirmMany(rows) {
    openSheet(`${rows.length} spese trovate`, `
      <div class="list">${rows.map(r => `<div class="item" style="cursor:default">${iconHTML(r.descrizione, r.categoria, r.sito)}
        <div class="main"><div class="t">${esc(r.descrizione)}</div><div class="s">${esc(r.categoria)} · ${esc(shortDate(r.data))} · ${esc(r.metodo)}</div></div>
        <div class="amt">${eur(r.importo)}</div></div>`).join('')}</div>
      <div class="sum-row" style="margin:8px 0"><span class="muted">Totale</span><strong>${eur(sum(rows))}</strong></div>`,
      () => {
        const now = new Date().toISOString();
        write(rows.map(r => ({ action: 'upsert', sheet: 'Spese', row: { ...r, creato: now } })));
        closeSheet(); toast(`${rows.length} spese aggiunte`);
      }, null, 'Aggiungi tutte');
  }

  async function aiBill(forBill) {
    let img;
    try { img = await pickDoc(); } catch (e) { if (e.message !== 'annullato') toast(e.message); return; }
    busy('Leggo la bolletta…');
    try {
      const r = await aiCall('bill', { image: img.b64, mime: img.mime });
      busy();
      if (!r.valido) return toast('Non sembra una bolletta, riprova');
      const pre = { _ai: true, importo: r.importo, scadenza: validDate(r.scadenza), frequenza: FREQ[r.frequenza] !== undefined ? r.frequenza : 'mensile', categoria: pickCat(r.categoria) };
      // bolletta già presente? stesso fornitore o stesso nome
      const m = findMerchant(r.nome);
      const ex = activeBills().find(b => {
        const mb = findMerchant(b.nome);
        if (m && mb) return m.domain === mb.domain && b.categoria === pre.categoria;
        return b.nome.toLowerCase().trim() === String(r.nome).toLowerCase().trim();
      });
      const target = forBill || ex;
      const fpre = { _ai: true, importo: r.importo, scadenza: pre.scadenza, numero: r.numero || '', emissione: r.emissione || '', periodoDa: r.periodoDa || '', periodoA: r.periodoA || '',
        consumo: Number(r.consumo) > 0 ? r.consumo : '', unita: r.unita || '', voci: JSON.stringify((r.voci || []).filter(v => v.descrizione)), note: r.note || '' };
      if (target) formFattura(target, null, fpre, false, img);
      else formFattura({ id: uid(), nome: r.nome, categoria: pre.categoria, importo: pre.importo, frequenza: pre.frequenza, scadenza: pre.scadenza, attiva: true, note: r.note || '' }, null, fpre, true, img);
    } catch (e) { busy(); toast(e.message); }
  }

  /* Consigli del mese */
  function insightsData(month) {
    const [y, m] = month.split('-').map(Number);
    const mesi = [];
    for (let i = 5; i >= 0; i--) mesi.push(ymOf(new Date(y, m - 1 - i, 1)));
    const perMese = mesi.map(k => {
      const ms = db.spese.filter(s => ym(s.data) === k);
      const cat = {};
      ms.forEach(s => (cat[s.categoria] = Math.round(((cat[s.categoria] || 0) + Number(s.importo || 0)) * 100) / 100));
      return { mese: k, totale: Math.round(sum(ms) * 100) / 100, entrate: Math.round(sum(db.entrate.filter(x => ym(x.data) === k)) * 100) / 100, numero: ms.length, perCategoria: cat };
    });
    const speseMese = db.spese.filter(s => ym(s.data) === month).slice(0, 200).map(s => ({ d: s.data, e: Number(s.importo), c: s.categoria, n: s.descrizione, p: s.metodo }));
    const bollette = activeBills().map(b => ({ nome: b.nome, previsto: Number(b.importo), freq: b.frequenza, scadenza: b.scadenza,
      pagamenti: db.spese.filter(s => s.bollettaId === b.id).sort((a, c) => c.data.localeCompare(a.data)).slice(0, 6).map(s => [s.data, Number(s.importo)]),
      fatture: billFatture(b).slice(0, 6).map(f => ({ periodo: [f.periodoDa, f.periodoA].filter(Boolean).join('/'), totale: Number(f.importo), consumo: f.consumo, unita: f.unita, voci: parseVoci(f).map(v => [v.descrizione, v.importo]) })) }));
    return { perMese, speseMese, bollette };
  }
  const insKey = month => 'sc_ins_' + month;
  const insSig = month => { const ms = db.spese.filter(s => ym(s.data) === month); return ms.length + ':' + sum(ms).toFixed(2); };

  function renderInsights() {
    const card = $('#h-ai');
    if (!card) return;
    card.hidden = !aiReady();
    if (!aiReady()) return;
    const saved = LS.get(insKey(homeMonth), null);
    const stale = saved && saved.sig !== insSig(homeMonth);
    const box = $('#h-ai-body');
    $('#h-ai-btn').textContent = saved ? 'Aggiorna' : 'Analizza';
    if (!saved) { box.innerHTML = `<p class="muted small" style="margin:0">L'IA analizza le spese di ${esc(monthName(homeMonth))} e ti dice dove intervenire.</p>`; return; }
    box.innerHTML = `<p class="ins-sum">${esc(saved.r.sintesi)}</p>
      <ul class="ins">${(saved.r.punti || []).map(p => `<li class="${esc(p.tipo)}"><i></i><span>${esc(p.testo)}</span></li>`).join('')}</ul>
      ${stale ? '<p class="muted small" style="margin:6px 0 0">Ci sono nuove spese: premi Aggiorna.</p>' : ''}`;
  }

  async function runInsights() {
    const month = homeMonth;
    if (!db.spese.some(s => ym(s.data) === month)) return toast('Nessuna spesa in questo mese');
    const btn = $('#h-ai-btn'); btn.disabled = true; btn.textContent = 'Analizzo…';
    try {
      const r = await aiCall('insights', { mese: monthName(month), dati: insightsData(month) });
      LS.set(insKey(month), { r, sig: insSig(month) });
    } catch (e) { toast(e.message); }
    btn.disabled = false;
    renderInsights();
  }

  function renderAISettings() {
    const box = $('#ai-set');
    if (isLocal()) { box.innerHTML = '<p class="muted small" style="margin:0">Disponibile solo con il collegamento al Foglio Google.</p>'; return; }
    box.innerHTML = db.ai
      ? `<p class="small" style="margin:0 0 10px"><span class="chip paid">Attiva</span> Scontrini, bollette, dettatura e consigli sono abilitati.</p>
         <button class="btn ghost" id="ai-off">Rimuovi chiave</button>`
      : `<p class="muted small" style="margin:0 0 10px">Incolla la chiave gratuita di Google Gemini. Viene salvata solo nel tuo Google Apps Script.</p>
         <div class="inline-add"><input id="ai-key" type="password" placeholder="Chiave API (AIza…)" autocomplete="off"><button class="btn primary" id="ai-save">Attiva</button></div>
         <a class="link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Ottieni la chiave gratuita →</a>`;
  }

  async function setAIKey(key) {
    busy(key ? 'Verifico la chiave…' : 'Rimuovo…');
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'setKey', key }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      db.ai = !!key; save(); render();
      toast(key ? 'IA attivata' : 'IA disattivata');
    } catch (e) { toast(e.message || 'Errore'); }
    busy();
  }


  /* ================= BLOCCO FACE ID / IMPRONTA ================= */
  const lockCfg = () => LS.get('sc_lock', null);
  let locked = false, hiddenAt = 0, lockPause = 0;
  const pauseLock = (ms = 300000) => { lockPause = Date.now() + ms; };   // fotocamera / scelta file: non bloccare al ritorno
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  async function bioAvailable() {
    try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
  }
  async function bioCreate() {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rnd(32), rp: { name: 'Spese Casa', id: location.hostname },
      user: { id: rnd(16), name: 'spese-casa', displayName: 'Spese Casa' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none' } });
    return b64u(cred.rawId);
  }
  async function bioVerify() {
    const c = lockCfg(); if (!c) return true;
    pauseLock(60000);
    const r = await navigator.credentials.get({ publicKey: { challenge: rnd(32), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: unb64u(c.id), transports: ['internal'] }], userVerification: 'required', timeout: 60000 } });
    pauseLock(2500);
    return !!r;
  }
  function showLock() {
    if (!lockCfg() || locked) return;
    locked = true; document.body.classList.add('is-locked');
    $('#lock').hidden = false; $('#lock-err').hidden = true;
    if (!$('#sheet').hidden) closeSheet();
    closeViewer();
  }
  async function unlock() {
    const btn = $('#lock-go'); btn.disabled = true;
    try {
      if (await bioVerify()) {
        locked = false; document.body.classList.remove('is-locked');
        const l = $('#lock'); l.classList.add('out'); setTimeout(() => { l.hidden = true; l.classList.remove('out'); }, 260);
      }
    } catch (e) {
      const er = $('#lock-err'); er.hidden = false;
      er.textContent = e && e.name === 'NotAllowedError' ? 'Sblocco annullato. Tocca “Sblocca” per riprovare.' : 'Sblocco non riuscito: ' + (e.message || e);
    }
    btn.disabled = false;
  }
  function lockBind() {
    $('#lock-go').onclick = unlock;
    $('#lock-reset').onclick = () => {
      if (!confirm('Scollego questo dispositivo: i dati restano al sicuro sul Foglio Google e potrai ricollegarti incollando di nuovo l\'URL dello script. Continuare?')) return;
      Object.keys(localStorage).filter(k => k.startsWith('sc_')).forEach(k => localStorage.removeItem(k));
      location.reload();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      const c = lockCfg(); if (!c || locked) return;
      if (Date.now() < lockPause) { lockPause = 0; return; }
      if (Date.now() - hiddenAt >= (Number(c.dopo) || 0) * 1000) showLock();
    });
  }
  async function renderLockSettings() {
    const box = $('#lock-set'); if (!box) return;
    const c = lockCfg();
    if (!c && !(await bioAvailable())) {
      box.innerHTML = '<p class="muted small" style="margin:0">Questo dispositivo non supporta lo sblocco con Face ID o impronta. Su iPhone apri l\'app dall\'icona nella schermata Home.</p>';
      return;
    }
    box.innerHTML = `<label class="sw"><input type="checkbox" id="lock-on" ${c ? 'checked' : ''}><span class="sw-ui"></span><span class="sw-t"><b>Blocca con Face ID / impronta</b><small>All'apertura l'app chiede lo sblocco. Vale solo per questo dispositivo.</small></span></label>
      ${c ? `<label class="f" style="margin:4px 0 0"><span>Blocca di nuovo dopo</span><select id="lock-dopo">${[[0, 'Subito'], [60, '1 minuto'], [300, '5 minuti'], [900, '15 minuti']].map(([v, l]) => `<option value="${v}" ${Number(c.dopo) === v ? 'selected' : ''}>${l} in background</option>`).join('')}</select></label>` : ''}`;
    $('#lock-on').onchange = async e => {
      const on = e.target.checked;
      try {
        if (on) { pauseLock(60000); const id = await bioCreate(); pauseLock(2500); LS.set('sc_lock', { id, dopo: 60 }); toast('Blocco attivato'); }
        else { if (!(await bioVerify())) throw new Error('verifica'); localStorage.removeItem('sc_lock'); toast('Blocco disattivato'); }
      } catch (er) { e.target.checked = !on; toast(on ? 'Attivazione annullata' : 'Verifica non riuscita'); }
      renderLockSettings();
    };
    const d = $('#lock-dopo'); if (d) d.onchange = () => { LS.set('sc_lock', { ...lockCfg(), dopo: Number(d.value) }); toast('Salvato'); };
  }

  /* ================= LISTA DELLA SPESA ================= */
  const REPARTI = [
    ['Frutta e verdura', 'mel[ae]|pere?\\b|banan|aranc|limon|frutt|verdur|insalat|lattug|pomodor|patat|cipoll|aglio|carot|zucchin|melanzan|peperon|spinac|broccol|finocch|kiwi|uva\\b|fragol|mandarin|avocad|fungh|zucca|basilic|prezzemol|rucola|sedano|cavol|ananas|pesche|albicocc|ciliegi|anguri|melone'],
    ['Pane e forno', 'pane|panin|pancarr|grissin|cracker|focacc|pizz|fette biscott|piadin|brioche|cornett|biscott|tort[ae]|crostin'],
    ['Latticini e uova', 'latte\\b|yogurt|yoghurt|burro|formagg|mozzarell|parmigian|grana|ricott|stracchin|panna|uov|mascarpon|scamorz|pecorin|provola|emmental|philadelphia'],
    ['Carne e pesce', 'carne|pollo|petto di|tacchin|manzo|maiale|vitell|salsicc|hamburger|macinat|bistecc|prosciutt|salame|mortadell|wurstel|speck|bresaola|pancett|guanciale|pesce|salmone|merluzz|gamber|cozze|vongol|orata|branzin|polpo|calamar|affettat'],
    ['Surgelati', 'surgel|gelat|bastoncin|findus|sofficin'],
    ['Bevande', 'acqua|vino|birra|succo|coca|aranciata|bibit|spremut|prosecco|t[eè] fredd|sprite|fanta|energy|aperol|liquor'],
    ['Dispensa', 'pasta|spaghett|penne|fusill|rigaton|riso|farin|zucchero|sale\\b|olio|aceto|passata|pelati|sugo|ragù|pesto|tonno|legum|ceci|fagiol|lenticch|caff[eè]|\\bt[eè]\\b|tisan|camomill|marmellat|nutella|miele|cereal|muesli|spezie|pepe\\b|dado|brodo|maionese|ketchup|senape|cioccolat|merendin|patatine|snack|olive|mais|lievito|cacao|crackers'],
    ['Casa e pulizia', 'detersiv|ammorbid|sgrassat|candeggin|spugn|carta igien|scottex|rotoloni|tovagliol|sacchett|sacchi|pellicol|alluminio|piatti|bicchier|lavastovigl|pastigl|anticalcare|scop[ae]|spazzol|deodorante per|carta forno|lampadin|\\bpile\\b|batteri|ammonia|vetri|lavatrice|bucato|straccio'],
    ['Igiene e cura', 'shampoo|balsamo|bagnoschium|doccia|sapone|dentifric|spazzolin|deodorant|rasoi|lamette|schiuma da barba|assorbent|cotton|crema|pannolin|salviett|struccant|collutorio|filo interdentale|cerott'],
    ['Animali', 'croccant|crocchett|lettiera|scatolett|cibo (per )?(il )?(gatt|can)|per gatti|per cani']
  ].map(([n, re]) => [n, new RegExp('\\b(?:' + re + ')', 'i')]);
  const REP_ORDER = [...REPARTI.map(r => r[0]), 'Altro'];
  const repartoOf = nome => (REPARTI.find(([, re]) => re.test(nome)) || ['Altro'])[0];
  const lsOpen = () => db.lista.filter(x => !isOn(x.fatto));
  const lsDone = () => db.lista.filter(x => isOn(x.fatto));
  const lsKey = s => String(s || '').trim().toLowerCase();

  function lsAdd(text) {
    const parts = String(text || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
    const open = new Set(lsOpen().map(x => lsKey(x.nome)));
    const freq = LS.get('sc_lsfreq', {});
    const ops = [];
    parts.forEach(p => {
      let qta = '', nome = p;
      const m = p.match(/^(\d+(?:[.,]\d+)?\s*(?:x|kg|g|gr|hg|l|lt|ml|cl|pz|pezzi|conf\.?|confezioni|bottiglie|vasetti|pacchi)?)\s+(.+)$/i) || p.match(/^(.+?)\s+x\s?(\d+)$/i);
      if (m) { if (/^\d/.test(m[1])) { qta = m[1].trim(); nome = m[2]; } else { nome = m[1]; qta = m[2]; } }
      nome = nome.charAt(0).toUpperCase() + nome.slice(1);
      if (open.has(lsKey(nome))) return;
      open.add(lsKey(nome));
      const done = lsDone().find(x => lsKey(x.nome) === lsKey(nome));
      const row = done ? { ...done, qta: qta || done.qta, fatto: false, fattoIl: '', creato: new Date().toISOString() }
        : { id: uid(), nome, qta, reparto: repartoOf(nome), fatto: false, creato: new Date().toISOString(), fattoIl: '' };
      ops.push({ action: 'upsert', sheet: 'Lista', row });
      const k = lsKey(nome); freq[k] = { n: ((freq[k] && freq[k].n) || 0) + 1, nome };
    });
    LS.set('sc_lsfreq', freq);
    if (!ops.length) { if (parts.length) toast('Già nella lista'); return; }
    write(ops);
    if (ops.length > 1) toast(`${ops.length} prodotti aggiunti`);
  }
  function lsToggle(id) {
    const x = db.lista.find(y => y.id === id); if (!x) return;
    const on = !isOn(x.fatto);
    const el = $(`[data-lsid="${CSS.escape(id)}"]`);
    const go = () => write([{ action: 'upsert', sheet: 'Lista', row: { ...x, fatto: on, fattoIl: on ? today() : '' } }]);
    if (el && !reduced()) { el.classList.add(on ? 'checking' : 'unchecking'); setTimeout(go, 260); } else go();
  }
  function renderLista() {
    const open = lsOpen(), done = lsDone();
    $('#ls-count').textContent = open.length ? `${open.length} da prendere` : 'Lista vuota';
    const groups = {};
    open.forEach(x => (groups[x.reparto || repartoOf(x.nome)] = groups[x.reparto || repartoOf(x.nome)] || []).push(x));
    const row = x => `<div class="ls-it${isOn(x.fatto) ? ' done' : ''}" data-lsid="${esc(x.id)}">
      <button type="button" class="ls-ck" data-lstog="${esc(x.id)}" aria-label="${isOn(x.fatto) ? 'Rimetti in lista' : 'Spunta'}"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
      <span class="ls-n">${esc(x.nome)}${x.qta ? ` <em>${esc(x.qta)}</em>` : ''}</span>
      <button type="button" class="icon-btn ls-x" data-lsdel="${esc(x.id)}" aria-label="Rimuovi">✕</button></div>`;
    $('#ls-list').innerHTML = open.length
      ? REP_ORDER.filter(r => groups[r]).map(r => `<div class="ls-g"><div class="ls-gh">${esc(r)}<span>${groups[r].length}</span></div>${groups[r].sort((a, b) => String(a.creato).localeCompare(String(b.creato))).map(row).join('')}</div>`).join('')
      : `<div class="ls-empty"><div class="es-ic"><svg viewBox="0 0 24 24"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg></div><b>Niente da comprare</b><span class="muted small">Scrivi un prodotto qui sopra. Puoi aggiungerne più di uno separandoli con la virgola.</span></div>`;
    $('#ls-done').innerHTML = done.length ? `<div class="ls-dh"><span>Nel carrello · ${done.length}</span><button type="button" class="link-btn" data-lsclear="1">Svuota</button></div>
      ${done.sort((a, b) => String(b.fattoIl).localeCompare(String(a.fattoIl))).slice(0, 40).map(row).join('')}` : '';
    // suggerimenti: prodotti usati spesso che non sono già in lista
    const inOpen = new Set(open.map(x => lsKey(x.nome)));
    const freq = LS.get('sc_lsfreq', {});
    done.forEach(x => { const k = lsKey(x.nome); if (!freq[k]) freq[k] = { n: 1, nome: x.nome }; });
    const sug = Object.entries(freq).filter(([k]) => !inOpen.has(k)).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
    $('#ls-sugg').innerHTML = sug.map(([, v]) => `<button type="button" class="chip vtip" data-lsquick="${esc(v.nome)}">+ ${esc(v.nome)}</button>`).join('');
    $('#ls-sugg').hidden = !sug.length;
  }
  // lista condivisa: mentre è aperta si aggiorna da sola
  setInterval(() => { if (view === 'lista' && document.visibilityState === 'visible' && !isLocal() && url && !syncing && !queue.length && !locked) pull(); }, 15000);

  /* ================= BUDGET PER CATEGORIA ================= */
  const catBudCfg = () => db.config.budgetCat || {};
  const catLimits = () => { const l = catBudCfg().limiti || {}; const o = {}; Object.keys(l).forEach(k => { if (Number(l[k]) > 0) o[k] = Number(l[k]); }); return o; };
  const catTotals = mk => { const o = {}; db.spese.filter(s => ym(s.data) === mk).forEach(s => (o[s.categoria] = (o[s.categoria] || 0) + (Number(s.importo) || 0))); return o; };
  function catCrossCheck(before) {
    const lims = catLimits(); if (!Object.keys(lims).length) return;
    const mk = ymOf(new Date()), now = catTotals(mk);
    for (const c of Object.keys(lims)) {
      const l = lims[c], b = before[c] || 0, n = now[c] || 0;
      if (b <= l && n > l) {
        toast(`${c}: budget di ${eur0(l)} superato (${eur0(n)})`);
        const t = $('#toast'); t.classList.add('alert'); setTimeout(() => t.classList.remove('alert'), 3000);
        if (!isLocal() && catBudCfg().email !== false) api('budgetAlert', { mese: mk, categoria: c, totale: n }).catch(() => {});
        return;
      }
      if (b <= l * 0.8 && n > l * 0.8 && n <= l) { toast(`${c}: hai usato l'80% del budget (${eur0(n)} di ${eur0(l)})`); return; }
    }
  }
  function catBudgetRows(byCat, isCur) {
    const lims = catLimits();
    return Object.keys(lims).map(c => [c, byCat[c] || 0, lims[c]]).sort((a, b) => b[1] / b[2] - a[1] / a[2]).map(([c, v, l]) => {
      const pct = Math.round(v / l * 100), cls = v > l ? 'late' : pct >= 80 ? 'soon' : 'ok';
      const w = Math.max(2, Math.min(100, pct));
      return `<div class="bar-row cb-row"><div class="bar-top"><span>${esc(c)} <span class="chip ${cls === 'ok' ? 'paid' : cls}">${pct}%</span></span><span>${eur0(v)} <span class="muted">/ ${eur0(l)}</span></span></div>
        <div class="bar-track"><div class="bar-fill cb-${cls}" data-w="${w}" style="width:${animate && !reduced() ? 0 : w}%"></div></div>
        ${isCur ? `<small class="cb-left ${v > l ? 'neg-t' : 'muted'}">${v > l ? 'Oltre di ' + eur0(v - l) : 'Restano ' + eur0(l - v)}</small>` : ''}</div>`;
    }).join('');
  }
  function formBudgetCat() {
    const cfg = catBudCfg(), lim = cfg.limiti || {};
    const d0 = new Date(), mesi = [1, 2, 3].map(i => ymOf(new Date(d0.getFullYear(), d0.getMonth() - i, 1)));
    const avg = c => sum(db.spese.filter(s => s.categoria === c && mesi.includes(ym(s.data)))) / 3;
    const list = cats().sort((a, b) => (Number(lim[b]) > 0) - (Number(lim[a]) > 0) || avg(b) - avg(a));
    openSheet('Budget per categoria', `
      <p class="muted small" style="margin:0 0 10px">Imposta quanto vuoi spendere al mese per ogni categoria. Lascia vuoto per non mettere un limite. Accanto vedi la media degli ultimi 3 mesi.</p>
      <div class="bc-list">${list.map(c => `<label class="bc-row"><span class="bc-n"><b>${esc(c)}</b><small>${avg(c) ? 'media ' + eur0(avg(c)) + '/mese' : 'nessuna spesa recente'}</small></span>
        <span class="bc-in"><input name="l:${esc(c)}" inputmode="decimal" placeholder="—" value="${esc(Number(lim[c]) > 0 ? fmtNum(lim[c], 0) : '')}"><i>€</i></span></label>`).join('')}</div>
      <label class="sw" style="margin-top:6px"><input type="checkbox" name="email" ${cfg.email !== false ? 'checked' : ''}><span class="sw-ui"></span><span class="sw-t"><b>Avvisami via email</b><small>Una email al mese per categoria, appena superi il budget.</small></span></label>`,
      fd => {
        const limiti = {};
        for (const [k, v] of fd.entries()) if (k.startsWith('l:') && num(v) > 0) limiti[k.slice(2)] = num(v);
        setConfig('budgetCat', Object.keys(limiti).length ? { limiti, email: fd.get('email') === 'on' } : null);
        if (Object.keys(limiti).length) setConfig('appUrl', location.href.split('#')[0]);
        closeSheet(); toast(Object.keys(limiti).length ? `Budget impostato per ${Object.keys(limiti).length} categori${Object.keys(limiti).length === 1 ? 'a' : 'e'}` : 'Budget rimossi');
      });
  }

  /* ================= DOCUMENTI (archivio) ================= */
  const DOC_TIPI = ['Garanzie', 'Contratti', 'Casa', 'Salute', 'Auto', 'Fiscale', 'Altro'];
  const DOC_ICO = {
    'Scontrini': '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    'Buste paga': '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    'Bollette': '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    'Estratti conto': '<path d="M3 10l9-6 9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18"/>',
    'Garanzie': '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    'Contratti': '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 17c1-2 2-3 3 0 .5 1 1.5 1 2.5 0"/>',
    'Casa': '<path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5"/>',
    'Salute': '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>',
    'Auto': '<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3zM5 11h14"/>',
    'Fiscale': '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 15l6-6"/><circle cx="9.5" cy="9.5" r=".8"/><circle cx="14.5" cy="14.5" r=".8"/>',
    'Altro': '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'
  };
  const docIco = c => `<svg viewBox="0 0 24 24">${DOC_ICO[c] || DOC_ICO.Altro}</svg>`;
  const docF = { cat: '', q: '', year: '' };
  function allDocs() {
    const out = [];
    db.documenti.forEach(d => out.push({ key: 'd:' + d.id, fileId: d.fileId, nome: d.nome || 'Documento', cat: d.tipo || 'Altro', data: d.data || String(d.creato || '').slice(0, 10), scad: d.scadenza, note: d.note, ref: { k: 'doc', id: d.id } }));
    db.spese.filter(s => s.allegato).forEach(s => out.push({ key: 's:' + s.id, fileId: s.allegato, nome: s.descrizione || s.categoria || 'Scontrino', cat: 'Scontrini', data: s.data, importo: s.importo, logo: iconHTML(s.descrizione, s.categoria, s.sito), note: s.categoria, ref: { k: 'spesa', id: s.id } }));
    db.entrate.filter(e => e.allegato).forEach(e => { const p = personaById(e.personaId); out.push({ key: 'e:' + e.id, fileId: e.allegato, nome: e.descrizione || e.tipo || 'Busta paga', cat: 'Buste paga', data: e.data, importo: e.importo, note: p ? p.nome : '', ref: { k: 'entrata', id: e.id } }); });
    db.fatture.filter(f => f.allegato).forEach(f => { const b = db.bollette.find(x => x.id === f.bollettaId); out.push({ key: 'f:' + f.id, fileId: f.allegato, nome: (b ? b.nome : 'Bolletta') + (f.numero ? ' n. ' + f.numero : ''), cat: 'Bollette', data: f.emissione || f.scadenza, importo: f.importo, logo: b ? iconHTML(b.nome) : '', ref: { k: 'fattura', id: f.id } }); });
    (db.estratti || []).forEach(x => { const m = String(x.fileUrl || '').match(/[-\w]{25,}/); if (m) out.push({ key: 'x:' + x.id, fileId: m[0], nome: x.nome || 'Estratto conto', cat: 'Estratti conto', data: x.periodoA || x.data, note: x.banca, ref: { k: 'estratto', id: x.id } }); });
    return out.filter(d => d.fileId).sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  }
  function renderDocs() {
    const all = allDocs();
    const years = [...new Set(all.map(d => String(d.data || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y)))].sort().reverse();
    const ys = $('#doc-year');
    ys.innerHTML = '<option value="">Tutti gli anni</option>' + years.map(y => `<option${y === docF.year ? ' selected' : ''}>${y}</option>`).join('');
    const byYear = all.filter(d => !docF.year || String(d.data).startsWith(docF.year));
    const counts = {}; byYear.forEach(d => (counts[d.cat] = (counts[d.cat] || 0) + 1));
    const order = ['Scontrini', 'Buste paga', 'Bollette', 'Estratti conto', ...DOC_TIPI].filter((c, i, a) => counts[c] && a.indexOf(c) === i);
    $('#doc-chips').innerHTML = `<button type="button" class="dchip${!docF.cat ? ' on' : ''}" data-dcat="">Tutti <i>${byYear.length}</i></button>` + order.map(c => `<button type="button" class="dchip${docF.cat === c ? ' on' : ''}" data-dcat="${esc(c)}">${docIco(c)}${esc(c)} <i>${counts[c]}</i></button>`).join('');
    const q = docF.q.trim().toLowerCase();
    const list = byYear.filter(d => !docF.cat || d.cat === docF.cat).filter(d => !q || [d.nome, d.cat, d.note].join(' ').toLowerCase().includes(q));
    $('#doc-n').textContent = `${list.length} document${list.length === 1 ? 'o' : 'i'}`;
    $('#doc-list').innerHTML = list.map(d => {
      const ds = d.scad ? daysTo(d.scad) : null;
      return `<button type="button" class="doc" data-doc="${esc(d.key)}">
        ${d.logo || `<div class="ic doc-ic">${docIco(d.cat)}</div>`}
        <div class="doc-m"><b>${esc(d.nome)}</b><small>${esc([d.cat, d.data ? shortDate(d.data) : '', d.note].filter(Boolean).join(' · '))}</small></div>
        <div class="doc-r">${d.importo ? `<span class="amt">${eur(d.importo)}</span>` : ''}${ds != null ? `<span class="chip ${ds < 0 ? 'late' : ds <= 60 ? 'soon' : ''}">${ds < 0 ? 'Scaduto' : 'Scade ' + parseD(d.scad).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>` : ''}</div></button>`;
    }).join('') || `<div class="card empty-state doc-empty"><div class="es-ic">${docIco('Altro')}</div><h3>${all.length ? 'Nessun documento trovato' : 'Il tuo archivio è vuoto'}</h3>
      <p class="muted small">Qui trovi tutti i file allegati: scontrini, buste paga, bollette ed estratti conto. Puoi caricare anche garanzie, contratti e altri documenti.</p>
      <button type="button" class="btn primary" data-docact="up">Carica documento</button></div>`;
  }
  function formDoc(d, file) {
    const isNew = !d;
    d = d || { id: uid(), nome: file ? file.name.replace(/\.[^.]+$/, '') : '', tipo: docF.cat && DOC_TIPI.includes(docF.cat) ? docF.cat : 'Garanzie', data: today(), scadenza: '', note: '' };
    openSheet(isNew ? 'Nuovo documento' : 'Modifica documento', `
      ${file ? `<div class="att on">${ICO_CLIP}<div class="att-m"><b>${esc(file.name)}</b><small>Verrà salvato su Google Drive</small></div></div><div style="height:12px"></div>` : ''}
      <label class="f"><span>Nome</span><input name="nome" value="${esc(d.nome)}" placeholder="Es. Garanzia lavatrice, Contratto luce…" required data-focus></label>
      <label class="f"><span>Tipo</span><div class="dt-tipi">${DOC_TIPI.map(t => `<label class="tp"><input type="radio" name="tipo" value="${t}" ${t === d.tipo ? 'checked' : ''}><span>${docIco(t)}${t}</span></label>`).join('')}</div></label>
      <div class="f-row">
        <label class="f"><span>Data</span><input name="data" type="date" value="${esc(d.data)}"></label>
        <label class="f"><span>Scadenza <small class="muted">(facoltativa)</small></span><input name="scadenza" type="date" value="${esc(d.scadenza || '')}"></label>
      </div>
      <label class="f"><span>Note</span><textarea name="note" rows="2" placeholder="Es. negozio, numero di serie, durata garanzia…">${esc(d.note || '')}</textarea></label>`,
      async fd => {
        const nome = String(fd.get('nome') || '').trim(); if (!nome) return toast('Inserisci un nome');
        const row = { ...d, nome, tipo: fd.get('tipo') || 'Altro', data: fd.get('data') || today(), scadenza: fd.get('scadenza') || '', note: String(fd.get('note') || '').trim(), creato: d.creato || new Date().toISOString() };
        if (file) {
          busy('Carico il documento…');
          try { row.fileId = await uploadDoc(file, row.tipo, nome + (file.mime === 'application/pdf' ? '.pdf' : '.jpg')); row.mime = file.mime; busy(); }
          catch (e) { busy(); return toast(/drive|permission|permess|autorizz/i.test(e.message) ? 'Serve un permesso: esegui la funzione "autorizza" nello script' : e.message); }
        }
        write([{ action: 'upsert', sheet: 'Documenti', row }]); closeSheet(); toast(isNew ? 'Documento salvato' : 'Documento aggiornato');
      },
      isNew ? null : () => delDoc(d));
  }
  function delDoc(d) {
    if (!confirm('Eliminare questo documento? Il file viene spostato nel cestino di Google Drive.')) return;
    write([{ action: 'delete', sheet: 'Documenti', id: d.id }]);
    if (!isLocal() && d.fileId) api('deleteFile', { id: d.fileId }).catch(() => {});
    closeSheet(); closeViewer(); toast('Documento eliminato');
  }
  async function newDoc() {
    if (isLocal()) return toast('I documenti richiedono il collegamento al Foglio Google');
    let file; try { file = await pickDoc(); } catch (e) { if (e.message !== 'annullato') toast(e.message); return; }
    formDoc(null, file);
  }

  /* ---------- Visualizzatore (PDF e foto, con cache offline) ---------- */
  async function getDocFile(id) {
    const key = new URL('__doc/' + encodeURIComponent(id), location.href).href;
    try { const c = await caches.open('sc-docs'); const hit = await c.match(key); if (hit) { const blob = await hit.blob(); return { blob, name: decodeURIComponent(hit.headers.get('x-name') || 'documento'), mime: blob.type }; } } catch {}
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=file&id=' + encodeURIComponent(id) + '&t=' + Date.now());
    const j = await r.json(); if (!j.ok) throw new Error(j.error);
    const bin = atob(j.data.b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: j.data.mime });
    try { const c = await caches.open('sc-docs'); await c.put(key, new Response(blob, { headers: { 'content-type': j.data.mime, 'x-name': encodeURIComponent(j.data.name) } })); } catch {}
    return { blob, name: j.data.name, mime: j.data.mime };
  }
  let viewerDoc = null;
  function closeViewer() { const v = $('#viewer'); if (!v || v.hidden) return; v.classList.add('closing'); setTimeout(() => { v.hidden = true; v.classList.remove('closing'); $('#vw-body').innerHTML = ''; }, 200); viewerDoc = null; if ($('#sheet').hidden) document.body.style.overflow = ''; }
  async function openDoc(fileId, meta) {
    const d = meta || { fileId, nome: 'Documento', ref: null };
    viewerDoc = d;
    const v = $('#viewer');
    $('#vw-title').textContent = d.nome || 'Documento';
    $('#vw-sub').textContent = [d.cat, d.data ? shortDate(d.data) : '', d.importo ? eur(d.importo) : ''].filter(Boolean).join(' · ');
    $('#vw-go').hidden = !(d.ref && d.ref.k !== 'doc');
    $('#vw-edit').hidden = !(d.ref && d.ref.k === 'doc');
    $('#vw-share').hidden = !navigator.share;
    $('#vw-body').innerHTML = '<div class="vw-load"><div class="spin"></div><span>Apro il documento…</span></div>';
    v.hidden = false; document.body.style.overflow = 'hidden';
    try {
      const f = await getDocFile(d.fileId);
      if (viewerDoc !== d) return;
      d.file = f;
      const body = $('#vw-body');
      if (/^image\//.test(f.mime)) { body.innerHTML = `<img class="vw-img" src="${URL.createObjectURL(f.blob)}" alt="">`; return; }
      if (/pdf/.test(f.mime)) {
        const pdfjs = await libPdf();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await f.blob.arrayBuffer()) }).promise;
        body.innerHTML = '';
        const n = Math.min(pdf.numPages, 12), w = Math.min(body.clientWidth || 600, 900);
        for (let i = 1; i <= n; i++) {
          if (viewerDoc !== d) return;
          const page = await pdf.getPage(i), vp0 = page.getViewport({ scale: 1 });
          const scale = (w / vp0.width) * Math.min(2, window.devicePixelRatio || 1);
          const vp = page.getViewport({ scale });
          const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.className = 'vw-page';
          body.appendChild(c);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        }
        if (pdf.numPages > n) body.insertAdjacentHTML('beforeend', `<p class="muted small" style="text-align:center">Altre ${pdf.numPages - n} pagine: scarica il file per vederle tutte.</p>`);
        return;
      }
      body.innerHTML = `<div class="vw-load"><span>Anteprima non disponibile. Usa “Scarica”.</span></div>`;
    } catch (e) {
      if (viewerDoc !== d) return;
      $('#vw-body').innerHTML = `<div class="vw-load"><span>${esc(/drive|permission|permess|autorizz/i.test(e.message) ? 'Serve un permesso: esegui la funzione "autorizza" nello script' : 'Impossibile aprire: ' + e.message)}</span></div>`;
    }
  }
  function viewerBind() {
    $('#vw-close').onclick = closeViewer;
    $('#vw-dl').onclick = async () => { const d = viewerDoc; if (!d) return; try { const f = d.file || await getDocFile(d.fileId); saveBlob(f.blob, f.name); } catch (e) { toast(e.message); } };
    $('#vw-share').onclick = async () => {
      const d = viewerDoc; if (!d) return;
      try { const f = d.file || await getDocFile(d.fileId); const file = new File([f.blob], f.name, { type: f.mime });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) return saveBlob(f.blob, f.name);
        pauseLock(); await navigator.share({ files: [file], title: d.nome }); } catch (e) { if (e.name !== 'AbortError') toast('Condivisione non riuscita'); }
    };
    $('#vw-go').onclick = () => {
      const d = viewerDoc; if (!d || !d.ref) return; closeViewer();
      const { k, id } = d.ref;
      if (k === 'spesa') { const s = db.spese.find(x => x.id === id); if (s) formSpesa(s); }
      if (k === 'entrata') { const e = db.entrate.find(x => x.id === id); if (e) formEntrata(e); }
      if (k === 'fattura') { const f = db.fatture.find(x => x.id === id); const b = f && db.bollette.find(x => x.id === f.bollettaId); if (b) formFattura(b, f); }
      if (k === 'estratto') { location.hash = '#estratto'; setTimeout(() => openSavedStatement(id), 50); }
    };
    $('#vw-edit').onclick = () => { const d = viewerDoc; if (!d) return; const row = db.documenti.find(x => x.id === d.ref.id); closeViewer(); if (row) formDoc(row); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#viewer').hidden) closeViewer(); });
  }

  /* ================= RIEPILOGO 730 ================= */
  const DETR = {
    sanitarie: { nome: 'Spese sanitarie', pct: 19, fr: 129.11, hint: 'Farmaci, visite, dentista, ottico, ticket', ico: 'Salute' },
    veterinarie: { nome: 'Spese veterinarie', pct: 19, fr: 129.11, max: 550, hint: 'Veterinario e farmaci per animali', ico: 'Salute' },
    ristrutturazione: { nome: 'Ristrutturazione', pct: 50, rate: 10, max: 96000, hint: '50% abitazione principale (36% altre case), in 10 anni · bonifico parlante', ico: 'Casa' },
    mobili: { nome: 'Bonus mobili ed elettrodomestici', pct: 50, rate: 10, max: 5000, hint: 'Solo con una ristrutturazione in corso, in 10 anni', ico: 'Casa' },
    risparmio: { nome: 'Risparmio energetico', pct: 50, rate: 10, hint: 'Ecobonus (abitazione principale), in 10 anni', ico: 'Casa' },
    interessi: { nome: 'Interessi mutuo prima casa', pct: 19, max: 4000, hint: 'Solo la quota interessi', ico: 'Casa' },
    istruzione: { nome: 'Istruzione', pct: 19, hint: 'Scuola, università, mensa', ico: 'Fiscale' },
    sport: { nome: 'Sport ragazzi', pct: 19, max: 210, hint: '5–18 anni, max 210 € per figlio', ico: 'Fiscale' },
    assicurazioni: { nome: 'Assicurazioni vita e infortuni', pct: 19, max: 530, hint: 'Non RC auto né casa', ico: 'Garanzie' },
    altro: { nome: 'Altre detraibili', pct: 19, ico: 'Fiscale' }
  };
  const isDetr = s => !!DETR[s.detrazione];
  let dtYear = new Date().getFullYear(), dtWho = 'all';
  const dtSpese = () => db.spese.filter(s => isDetr(s) && String(s.data).startsWith(String(dtYear)) && (dtWho === 'all' || (s.personaId || '') === dtWho));
  // calcolo per tipo: franchigia e tetti per persona
  function dtCalc(list) {
    const out = {};
    Object.keys(DETR).forEach(k => {
      const L = list.filter(s => s.detrazione === k); if (!L.length) return;
      const T = DETR[k], spent = sum(L);
      const byP = {}; L.forEach(s => (byP[s.personaId || '-'] = (byP[s.personaId || '-'] || 0) + (Number(s.importo) || 0)));
      let detr = 0;
      Object.values(byP).forEach(v => { const base = Math.max(0, Math.min(v, T.max || Infinity) - (T.fr || 0)); detr += base * T.pct / 100; });
      out[k] = { list: L.sort((a, b) => a.data.localeCompare(b.data)), spent, detr, annual: T.rate ? detr / T.rate : detr, att: L.filter(s => s.allegato).length };
    });
    return out;
  }
  const DT_RE = /farmac|parafarm|medic|dentist|odontoi|ottic|occhial|lenti|visita|analisi|laborator|ticket|ospedal|\basl\b|fisioter|ortoped|veterin|clinica|poliambul|psicolog|logoped/i;
  const dtCandidates = () => db.spese.filter(s => String(s.data).startsWith(String(dtYear)) && !s.detrazione && !s.bollettaId && (['Salute', 'Animali'].includes(s.categoria) || DT_RE.test(s.descrizione + ' ' + (s.note || ''))));

  function renderDetr() {
    $('#dt-year').textContent = dtYear;
    const pp = personeAttive();
    $('#dt-who').innerHTML = pp.length > 1 ? `<button class="veh-tab${dtWho === 'all' ? ' on' : ''}" data-dtwho="all">Tutti</button>` + pp.map(p => `<button class="veh-tab${dtWho === p.id ? ' on' : ''}" data-dtwho="${esc(p.id)}">${avatar(p, 'xs')}<span>${esc(p.nome)}</span></button>`).join('') : '';
    const list = dtSpese(), calc = dtCalc(list);
    const tot = sum(list), detr = Object.values(calc).reduce((a, c) => a + c.annual, 0);
    const att = list.filter(s => s.allegato).length;
    $('#dt-hero').innerHTML = `<div class="dt-h-l"><span class="label">Rimborso stimato nel 730 ${dtYear + 1}</span><div class="big" id="dt-big">0</div>
        <span class="small">su <b>${eur(tot)}</b> di spese detraibili${dtWho !== 'all' && personaById(dtWho) ? ' di ' + esc(personaById(dtWho).nome) : ''} nel ${dtYear}</span></div>
      <div class="dt-h-r"><div class="dt-stat"><b>${list.length}</b><span>spese</span></div><div class="dt-stat"><b>${att}/${list.length}</b><span>con ricevuta</span></div>
        <div class="dt-acts"><button type="button" class="btn btn-ic dt-btn" data-dtact="pdf" ${list.length ? '' : 'disabled'}><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>PDF per il commercialista</button>
        <button type="button" class="btn ghost dt-btn2" data-dtact="csv" ${list.length ? '' : 'disabled'}>Excel</button></div></div>`;
    countTo($('#dt-big'), detr);
    const keys = Object.keys(calc);
    $('#dt-tipi').innerHTML = keys.length ? keys.map(k => {
      const T = DETR[k], c = calc[k];
      return `<details class="dt-t"><summary><div class="ic doc-ic">${docIco(T.ico)}</div><div class="main"><div class="t">${esc(T.nome)}</div><div class="s">${esc(T.hint || '')}</div></div>
        <div class="dt-v"><b>${eur(c.spent)}</b><small class="pos-t">${T.rate ? '+' + eur(c.annual) + '/anno' : '+' + eur(c.detr)}</small></div></summary>
        ${T.fr && c.spent <= T.fr ? `<p class="small warn-t dt-note">Sotto la franchigia di ${eur(T.fr)}: per ora nessun rimborso.</p>` : ''}
        ${T.max && c.spent > T.max ? `<p class="small muted dt-note">Detraibile fino a ${eur0(T.max)}.</p>` : ''}
        <div class="list">${c.list.map(s => `<div class="item" data-spesa="${esc(s.id)}">${iconHTML(s.descrizione, s.categoria, s.sito)}<div class="main"><div class="t">${esc(s.descrizione || s.categoria)}${s.allegato ? ` <i class="clip">${ICO_CLIP}</i>` : ''}</div>
          <div class="s">${esc(shortDate(s.data))} · ${esc(s.metodo || '')}${s.metodo === 'Contanti' ? ' <span class="chip soon">Contanti: verifica</span>' : ''}${s.allegato ? '' : ' <span class="chip">Senza ricevuta</span>'}</div></div><div class="amt">${eur(s.importo)}</div></div>`).join('')}</div></details>`;
    }).join('') : `<div class="empty">Nessuna spesa detraibile nel ${dtYear}. Quando registri una spesa scegli il campo “Detrazione 730”, oppure usa “Da controllare”.</div>`;
    const cand = dtCandidates();
    $('#dt-ai').hidden = !aiReady();
    $('#dt-check').innerHTML = cand.length ? `<p class="muted small" style="margin:0 0 6px">Spese che potrebbero essere detraibili: scegli il tipo oppure “No”.</p><div class="list">${cand.slice(0, 30).map(s => `<div class="item dt-c" data-spesa="${esc(s.id)}">${iconHTML(s.descrizione, s.categoria, s.sito)}
        <div class="main"><div class="t">${esc(s.descrizione || s.categoria)}</div><div class="s">${esc(shortDate(s.data))} · ${eur(s.importo)}</div></div>
        <select class="dt-sel" data-dtset="${esc(s.id)}"><option value="">Scegli…</option><option value="no">No</option>${Object.keys(DETR).map(k => `<option value="${k}">${esc(DETR[k].nome)}</option>`).join('')}</select></div>`).join('')}</div>`
      : `<p class="muted small" style="margin:0">Nessuna spesa da controllare${aiReady() ? '. Con “Classifica con IA” l\'IA cerca tra tutte le spese dell\'anno.' : '.'}</p>`;
  }

  async function dtClassifyAI() {
    const pool = db.spese.filter(s => String(s.data).startsWith(String(dtYear)) && !s.detrazione && !s.bollettaId).slice(0, 400);
    if (!pool.length) return toast('Nessuna spesa da classificare');
    busy(`Analizzo ${pool.length} spese…`);
    try {
      const r = await aiCall('detraz', { spese: pool.map((s, i) => ({ i, n: s.descrizione, c: s.categoria, e: Number(s.importo), note: String(s.note || '').slice(0, 60) })) });
      busy();
      const hits = (r.voci || []).filter(v => DETR[v.tipo] && pool[v.i]).map(v => ({ s: pool[v.i], tipo: v.tipo }));
      if (!hits.length) return toast('Nessuna nuova spesa detraibile trovata');
      openSheet(`${hits.length} spese detraibili trovate`, `
        <p class="muted small" style="margin:0 0 10px">Togli la spunta a quelle che non vuoi inserire nel riepilogo.</p>
        <div class="list">${hits.map((h, i) => `<label class="item dt-hit"><input type="checkbox" name="h${i}" checked>${iconHTML(h.s.descrizione, h.s.categoria, h.s.sito)}
          <div class="main"><div class="t">${esc(h.s.descrizione || h.s.categoria)}</div><div class="s">${esc(DETR[h.tipo].nome)} · ${esc(shortDate(h.s.data))}</div></div><div class="amt">${eur(h.s.importo)}</div></label>`).join('')}</div>`,
        fd => {
          const pid = (personeAttive()[0] || {}).id || '';
          const ops = hits.filter((h, i) => fd.get('h' + i) === 'on').map(h => ({ action: 'upsert', sheet: 'Spese', row: { ...h.s, detrazione: h.tipo, personaId: h.s.personaId || (dtWho !== 'all' ? dtWho : pid) } }));
          if (ops.length) write(ops);
          closeSheet(); toast(`${ops.length} spese aggiunte al riepilogo 730`);
        }, null, 'Aggiungi al 730');
    } catch (e) { busy(); toast(e.message); }
  }

  function dtCSV() {
    const list = dtSpese().sort((a, b) => (a.detrazione + a.data).localeCompare(b.detrazione + b.data));
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = list.map(s => [q(DETR[s.detrazione].nome), q(s.data), q(s.descrizione), String(Number(s.importo).toFixed(2)).replace('.', ','), q(s.metodo), q((personaById(s.personaId) || {}).nome || ''), q(s.allegato ? 'sì' : 'no')].join(';'));
    const blob = new Blob(['﻿' + ['Tipo;Data;Descrizione;Importo;Metodo;Intestatario;Ricevuta', ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    saveBlob(blob, `730-${dtYear}-spese-detraibili.csv`);
  }

  async function dtPDF() {
    const list = dtSpese(); if (!list.length) return;
    busy('Preparo il PDF…');
    try {
      const PL = await libPdfLib();
      const doc = await PL.PDFDocument.create();
      const F = await doc.embedFont(PL.StandardFonts.Helvetica), FB = await doc.embedFont(PL.StandardFonts.HelveticaBold);
      const T = s => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF€]/g, '');
      const ink = PL.rgb(0.09, 0.09, 0.1), mut = PL.rgb(0.45, 0.45, 0.5), acc = PL.rgb(0.09, 0.47, 0.35), lin = PL.rgb(0.88, 0.88, 0.86);
      const W = 595, H = 842, M = 44;
      let page, y;
      const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
      const need = h => { if (y - h < M + 20) newPage(); };
      const txt = (s, x, size = 10, font = F, color = ink, maxW) => { let t = T(s); if (maxW && font.widthOfTextAtSize(t, size) > maxW) { while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > maxW) t = t.slice(0, -1); t = t.trim() + '...'; } page.drawText(t, { x, y, size, font, color }); };
      const right = (s, xr, size = 10, font = F, color = ink) => { const t = T(s); page.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y, size, font, color }); };
      const E = v => T(eur(v));
      const calc = dtCalc(list);
      const who = dtWho !== 'all' && personaById(dtWho) ? personaById(dtWho).nome : 'Tutta la famiglia';
      newPage();
      txt('Riepilogo spese detraibili ' + dtYear, M, 20, FB); y -= 18;
      txt(`${who} · per la dichiarazione 730 ${dtYear + 1} · creato il ${shortDate(today())} con Spese Casa`, M, 9.5, F, mut); y -= 28;
      // riepilogo
      const totDet = Object.values(calc).reduce((a, c) => a + c.annual, 0);
      page.drawRectangle({ x: M, y: y - 44, width: W - 2 * M, height: 54, color: PL.rgb(0.9, 0.95, 0.93) });
      y -= 10; txt('Rimborso stimato', M + 14, 9.5, F, acc); right('Totale spese detraibili', W - M - 14, 9.5, F, acc); y -= 22;
      txt(E(totDet), M + 14, 18, FB, acc); right(E(sum(list)), W - M - 14, 18, FB, ink); y -= 34;
      txt('Tipo di detrazione', M, 9, FB, mut); right('Spese', W - M - 110, 9, FB, mut); right('Detrazione', W - M, 9, FB, mut); y -= 8;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: lin }); y -= 14;
      Object.keys(calc).forEach(k => {
        const c = calc[k], D = DETR[k];
        txt(D.nome + (D.rate ? ` (${D.pct}% in ${D.rate} anni)` : ` (${D.pct}%${D.fr ? ', franchigia ' + eur(D.fr) : ''})`), M, 10, F, ink, W - 2 * M - 200);
        right(E(c.spent), W - M - 110); right(D.rate ? E(c.annual) + '/anno' : E(c.detr), W - M, 10, FB); y -= 16;
      });
      y -= 14;
      // dettaglio per tipo
      let n = 0; const allegati = [];
      Object.keys(calc).forEach(k => {
        need(60);
        txt(DETR[k].nome, M, 12.5, FB); y -= 16;
        txt('Data', M, 8.5, FB, mut); txt('Descrizione', M + 62, 8.5, FB, mut); txt('Pagamento', M + 300, 8.5, FB, mut); txt('Ricevuta', M + 380, 8.5, FB, mut); right('Importo', W - M, 8.5, FB, mut); y -= 6;
        page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: lin }); y -= 12;
        calc[k].list.forEach(s => {
          need(16);
          let rif = '-';
          if (s.allegato) { n++; rif = 'Allegato ' + n; allegati.push({ n, s }); }
          txt(parseD(s.data).toLocaleDateString('it-IT'), M, 9.5); txt(s.descrizione || s.categoria, M + 62, 9.5, F, ink, 228);
          txt(s.metodo || '', M + 300, 9.5, F, s.metodo === 'Contanti' ? PL.rgb(0.7, 0.4, 0.05) : ink, 76); txt(rif, M + 380, 9.5, F, s.allegato ? acc : mut); right(E(s.importo), W - M); y -= 15;
        });
        y -= 4; page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.4, color: lin });
        right('Totale ' + E(calc[k].spent), W - M, 9.5, FB); y -= 24;
      });
      need(60);
      [ 'Stima indicativa: le percentuali e i limiti dipendono dalla normativa dell\'anno e dalla tua situazione.',
        'Le spese sanitarie (esclusi farmaci e dispositivi medici) sono detraibili solo se pagate con mezzi tracciabili.',
        'Verifica sempre con il CAF o il commercialista. Le ricevute sono allegate in fondo al documento.' ].forEach(l => { txt(l, M, 8.5, F, mut); y -= 12; });
      // ricevute allegate
      for (const a of allegati) {
        busy(`Aggiungo le ricevute… ${a.n}/${allegati.length}`);
        const cap = `Allegato ${a.n} - ${a.s.descrizione || a.s.categoria} - ${parseD(a.s.data).toLocaleDateString('it-IT')} - ${eur(a.s.importo)}`;
        try {
          const f = await getDocFile(a.s.allegato);
          const bytes = new Uint8Array(await f.blob.arrayBuffer());
          if (/pdf/.test(f.mime)) {
            const src = await PL.PDFDocument.load(bytes, { ignoreEncryption: true });
            const pages = await doc.copyPages(src, src.getPageIndices());
            pages.forEach((p, i) => { doc.addPage(p); if (!i) { const { height } = p.getSize(); p.drawRectangle({ x: 0, y: height - 20, width: p.getSize().width, height: 20, color: PL.rgb(1, 1, 1), opacity: 0.85 }); p.drawText(T(cap), { x: 12, y: height - 14, size: 9, font: FB, color: acc }); } });
          } else {
            const img = /png/.test(f.mime) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
            newPage(); txt(cap, M, 10, FB, acc); y -= 14;
            const k = Math.min((W - 2 * M) / img.width, (y - M) / img.height);
            page.drawImage(img, { x: (W - img.width * k) / 2, y: y - img.height * k, width: img.width * k, height: img.height * k });
          }
        } catch (e) { newPage(); txt(cap, M, 10, FB, acc); y -= 16; txt('Ricevuta non disponibile: ' + e.message, M, 9.5, F, mut); }
      }
      const out = await doc.save();
      busy(); saveBlob(new Blob([out], { type: 'application/pdf' }), `730-${dtYear}-riepilogo${dtWho !== 'all' && personaById(dtWho) ? '-' + personaById(dtWho).nome.toLowerCase() : ''}.pdf`);
    } catch (e) { busy(); toast('Errore nel creare il PDF: ' + e.message); }
  }

  /* ================= Sheet (form) ================= */
  let onSubmit = null, onDelete = null;
  function openSheet(title, html, submit, del, okLabel = 'Salva') {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    $('#sheet-ok').textContent = okLabel;
    $('#sheet-del').hidden = !del; $('#sheet-del').textContent = 'Elimina';
    onSubmit = submit; onDelete = del;
    clearTimeout(closeSheet._t);
    $('#sheet').classList.remove('closing');
    $('#sheet-form').classList.remove('wide');
    $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    const first = $('#sheet-body [data-focus]');
    if (first && matchMedia('(min-width: 640px)').matches) setTimeout(() => first.focus(), 50);
  }
  function closeSheet() {
    const sh = $('#sheet');
    onSubmit = onDelete = null; document.body.style.overflow = '';
    if (sh.hidden) return;
    if (reduced()) { sh.hidden = true; return; }
    sh.classList.add('closing');
    clearTimeout(closeSheet._t);
    closeSheet._t = setTimeout(() => { sh.hidden = true; sh.classList.remove('closing'); }, 230);
  }

  const opt = (list, sel) => list.map(v => `<option${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const fmtAmt = v => (v === '' || v == null) ? '' : String(Number(v).toFixed(2)).replace('.', ',');

  function catOptions(sel) {
    const list = cats();
    if (sel && !list.includes(sel)) list.push(sel);
    return opt(list, sel);
  }

  function formSpesa(s, pre) {
    const isNew = !s;
    s = s || { id: uid(), data: today(), importo: '', categoria: LS.get('sc_lastcat', cats()[0] || ''), descrizione: '', metodo: LS.get('sc_lastmet', 'Carta'), note: '', sito: '' };
    if (pre) s = { ...s, ...pre };
    const pp = personeAttive();
    const lsItems = (s._lista || []).map(id => db.lista.find(x => x.id === id)).filter(x => x && !isOn(x.fatto));
    openSheet(isNew ? 'Nuova spesa' : 'Modifica spesa', `
      ${isNew && !pre && aiReady() ? `<div class="ai-row">
        <button type="button" class="ai-btn" data-ai="receipt">${ICO.camera}<span>Foto scontrino</span></button>
        <button type="button" class="ai-btn" data-ai="text">${ICO.mic}<span>Scrivi o detta</span></button></div>` : ''}
      ${pre && pre._ai ? `<div class="ai-note">${ICO.spark}<span>Compilato dall'IA: controlla e salva</span></div>` : ''}
      <label class="f"><span>Importo (€)</span><input name="importo" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(fmtAmt(s.importo))}" required data-focus></label>
      <label class="f"><span>Descrizione / negozio</span><div class="desc-wrap"><span id="desc-ic">${iconHTML(s.descrizione, '?', s.sito)}</span><input name="descrizione" placeholder="Es. Conad, Enel, Leroy Merlin…" value="${esc(s.descrizione)}"></div><div class="hint" id="desc-hint"></div></label>
      <div class="f-row">
        <label class="f"><span>Categoria</span><select name="categoria">${catOptions(s.categoria)}</select></label>
        <label class="f"><span>Data</span><input name="data" type="date" value="${esc(s.data)}" required></label>
      </div>
      <div class="f-row">
        <label class="f"><span>Metodo di pagamento</span><select name="metodo">${opt(METODI, s.metodo)}</select></label>
        <label class="f"><span>Detrazione 730</span><select name="detrazione"><option value="">Nessuna</option>${Object.keys(DETR).map(k => `<option value="${k}" ${s.detrazione === k ? 'selected' : ''}>${esc(DETR[k].nome)}</option>`).join('')}</select></label>
      </div>
      ${pp.length > 1 ? `<label class="f" id="sp-who" ${isDetr(s) ? '' : 'hidden'}><span>Intestata a (per il 730)</span><select name="personaId">${pp.map(p => `<option value="${esc(p.id)}" ${p.id === (s.personaId || pp[0].id) ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>` : ''}
      ${lsItems.length ? `<div class="ai-note ls-note"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>Spunterò dalla lista: ${esc(lsItems.map(x => x.nome).join(', '))}</span></div>` : ''}
      <div id="att-box" class="att-wrap"></div>
      <label class="f"><span>Note</span><textarea name="note" rows="2">${esc(s.note)}</textarea></label>`,
      async fd => {
        const importo = num(fd.get('importo'));
        if (importo <= 0) return toast('Inserisci un importo valido');
        const desc = fd.get('descrizione').trim(), data = fd.get('data');
        const allegato = await att.commit(`Scontrino ${desc || fd.get('categoria')} ${data}` + (att.pending && att.pending.mime === 'application/pdf' ? '.pdf' : '.jpg'));
        const detr = fd.get('detrazione') || (s.detrazione === 'no' ? 'no' : '');
        const row = { ...s, importo, descrizione: desc, categoria: fd.get('categoria'), data, metodo: fd.get('metodo'), note: fd.get('note').trim(), creato: s.creato || new Date().toISOString(), allegato, detrazione: detr,
          personaId: DETR[detr] ? (fd.get('personaId') || s.personaId || (pp[0] || {}).id || '') : (s.personaId || '') };
        Object.keys(row).forEach(k => { if (k.startsWith('_')) delete row[k]; });
        row.sito = row.descrizione === (s.descrizione || '') ? (s.sito || '') : '';
        LS.set('sc_lastcat', row.categoria); LS.set('sc_lastmet', row.metodo);
        const ops = [{ action: 'upsert', sheet: 'Spese', row }];
        lsItems.forEach(x => ops.push({ action: 'upsert', sheet: 'Lista', row: { ...x, fatto: true, fattoIl: today() } }));
        write(ops);
        closeSheet(); toast((isNew ? 'Spesa aggiunta' : 'Spesa aggiornata') + (lsItems.length ? ` · ${lsItems.length} prodott${lsItems.length === 1 ? 'o' : 'i'} spuntat${lsItems.length === 1 ? 'o' : 'i'}` : ''));
      },
      isNew ? null : () => {
        if (!confirm('Eliminare questa spesa?')) return;
        write([{ action: 'delete', sheet: 'Spese', id: s.id }]); closeSheet(); toast('Spesa eliminata');
      });
    bindMerchantField(isNew && !(pre && pre._ai), s);
    const att = attachBox({ id: s.allegato || '', pending: s._doc || null, label: 'Scontrino', cartella: 'Scontrini' });
    const dsel = $('#sheet-body [name=detrazione]'), csel = $('#sheet-body [name=categoria]');
    const syncWho = () => { const w = $('#sp-who'); if (w) w.hidden = !DETR[dsel.value]; };
    dsel.addEventListener('change', syncWho);
    if (isNew) {
      let dTouched = !!s.detrazione;
      dsel.addEventListener('change', () => (dTouched = true));
      const auto = () => { if (dTouched) return; dsel.value = csel.value === 'Salute' ? 'sanitarie' : ''; syncWho(); };
      csel.addEventListener('change', auto); $('#sheet-body [name=descrizione]').addEventListener('input', () => setTimeout(auto)); auto();
    }
  }

  function bindMerchantField(autoCat, s0) {
    const inp = $('#sheet-body [name=descrizione]'), sel = $('#sheet-body [name=categoria]');
    let touched = !autoCat, lastKey = '';
    sel.addEventListener('change', () => (touched = true));
    const upd = () => {
      const m = findMerchant(inp.value);
      const key = m ? m.domain + m.cat : '';
      if (key === lastKey) return;
      lastKey = key;
      $('#desc-ic').innerHTML = iconHTML(inp.value, '?', s0 && inp.value === s0.descrizione ? s0.sito : '');
      const hint = $('#desc-hint');
      if (m && !touched && db.categorie.includes(m.cat) && sel.value !== m.cat) {
        sel.value = m.cat; hint.textContent = `Categoria impostata: ${m.cat}`;
      } else hint.textContent = '';
    };
    inp.addEventListener('input', upd);
  }

  function formBill(b, pre) {
    const isNew = !b;
    b = b || { id: uid(), nome: '', categoria: cats().find(c => c === 'Luce') || cats()[0] || '', importo: '', frequenza: 'mensile', scadenza: today(), attiva: true, note: '' };
    if (pre) b = { ...b, ...pre };
    const aiMsg = pre && pre._ai ? (isNew ? 'Nuova bolletta letta dall\'IA: controlla e salva' : 'Bolletta già presente: aggiornati importo e scadenza') : '';
    const active = b.attiva !== false && String(b.attiva).toUpperCase() !== 'FALSE';
    const hist = db.spese.filter(s => s.bollettaId === b.id).sort((a, c) => c.data.localeCompare(a.data));
    openSheet(isNew ? 'Nuova bolletta' : 'Modifica bolletta', `
      ${aiMsg ? `<div class="ai-note">${ICO.spark}<span>${esc(aiMsg)}</span></div>` : ''}
      <label class="f"><span>Nome</span><input name="nome" placeholder="Es. Luce Enel" value="${esc(b.nome)}" required data-focus></label>
      <div class="f-row">
        <label class="f"><span>Importo previsto (€)</span><input name="importo" inputmode="decimal" placeholder="0,00" value="${esc(fmtAmt(b.importo))}"></label>
        <label class="f"><span>Prossima scadenza</span><input name="scadenza" type="date" value="${esc(b.scadenza)}" required></label>
      </div>
      <div class="f-row">
        <label class="f"><span>Frequenza</span><select name="frequenza">${opt(Object.keys(FREQ), b.frequenza)}</select></label>
        <label class="f"><span>Categoria</span><select name="categoria">${catOptions(b.categoria)}</select></label>
      </div>
      <label class="f"><span>Note</span><textarea name="note" rows="2" placeholder="Codice cliente, IBAN fornitore…">${esc(b.note)}</textarea></label>
      ${isNew ? '' : `<label class="f" style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="attiva" ${active ? 'checked' : ''} style="width:auto;min-height:0"> <span style="margin:0;font-size:14px;color:var(--ink)">Attiva</span></label>`}
      ${hist.length ? `<div class="hist"><h3 style="margin-bottom:4px">Storico pagamenti · ${eur(sum(hist))}</h3>${hist.slice(0, 12).map(s => `<div class="item"><div class="main"><div class="t">${esc(shortDate(s.data))}</div><div class="s">${esc(s.metodo || '')}</div></div><div class="amt">${eur(s.importo)}</div></div>`).join('')}</div>` : ''}`,
      fd => {
        const row = { ...b, _ai: undefined, nome: fd.get('nome').trim(), importo: num(fd.get('importo')), scadenza: fd.get('scadenza'), frequenza: fd.get('frequenza'), categoria: fd.get('categoria'), note: fd.get('note').trim(), attiva: isNew ? true : fd.get('attiva') === 'on' };
        delete row._ai;
        if (!row.nome) return toast('Inserisci il nome');
        write([{ action: 'upsert', sheet: 'Bollette', row }]);
        toast(isNew ? 'Bolletta aggiunta' : 'Bolletta aggiornata');
        billDetail(row);
      },
      isNew ? null : () => {
        if (!confirm('Eliminare questa bolletta? Le spese già registrate restano.')) return;
        write([{ action: 'delete', sheet: 'Bollette', id: b.id }]); closeSheet(); toast('Bolletta eliminata');
      });
  }

  function formPay(b, fatt) {
    // fattura collegata: quella indicata, o quella non pagata con la stessa scadenza della bolletta
    fatt = fatt || db.fatture.find(f => f.bollettaId === b.id && !f.spesaId && f.scadenza === b.scadenza) || null;
    const advance = !fatt || !fatt.scadenza || fatt.scadenza >= b.scadenza;
    const months = FREQ[b.frequenza] ?? 1;
    const next = advance ? (months ? addMonths(b.scadenza, months) : null) : b.scadenza;
    openSheet('Paga ' + b.nome, `
      ${fatt ? `<div class="ai-note">${ICO_DOC}<span>Fattura ${esc(fattLabel(fatt))}</span></div>` : ''}
      <label class="f"><span>Importo pagato (€)</span><input name="importo" class="amount-input" inputmode="decimal" value="${esc(fmtAmt(fatt ? fatt.importo : b.importo))}" required data-focus></label>
      <div class="f-row">
        <label class="f"><span>Data pagamento</span><input name="data" type="date" value="${today()}" required></label>
        <label class="f"><span>Metodo</span><select name="metodo">${opt(METODI, 'Addebito in conto')}</select></label>
      </div>
      <p class="muted small" style="margin:0 0 10px">${!advance ? '' : next ? `Prossima scadenza: <b>${esc(shortDate(next))}</b>. ` : 'Bolletta una tantum: verrà disattivata. '}La spesa sarà registrata in “${esc(b.categoria)}”.</p>`,
      fd => {
        const importo = num(fd.get('importo'));
        if (importo <= 0) return toast('Inserisci un importo valido');
        const spesa = { id: uid(), data: fd.get('data'), importo, categoria: b.categoria, descrizione: b.nome, metodo: fd.get('metodo'), note: fatt ? 'Fattura ' + fattLabel(fatt) : 'Scadenza ' + shortDate(b.scadenza), bollettaId: b.id, creato: new Date().toISOString() };
        const ops = [{ action: 'upsert', sheet: 'Spese', row: spesa }];
        if (advance) ops.push({ action: 'upsert', sheet: 'Bollette', row: next ? { ...b, scadenza: next } : { ...b, attiva: false } });
        if (fatt) ops.push({ action: 'upsert', sheet: 'Fatture', row: { ...fatt, spesaId: spesa.id } });
        write(ops);
        closeSheet(); toast('Pagamento registrato');
      }, null, 'Conferma pagamento');
  }

  /* ================= Events ================= */
  function bind() {
    window.addEventListener('hashchange', route);
    // blocca lo zoom (pizzico e doppio tocco) su iPhone
    ['gesturestart', 'gesturechange'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
    let lastTouch = 0;
    document.addEventListener('touchend', e => { const n = Date.now(); if (n - lastTouch < 300 && !e.target.closest('input,select,textarea')) e.preventDefault(); lastTouch = n; }, { passive: false });
    $('#fab').onclick = $('#add-top').onclick = () => (view === 'fisse' ? formFissa() : view === 'auto' ? (curVeh() ? formRifornimento() : formVeicolo()) : view === 'entrate' ? (db.persone.length ? formEntrata() : formPersona()) : view === 'documenti' ? newDoc() : view === 'lista' ? $('#ls-in').focus() : formSpesa());
    $('#add-bill').onclick = () => formBill();
    $('#st-file').addEventListener('change', e => { const fl = [...e.target.files]; e.target.value = ''; if (fl.length) analyzeStatement(fl); });
    const dz = $('#st-drop');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => { const fl = [...e.dataTransfer.files]; if (fl.length) analyzeStatement(fl); });

    document.addEventListener('click', e => {
      const pay = e.target.closest('[data-pay]');
      if (pay) { e.stopPropagation(); const b = db.bollette.find(x => x.id === pay.dataset.pay); if (b) formPay(b); return; }
      const sp = e.target.closest('[data-spesa]');
      if (sp && !e.target.closest('.hist') && !e.target.closest('select')) { const s = db.spese.find(x => String(x.id) === sp.dataset.spesa); if (s) formSpesa(s); return; }
      const bl = e.target.closest('[data-bill]');
      if (bl) { const b = db.bollette.find(x => x.id === bl.dataset.bill); if (b) billDetail(b); return; }
      const fxp = e.target.closest('[data-fxpay]');
      if (fxp) { e.stopPropagation(); const f = db.fisse.find(x => x.id === fxp.dataset.fxpay); if (f) formPayFissa(f); return; }
      const cp2 = e.target.closest('[data-calpay]');
      if (cp2) {
        e.stopPropagation();
        const [k, ...rest] = cp2.dataset.calpay.split(':'); const ref = rest.join(':');
        if (k === 'fx') { const f = db.fisse.find(x => x.id === ref); if (f) formPayFissa(f); }
        if (k === 'bill') { const b = db.bollette.find(x => x.id === ref); if (b) formPay(b); }
        if (k === 'fatt') { const f = db.fatture.find(x => x.id === ref); const b = f && db.bollette.find(x => x.id === f.bollettaId); if (b) formPay(b, f); }
        if (k === 'rent') formRentPay(ref);
        if (k === 'auto') { const [vid, voce] = ref.split(':'); const v = db.veicoli.find(x => x.id === vid); if (v) formAutoSpesa(v, null, { voceAuto: voce }); }
        return;
      }
      const ins = e.target.closest('[data-insel]');
      if (ins) { inSel = ins.dataset.insel; inAll = false; renderEntrate(); stagger($('#in-body')); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const ind = e.target.closest('[data-inday]');
      if (ind) { inCalSel = ind.dataset.inday; renderInCal(); return; }
      const incm = e.target.closest('[data-incm]');
      if (incm) {
        const v = incm.dataset.incm;
        if (v === '0') { inCalMonth = ymOf(new Date()); inCalSel = today(); }
        else { const [y, m] = inCalMonth.split('-').map(Number); inCalMonth = ymOf(new Date(y, m - 1 + Number(v), 1)); }
        const g = $('#inc-grid'); g.classList.remove('slide-l', 'slide-r'); void g.offsetWidth; renderInCal(); g.classList.add(Number(v) < 0 ? 'slide-r' : 'slide-l'); return;
      }
      const ina = e.target.closest('[data-inact]');
      if (ina) {
        const a = ina.dataset.inact;
        if (a === 'newp') formPersona();
        if (a === 'editp') formPersona(personaById(inSel));
        if (a === 'add') formEntrata();
        if (a === 'rec') formRicorrente(inSel !== 'all' ? personaById(inSel) : null);
        if (a === 'all') { inAll = true; renderEntrate(); }
        if (a === 'goal') formGoal();
        if (a === 'addday') formEntrata(null, { data: inCalSel });
        return;
      }
      const inid = e.target.closest('[data-inid]');
      if (inid) { const x = db.entrate.find(y => y.id === inid.dataset.inid); if (x) formEntrata(x); return; }
      const inrec = e.target.closest('[data-inrec]');
      if (inrec) { const x = db.entrateFisse.find(y => y.id === inrec.dataset.inrec); if (x) formRicorrente(personaById(x.personaId), x); return; }
      const gv = e.target.closest('[data-goalv]');
      if (gv) { const g = db.obiettivi.find(y => y.id === gv.dataset.goalv); if (g) formVersa(g); return; }
      const gg = e.target.closest('[data-goal]');
      if (gg) { const g = db.obiettivi.find(y => y.id === gg.dataset.goal); if (g) formGoal(g); return; }
      const sa = e.target.closest('[data-stmt]');
      if (sa) { stmtAction(sa.dataset.stmt, sa); return; }
      const vsel = e.target.closest('[data-veh]');
      if (vsel) { autoVid = vsel.dataset.veh; renderAuto(); stagger($('#auto-body')); return; }
      const aa = e.target.closest('[data-autoact]');
      if (aa) {
        e.stopPropagation();
        const a = aa.dataset.autoact, v = curVeh();
        if (a === 'all') { autoAll = true; renderAuto(); return; }
        if (a === 'newveh') formVeicolo();
        else if (a === 'editveh' && v) formVeicolo(v);
        else if (a === 'fuel' && v) formRifornimento();
        else if (a === 'spesa' && v) formAutoSpesa(v);
        else if (a.startsWith('scad:') && v) formAutoSpesa(v, null, { voceAuto: a.slice(5) });
        return;
      }
      const as = e.target.closest('[data-aspesa]');
      if (as) { const sp = db.spese.find(x => x.id === as.dataset.aspesa); if (sp) (autoVoce(sp) === 'Carburante' ? formRifornimento(sp) : formAutoSpesa(vehOf(sp) || curVeh(), sp)); return; }
      const fxi = e.target.closest('[data-fx]');
      if (fxi) { const f = db.fisse.find(x => x.id === fxi.dataset.fx); if (f) formFissa(f); return; }
      const day = e.target.closest('[data-day]');
      if (day) { calSel = day.dataset.day; $$('.cd.sel').forEach(c => c.classList.remove('sel')); day.classList.add('sel'); renderAgenda(); if (!isDesk()) $('#cal-agenda').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
      const cm = e.target.closest('[data-calm]');
      if (cm) {
        const v = cm.dataset.calm;
        if (v === '0') { calMonth = ymOf(new Date()); calSel = today(); }
        else { const [y, m] = calMonth.split('-').map(Number); calMonth = ymOf(new Date(y, m - 1 + Number(v), 1)); }
        const g = $('#cal-grid'); g.classList.remove('slide-l', 'slide-r'); void g.offsetWidth;
        renderCal(); g.classList.add(Number(v) < 0 ? 'slide-r' : 'slide-l'); return;
      }
      const ft = e.target.closest('[data-fxtab]');
      if (ft) { fxTab = ft.dataset.fxtab; renderFisse(); stagger($('#fx-grid')); return; }
      if (e.target.closest('#fx-add')) { formFissa(); return; }
      if (e.target.closest('#fx-notify')) { formNotify(); return; }
      const fa = e.target.closest('[data-fatt]');
      if (fa) { const f = db.fatture.find(x => x.id === fa.dataset.fatt); const b = f && db.bollette.find(x => x.id === f.bollettaId); if (b) formFattura(b, f); return; }
      const fp = e.target.closest('[data-fpay]');
      if (fp) { e.stopPropagation(); const f = db.fatture.find(x => x.id === fp.dataset.fpay); const b = f && db.bollette.find(x => x.id === f.bollettaId); if (b) formPay(b, f); return; }
      const ba = e.target.closest('[data-billact]');
      if (ba) {
        const b = db.bollette.find(x => x.id === ba.dataset.id);
        if (b && ba.dataset.billact === 'edit') formBill(b);
        if (b && ba.dataset.billact === 'add') formFattura(b);
        if (b && ba.dataset.billact === 'photo') aiBill(b);
        return;
      }
      if (e.target.closest('#shop-add')) {
        const nome = $('#shop-name').value.trim(), dominio = domainOf($('#shop-url').value.trim());
        if (!nome || !dominio) return toast('Inserisci nome e link del negozio');
        setConfig('negozi', [...customShops().filter(n => n.nome.toLowerCase() !== nome.toLowerCase()), { nome, dominio, categoria: $('#shop-cat').value }]);
        $('#shop-name').value = ''; $('#shop-url').value = ''; toast(nome + ' aggiunto');
        return;
      }
      const ds = e.target.closest('[data-delshop]');
      if (ds) { const l = customShops().slice(); l.splice(Number(ds.dataset.delshop), 1); setConfig('negozi', l); return; }
      const vadd = e.target.closest('[data-vadd]');
      if (vadd) { addVoce(vadd.dataset.vadd === '1' ? '' : vadd.dataset.vadd, ''); if (vadd.dataset.vadd !== '1') vadd.remove(); return; }
      const vdel = e.target.closest('[data-vdel]');
      if (vdel) { vdel.closest('.voce').remove(); updVoci(); return; }
      const mo = e.target.closest('[data-month]');
      if (mo) { const [y, m] = homeMonth.split('-').map(Number); homeMonth = ymOf(new Date(y, m - 1 + Number(mo.dataset.month), 1)); renderHome(); return; }
      const dc = e.target.closest('[data-delcat]');
      if (dc) {
        const c = dc.dataset.delcat;
        const used = db.spese.filter(s => s.categoria === c).length;
        if (!confirm(`Eliminare la categoria “${c}”?${used ? ` (${used} spese la usano: resteranno invariate)` : ''}`)) return;
        write([{ action: 'delete', sheet: 'Categorie', id: c }]); return;
      }
      const rp = e.target.closest('[data-rentpay]');
      if (rp) { e.stopPropagation(); formRentPay(rp.dataset.rentpay); return; }
      const rm = e.target.closest('[data-rentmonth]');
      if (rm) { formRentPay(rm.dataset.rentmonth); return; }
      const ra = e.target.closest('[data-rent]');
      if (ra) {
        const a = ra.dataset.rent;
        if (a === 'edit') formRent();
        else if (a === 'pay') formRentPay(ra.dataset.month || ymOf(new Date()));
        else if (a === 'notify') formNotify();
        else if (a === 'testmail') { busy('Invio…'); api('testEmail').then(r => { busy(); toast('Email inviata a ' + r.email); }).catch(err => { busy(); toast(err.message); }); }
        return;
      }
      const yr = e.target.closest('[data-year]');
      if (yr) { rentYear += Number(yr.dataset.year); renderRent(); return; }
      const cp = e.target.closest('[data-copy]');
      if (cp) { navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy).then(() => toast('IBAN copiato')); return; }
      const go = e.target.closest('[data-go]');
      if (go && !e.target.closest('button')) { location.hash = '#' + go.dataset.go; return; }
      const ai = e.target.closest('[data-ai]');
      if (ai) { ai.dataset.ai === 'receipt' ? aiReceipt() : aiTextForm(); return; }
      if (e.target.closest('#ai-save')) { const k = $('#ai-key').value.trim(); if (k) setAIKey(k); return; }
      if (e.target.closest('#ai-off')) { if (confirm('Disattivare l\'IA?')) setAIKey(''); return; }
      if (e.target.closest('#h-ai-btn')) { runInsights(); return; }
      if (e.target.closest('#bill-photo')) { aiBill(); return; }
      const lt = e.target.closest('[data-lstog]');
      if (lt) { lsToggle(lt.dataset.lstog); return; }
      const ld = e.target.closest('[data-lsdel]');
      if (ld) { write([{ action: 'delete', sheet: 'Lista', id: ld.dataset.lsdel }]); return; }
      const lq = e.target.closest('[data-lsquick]');
      if (lq) { lsAdd(lq.dataset.lsquick); return; }
      if (e.target.closest('[data-lsclear]')) { const d = lsDone(); if (d.length && confirm(`Togliere dalla lista i ${d.length} prodotti già presi?`)) write(d.map(x => ({ action: 'delete', sheet: 'Lista', id: x.id }))); return; }
      const dc2 = e.target.closest('[data-dcat]');
      if (dc2) { docF.cat = dc2.dataset.dcat; renderDocs(); return; }
      const dd = e.target.closest('[data-doc]');
      if (dd) { const d = allDocs().find(x => x.key === dd.dataset.doc); if (d) openDoc(d.fileId, d); return; }
      if (e.target.closest('[data-docact]')) { newDoc(); return; }
      const dw = e.target.closest('[data-dtwho]');
      if (dw) { dtWho = dw.dataset.dtwho; renderDetr(); return; }
      const dy = e.target.closest('[data-dty]');
      if (dy) { dtYear += Number(dy.dataset.dty); renderDetr(); stagger($('#v-detrazioni')); return; }
      const da = e.target.closest('[data-dtact]');
      if (da) { da.dataset.dtact === 'pdf' ? dtPDF() : dtCSV(); return; }
      if (e.target.closest('#dt-ai')) { dtClassifyAI(); return; }
      if (e.target.closest('#h-catbud')) { formBudgetCat(); return; }
      if (e.target.closest('[data-close]')) closeSheet();
    });
    document.addEventListener('change', e => {
      const ds = e.target.closest('[data-dtset]');
      if (ds && ds.value) { const sp = db.spese.find(x => x.id === ds.dataset.dtset); if (sp) { write([{ action: 'upsert', sheet: 'Spese', row: { ...sp, detrazione: ds.value, personaId: sp.personaId || (dtWho !== 'all' ? dtWho : (personeAttive()[0] || {}).id || '') } }]); toast(ds.value === 'no' ? 'Segnata come non detraibile' : 'Aggiunta al riepilogo 730'); } }
    });
    $('#ls-form').addEventListener('submit', e => { e.preventDefault(); const i = $('#ls-in'); lsAdd(i.value); i.value = ''; i.focus(); });
    $('#doc-q').addEventListener('input', e => { docF.q = e.target.value; renderDocs(); });
    $('#doc-year').addEventListener('change', e => { docF.year = e.target.value; renderDocs(); });

    $('#sheet-form').addEventListener('submit', e => { e.preventDefault(); onSubmit && onSubmit(new FormData(e.target)); });
    $('#sheet-del').onclick = () => onDelete && onDelete();
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

    $('#f-q').addEventListener('input', e => { f.q = e.target.value; renderSpese(); });
    $('#f-month').addEventListener('change', e => { f.month = e.target.value; renderSpese(); });
    $('#f-cat').addEventListener('change', e => { f.cat = e.target.value; renderSpese(); });

    $('#add-cat').onclick = () => {
      const v = $('#new-cat').value.trim();
      if (!v) return;
      if (db.categorie.some(c => c.toLowerCase() === v.toLowerCase())) return toast('Categoria già presente');
      write([{ action: 'upsert', sheet: 'Categorie', row: { nome: v } }]);
      $('#new-cat').value = ''; toast('Categoria aggiunta');
    };
    $('#new-cat').addEventListener('keydown', e => { if (e.key === 'Enter') $('#add-cat').click(); });
    $('#btn-csv').onclick = exportCSV;
    $('#btn-sync').onclick = () => pull(true);
    $('#btn-conn').onclick = () => {
      if (queue.length && !confirm(`Ci sono ${queue.length} modifiche non ancora inviate. Cambiare comunque?`)) return;
      showSetup();
    };

    let rz, wasDesk = isDesk();
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (isDesk() !== wasDesk) { wasDesk = isDesk(); render(); } else if (view === 'home') { renderChart(); renderBudget(); } }, 150); });
    $('#bud-set').onclick = formBudget;
    window.addEventListener('online', () => { online = true; flush(); pull(); });
    window.addEventListener('offline', () => { online = false; setSync(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !isLocal()) pull(); });
  }

  /* ================= Setup ================= */
  const DEFAULT_CATS = ['Spesa alimentare', 'Luce', 'Gas', 'Acqua', 'Internet e telefono', 'Affitto / Mutuo', 'Condominio', 'Tasse e tributi', 'Assicurazioni', 'Manutenzione', 'Arredamento', 'Elettrodomestici', 'Pulizia e casa', 'Auto e trasporti', 'Salute', 'Animali', 'Altro'];

  function showSetup() {
    hideSplash();
    $('#app').hidden = true; $('#setup').hidden = false;
    $('#setup-url').value = isLocal() ? '' : url;
  }
  function hideSplash() {
    const sp = $('#splash'); if (!sp) return;
    setTimeout(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 450); }, reduced() ? 0 : 1050);
  }
  function startApp() {
    $('#setup').hidden = true; $('#app').hidden = false;
    hideSplash();
    route();
    if (!isLocal()) pull();
  }

  function setupBind() {
    $('#setup-go').onclick = async () => {
      const v = $('#setup-url').value.trim();
      const err = $('#setup-err'); err.hidden = true;
      if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(v)) { err.textContent = 'URL non valido: deve iniziare con https://script.google.com/…/exec'; err.hidden = false; return; }
      $('#setup-go').textContent = 'Verifico…';
      try {
        const r = await fetch(v + (v.includes('?') ? '&' : '?') + 'action=all');
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        if (url !== v) { queue = []; }
        url = v; LS.set('sc_url', url);
        db = { spese: j.data.spese, bollette: j.data.bollette, fatture: j.data.fatture || [], fisse: j.data.fisse || [], veicoli: j.data.veicoli || [], estratti: j.data.estratti || [], persone: j.data.persone || [], entrate: j.data.entrate || [], entrateFisse: j.data.entrateFisse || [], obiettivi: j.data.obiettivi || [], lista: j.data.lista || [], documenti: j.data.documenti || [], categorie: j.data.categorie, config: j.data.config || {}, ai: !!j.data.ai };
        save(); online = true; startApp(); toast('Collegato');
      } catch (e) {
        err.textContent = 'Collegamento non riuscito. Controlla che l\'App web sia pubblicata con accesso "Chiunque" e di aver eseguito setup(). ' + (e.message || '');
        err.hidden = false;
      }
      $('#setup-go').textContent = 'Collega';
    };
    $('#setup-local').onclick = () => {
      url = 'local'; LS.set('sc_url', url); queue = [];
      if (!db.categorie.length) db.categorie = DEFAULT_CATS.slice();
      save(); startApp();
    };
  }

  /* ================= Init ================= */
  bind(); setupBind(); lockBind(); viewerBind();
  if (url && lockCfg()) { showLock(); setTimeout(() => { if (locked) unlock(); }, 450); }
  if (url) startApp(); else showSetup();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
