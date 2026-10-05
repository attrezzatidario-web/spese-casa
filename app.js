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
  let db = LS.get('sc_data', { spese: [], bollette: [], categorie: [] });
  let queue = LS.get('sc_queue', []);
  let syncing = false;
  let online = navigator.onLine;

  const isLocal = () => url === 'local';
  const save = () => { LS.set('sc_data', db); LS.set('sc_queue', queue); };

  /* ================= Utils ================= */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eurF = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  const eur = n => eurF.format(Number(n) || 0);
  const eur0 = n => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
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
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2400);
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
    return `<div class="ic">${esc(initials(fallback || text))}</div>`;
  }

  /* ================= Data layer ================= */
  const KEY = { Spese: 'spese', Bollette: 'bollette', Categorie: 'categorie' };

  function applyLocal(op) {
    const k = KEY[op.sheet];
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
      db = { spese: j.data.spese || [], bollette: j.data.bollette || [], categorie: j.data.categorie || [], ai: !!j.data.ai };
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
  const TITLES = { home: 'Home', spese: 'Spese', bollette: 'Bollette', impostazioni: 'Impostazioni' };
  function route() {
    view = (location.hash || '#home').slice(1);
    if (!TITLES[view]) view = 'home';
    $$('.view').forEach(v => (v.hidden = v.id !== 'v-' + view));
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    $('#title').textContent = TITLES[view];
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    renderBadge();
    if (view === 'home') renderHome();
    if (view === 'spese') renderSpese();
    if (view === 'bollette') renderBills();
    if (view === 'impostazioni') renderSettings();
    setSync();
  }

  function renderBadge() {
    const n = activeBills().filter(b => daysTo(b.scadenza) <= 0).length;
    const el = $('#badge'); el.hidden = !n; el.textContent = n;
  }

  /* ================= Item templates ================= */
  function speseItem(s) {
    const sub = [s.categoria, s.metodo].filter(Boolean).join(' · ');
    return `<div class="item" data-spesa="${esc(s.id)}">
      ${iconHTML(s.descrizione, s.categoria, s.sito)}
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

  /* ================= HOME ================= */
  function renderHome() {
    $('.month-label').textContent = monthName(homeMonth);
    const ms = db.spese.filter(s => ym(s.data) === homeMonth);
    const tot = sum(ms);
    $('#h-total').textContent = eur(tot);

    const [y, m] = homeMonth.split('-').map(Number);
    const prevKey = ymOf(new Date(y, m - 2, 1));
    const prev = sum(db.spese.filter(s => ym(s.data) === prevKey));
    const dEl = $('#h-delta');
    if (prev > 0) {
      const p = Math.round(((tot - prev) / prev) * 100);
      dEl.innerHTML = `<span class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${Math.abs(p)}%</span> rispetto a ${esc(monthShort(prevKey))} (${eur0(prev)})`;
    } else dEl.textContent = `${ms.length} ${ms.length === 1 ? 'spesa' : 'spese'}`;

    // bollette
    const ab = activeBills().sort((a, b) => a.scadenza.localeCompare(b.scadenza));
    const due30 = ab.filter(b => daysTo(b.scadenza) <= 30);
    const late = ab.filter(b => daysTo(b.scadenza) < 0);
    $('#h-bills').textContent = eur(sum(due30));
    $('#h-bills-sub').innerHTML = late.length
      ? `<span class="chip late">${late.length} scadut${late.length === 1 ? 'a' : 'e'}</span> · ${due30.length} in totale`
      : `${due30.length} ${due30.length === 1 ? 'bolletta' : 'bollette'}`;
    $('#h-due').innerHTML = ab.slice(0, 5).map(dueItem).join('') || `<div class="empty">Nessuna bolletta. <a class="link" href="#bollette">Aggiungine una</a></div>`;

    // categorie
    const byCat = {};
    ms.forEach(s => (byCat[s.categoria || 'Altro'] = (byCat[s.categoria || 'Altro'] || 0) + Number(s.importo || 0)));
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const max = rows[0] ? rows[0][1] : 1;
    const top = rows.slice(0, 6);
    if (rows.length > 6) top.push(['Altre categorie', rows.slice(6).reduce((a, r) => a + r[1], 0)]);
    $('#h-cat').innerHTML = top.map(([c, v]) => `<div class="bar-row">
      <div class="bar-top"><span>${esc(c)} <span class="muted">${tot ? Math.round(v / tot * 100) : 0}%</span></span><span>${eur(v)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (v / max) * 100)}%"></div></div></div>`).join('')
      || '<div class="empty">Nessuna spesa in questo mese</div>';

    renderChart();
    renderInsights();

    const last = [...db.spese].sort((a, b) => (b.data + (b.creato || '')).localeCompare(a.data + (a.creato || ''))).slice(0, 5);
    $('#h-last').innerHTML = last.map(speseItem).join('') || '<div class="empty">Ancora nessuna spesa. Tocca + per iniziare.</div>';
  }

  function renderChart() {
    const [y, m] = homeMonth.split('-').map(Number);
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(ymOf(new Date(y, m - 1 - i, 1)));
    const vals = months.map(k => sum(db.spese.filter(s => ym(s.data) === k)));
    const nonZero = vals.filter(v => v > 0);
    $('#h-avg').textContent = nonZero.length ? `media ${eur0(nonZero.reduce((a, b) => a + b, 0) / nonZero.length)}/mese` : '';

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
      g += `<path class="b ${k === homeMonth ? 'cur' : ''}" d="${path}"/>`;
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
    $('#f-total').textContent = eur(sum(list));
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
    $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    const first = $('#sheet-body [data-focus]');
    if (first && matchMedia('(min-width: 640px)').matches) setTimeout(() => first.focus(), 50);
  }
  function closeSheet() { $('#sheet').hidden = true; document.body.style.overflow = ''; onSubmit = onDelete = null; }

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

    let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => view === 'home' && renderChart(), 150); });
    window.addEventListener('online', () => { online = true; flush(); pull(); });
    window.addEventListener('offline', () => { online = false; setSync(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !isLocal()) pull(); });
  }

  /* ================= Setup ================= */
  const DEFAULT_CATS = ['Spesa alimentare', 'Luce', 'Gas', 'Acqua', 'Internet e telefono', 'Affitto / Mutuo', 'Condominio', 'Tasse e tributi', 'Assicurazioni', 'Manutenzione', 'Arredamento', 'Elettrodomestici', 'Pulizia e casa', 'Auto e trasporti', 'Salute', 'Animali', 'Altro'];

  function showSetup() {
    $('#app').hidden = true; $('#setup').hidden = false;
    $('#setup-url').value = isLocal() ? '' : url;
  }
  function startApp() {
    $('#setup').hidden = true; $('#app').hidden = false;
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
        db = { spese: j.data.spese, bollette: j.data.bollette, categorie: j.data.categorie, ai: !!j.data.ai };
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
