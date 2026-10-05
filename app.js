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
      db = { spese: j.data.spese || [], bollette: j.data.bollette || [], categorie: j.data.categorie || [] };
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
      <div class="ic">${esc(initials(s.categoria))}</div>
      <div class="main"><div class="t">${esc(s.descrizione || s.categoria || 'Spesa')}</div><div class="s">${esc(sub)}</div></div>
      <div class="amt">${eur(s.importo)}</div></div>`;
  }
  function dueItem(b) {
    const st = billStatus(b);
    return `<div class="item" data-bill="${esc(b.id)}">
      <div class="ic">${esc(initials(b.nome))}</div>
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
    [0.5, 1].forEach(p => {
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
      <div class="ic">${esc(initials(b.nome))}</div>
      <div class="main"><div class="t">${esc(b.nome)}</div>
        <div class="s">${esc([b.categoria, b.frequenza].filter(Boolean).join(' · '))}${paid ? ` · ultimo pag. ${esc(shortDate(paid.data))}` : ''}</div></div>
      <div class="right"><div class="amt">${eur(b.importo)}</div>
        ${inactive ? '<span class="chip">Disattivata</span>' : `<span class="chip ${st.cls}">${esc(st.txt)}</span>`}
        ${inactive ? '' : `<button class="btn sm" data-pay="${esc(b.id)}">Segna pagata</button>`}</div></div>`;
  }
  function renderBills() {
    const ab = activeBills().sort((a, b) => a.scadenza.localeCompare(b.scadenza));
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

  function formSpesa(s) {
    const isNew = !s;
    s = s || { id: uid(), data: today(), importo: '', categoria: LS.get('sc_lastcat', cats()[0] || ''), descrizione: '', metodo: LS.get('sc_lastmet', 'Carta'), note: '' };
    openSheet(isNew ? 'Nuova spesa' : 'Modifica spesa', `
      <label class="f"><span>Importo (€)</span><input name="importo" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(fmtAmt(s.importo))}" required data-focus></label>
      <label class="f"><span>Descrizione</span><input name="descrizione" placeholder="Es. Spesa Conad" value="${esc(s.descrizione)}"></label>
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
        LS.set('sc_lastcat', row.categoria); LS.set('sc_lastmet', row.metodo);
        write([{ action: 'upsert', sheet: 'Spese', row }]);
        closeSheet(); toast(isNew ? 'Spesa aggiunta' : 'Spesa aggiornata');
      },
      isNew ? null : () => {
        if (!confirm('Eliminare questa spesa?')) return;
        write([{ action: 'delete', sheet: 'Spese', id: s.id }]); closeSheet(); toast('Spesa eliminata');
      });
  }

  function formBill(b) {
    const isNew = !b;
    b = b || { id: uid(), nome: '', categoria: cats().find(c => c === 'Luce') || cats()[0] || '', importo: '', frequenza: 'mensile', scadenza: today(), attiva: true, note: '' };
    const active = b.attiva !== false && String(b.attiva).toUpperCase() !== 'FALSE';
    const hist = db.spese.filter(s => s.bollettaId === b.id).sort((a, c) => c.data.localeCompare(a.data));
    openSheet(isNew ? 'Nuova bolletta' : 'Modifica bolletta', `
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
        const row = { ...b, nome: fd.get('nome').trim(), importo: num(fd.get('importo')), scadenza: fd.get('scadenza'), frequenza: fd.get('frequenza'), categoria: fd.get('categoria'), note: fd.get('note').trim(), attiva: isNew ? true : fd.get('attiva') === 'on' };
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
        db = { spese: j.data.spese, bollette: j.data.bollette, categorie: j.data.categorie };
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
