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
  let db = LS.get('sc_data', { spese: [], bollette: [], categorie: [], config: {} });
  if (!db.config) db.config = {};
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
    ['sky\\b', 'sky.it', IT], ['netflix', 'netflix.com', AL], ['spotify', 'spotify.com', AL], ['disney', 'disneyplus.com', AL],
    ['dazn', 'dazn.com', AL], ['poste', 'poste.it', AL], ['paypal', 'paypal.com', AL],
    ['unipol', 'unipol.it', AS], ['generali', 'generali.it', AS], ['allianz', 'allianz.it', AS], ['zurich', 'zurich.it', AS],
    ['prima\\.it|prima assicura', 'prima.it', AS], ['genertel', 'genertel.it', AS], ['linear', 'linear.it', AS],
    ['farmacia', '', 'Salute'], ['mcdonald', 'mcdonalds.it', AL], ['burger king', 'burgerking.it', AL]
  ].map(([k, domain, cat]) => ({ re: new RegExp(k, 'i'), domain, cat }));

  function findMerchant(text) {
    if (!text) return null;
    const t = String(text);
    return MERCHANTS.find(m => m.re.test(t)) || null;
  }
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
  const KEY = { Spese: 'spese', Bollette: 'bollette', Categorie: 'categorie' };

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
    ops.forEach(applyLocal);
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
      db = { spese: j.data.spese || [], bollette: j.data.bollette || [], categorie: j.data.categorie || [], config: j.data.config || {}, ai: !!j.data.ai };
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
  const TITLES = { home: 'Home', spese: 'Spese', affitto: 'Affitto', bollette: 'Bollette', impostazioni: 'Impostazioni' };
  const SUBS = { home: '', spese: 'Tutti i movimenti', affitto: 'Canone, pagamenti e promemoria', bollette: 'Spese ricorrenti e scadenze', impostazioni: 'Collegamento, IA e categorie' };
  function route() {
    view = (location.hash || '#home').slice(1);
    if (!TITLES[view]) view = 'home';
    $$('.view').forEach(v => (v.hidden = v.id !== 'v-' + view));
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    $('#title').textContent = TITLES[view];
    const sub = view === 'home' ? new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) : SUBS[view];
    $('#subtitle').textContent = sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : '';
    animate = true;
    render();
    stagger($('#v-' + view));
    animate = false;
    window.scrollTo(0, 0);
  }

  function render() {
    renderBadge();
    if (view === 'home') renderHome();
    if (view === 'spese') renderSpese();
    if (view === 'bollette') renderBills();
    if (view === 'affitto') renderRent();
    if (view === 'impostazioni') renderSettings();
    setSync();
  }

  function renderBadge() {
    if (!renderBadge._busy) { renderBadge._busy = true; ensureRentStart(); renderBadge._busy = false; }
    const n = activeBills().filter(b => daysTo(b.scadenza) <= 0).length;
    const el = $('#badge'); el.hidden = !n; el.textContent = n;
    const r = rentArrears().length;
    const er = $('#badge-rent'); er.hidden = !r; er.textContent = r;
  }

  /* ================= Item templates ================= */
  function speseItem(s) {
    const sub = [s.categoria, s.metodo].filter(Boolean).join(' · ');
    return `<div class="item" data-spesa="${esc(s.id)}">
      ${String(s.bollettaId || '').startsWith('affitto:') ? `<div class="ic rent-ic">${ICO_KEY}</div>` : iconHTML(s.descrizione, s.categoria, s.sito)}
      <div class="main"><div class="t">${esc(s.descrizione || s.categoria || 'Spesa')}</div><div class="s">${esc(sub)}</div></div>
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
        <td><div class="tcell">${String(s.bollettaId || '').startsWith('affitto:') ? `<div class="ic rent-ic">${ICO_KEY}</div>` : iconHTML(s.descrizione, s.categoria, s.sito)}<div class="tt"><b>${esc(s.descrizione || s.categoria || 'Spesa')}</b>${s.note ? `<small>${esc(s.note)}</small>` : ''}</div></div></td>
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
    const all = [...ab, ...rents].sort((a, b) => a.due.localeCompare(b.due));
    const due30 = all.filter(x => daysTo(x.due) <= 30);
    const late = all.filter(x => daysTo(x.due) < 0);
    countTo($('#h-bills'), sum(due30));
    $('#h-bills-sub').innerHTML = late.length
      ? `<span class="chip late">${late.length} scadut${late.length === 1 ? 'o' : 'i'}</span> · ${due30.length} pagament${due30.length === 1 ? 'o' : 'i'}`
      : `${due30.length} pagament${due30.length === 1 ? 'o' : 'i'}`;
    $('#h-due').innerHTML = all.slice(0, 6).map(x => x.kind === 'rent' ? rentDueItem(x.r) : dueItem(x.b)).join('') || `<div class="empty">Nessuna scadenza. <a class="link" href="#bollette">Aggiungi una bolletta</a></div>`;

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
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const max = rows[0] ? rows[0][1] : 1;
    const top = rows.slice(0, 6);
    if (rows.length > 6) top.push(['Altre categorie', rows.slice(6).reduce((a, r) => a + r[1], 0)]);
    $('#h-cat').innerHTML = top.map(([c, v]) => `<div class="bar-row">
      <div class="bar-top"><span>${esc(c)} <span class="muted">${tot ? Math.round(v / tot * 100) : 0}%</span></span><span>${eur(v)}</span></div>
      <div class="bar-track"><div class="bar-fill" data-w="${Math.max(2, (v / max) * 100)}" style="width:${animate && !reduced() ? 0 : Math.max(2, (v / max) * 100)}%"></div></div></div>`).join('')
      || '<div class="empty">Nessuna spesa in questo mese</div>';

    if (animate) requestAnimationFrame(() => requestAnimationFrame(() => $$('#h-cat .bar-fill').forEach(b => (b.style.width = b.dataset.w + '%'))));
    renderChart();
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
    const paid = db.spese.filter(s => s.bollettaId === b.id).sort((a, c) => c.data.localeCompare(a.data))[0];
    return `<div class="bill" data-bill="${esc(b.id)}">
      ${iconHTML(b.nome)}
      <div class="main"><div class="t">${esc(b.nome)}</div>
        <div class="s">${esc([b.categoria, b.frequenza].filter(Boolean).join(' · '))}${paid ? ` · ultimo pag. ${esc(shortDate(paid.data))}` : ''}</div></div>
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
        ${n.calendario ? `<li><b>Calendario Google</b><span>Promemoria sul telefono ${n.giorniPrima ? n.giorniPrima + ' gg prima e ' : ''}il giorno della scadenza, alle ${n.ora}:00</span></li>` : ''}
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
        <span class="sw-t"><b>Calendario Google</b><small>Crea un evento mensile "Pagare affitto" con promemoria: arriva come notifica sul telefono.</small></span></label>
      <label class="sw"><input type="checkbox" name="email" ${n.email ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Email intelligente</b><small>Controllo ogni giorno: ti scrivo solo se il pagamento non è ancora registrato.</small></span></label>
      <label class="sw"><input type="checkbox" name="bollette" ${n.bollette ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-t"><b>Includi le bollette</b><small>Nell'email anche le bollette in scadenza.</small></span></label>
      <div class="f-row" style="margin-top:6px">
        <label class="f"><span>Avvisami</span><select name="giorniPrima">${[0, 1, 2, 3, 5, 7].map(d => `<option value="${d}"${Number(n.giorniPrima) === d ? ' selected' : ''}>${d === 0 ? 'Solo il giorno stesso' : d + (d === 1 ? ' giorno prima' : ' giorni prima')}</option>`).join('')}</select></label>
        <label class="f"><span>Orario</span><select name="ora">${hours.map(hh => `<option value="${hh}"${String(n.ora) === hh ? ' selected' : ''}>${hh}:00</option>`).join('')}</select></label>
      </div>
      <p class="muted small" style="margin:0 0 8px">Le email arrivano all'indirizzo Gmail del tuo account Google.</p>`,
      async fd => {
        const v = { calendario: fd.get('calendario') === 'on', email: fd.get('email') === 'on', bollette: fd.get('bollette') === 'on', giorniPrima: Number(fd.get('giorniPrima')), ora: Number(fd.get('ora')) };
        if (v.calendario && !rentCfg()) return toast('Prima configura l\'affitto');
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
      inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
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
      const r = await aiCall('receipt', img);
      busy();
      if (!r.valido) return toast('Non sembra uno scontrino, riprova');
      formSpesa(null, { _ai: true, importo: r.importo, descrizione: r.negozio, data: validDate(r.data), categoria: pickCat(r.categoria), metodo: r.metodo, note: r.note || '', sito: r.sito || '' });
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

  async function aiBill() {
    let img;
    try { img = await pickImage(); } catch { return; }
    busy('Leggo la bolletta…');
    try {
      const r = await aiCall('bill', img);
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
      if (ex) formBill(ex, { _ai: true, importo: pre.importo, scadenza: pre.scadenza });
      else formBill(null, { ...pre, nome: r.nome, note: r.note || '' });
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
      return { mese: k, totale: Math.round(sum(ms) * 100) / 100, numero: ms.length, perCategoria: cat };
    });
    const speseMese = db.spese.filter(s => ym(s.data) === month).slice(0, 200).map(s => ({ d: s.data, e: Number(s.importo), c: s.categoria, n: s.descrizione, p: s.metodo }));
    const bollette = activeBills().map(b => ({ nome: b.nome, previsto: Number(b.importo), freq: b.frequenza, scadenza: b.scadenza,
      pagamenti: db.spese.filter(s => s.bollettaId === b.id).sort((a, c) => c.data.localeCompare(a.data)).slice(0, 6).map(s => [s.data, Number(s.importo)]) }));
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

  /* ================= Sheet (form) ================= */
  let onSubmit = null, onDelete = null;
  function openSheet(title, html, submit, del, okLabel = 'Salva') {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    $('#sheet-ok').textContent = okLabel;
    $('#sheet-del').hidden = !del;
    onSubmit = submit; onDelete = del;
    clearTimeout(closeSheet._t);
    $('#sheet').classList.remove('closing');
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
      <label class="f"><span>Metodo di pagamento</span><select name="metodo">${opt(METODI, s.metodo)}</select></label>
      <label class="f"><span>Note</span><textarea name="note" rows="2">${esc(s.note)}</textarea></label>`,
      fd => {
        const importo = num(fd.get('importo'));
        if (importo <= 0) return toast('Inserisci un importo valido');
        const row = { ...s, importo, descrizione: fd.get('descrizione').trim(), categoria: fd.get('categoria'), data: fd.get('data'), metodo: fd.get('metodo'), note: fd.get('note').trim(), creato: s.creato || new Date().toISOString() };
        delete row._ai;
        row.sito = row.descrizione === (s.descrizione || '') ? (s.sito || '') : '';
        LS.set('sc_lastcat', row.categoria); LS.set('sc_lastmet', row.metodo);
        write([{ action: 'upsert', sheet: 'Spese', row }]);
        closeSheet(); toast(isNew ? 'Spesa aggiunta' : 'Spesa aggiornata');
      },
      isNew ? null : () => {
        if (!confirm('Eliminare questa spesa?')) return;
        write([{ action: 'delete', sheet: 'Spese', id: s.id }]); closeSheet(); toast('Spesa eliminata');
      });
    bindMerchantField(isNew && !(pre && pre._ai), s);
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
        closeSheet(); toast(isNew ? 'Bolletta aggiunta' : 'Bolletta aggiornata');
      },
      isNew ? null : () => {
        if (!confirm('Eliminare questa bolletta? Le spese già registrate restano.')) return;
        write([{ action: 'delete', sheet: 'Bollette', id: b.id }]); closeSheet(); toast('Bolletta eliminata');
      });
  }

  function formPay(b) {
    const months = FREQ[b.frequenza] ?? 1;
    const next = months ? addMonths(b.scadenza, months) : null;
    openSheet('Paga ' + b.nome, `
      <label class="f"><span>Importo pagato (€)</span><input name="importo" class="amount-input" inputmode="decimal" value="${esc(fmtAmt(b.importo))}" required data-focus></label>
      <div class="f-row">
        <label class="f"><span>Data pagamento</span><input name="data" type="date" value="${today()}" required></label>
        <label class="f"><span>Metodo</span><select name="metodo">${opt(METODI, 'Addebito in conto')}</select></label>
      </div>
      <p class="muted small" style="margin:0 0 10px">${next ? `Prossima scadenza: <b>${esc(shortDate(next))}</b>` : 'Bolletta una tantum: verrà disattivata.'} La spesa sarà registrata in “${esc(b.categoria)}”.</p>`,
      fd => {
        const importo = num(fd.get('importo'));
        if (importo <= 0) return toast('Inserisci un importo valido');
        const spesa = { id: uid(), data: fd.get('data'), importo, categoria: b.categoria, descrizione: b.nome, metodo: fd.get('metodo'), note: 'Scadenza ' + shortDate(b.scadenza), bollettaId: b.id, creato: new Date().toISOString() };
        const bill = next ? { ...b, scadenza: next } : { ...b, attiva: false };
        write([{ action: 'upsert', sheet: 'Spese', row: spesa }, { action: 'upsert', sheet: 'Bollette', row: bill }]);
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
    $('#fab').onclick = $('#add-top').onclick = () => formSpesa();
    $('#add-bill').onclick = () => formBill();

    document.addEventListener('click', e => {
      const pay = e.target.closest('[data-pay]');
      if (pay) { e.stopPropagation(); const b = db.bollette.find(x => x.id === pay.dataset.pay); if (b) formPay(b); return; }
      const sp = e.target.closest('[data-spesa]');
      if (sp && !e.target.closest('.hist')) { const s = db.spese.find(x => String(x.id) === sp.dataset.spesa); if (s) formSpesa(s); return; }
      const bl = e.target.closest('[data-bill]');
      if (bl) { const b = db.bollette.find(x => x.id === bl.dataset.bill); if (b) formBill(b); return; }
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
      if (e.target.closest('[data-close]')) closeSheet();
    });

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
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (isDesk() !== wasDesk) { wasDesk = isDesk(); render(); } else if (view === 'home') renderChart(); }, 150); });
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
        db = { spese: j.data.spese, bollette: j.data.bollette, categorie: j.data.categorie, config: j.data.config || {}, ai: !!j.data.ai };
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
  bind(); setupBind();
  if (url) startApp(); else showSetup();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
