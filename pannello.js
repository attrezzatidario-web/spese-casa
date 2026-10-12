/* Spese Casa — pannello di controllo del proprietario
   Mostra numeri e stato degli account (mai spese, importi o documenti degli utenti).
   I dati arrivano da funzioni del database riservate agli amministratori. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const SB_URL = 'https://yxfrevixckortffogmbb.supabase.co';
  const SB_KEY = 'sb_publishable_yDpVXV9QcjHRsmmBKMTj9A_BhCnB0Wh';
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'sc_pannello_auth' } });
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const POLL_MS = 20000;
  const LIMITI = { db: 500 * 1048576, storage: 1024 * 1048576, mau: 50000 };
  const PREZZI = { premium_annuale: 39.99 / 12, premium_mensile: 4.99 };

  /* ---------- utilità ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const N = n => Number(n || 0).toLocaleString('it-IT');
  const EUR = n => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const B = b => { b = Number(b || 0); if (b < 1048576) return Math.max(0, Math.round(b / 1024)) + ' KB'; if (b < 1073741824) return (b / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' MB'; return (b / 1073741824).toLocaleString('it-IT', { maximumFractionDigits: 2 }) + ' GB'; };
  const D = s => s ? new Date(s) : null;
  const giorno = d => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const dataOra = d => d ? d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) + ', ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—';
  const fa = s => {
    const d = D(s); if (!d) return 'mai';
    const m = Math.round((Date.now() - d) / 60000);
    if (m < 2) return 'ora'; if (m < 60) return m + ' min fa';
    const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' ora fa' : ' ore fa');
    const g = Math.round(h / 24); if (g === 1) return 'ieri'; if (g < 30) return g + ' giorni fa';
    return giorno(d);
  };
  const tra = s => { const d = D(s); if (!d) return ''; const h = (d - Date.now()) / 36e5; if (h < 0) return 'scaduta'; if (h < 24) return 'tra ' + Math.max(1, Math.round(h)) + ' ore'; const g = Math.round(h / 24); return 'tra ' + g + (g === 1 ? ' giorno' : ' giorni'); };
  const iniziale = e => (String(e || '?').trim()[0] || '?').toUpperCase();
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw new Error(error.message); return data; };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.remove('out'); t.classList.add('in');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.classList.add('out'); setTimeout(() => (t.hidden = true), 250); }, 2800);
  }
  function countTo(el, to, fmt) {
    fmt = fmt || (v => N(Math.round(v))); to = Number(to) || 0;
    const from = Number(el.dataset.n || 0); el.dataset.n = to;
    if (REDUCED || from === to) { el.textContent = fmt(to); return; }
    if (from !== 0) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    const t0 = performance.now(), dur = from === 0 ? 900 : 600;
    const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to); };
    requestAnimationFrame(step);
  }
  const intFmt = n => N(Math.round(n));
  function stagger(root) {
    if (REDUCED || !root) return;
    Array.from(root.children).forEach((c, i) => { c.style.setProperty('--d', (i * 55) + 'ms'); c.classList.remove('pn-in'); void c.offsetWidth; c.classList.add('pn-in'); });
    root.querySelectorAll(':scope > .kpis > .card, :scope > .pn-grid > .pn-col > .card').forEach((c, i) => { c.style.setProperty('--d', (60 + i * 60) + 'ms'); c.classList.remove('pn-in'); void c.offsetWidth; c.classList.add('pn-in'); });
  }
  const liAnim = (html, i) => html.replace(/^<(div|a) /, `<$1 style="--d:${Math.min(i, 14) * 30}ms" `);

  /* ---------- pannello modale (come nell'app) ---------- */
  let sheetSubmit = null, sheetDelete = null;
  // opz: { ok: 'Salva', onSubmit(fd) → false per restare aperto, onDelete(), wide }
  function openSheet(title, html, opz) {
    opz = opz || {}; sheetSubmit = opz.onSubmit || null; sheetDelete = opz.onDelete || null;
    $('#sheet-ok').textContent = opz.ok || 'Chiudi'; $('#sheet-ok').disabled = false;
    $('#sheet-del').hidden = !sheetDelete;
    $('#sheet-form').classList.toggle('pn-wide', !!opz.wide);
    $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html; $('#sheet-form').classList.remove('pn-det');
    $('#sheet').classList.remove('closing'); $('#sheet').hidden = false; document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    const sh = $('#sheet'); document.body.style.overflow = ''; if (sh.hidden) return;
    sh.classList.add('closing'); setTimeout(() => { sh.hidden = true; sh.classList.remove('closing'); }, 230);
  }
  $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  $('#sheet-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!sheetSubmit) return closeSheet();
    const b = $('#sheet-ok'); b.disabled = true;
    try { const r = await sheetSubmit(new FormData($('#sheet-form'))); if (r !== false) closeSheet(); }
    catch (er) { toast(er.message || String(er)); }
    finally { b.disabled = false; }
  });
  $('#sheet-del').addEventListener('click', async () => { if (!sheetDelete) return; try { const r = await sheetDelete(); if (r !== false) closeSheet(); } catch (er) { toast(er.message || String(er)); } });

  /* ---------- tooltip ---------- */
  const tip = $('#pn-tip');
  const showTip = (x, y, html) => { tip.innerHTML = html; tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.hidden = false; };
  const hideTip = () => { tip.hidden = true; };

  /* ---------- grafici ---------- */
  function niceMax(v) { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return v; }
  function barChart(el, serie, cosa) {
    const W = Math.max(280, el.clientWidth || 600), H = el.clientHeight || 200, L = 30, Bm = 24, T = 8;
    const max = niceMax(Math.max(1, ...serie.map(x => x.n))), n = serie.length, slot = (W - L) / n, bw = Math.max(3, Math.min(22, slot * .62));
    const y = v => T + (H - T - Bm) * (1 - v / max);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = max * i / 4, yy = y(v); g += `<line class="gl" x1="${L}" x2="${W}" y1="${yy}" y2="${yy}"/><text class="ax" x="${L - 8}" y="${yy + 4}" text-anchor="end">${N(v)}</text>`; }
    let bars = '', labs = '';
    serie.forEach((p, i) => {
      const x = L + slot * i + (slot - bw) / 2, v = Math.max(p.n, 0), yy = p.n ? y(v) : H - Bm - 2, h = Math.max(2, H - Bm - yy), r = Math.min(4, bw / 2, h);
      bars += `<path class="bar${p.n ? '' : ' zero'}" data-i="${i}" style="--d:${i * 18}ms" d="M${x},${H - Bm} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z"/>`;
      if (i % Math.ceil(n / 6) === 0 || i === n - 1) labs += `<text class="ax" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${giorno(new Date(p.d))}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(cosa)} al giorno">${g}${bars}${labs}<rect class="hit" x="${L}" y="0" width="${W - L}" height="${H}"/></svg>`;
    const svg = el.querySelector('svg');
    const move = ev => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * W / r.width, i = Math.max(0, Math.min(n - 1, Math.floor((x - L) / slot)));
      el.classList.add('hov'); svg.querySelectorAll('.bar').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
      const p = serie[i], bx = r.left + (L + slot * i + slot / 2) * r.width / W, by = r.top + y(Math.max(p.n, 0)) * r.height / H;
      showTip(bx, by, `<b>${N(p.n)}</b> ${esc(p.n === 1 ? cosa[0] : cosa[1])}<small>${new Date(p.d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' })}</small>`);
    };
    const leave = () => { el.classList.remove('hov'); hideTip(); };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', leave);
  }
  function lineChart(el, serie, cosa) {
    const W = Math.max(280, el.clientWidth || 600), H = el.clientHeight || 200, L = 30, Bm = 24, T = 10;
    const max = niceMax(Math.max(1, ...serie.map(x => x.n))), n = serie.length, step = (W - L - 8) / Math.max(1, n - 1);
    const X = i => L + 4 + step * i, Y = v => T + (H - T - Bm) * (1 - v / max);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = max * i / 4, yy = Y(v); g += `<line class="gl" x1="${L}" x2="${W}" y1="${yy}" y2="${yy}"/><text class="ax" x="${L - 8}" y="${yy + 4}" text-anchor="end">${N(v)}</text>`; }
    const pts = serie.map((p, i) => [X(i), Y(p.n)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const area = d + ` L${X(n - 1)},${H - Bm} L${X(0)},${H - Bm} Z`;
    let labs = ''; serie.forEach((p, i) => { if (i % Math.ceil(n / 6) === 0 || i === n - 1) labs += `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="middle">${giorno(new Date(p.d))}</text>`; });
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(cosa[1])} al giorno"><defs><linearGradient id="pn-area-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      ${g}<path class="area" d="${area}"/><path class="line" style="--len:${Math.ceil(len)}" d="${d}"/>${labs}
      <line class="cross" y1="${T}" y2="${H - Bm}"/><circle class="dot" r="4.5"/><rect class="hit" x="${L}" y="0" width="${W - L}" height="${H}"/></svg>`;
    const svg = el.querySelector('svg'), cross = svg.querySelector('.cross'), dot = svg.querySelector('.dot');
    const move = ev => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * W / r.width, i = Math.max(0, Math.min(n - 1, Math.round((x - L - 4) / step)));
      el.classList.add('hov'); cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(serie[i].n));
      showTip(r.left + X(i) * r.width / W, r.top + Y(serie[i].n) * r.height / H, `<b>${N(serie[i].n)}</b> ${esc(serie[i].n === 1 ? cosa[0] : cosa[1])}<small>${new Date(serie[i].d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' })}</small>`);
    };
    const leave = () => { el.classList.remove('hov'); hideTip(); };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', leave);
  }
  function heroSpark(el, serie, totale) {
    // utenti totali giorno per giorno (cumulato) sullo sfondo della scheda verde
    let base = totale - serie.reduce((a, p) => a + p.n, 0); const cum = serie.map(p => (base += p.n));
    const W = 300, H = 80, min = Math.min(...cum), max = Math.max(...cum), rg = Math.max(1, max - min);
    const pts = cum.map((v, i) => [i * W / Math.max(1, cum.length - 1), H - 8 - (v - min) / rg * (H - 22)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="pn-hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path d="${d} L${W},${H} L0,${H} Z" fill="url(#pn-hg)"/><path d="${d}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const barra = (lbl, val, tot, testo, cls) => {
    const pct = tot ? Math.min(100, val / tot * 100) : 0;
    return `<div class="pn-bar ${cls || (pct > 85 ? 'late' : pct > 65 ? 'warn' : '')}"><div class="bar-top"><span>${esc(lbl)}</span><b>${testo}</b></div><div class="bar-track"><div class="bar-fill" data-w="${pct.toFixed(1)}"></div></div></div>`;
  };
  const animaBarre = root => requestAnimationFrame(() => requestAnimationFrame(() => root.querySelectorAll('.bar-fill[data-w], .pn-seg-bar i[data-w]').forEach(b => (b.style.width = b.dataset.w + '%'))));

  /* ---------- stato ---------- */
  let ov = null, users = null, inviti = null, sys = null, view = 'panoramica', filtro = 'tutti', aggiornato = null, primo = {};
  const statoPiano = u => u.plan !== 'premium' ? 'gratis' : u.source === 'trial' ? 'prova' : 'premium';
  const casePremium = () => {
    // una riga per casa (la prima persona della casa)
    const per = {}; (users || []).forEach(u => { if (!u.household_id) return; const c = per[u.household_id]; if (!c || (u.role === 'owner' && c.role !== 'owner')) per[u.household_id] = u; });
    return Object.values(per).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  };

  /* ---------- viste ---------- */
  const TITOLI = { panoramica: 'Panoramica', utenti: 'Utenti', abbonamenti: 'Abbonamenti', marketing: 'Marketing', inviti: 'Inviti', sistema: 'Sistema' };
  function route() {
    view = (location.hash || '#panoramica').slice(1); if (!TITOLI[view]) view = 'panoramica';
    $$('.view').forEach(v => (v.hidden = v.id !== 'v-' + view));
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    $('#title').textContent = TITOLI[view];
    primo[view] = true; render(); stagger($('#v-' + view)); window.scrollTo(0, 0);
  }
  function sottotitolo() {
    const t = aggiornato ? 'Aggiornato alle ' + aggiornato.toLocaleTimeString('it-IT') : 'Carico…';
    const extra = view === 'utenti' && users ? `${N(users.length)} utenti · ` : view === 'inviti' && inviti ? `${N(inviti.filter(i => i.stato === 'attivo').length)} codici attivi · ` : '';
    $('#subtitle').textContent = extra + t;
  }
  function render() {
    sottotitolo();
    if (view === 'panoramica') renderPanoramica();
    if (view === 'utenti') renderUtenti();
    if (view === 'abbonamenti') renderAbbonamenti();
    if (view === 'inviti') renderInviti();
    if (view === 'sistema') { renderSistema(); statoAvvisi(); }
    if (view === 'marketing' && window.PNM) window.PNM.render(primo.marketing);
  }

  function renderPanoramica() {
    if (!ov) { ['#c-sign', '#c-act'].forEach(s => ($(s).innerHTML = '<div class="pn-sk" style="height:100%"></div>')); return; }
    const anim = primo.panoramica; primo.panoramica = false;
    countTo($('#k-users'), ov.users); $('#k-users-s').textContent = `+${N(ov.new_7)} in 7 giorni · ${N(ov.households)} case`;
    countTo($('#k-new'), ov.new_today); $('#k-new-s').textContent = `${N(ov.new_30)} negli ultimi 30 giorni`;
    countTo($('#k-act'), ov.active_today); $('#k-act-s').textContent = `${N(ov.active_7)} negli ultimi 7 giorni`;
    const prem = ov.plan_paid + ov.plan_trial + ov.plan_manual;
    countTo($('#k-prem'), prem); $('#k-prem-s').textContent = `${N(ov.plan_paid)} abbonati · ${N(ov.plan_trial)} in prova`;
    heroSpark($('#k-spark'), ov.signups_30 || [], ov.users);
    const tot = (ov.signups_30 || []).reduce((a, p) => a + p.n, 0); $('#c-sign-tot').textContent = N(tot);
    if (anim || !$('#c-sign svg')) { barChart($('#c-sign'), ov.signups_30 || [], ['iscritto', 'iscritti']); lineChart($('#c-act'), ov.active_30 || [], ['utente attivo', 'utenti attivi']); }
    // piani
    const P = [['Premium', ov.plan_paid + ov.plan_manual, 'pn-c-prem'], ['In prova', ov.plan_trial, 'pn-c-trial'], ['Gratis', ov.plan_free, 'pn-c-free']], tp = Math.max(1, ov.households);
    $('#c-plan-tot').textContent = N(ov.households) + ' case';
    $('#c-plan').innerHTML = `<div class="pn-seg-bar" role="img" aria-label="Distribuzione dei piani">${P.filter(p => p[1]).map(p => `<i class="${p[2]}" data-w="${(p[1] / tp * 100).toFixed(2)}"></i>`).join('')}</div>
      <div class="pn-leg">${P.map(p => `<div><i class="${p[2]}"></i><span>${p[0]}</span><b>${N(p[1])}</b><small>${Math.round(p[1] / tp * 100)}%</small></div>`).join('')}</div>`;
    // notifiche e risorse
    const pt = ov.push_web + ov.push_android + ov.push_ios, pm = Math.max(1, pt);
    $('#c-push-tot').textContent = N(pt) + ' dispositivi';
    $('#c-push').innerHTML = barra('Browser e PWA', ov.push_web, pm, N(ov.push_web), 'ok') + barra('App Android', ov.push_android, pm, N(ov.push_android), 'ok') + barra('App iPhone', ov.push_ios, pm, N(ov.push_ios), 'ok')
      + `<p class="muted small" style="margin:0">Inviate oggi a <b>${N(ov.push_ok_today)}</b> dispositivi · IA attiva in <b>${N(ov.ai_households)}</b> case</p>`;
    $('#c-res').innerHTML = barra('Database', ov.db_bytes, LIMITI.db, `${B(ov.db_bytes)} <small>/ 500 MB</small>`) + barra('Archivio file', ov.storage_bytes, LIMITI.storage, `${B(ov.storage_bytes)} <small>/ 1 GB · ${N(ov.files)} file</small>`) + barra('Utenti attivi al mese', ov.users, LIMITI.mau, `${N(ov.users)} <small>/ 50.000</small>`);
    animaBarre($('#v-panoramica'));
    // ultimi iscritti
    $('#c-last').innerHTML = users ? users.slice(0, 5).map((u, i) => liAnim(rigaUtente(u, true), i)).join('') || '<div class="pn-empty">Nessun utente</div>' : '<div class="pn-sk" style="height:180px"></div>';
    $$('#c-last .item').forEach(e => e.classList.add('pn-li'));
  }

  const chipPiano = u => { const s = statoPiano(u); return s === 'premium' ? `<span class="chip prem">${u.source === 'manual' ? 'Regalato' : 'Premium'}</span>` : s === 'prova' ? `<span class="chip soon" title="Prova ${esc(tra(u.expires_at))}">Prova · ${Math.max(0, Math.ceil((new Date(u.expires_at) - Date.now()) / 864e5))} gg</span>` : '<span class="chip">Gratis</span>'; };
  // riga utente a colonne fisse: avatar · email · piano · archivio · attività (tutto allineato in colonna)
  function rigaUtente(u, corta) {
    const att = fa(u.last_activity || u.last_sign_in_at);
    const sub = corta ? 'iscritto ' + fa(u.created_at) : `iscritto ${giorno(new Date(u.created_at))}${u.members > 1 ? ` · casa di ${u.members}` : ''}<span class="pn-only-m"> · attivo ${att}</span>`;
    return `<div class="item pn-u${corta ? ' pn-u-s' : ''}" data-u="${esc(u.user_id)}"><span class="pn-av${statoPiano(u) === 'premium' ? ' prem' : ''}">${esc(iniziale(u.email))}</span>
      <div class="main"><div class="t">${esc(u.email)}</div><div class="s">${sub}</div></div>
      <div class="pn-c pn-c-plan">${chipPiano(u)}</div>${corta ? '' : `<div class="pn-c pn-c-num">${B(u.storage_bytes)}</div><div class="pn-c pn-c-act">${att}</div>`}</div>`;
  }
  const testaUtenti = () => `<div class="pn-uh"><span></span><span>Utente</span><span>Piano</span><span class="r">Archivio</span><span class="r">Attività</span></div>`;
  function renderUtenti() {
    const box = $('#u-list'); if (!users) { box.innerHTML = '<div class="pn-sk" style="height:260px"></div>'; return; }
    const q = $('#u-q').value.trim().toLowerCase();
    const list = users.filter(u => (!q || String(u.email).toLowerCase().includes(q)) && (filtro === 'tutti' || statoPiano(u) === filtro));
    $('#u-count').textContent = list.length === users.length ? `${N(users.length)} utenti` : `${N(list.length)} di ${N(users.length)} utenti`;
    box.innerHTML = list.length ? testaUtenti() + list.slice(0, 300).map((u, i) => liAnim(rigaUtente(u), i)).join('') : '<div class="pn-empty">Nessun utente trovato</div>';
    $$('#u-list .item').forEach(e => e.classList.add('pn-li'));
    pillSeg();
  }
  function pillSeg() {
    const seg = $('#u-f'), on = seg.querySelector('button.on'); if (!on) return;
    let p = seg.querySelector('.pn-pill'); if (!p) { p = document.createElement('i'); p.className = 'pn-pill'; seg.prepend(p); }
    p.style.left = on.offsetLeft + 'px'; p.style.width = on.offsetWidth + 'px';
  }
  const ICO = {
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>'
  };
  function dettaglioUtente(id) {
    const u = (users || []).find(x => x.user_id === id); if (!u) return;
    const s = statoPiano(u), me = u.email && sessionEmail && u.email.toLowerCase() === sessionEmail.toLowerCase();
    const casa = u.members > 1 ? `Casa di ${u.members} persone` : 'Casa personale';
    const pianoTxt = s === 'gratis' ? 'Gratis' : s === 'prova' ? `Prova fino al ${giorno(new Date(u.expires_at))}` : u.source === 'manual' ? (u.expires_at ? `Regalato fino al ${giorno(new Date(u.expires_at))}` : 'Regalato per sempre') : `${u.source === 'apple' ? 'App Store' : u.source === 'google' ? 'Google Play' : 'Premium'}${u.product === 'premium_annuale' ? ' · annuale' : u.product ? ' · mensile' : ''}`;
    const lim = s === 'gratis' ? 104857600 : 2147483648, pct = Math.min(100, (Number(u.storage_bytes) || 0) / lim * 100);
    const riga = (k, v) => `<div class="pn-row"><span>${k}</span><b>${v}</b></div>`;
    const azione = (a, ico, t, d, extra) => `<button type="button" class="pn-action${extra || ''}" data-pa="${a}" data-hh="${esc(u.household_id)}" data-u="${esc(u.user_id)}"><span class="pn-ic">${ico}</span><span class="pn-action-t"><b>${t}</b><small>${d}</small></span><span class="pn-arrow">›</span></button>`;
    openSheet('', `
      <div class="pn-det-h"><span class="pn-av${s === 'premium' ? ' prem' : ''}">${esc(iniziale(u.email))}</span>
        <div class="pn-det-t"><b>${esc(u.email)}</b><small>${esc(casa)} · ${u.role === 'owner' ? 'proprietario' : 'membro'}</small></div>${chipPiano(u)}</div>
      <div class="pn-strip">
        <div><b>${N(u.records)}</b><small>voci della casa</small></div>
        <div><b>${N(u.devices)}</b><small>dispositivi</small></div>
        <div><b>${u.ai ? 'Sì' : 'No'}</b><small>IA attiva</small></div>
      </div>
      <div class="pn-sec"><h4>Attività</h4>
        ${riga('Iscritto', dataOra(D(u.created_at)))}${riga('Ultimo accesso', fa(u.last_sign_in_at))}${riga('Ultima attività', fa(u.last_activity))}${riga('Prova gratuita', u.trial_used ? 'Già usata' : 'Non usata')}
      </div>
      <div class="pn-sec"><h4>Piano e archivio</h4>
        ${riga('Piano', esc(pianoTxt))}
        <div class="pn-row pn-row-bar"><span>Archivio</span><b>${B(u.storage_bytes)} <small>di ${s === 'gratis' ? '100 MB' : '2 GB'}</small></b><div class="bar-track"><div class="bar-fill" data-w="${pct.toFixed(1)}"></div></div></div>
      </div>
      ${u.household_id ? `<div class="pn-sec"><h4>Cambia piano della casa</h4><div class="pn-actions">
        ${azione('regala', ICO.star, 'Regala Premium per sempre', 'Nessuna scadenza, per tutta la casa')}
        ${azione('mese', ICO.cal, 'Premium per 1 mese', 'Torna gratis da solo tra 30 giorni')}
        ${azione('anno', ICO.cal, 'Premium per 1 anno', 'Torna gratis da solo tra 12 mesi')}
        ${azione('prova7', ICO.plus, 'Allunga la prova di 7 giorni', s === 'prova' ? 'Si aggiunge ai giorni rimasti' : 'Attiva una prova da oggi')}
        ${s !== 'gratis' ? azione('gratis', ICO.back, 'Torna al piano gratis', 'Le funzioni Premium si bloccano, i dati restano') : ''}
      </div></div>` : ''}
      ${me ? '' : `<div class="pn-sec pn-danger"><h4>Zona pericolosa</h4>
        <button type="button" class="btn danger-ghost pn-del" data-pa="elimina" data-u="${esc(u.user_id)}" data-mail="${esc(u.email)}"><span>${ICO.trash}</span>Elimina account e dati</button>
        <p class="pn-note">Cancella account, casa (se è l'unico membro) e file. Non si può annullare.</p></div>`}
      <p class="pn-note pn-priv">Nel pannello non compaiono mai spese, importi o documenti degli utenti.</p>`);
    $('#sheet-form').classList.add('pn-det');
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#sheet-body .bar-fill[data-w]').forEach(b => (b.style.width = b.dataset.w + '%'))));
    if (!REDUCED) $$('#sheet-body .pn-sec, #sheet-body .pn-strip').forEach((e, i) => { e.style.setProperty('--d', (80 + i * 50) + 'ms'); e.classList.add('pn-in'); });
  }
  async function azionePiano(btn) {
    const a = btn.dataset.pa, hh = btn.dataset.hh;
    try {
      btn.disabled = true;
      if (a === 'regala') await rpc('admin_set_plan', { hh, p: 'premium', fino: null });
      if (a === 'mese' || a === 'anno') { const d = new Date(); if (a === 'mese') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1); await rpc('admin_set_plan', { hh, p: 'premium', fino: d.toISOString() }); }
      if (a === 'prova7') await rpc('admin_extend_trial', { hh, giorni: 7 });
      if (a === 'gratis') { if (!confirm('Riportare questa casa al piano gratis?')) { btn.disabled = false; return; } await rpc('admin_set_plan', { hh, p: 'free', fino: null }); }
      if (a === 'elimina') {
        const mail = btn.dataset.mail;
        if (prompt(`Per eliminare definitivamente l'account ${mail} e tutti i suoi dati scrivi ELIMINA`) !== 'ELIMINA') { btn.disabled = false; return toast('Eliminazione annullata'); }
        const data = await invoca({ azione: 'elimina_utente', user_id: btn.dataset.u });
        closeSheet(); toast(`Account eliminato${data.file ? ` · ${data.file} file cancellati` : ''}`); await carica(true); return;
      }
      toast('Piano aggiornato'); const uid = btn.dataset.u; await carica(true); dettaglioUtente(uid);
    } catch (e) { toast(e.message); btn.disabled = false; }
  }

  function renderAbbonamenti() {
    if (!ov || !users) return;
    const anim = primo.abbonamenti; primo.abbonamenti = false;
    const case_ = casePremium();
    const paganti = case_.filter(u => u.plan === 'premium' && (u.source === 'apple' || u.source === 'google'));
    const mrr = paganti.reduce((a, u) => a + (PREZZI[u.product] || PREZZI.premium_mensile), 0) * 0.85;
    countTo($('#a-mrr'), mrr, EUR); countTo($('#a-paid'), ov.plan_paid); countTo($('#a-trial'), ov.plan_trial); countTo($('#a-man'), ov.plan_manual);
    $('#a-trial-s').textContent = ov.trials_expiring ? `${N(ov.trials_expiring)} scadono entro 3 giorni` : 'nessuna in scadenza a breve';
    const prove = case_.filter(u => statoPiano(u) === 'prova').sort((a, b) => String(a.expires_at).localeCompare(String(b.expires_at)));
    $('#a-exp').innerHTML = prove.slice(0, 8).map((u, i) => liAnim(rigaUtente(u, true).replace(/iscritto [^<]+/, 'scade ' + tra(u.expires_at) + ' · ' + giorno(new Date(u.expires_at))), i)).join('') || '<div class="pn-empty">Nessuna prova in corso</div>';
    const conv = ov.trials_used ? Math.round(ov.plan_paid / ov.trials_used * 100) : 0;
    $('#a-conv').innerHTML = `<div class="pn-conv"><div class="pn-ring"><svg viewBox="0 0 42 42"><circle class="tr" cx="21" cy="21" r="15.9"/><circle class="vl" cx="21" cy="21" r="15.9" pathLength="100"/></svg><b>${conv}%</b></div>
      <p>${N(ov.plan_paid)} abbonati su ${N(ov.trials_used)} prove attivate</p></div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => { const c = $('#a-conv .vl'); if (c) c.style.strokeDashoffset = 100 - Math.min(100, conv); }));
    const prem = case_.filter(u => statoPiano(u) === 'premium');
    $('#a-list-n').textContent = N(prem.length) + ' case';
    $('#a-list').innerHTML = prem.length ? testaUtenti() + prem.map((u, i) => liAnim(rigaUtente(u), i)).join('') : '<div class="pn-empty">Ancora nessuna casa Premium</div>';
    $$('#v-abbonamenti .item').forEach(e => e.classList.add('pn-li'));
    if (anim) {}
  }

  function renderInviti() {
    const box = $('#i-list'); if (!inviti) { box.innerHTML = '<div class="pn-sk" style="height:200px"></div>'; return; }
    $('#i-n').textContent = `${N(inviti.filter(i => i.stato === 'attivo').length)} attivi · ${N(inviti.filter(i => i.stato === 'usato').length)} usati`;
    box.innerHTML = inviti.map((v, i) => liAnim(`<div class="item"><span class="pn-ic"><svg viewBox="0 0 24 24"><path d="M3 12l18-8-6 18-3-7z"/><path d="M12 15l9-11"/></svg></span>
      <div class="main"><div class="t" style="font-variant-numeric:tabular-nums;letter-spacing:.08em">${esc(String(v.code).replace(/(\d{3})(\d{3})/, '$1 $2'))}</div>
      <div class="s">da ${esc(v.da || '—')}${v.usato_da ? ' → ' + esc(v.usato_da) : ''} · ${v.stato === 'usato' ? 'usato ' + fa(v.used_at) : v.stato === 'attivo' ? 'scade ' + tra(v.expires_at) : 'scaduto ' + fa(v.expires_at)}</div></div>
      <span class="chip ${v.stato === 'attivo' ? 'paid' : v.stato === 'usato' ? '' : 'late'}">${v.stato === 'attivo' ? 'Attivo' : v.stato === 'usato' ? 'Usato' : 'Scaduto'}</span></div>`, i)).join('') || '<div class="pn-empty">Nessun codice d\'invito</div>';
    $$('#i-list .item').forEach(e => e.classList.add('pn-li'));
  }

  const LINK = [
    ['Supabase · tabelle', 'https://supabase.com/dashboard/project/yxfrevixckortffogmbb/editor', 'M4 5h16v14H4zM4 10h16M10 10v9'],
    ['Supabase · utenti', 'https://supabase.com/dashboard/project/yxfrevixckortffogmbb/auth/users', 'M9 8a3.5 3.5 0 1 0 0 .1M2.5 20a6.5 6.5 0 0 1 13 0'],
    ['Supabase · registri notifiche', 'https://supabase.com/dashboard/project/yxfrevixckortffogmbb/functions/notifiche/logs', 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5'],
    ['Firebase', 'https://console.firebase.google.com/project/spese-casa-e151f', 'M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-5 3-7 6-11z'],
    ['Google Play Console', 'https://play.google.com/console', 'M6 3l13 9-13 9z'],
    ['App Store Connect', 'https://appstoreconnect.apple.com', 'M12 3l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z'],
    ['GitHub · compilazioni', 'https://github.com/attrezzatidario-web/spese-casa/actions', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 12l2 2 4-4'],
    ['Apri l\'app', './', 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5']
  ];
  function renderSistema() {
    $('#s-links').innerHTML = LINK.map(([t, u, d]) => `<a class="item" href="${u}" target="_blank" rel="noopener"><span class="pn-ic"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></span><div class="main"><div class="t">${esc(t)}</div></div><span class="pn-arrow">›</span></a>`).join('');
    if (!sys) { $('#s-runs').innerHTML = '<div class="pn-sk" style="grid-column:1/-1;height:44px"></div>'; return; }
    const runs = (sys.runs || []).slice(0, 24).reverse();
    const vuoti = Math.max(0, 24 - runs.length);
    $('#s-runs').innerHTML = Array.from({ length: vuoti }, (_, i) => `<i class="no" style="--d:${i * 15}ms"></i>`).join('') + runs.map((r, i) => `<i class="${r.status === 'succeeded' ? '' : 'ko'}" style="--d:${(vuoti + i) * 15}ms" title="${esc(dataOra(D(r.start_time)) + ' · ' + (r.status === 'succeeded' ? 'ok' : r.status))}"></i>`).join('');
    const ko = runs.filter(r => r.status !== 'succeeded').length, last = (sys.runs || [])[0];
    $('#s-runs-t').innerHTML = last ? `Ultimo giro <b>${fa(last.start_time)}</b> · ${ko ? `<span style="color:var(--danger)">${ko} non riusciti</span>` : 'tutti riusciti'}` : 'Nessun giro registrato (l\'orologio parte al minuto 5 di ogni ora).';
    $('#s-resp').innerHTML = (sys.responses || []).slice(0, 8).map((r, i) => {
      const body = String(r.body || ''); let info;
      const err = body.match(/"error"\s*:\s*"([^"]+)"/), nc = body.match(/"case"\s*:\s*(\d+)/);
      let inv = 0; (body.match(/"inviate"\s*:\s*\[[^\]]*\]/g) || []).forEach(m => (inv += (m.match(/"ok"/g) || []).length));
      info = err ? err[1] : nc ? `${nc[1]} case controllate · ${inv} notifiche inviate` : body.slice(0, 90);
      const okk = r.status_code >= 200 && r.status_code < 300;
      return liAnim(`<div class="item"><span class="chip ${okk ? 'paid' : 'late'}">${esc(r.status_code || '—')}</span><div class="main"><div class="t">${fa(r.created)}</div><div class="s pn-code">${esc(info)}</div></div></div>`, i);
    }).join('') || '<div class="pn-empty">Nessuna risposta recente</div>';
    $$('#s-resp .item').forEach(e => e.classList.add('pn-li'));
  }

  /* ---------- avvisi push: nuovi iscritti ---------- */
  const VAPID_PUBLIC = 'BOmeNL_VFB4WwSPylaBuisV2pi0A-GsmoeJK2CgeLpZVQ_HczJIn5T0wgKijQlFQPCECjPKFCApTyqzkruYu28c';
  const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64uKey = k => { const p = '='.repeat((4 - k.length % 4) % 4), b = atob((k + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const swReg = () => ('serviceWorker' in navigator && location.protocol !== 'file:') ? navigator.serviceWorker.register('sw.js').catch(() => null) : Promise.resolve(null);
  const iscrizione = async () => { try { const r = await navigator.serviceWorker.getRegistration(); return r ? await r.pushManager.getSubscription() : null; } catch (e) { return null; } };
  const invoca = async (body, giro) => {
    const { data: ss } = await sb.auth.getSession();
    const tok = ss && ss.session && ss.session.access_token;
    const { data, error } = await sb.functions.invoke('admin', { body, headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
    // sessione scaduta: la rinnovo e riprovo una volta
    if (!giro && error && error.context && error.context.status === 401) { await sb.auth.refreshSession().catch(() => {}); return invoca(body, true); }
    let msg = error && error.message; if (error) { try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {} }
    if (error || !data || !data.ok) throw new Error(msg || (data && data.error) || 'Operazione non riuscita');
    return data;
  };
  async function statoAvvisi() {
    const box = $('#av-on'); if (!box) return;
    const lab = box.closest('.pn-avv'), sub = $('#av-s');
    const blocca = t => { box.checked = false; box.disabled = true; lab.classList.add('off'); sub.textContent = t; $('#av-f').hidden = true; };
    if (IOS && !STANDALONE) return blocca('Su iPhone: apri il pannello in Safari, Condividi › Aggiungi a schermata Home, poi attiva da lì.');
    if (!pushOk()) return blocca('Questo browser non supporta le notifiche.');
    if (Notification.permission === 'denied') return blocca('Notifiche bloccate: riattivale dalle impostazioni del browser per questo sito.');
    box.disabled = false; lab.classList.remove('off');
    const s = await iscrizione();
    box.checked = !!s; $('#av-f').hidden = !s;
    sub.textContent = s ? 'Attivi: ti avviso qui ogni volta che qualcuno crea un account.' : 'Ricevi una notifica ogni volta che qualcuno crea un account.';
    rpc('admin_push_count').then(n => { $('#av-n').textContent = n ? `${n} ${n === 1 ? 'dispositivo' : 'dispositivi'}` : ''; }).catch(() => {});
  }
  async function attivaAvvisi(on) {
    const box = $('#av-on'); box.disabled = true;
    try {
      if (on) {
        if (await Notification.requestPermission() !== 'granted') throw new Error('Permesso negato');
        await swReg(); const reg = await navigator.serviceWorker.ready;
        let s = await reg.pushManager.getSubscription();
        if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uKey(VAPID_PUBLIC) });
        await rpc('admin_push_save', { s: s.toJSON() });
        toast('Avvisi attivati');
      } else {
        const s = await iscrizione();
        if (s) { await rpc('admin_push_delete', { ep: s.endpoint }).catch(() => {}); await s.unsubscribe().catch(() => {}); }
        toast('Avvisi disattivati');
      }
    } catch (e) {
      toast(/function|schema cache|does not exist/i.test(e.message) ? 'Prima esegui il file 09_avvisi_iscritti.sql su Supabase' : e.message);
    }
    await statoAvvisi();
  }
  $('#av-on').addEventListener('change', e => attivaAvvisi(e.target.checked));
  $('#av-prova').onclick = async () => {
    const b = $('#av-prova'); b.disabled = true;
    try { const r = await invoca({ azione: 'prova_avvisi' }); toast(r.inviate ? 'Prova inviata · guarda le notifiche' : 'Nessun dispositivo ha ricevuto la prova'); }
    catch (e) { toast(e.message); }
    b.disabled = false;
  };

  /* ---------- caricamento dati e tempo reale ---------- */
  let caricando = false;
  // aggiornamento in sottofondo: se i dati non cambiano non si tocca niente;
  // se cambiano, si aggiorna senza animazioni d'ingresso (niente "lampo" ogni 20 secondi)
  let firma = '';
  const ANIMATI = '.pn-li, .pn-in, .mk-anim, .mk-chip, .mk-card, .mk-g-bar, .pn-chart .bar, .mk-band, .mk-band-top, .pn-runs i, .mk-swap';
  const quieto = fn => {
    document.body.classList.add('pn-quiet');
    try { fn(); } finally {
      // i nuovi elementi restano fermi: animazioni e transizioni spente solo su di loro
      $$('main ' + ANIMATI.split(', ').join(', main ')).forEach(el => (el.style.animation = 'none'));
      $$('main .pn-chart .line').forEach(el => { el.style.animation = 'none'; el.style.strokeDashoffset = '0'; });
      $$('main .pn-chart .area').forEach(el => { el.style.animation = 'none'; el.style.opacity = '1'; });
      $$('main .bar-fill, main .mk-can-bar i, main .pn-seg-bar i').forEach(el => (el.style.transition = 'none'));
      document.body.classList.remove('pn-quiet');
    }
  };
  async function carica(tutto, silenzioso) {
    if (caricando) return; caricando = true; if (!silenzioso) $('#pn-ref').classList.add('rot');
    try {
      const jobs = [rpc('admin_overview').then(d => (ov = d))];
      if (tutto || view === 'utenti' || view === 'abbonamenti' || view === 'panoramica' || !users) jobs.push(rpc('admin_users', { q: '', lim: 500, off: 0 }).then(d => (users = d || [])));
      if (tutto || view === 'inviti' || !inviti) jobs.push(rpc('admin_invites').then(d => (inviti = d || [])));
      if (tutto || view === 'sistema' || !sys) jobs.push(rpc('admin_system').then(d => (sys = d)));
      if (window.PNM && (view === 'marketing' || tutto)) jobs.push(window.PNM.load().catch(e => { if (!/non autorizzato/i.test(e.message)) console.warn(e); }));
      await Promise.all(jobs);
      aggiornato = new Date(); $$('.pn-live').forEach(e => e.classList.remove('off'));
      const nuova = JSON.stringify([ov && { ...ov, now: null }, users, inviti, sys]);
      const cambiato = nuova !== firma; firma = nuova;
      if (!silenzioso) render();
      else if (cambiato && view !== 'marketing') quieto(render);
      else sottotitolo();
    } catch (e) {
      $$('.pn-live').forEach(x => x.classList.add('off'));
      if (/non autorizzato/i.test(e.message)) return nonAutorizzato();
      toast(/Failed to fetch|NetworkError/i.test(e.message) ? 'Connessione assente' : e.message);
    } finally { caricando = false; $('#pn-ref').classList.remove('rot'); }
  }
  setInterval(() => { if (!document.hidden && !$('#app').hidden) carica(false, true); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#app').hidden) carica(false, true); });
  setInterval(sottotitolo, 15000);

  /* ---------- accesso ---------- */
  let sessionEmail = '', loginEmail = '';
  const err = m => { const e = $('#login-err'); e.textContent = m || ''; e.hidden = !m; };
  function step(n) { $('#login-step1').hidden = n !== 1; $('#login-step2').hidden = n !== 2; err(''); setTimeout(() => (n === 1 ? $('#login-email') : $('#login-code')).focus(), 60); }
  function mostraLogin(msg) { $('#app').hidden = true; $('#setup').hidden = false; $('#login-msg').textContent = msg || 'Accesso riservato al proprietario dell\'app.'; step(1); }
  async function nonAutorizzato() { await sb.auth.signOut({ scope: 'local' }).catch(() => {}); mostraLogin('Questo account non è autorizzato ad aprire il pannello.'); }
  async function entra() {
    const { data } = await sb.auth.getSession(); const s = data && data.session;
    if (!s) return mostraLogin();
    sessionEmail = s.user.email || '';
    // controllo amministratore: se la rete o il token scaduto danno errore NON esco dall'account,
    // rinnovo la sessione e riprovo; esco solo se il server dice chiaramente "non sei amministratore"
    let ok = null;
    for (let giro = 0; giro < 3 && ok === null; giro++) {
      try { ok = await rpc('is_app_admin'); }
      catch (e) {
        if (/function|schema cache|does not exist/i.test(e.message)) return mostraLogin('Il pannello non è ancora attivo sul server: esegui il file 08_pannello.sql su Supabase.');
        await sb.auth.refreshSession().catch(() => {});
        await new Promise(r => setTimeout(r, 800 * (giro + 1)));
      }
    }
    if (ok === null) { $('#setup').hidden = true; $('#app').hidden = false; route(); toast('Connessione assente: riprovo da solo'); setTimeout(entra, 8000); return; }
    if (ok !== true) return nonAutorizzato();
    $('#setup').hidden = true; $('#app').hidden = false;
    route(); carica(true); swReg(); statoAvvisi();
  }
  $('#login-send').onclick = async () => {
    const email = $('#login-email').value.trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) return err('Email non valida');
    $('#login-send').disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    $('#login-send').disabled = false;
    if (error) return err(/not found|signups not allowed|Signups/i.test(error.message) ? 'Questo account non è autorizzato' : error.message);
    loginEmail = email; step(2); $('#login-msg').textContent = 'Ti abbiamo mandato un codice: controlla la posta (anche lo spam).';
  };
  $('#login-go').onclick = async () => {
    const token = $('#login-code').value.replace(/\D/g, ''); if (token.length < 6) return err('Inserisci il codice');
    $('#login-go').disabled = true;
    const { error } = await sb.auth.verifyOtp({ email: loginEmail, token, type: 'email' });
    $('#login-go').disabled = false;
    if (error) return err('Codice non valido o scaduto');
    entra();
  };
  $('#login-email').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login-send').click(); });
  $('#login-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login-go').click(); });
  $('#login-back').onclick = () => step(1);
  $('#pn-out').onclick = async () => { await sb.auth.signOut({ scope: 'local' }).catch(() => {}); location.reload(); };
  $('#pn-ref').onclick = () => carica(true);

  /* ---------- eventi ---------- */
  window.addEventListener('hashchange', route);
  $('#u-q').addEventListener('input', () => renderUtenti());
  $('#u-f').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; filtro = b.dataset.f; $$('#u-f button').forEach(x => x.classList.toggle('on', x === b)); renderUtenti(); });
  document.addEventListener('click', e => {
    const pa = e.target.closest('[data-pa]'); if (pa) { azionePiano(pa); return; }
    const u = e.target.closest('[data-u].pn-u'); if (u) { dettaglioUtente(u.dataset.u); return; }
    const g = e.target.closest('[data-go]'); if (g) { location.hash = g.dataset.go; }
  });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (view === 'panoramica' && ov) { barChart($('#c-sign'), ov.signups_30 || [], ['iscritto', 'iscritti']); lineChart($('#c-act'), ov.active_30 || [], ['utente attivo', 'utenti attivi']); } pillSeg(); }, 200); });

  /* ---------- apertura animata ---------- */
  (function apertura() {
    const sp = $('#pn-splash'); if (!sp) return;
    if (REDUCED) { sp.remove(); return; }
    let chiusa = false;
    const chiudi = () => {
      if (chiusa) return; chiusa = true;
      sp.classList.add('out');
      // il pannello vero prende il posto delle sagome: numeri e grafici ripartono
      if (!$('#app').hidden) {
        $$('#v-' + view + ' .big[data-n]').forEach(e => (e.dataset.n = 0));
        primo[view] = true; render();
      }
      setTimeout(() => sp.remove(), 500);
    };
    sp.addEventListener('click', chiudi);
    setTimeout(chiudi, 2650);
  })();

  // strumenti condivisi con il modulo Marketing (pannello-marketing.js)
  window.PN = { sb, $, $$, esc, N, EUR, giorno, fa, tra, toast, openSheet, closeSheet, countTo, liAnim, stagger, rpc, showTip, hideTip, niceMax, animaBarre, REDUCED, inviaPush: () => sb.functions.invoke('admin', { body: { azione: 'prova_avvisi' } }), view: () => view, overview: () => ov, quieto, rerender: () => { if (view === 'marketing') render(); } };

  entra();
})();
