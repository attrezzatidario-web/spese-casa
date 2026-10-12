/* Spese Casa — pannello, sezione Marketing
   Campagne pubblicitarie, calendario editoriale, bacheca dei contenuti e link tracciati.
   Dati nelle tabelle mk_campagne / mk_contenuti (solo amministratori), file nella cartella privata "marketing". */
(function () {
  'use strict';
  const P = window.PN; if (!P) return;
  const { sb, $, $$, esc, N, EUR, toast, openSheet, closeSheet, countTo, showTip, hideTip, niceMax, REDUCED } = P;

  /* ---------- costanti ---------- */
  const APP_URL = 'https://attrezzatidario-web.github.io/spese-casa/';
  const BUCKET = 'marketing';
  // icone dei canali: segno bianco su fondo del colore del canale (disegnate qui, niente immagini esterne)
  const GLYPH = {
    instagram: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.8"/><circle cx="16.9" cy="7.1" r="1.1" class="fill"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24"><path d="M13.5 4v10.8a3.3 3.3 0 1 1-3.3-3.3"/><path d="M13.5 4c.3 2.5 2 4.2 4.8 4.4"/></svg>',
    facebook: '<svg viewBox="0 0 24 24"><path d="M14.6 20.5v-7.3h2.4l.4-2.9h-2.8V8.6c0-.8.3-1.4 1.5-1.4h1.4V4.6a19 19 0 0 0-2.2-.1c-2.2 0-3.7 1.3-3.7 3.8v2h-2.4v2.9h2.4v7.3" class="fill"/></svg>',
    youtube: '<svg viewBox="0 0 24 24"><rect x="3.2" y="6.2" width="17.6" height="11.6" rx="3.6"/><path d="M10.4 9.4v5.2l4.5-2.6z" class="fill"/></svg>',
    sito: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.3 2.4 3.4 5 3.4 8s-1.1 5.6-3.4 8c-2.3-2.4-3.4-5-3.4-8S9.7 6.4 12 4z"/></svg>',
    store: '<svg viewBox="0 0 24 24"><rect x="6.5" y="3" width="11" height="18" rx="2.8"/><path d="M10.5 18h3"/></svg>',
    email: '<svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="12" rx="2.5"/><path d="M4.5 7.5l7.5 5.5 7.5-5.5"/></svg>',
    altro: '<svg viewBox="0 0 24 24"><circle cx="6.5" cy="12" r="1.5" class="fill"/><circle cx="12" cy="12" r="1.5" class="fill"/><circle cx="17.5" cy="12" r="1.5" class="fill"/></svg>'
  };
  const CANALI = {
    instagram: { n: 'Instagram', c: '#E1306C', bg: 'linear-gradient(45deg,#F9A13A 0%,#E1306C 45%,#8A3AB9 100%)' },
    tiktok: { n: 'TikTok', c: '#14b8b0', bg: '#111214' },
    facebook: { n: 'Facebook', c: '#1877F2' },
    youtube: { n: 'YouTube', c: '#FF2D2D' },
    sito: { n: 'Sito', c: '#17795a' },
    store: { n: 'App Store e Play', c: '#0A84FF' },
    email: { n: 'Email', c: '#8b5cf6' },
    altro: { n: 'Altro', c: '#8a948f' }
  };
  const TIPI = {
    reel: ['Reel', '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 9.5v5l4-2.5z"/></svg>'],
    video: ['Video', '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3"/></svg>'],
    post: ['Post', '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9.5" cy="9.5" r="1.8"/><path d="M20 15l-4.5-4.5L6 20"/></svg>'],
    carosello: ['Carosello', '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="12" height="14" rx="2.5"/><path d="M3 7.5v9M21 7.5v9"/></svg>'],
    storia: ['Storia', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.4"/><path d="M12 8v8M8 12h8"/></svg>'],
    articolo: ['Articolo', '<svg viewBox="0 0 24 24"><path d="M6 3.5h9l3 3v14H6z"/><path d="M9 10h6M9 13.5h6M9 17h4"/></svg>'],
    email: ['Email', GLYPH.email],
    documento: ['Documento', '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/></svg>'],
    annuncio: ['Annuncio', '<svg viewBox="0 0 24 24"><path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>']
  };
  const STATI = [['idea', 'Idee', '#a3aca7'], ['lavorazione', 'In lavorazione', '#f59e0b'], ['pronto', 'Pronto', '#0A84FF'], ['pubblicato', 'Pubblicato', '#17795a']];
  const STATO = Object.fromEntries(STATI.map(s => [s[0], s]));
  const OBIETTIVI = { iscrizioni: 'Nuovi iscritti', premium: 'Abbonamenti Premium', notorieta: 'Farsi conoscere', altro: 'Altro' };
  const COLORI = ['#17795a', '#0A84FF', '#8b5cf6', '#E1306C', '#f59e0b', '#14b8b0', '#ef4444', '#64748b'];
  const ICO = {
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/></svg>',
    clip: '<svg viewBox="0 0 24 24"><path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    money: '<svg viewBox="0 0 24 24"><path d="M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="M3 7l12-3v3M16 13.5h2"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>',
    target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/></svg>',
    megaphone: '<svg viewBox="0 0 24 24"><path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.8 6a8.5 8.5 0 0 1 0 12"/></svg>'
  };

  /* ---------- stato ---------- */
  let campagne = null, contenuti = null, stats = null, errore = '';
  let tab = 'panoramica';
  try { tab = localStorage.getItem('pn_mk_tab') || 'panoramica'; } catch (e) {}
  const oggiD = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parse = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const oggi = () => ymd(oggiD());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diffGiorni = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const gg = s => parse(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const ggLungo = s => parse(s).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const quando = s => { const d = diffGiorni(oggi(), s); return d === 0 ? 'oggi' : d === 1 ? 'domani' : d === -1 ? 'ieri' : d > 1 && d < 7 ? parse(s).toLocaleDateString('it-IT', { weekday: 'long' }) : gg(s); };
  let mese = (() => { const d = oggiD(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  let giornoSel = oggi();

  const canale = k => CANALI[k] || CANALI.altro;
  const icoCanale = (k, cls) => {
    const c = canale(k), g = GLYPH[CANALI[k] ? k : 'altro'];
    return `<span class="mk-ch ${cls || ''}" style="--cb:${c.bg || c.c}" title="${esc(c.n)}">${g}</span>`;
  };
  const statoCamp = c => { const t = oggi(); if (c.inizio > t) return ['arrivo', 'In arrivo', 'soon']; if (c.fine && c.fine < t) return ['fine', 'Conclusa', '']; return ['attiva', 'Attiva', 'paid']; };
  const linkCamp = c => c.codice ? APP_URL + '?ref=' + encodeURIComponent(c.codice) : '';
  const iscrittiCamp = c => (stats && stats.codici && c.codice && Number(stats.codici[String(c.codice).toLowerCase()])) || 0;
  const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const campById = id => (campagne || []).find(c => c.id === id);
  const sbErr = r => { if (r.error) throw new Error(/relation|does not exist|schema cache/i.test(r.error.message) ? 'Esegui prima il file 10_marketing.sql su Supabase' : r.error.message); return r.data; };

  /* ---------- dati ---------- */
  async function load() {
    try {
      const da = addDays(oggi(), -89);
      const [a, b, c] = await Promise.all([
        sb.from('mk_campagne').select('*').order('inizio', { ascending: false }),
        sb.from('mk_contenuti').select('*').order('data', { ascending: true }),
        sb.rpc('admin_marketing', { da, a: oggi() })
      ]);
      campagne = sbErr(a) || []; contenuti = sbErr(b) || []; stats = sbErr(c) || null; errore = '';
    } catch (e) { errore = e.message; if (!campagne) campagne = []; if (!contenuti) contenuti = []; }
    if (P.view() === 'marketing') render(false);
  }

  /* ---------- schede ---------- */
  function render(primo) {
    if (campagne === null) { $('#mk-body').innerHTML = '<div class="pn-sk" style="height:320px"></div>'; load(); return; }
    pill();
    const body = $('#mk-body');
    if (errore) { body.innerHTML = `<div class="card mk-empty"><div class="mk-empty-ic">${ICO.megaphone}</div><h3>Marketing non ancora attivo</h3><p class="muted">${esc(errore)}</p></div>`; return; }
    const html = tab === 'calendario' ? vistaCalendario() : tab === 'campagne' ? vistaCampagne() : tab === 'contenuti' ? vistaContenuti() : vistaPanoramica();
    const cambio = body.dataset.tab !== tab;
    body.dataset.tab = tab;
    body.innerHTML = html;
    if (primo || cambio) entrata(body);
    dopo(primo || cambio);
  }
  function entrata(root) {
    if (REDUCED) return;
    root.classList.remove('mk-swap'); void root.offsetWidth; root.classList.add('mk-swap');
    $$('#mk-body .mk-anim').forEach((el, i) => el.style.setProperty('--d', Math.min(i, 18) * 45 + 'ms'));
  }
  function dopo(anim) {
    if (tab === 'panoramica') {
      const k = kpi();
      countTo($('#mk-k-spesa'), k.spesa, v => EUR(v)); countTo($('#mk-k-isc'), k.isc); countTo($('#mk-k-prog'), k.prog);
      $('#mk-k-cpa').textContent = k.cpa != null ? EUR(k.cpa) : '—';
      grafico($('#mk-chart'));
    }
    if (tab === 'campagne') requestAnimationFrame(() => requestAnimationFrame(() => $$('#mk-body [data-w]').forEach(b => (b.style.width = b.dataset.w + '%'))));
    if (tab === 'panoramica') requestAnimationFrame(() => requestAnimationFrame(() => $$('#mk-body [data-w]').forEach(b => (b.style.width = b.dataset.w + '%'))));
    if (tab === 'contenuti') bindKanban();
    if (tab === 'calendario') bindCalendario();
  }
  function pill() {
    const seg = $('#mk-tabs'); $$('#mk-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    const on = seg.querySelector('button.on'); if (!on) return;
    let p = seg.querySelector('.pn-pill'); if (!p) { p = document.createElement('i'); p.className = 'pn-pill'; seg.prepend(p); }
    p.style.left = on.offsetLeft + 'px'; p.style.width = on.offsetWidth + 'px';
  }

  /* ---------- PANORAMICA ---------- */
  function kpi() {
    const spesa = campagne.reduce((a, c) => a + Number(c.spesa || 0), 0), budget = campagne.reduce((a, c) => a + Number(c.budget || 0), 0);
    const isc = stats ? Number(stats.tracciati || 0) : 0;
    const t = oggi(), fra7 = addDays(t, 7);
    const prossimi = contenuti.filter(c => c.data && c.data >= t && c.data <= fra7 && c.stato !== 'pubblicato');
    return { spesa, budget, isc, cpa: isc ? spesa / isc : null, prog: prossimi.length, daPrep: prossimi.filter(c => c.stato === 'idea' || c.stato === 'lavorazione').length };
  }
  function vistaPanoramica() {
    const k = kpi(), t = oggi();
    const attive = campagne.filter(c => statoCamp(c)[0] === 'attiva');
    const prossimi = contenuti.filter(c => c.data && c.data >= t && c.stato !== 'pubblicato').slice(0, 6);
    const vuoto = !campagne.length && !contenuti.length;
    return `
      ${vuoto ? `<div class="card mk-hello mk-anim"><div class="mk-hello-ic">${ICO.megaphone}</div><div><h3>Benvenuto nel Marketing</h3><p class="muted">Crea una campagna per avere il suo link tracciato, poi programma i contenuti nel calendario: qui vedrai quanti iscritti porta ogni campagna e quanto ti costano.</p></div><div class="mk-hello-a"><button class="btn primary" data-mk="nuova-campagna">Crea la prima campagna</button></div></div>` : ''}
      <div class="kpis pn-kpis mk-kpis">
        <div class="card kpi kpi-hero mk-anim"><div class="kpi-h"><span class="label">Spesa campagne</span><span class="kpi-ic">${ICO.money}</span></div><div id="mk-k-spesa" class="big" data-n="0">0 €</div><span class="muted small">${k.budget ? 'su ' + EUR(k.budget) + ' di budget' : 'nessun budget impostato'}</span></div>
        <div class="card kpi mk-anim"><div class="kpi-h"><span class="label">Iscritti dai link</span><span class="kpi-ic">${ICO.user}</span></div><div id="mk-k-isc" class="big" data-n="0">0</div><span class="muted small">${stats ? 'su ' + N(stats.utenti) + ' utenti totali' : ''}</span></div>
        <div class="card kpi mk-anim"><div class="kpi-h"><span class="label">Costo per iscritto</span><span class="kpi-ic">${ICO.target}</span></div><div id="mk-k-cpa" class="big">—</div><span class="muted small">spesa ÷ iscritti dai link</span></div>
        <div class="card kpi mk-anim link-card" data-mktab="calendario"><div class="kpi-h"><span class="label">Prossimi 7 giorni</span><span class="kpi-ic">${ICO.cal}</span></div><div id="mk-k-prog" class="big" data-n="0">0</div><span class="muted small">${k.daPrep ? `<span class="chip soon">${k.daPrep} da preparare</span>` : 'pubblicazioni in programma'}</span></div>
      </div>
      <div class="pn-grid">
        <div class="pn-col">
          <div class="card mk-anim">
            <div class="card-h"><h3>Iscritti e campagne</h3><span class="muted small">ultimi 90 giorni</span></div>
            <div id="mk-chart" class="pn-chart mk-chart"></div>
            <div class="mk-legend">${campagne.filter(c => c.inizio <= t && (!c.fine || c.fine >= addDays(t, -89))).slice(0, 6).map(c => `<span><i style="background:${esc(c.colore)}"></i>${esc(c.nome)}</span>`).join('') || '<span class="muted">Le campagne compariranno come fasce colorate sul grafico</span>'}</div>
          </div>
          <div class="card mk-anim">
            <div class="card-h"><h3>Contenuti per canale</h3><span class="muted small">ultimi 30 giorni e prossimi 30</span></div>
            ${perCanale()}</div>
          </div>
        </div>
        <div class="pn-col">
          <div class="card mk-anim">
            <div class="card-h"><h3>Prossime pubblicazioni</h3><button class="link-btn" data-mktab="calendario">Calendario</button></div>
            <div class="list">${prossimi.map(rigaContenuto).join('') || `<div class="pn-empty">Niente in programma · <button class="link-btn" data-mk="nuovo-contenuto">aggiungi</button></div>`}</div>
          </div>
          <div class="card mk-anim">
            <div class="card-h"><h3>Campagne attive</h3><button class="link-btn" data-mktab="campagne">Tutte</button></div>
            <div class="mk-act-list">${attive.map(barraCampagna).join('') || '<div class="pn-empty">Nessuna campagna in corso</div>'}</div>
          </div>
        </div>
      </div>`;
  }
  function perCanale() {
    const t = oggi(), a = addDays(t, -30), b = addDays(t, 30);
    const per = {}; contenuti.filter(c => c.data && c.data >= a && c.data <= b).forEach(c => { const k = CANALI[c.canale] ? c.canale : 'altro'; (per[k] = per[k] || { fatti: 0, prog: 0 }); if (c.stato === 'pubblicato' || c.data < t) per[k].fatti++; else per[k].prog++; });
    const righe = Object.entries(per).sort((x, y) => (y[1].fatti + y[1].prog) - (x[1].fatti + x[1].prog));
    if (!righe.length) return '<div class="pn-empty">Nessun contenuto con data in questo periodo</div>';
    const max = Math.max(...righe.map(([, v]) => v.fatti + v.prog));
    return `<div class="mk-canali">${righe.map(([k, v]) => `<div class="mk-can">${icoCanale(k)}<div class="mk-can-m"><div class="mk-can-t"><span>${esc(canale(k).n)}</span><b>${N(v.fatti + v.prog)}</b></div>
      <div class="mk-can-bar"><i class="f" style="background:${canale(k).c}" data-w="${(v.fatti / max * 100).toFixed(1)}"></i><i class="p" style="background:${canale(k).c}" data-w="${(v.prog / max * 100).toFixed(1)}"></i></div></div></div>`).join('')}
      <div class="mk-can-leg"><span><i class="f"></i>pubblicati o passati</span><span><i class="p"></i>in programma</span></div></div>`;
  }
  function rigaContenuto(c) {
    const ti = TIPI[c.tipo] || TIPI.post, st = STATO[c.stato] || STATI[0], cp = campById(c.campagna_id);
    return `<div class="item mk-row" data-cont="${esc(c.id)}"><span class="mk-tipo">${ti[1]}${icoCanale(c.canale, 'sm')}</span>
      <div class="main"><div class="t">${esc(c.titolo)}</div><div class="s">${esc(ti[0])} · ${esc(canale(c.canale).n)}${cp ? ` · <i class="mk-dot" style="background:${esc(cp.colore)}"></i>${esc(cp.nome)}` : ''}</div></div>
      <div class="mk-when">${c.data ? `<b>${esc(quando(c.data))}</b><small>${c.ora ? esc(c.ora) : esc(gg(c.data))}</small>` : '<b class="muted">Senza data</b><small>da programmare</small>'}<i class="mk-st" style="--sc:${st[2]}" title="${esc(st[1])}"></i></div></div>`;
  }
  function barraCampagna(c) {
    const pct = c.budget > 0 ? Math.min(100, c.spesa / c.budget * 100) : 0;
    const resta = c.fine ? diffGiorni(oggi(), c.fine) : null;
    return `<div class="mk-act" data-camp="${esc(c.id)}"><div class="mk-act-h"><i class="mk-dot lg" style="background:${esc(c.colore)}"></i><b>${esc(c.nome)}</b><span class="muted small">${resta == null ? 'senza fine' : resta === 0 ? 'ultimo giorno' : 'ancora ' + resta + ' gg'}</span></div>
      <div class="bar-track"><div class="bar-fill" style="background:${esc(c.colore)}" data-w="${pct.toFixed(1)}"></div></div>
      <div class="mk-act-f"><span>${EUR(c.spesa)}${c.budget > 0 ? ' di ' + EUR(c.budget) : ''}</span><span><b>${N(iscrittiCamp(c))}</b> iscritti</span></div></div>`;
  }

  // grafico: iscritti al giorno con le campagne come fasce colorate dietro
  function grafico(el) {
    if (!el) return;
    const serie = (stats && stats.giorni) || [];
    if (!serie.length) { el.innerHTML = '<div class="pn-empty">Dati non disponibili</div>'; return; }
    const W = Math.max(280, el.clientWidth || 600), H = el.clientHeight || 220, L = 30, Bm = 24, T = 26;
    const max = niceMax(Math.max(1, ...serie.map(x => x.n))), n = serie.length, slot = (W - L) / n, bw = Math.max(2, Math.min(14, slot * .6));
    const y = v => T + (H - T - Bm) * (1 - v / max);
    const idx = s => serie.findIndex(p => String(p.d).slice(0, 10) === s);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = max * i / 4, yy = y(v); g += `<line class="gl" x1="${L}" x2="${W}" y1="${yy}" y2="${yy}"/><text class="ax" x="${L - 8}" y="${yy + 4}" text-anchor="end">${N(v)}</text>`; }
    // fasce delle campagne (una riga di etichette in alto, si sovrappongono con trasparenza)
    let bande = '', lab = '', riga = 0;
    const primo = String(serie[0].d).slice(0, 10), ultimo = String(serie[n - 1].d).slice(0, 10);
    campagne.filter(c => c.inizio <= ultimo && (!c.fine || c.fine >= primo)).slice(0, 6).forEach((c, k) => {
      const a = Math.max(0, idx(c.inizio < primo ? primo : c.inizio)), b = c.fine && c.fine < ultimo ? idx(c.fine) : n - 1;
      if (a < 0 || b < 0) return;
      const x1 = L + slot * a, x2 = L + slot * (b + 1);
      bande += `<rect class="mk-band" style="--d:${k * 120}ms;fill:${esc(c.colore)}" x="${x1}" y="${T - 6}" width="${Math.max(2, x2 - x1)}" height="${H - T - Bm + 6}" rx="6"/>`;
      lab += `<rect class="mk-band-top" style="--d:${k * 120}ms;fill:${esc(c.colore)}" x="${x1}" y="${4 + (riga % 2) * 9}" width="${Math.max(2, x2 - x1)}" height="5" rx="2.5"/>`;
      riga++;
    });
    let bars = '', labs = '';
    serie.forEach((p, i) => {
      const x = L + slot * i + (slot - bw) / 2, v = Math.max(p.n, 0), yy = p.n ? y(v) : H - Bm - 2, h = Math.max(2, H - Bm - yy), r = Math.min(3, bw / 2, h);
      bars += `<path class="bar${p.n ? '' : ' zero'}" data-i="${i}" style="--d:${Math.min(i, 60) * 9}ms" d="M${x},${H - Bm} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z"/>`;
      if (i % Math.ceil(n / 6) === 0 || i === n - 1) labs += `<text class="ax" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${gg(String(p.d).slice(0, 10))}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Iscritti al giorno e periodi delle campagne">${bande}${lab}${g}${bars}${labs}<rect class="hit" x="${L}" y="0" width="${W - L}" height="${H}"/></svg>`;
    const svg = el.querySelector('svg');
    const move = ev => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * W / r.width, i = Math.max(0, Math.min(n - 1, Math.floor((x - L) / slot)));
      el.classList.add('hov'); svg.querySelectorAll('.bar').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
      const p = serie[i], d = String(p.d).slice(0, 10), att = campagne.filter(c => c.inizio <= d && (!c.fine || c.fine >= d));
      showTip(r.left + (L + slot * i + slot / 2) * r.width / W, r.top + y(Math.max(p.n, 0)) * r.height / H,
        `<b>${N(p.n)}</b> ${p.n === 1 ? 'iscritto' : 'iscritti'}<small>${parse(d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' })}</small>${att.map(c => `<small class="mk-tip-c"><i style="background:${esc(c.colore)}"></i>${esc(c.nome)}</small>`).join('')}`);
    };
    const leave = () => { el.classList.remove('hov'); hideTip(); };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', leave);
  }

  /* ---------- CALENDARIO ---------- */
  const NOMI_G = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  function vistaCalendario() {
    const y = mese.getFullYear(), m = mese.getMonth();
    const primo = new Date(y, m, 1), off = (primo.getDay() + 6) % 7, giorni = new Date(y, m + 1, 0).getDate();
    const celle = Math.ceil((off + giorni) / 7) * 7, t = oggi();
    let html = '';
    for (let i = 0; i < celle; i++) {
      const d = new Date(y, m, i - off + 1), s = ymd(d), fuori = d.getMonth() !== m;
      const items = contenuti.filter(c => c.data === s);
      const camps = campagne.filter(c => c.inizio <= s && (!c.fine || c.fine >= s)).slice(0, 3);
      html += `<div class="mk-day${fuori ? ' out' : ''}${s === t ? ' today' : ''}${s === giornoSel ? ' sel' : ''}${s < t ? ' past' : ''}" data-day="${s}">
        <div class="mk-day-h"><span class="mk-dn">${d.getDate()}</span><span class="mk-day-c">${camps.map(c => `<i style="background:${esc(c.colore)}" title="${esc(c.nome)}"></i>`).join('')}</span><button class="mk-day-add" data-addday="${s}" aria-label="Aggiungi">${ICO.plus}</button></div>
        <div class="mk-day-l">${items.slice(0, 3).map((c, k) => chipCal(c, k)).join('')}${items.length > 3 ? `<span class="mk-more">+${items.length - 3}</span>` : ''}</div>
        <div class="mk-dots">${items.slice(0, 4).map(c => `<i style="background:${canale(c.canale).c}"></i>`).join('')}</div></div>`;
    }
    const delMese = contenuti.filter(c => c.data && c.data.slice(0, 7) === ymd(primo).slice(0, 7));
    const senzaData = contenuti.filter(c => !c.data && c.stato !== 'pubblicato');
    const sel = contenuti.filter(c => c.data === giornoSel);
    return `<div class="card mk-anim mk-cal-card">
          <div class="mk-cal-top">
            <div class="mk-cal-nav"><button class="icon-btn" data-mese="-1" aria-label="Mese precedente">${ICO.left}</button><h3 class="mk-mese">${esc(primo.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }))}</h3><button class="icon-btn" data-mese="1" aria-label="Mese successivo">${ICO.right}</button></div>
            <div class="mk-cal-r"><span class="muted small">${N(delMese.length)} contenuti nel mese</span><button class="btn sm" data-mese="0">Oggi</button></div>
          </div>
          <div class="mk-week">${NOMI_G.map(g => `<span>${g}</span>`).join('')}</div>
          <div class="mk-cal" id="mk-cal">${html}</div>
          <p class="muted small mk-hint">Trascina un contenuto su un altro giorno per spostarlo · tocca un giorno per vederne i dettagli</p>
      </div>
      <div class="mk-cal-below">
        <div class="card mk-anim" id="mk-daycard">
          <div class="card-h"><h3 class="mk-sel-t">${esc(ggLungo(giornoSel).replace(/^./, x => x.toUpperCase()))}</h3><button class="btn sm" data-addday="${giornoSel}">+ Aggiungi</button></div>
          <div class="list">${sel.map(rigaContenuto).join('') || '<div class="pn-empty">Niente in questo giorno</div>'}</div>
        </div>
        ${senzaData.length ? `<div class="card mk-anim"><div class="card-h"><h3>Senza data</h3><span class="muted small">trascinali sul calendario</span></div><div class="list mk-nodate">${senzaData.map(c => rigaContenuto(c).replace('class="item mk-row"', 'class="item mk-row" draggable="true"')).join('')}</div></div>` : ''}
      </div>`;
  }
  const chipCal = (c, k) => { const st = STATO[c.stato] || STATI[0]; return `<div class="mk-chip${c.stato === 'pubblicato' ? ' done' : ''}" draggable="true" data-cont="${esc(c.id)}" style="--cc:${canale(c.canale).c};--d:${k * 40}ms" title="${esc(c.titolo)} · ${esc(st[1])}"><span class="mk-chip-t">${c.ora ? `<b>${esc(c.ora)}</b> ` : ''}${esc(c.titolo)}</span></div>`; };

  let dragId = null;
  function bindCalendario() {
    const cal = $('#mk-cal'); if (!cal) return;
    $$('#mk-body [draggable=true][data-cont]').forEach(el => {
      el.addEventListener('dragstart', e => { dragId = el.dataset.cont; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) {} });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); $$('.mk-day.drop').forEach(d => d.classList.remove('drop')); });
    });
    $$('#mk-cal .mk-day').forEach(day => {
      day.addEventListener('dragover', e => { if (!dragId) return; e.preventDefault(); day.classList.add('drop'); });
      day.addEventListener('dragleave', () => day.classList.remove('drop'));
      day.addEventListener('drop', e => { e.preventDefault(); day.classList.remove('drop'); const id = dragId; dragId = null; if (id) sposta(id, { data: day.dataset.day }, 'Spostato a ' + quando(day.dataset.day)); });
    });
  }
  async function sposta(id, campi, msg) {
    const c = contenuti.find(x => x.id === id); if (!c) return;
    const prima = { ...c };
    if (Object.keys(campi).every(k => c[k] === campi[k])) return;
    Object.assign(c, campi); render(false);
    const r = await sb.from('mk_contenuti').update({ ...campi, updated_at: new Date().toISOString() }).eq('id', id);
    if (r.error) { Object.assign(c, prima); render(false); toast(r.error.message); return; }
    if (msg) toast(msg);
    const el = document.querySelector(`#mk-body [data-cont="${CSS.escape(id)}"]`); if (el && !REDUCED) { el.classList.add('mk-landed'); }
  }

  /* ---------- CAMPAGNE ---------- */
  function vistaCampagne() {
    if (!campagne.length) return `<div class="card mk-empty mk-anim"><div class="mk-empty-ic">${ICO.target}</div><h3>Nessuna campagna</h3><p class="muted">Una campagna raccoglie budget, canali e risultati, e ti dà un link tracciato: chi si iscrive da quel link viene contato qui.</p><button class="btn primary" data-mk="nuova-campagna">Crea una campagna</button></div>`;
    return `<div class="card mk-anim"><div class="card-h"><h3>Linea del tempo</h3><span class="muted small">${N(campagne.length)} campagne</span></div>${gantt()}</div>
      <div class="mk-camps">${campagne.map(schedaCampagna).join('')}</div>`;
  }
  function gantt() {
    const t = oggi();
    let a = campagne.reduce((m, c) => c.inizio < m ? c.inizio : m, addDays(t, -30));
    let b = campagne.reduce((m, c) => (c.fine || addDays(c.inizio, 30)) > m ? (c.fine || addDays(c.inizio, 30)) : m, addDays(t, 45));
    a = ymd(new Date(parse(a).getFullYear(), parse(a).getMonth(), 1));
    const bd = parse(b); b = ymd(new Date(bd.getFullYear(), bd.getMonth() + 1, 0));
    const tot = diffGiorni(a, b) + 1, pos = s => Math.max(0, Math.min(100, diffGiorni(a, s) / tot * 100));
    let mesi = '', d = parse(a);
    while (ymd(d) <= b) { const s = ymd(d), fineM = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); mesi += `<span style="left:${pos(s)}%;width:${pos(fineM < b ? addDays(fineM, 1) : addDays(b, 1)) - pos(s)}%">${esc(d.toLocaleDateString('it-IT', { month: 'short' }))}</span>`; d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
    const righe = [...campagne].sort((x, y) => x.inizio.localeCompare(y.inizio)).map((c, i) => {
      const fine = c.fine || b, l = pos(c.inizio), w = Math.max(1.2, pos(addDays(fine, 1)) - l), st = statoCamp(c);
      return `<div class="mk-g-row"><span class="mk-g-n" title="${esc(c.nome)}">${esc(c.nome)}</span><div class="mk-g-track"><button class="mk-g-bar ${st[0]}" data-camp="${esc(c.id)}" style="left:${l}%;width:${w}%;--cc:${esc(c.colore)};--d:${i * 90}ms" title="${esc(c.nome)} · ${esc(gg(c.inizio))} → ${c.fine ? esc(gg(c.fine)) : 'senza fine'}"><span>${esc(gg(c.inizio))} → ${c.fine ? esc(gg(c.fine)) : '…'}</span></button></div></div>`;
    }).join('');
    return `<div class="mk-gantt"><div class="mk-g-head"><span class="mk-g-n"></span><div class="mk-g-track">${mesi}</div></div>${righe}
      <div class="mk-g-today" style="--x:${pos(t)}"><i></i><span>oggi</span></div></div>`;
  }
  function schedaCampagna(c) {
    const st = statoCamp(c), isc = iscrittiCamp(c), pct = c.budget > 0 ? Math.min(100, c.spesa / c.budget * 100) : 0, link = linkCamp(c);
    const met = [['Iscritti dal link', N(isc)], ['Costo per iscritto', isc ? EUR(c.spesa / isc) : '—'], ['Click', N(c.click)], ['Installazioni', N(c.installazioni)]];
    return `<div class="card mk-camp mk-anim" style="--cc:${esc(c.colore)}">
      <div class="mk-camp-h"><i class="mk-camp-c"></i><div class="mk-camp-t"><h3>${esc(c.nome)}</h3><span class="muted small">${esc(OBIETTIVI[c.obiettivo] || c.obiettivo)} · ${esc(gg(c.inizio))} → ${c.fine ? esc(gg(c.fine)) : 'senza fine'}</span></div><span class="chip ${st[2]}">${st[1]}</span></div>
      <div class="mk-camp-ch">${(c.canali || []).map(k => `<span class="mk-pill">${icoCanale(k, 'sm')}${esc(canale(k).n)}</span>`).join('') || '<span class="muted small">Nessun canale</span>'}</div>
      <div class="mk-budget"><div class="bar-top"><span>Budget</span><b>${EUR(c.spesa)} <small>${c.budget > 0 ? 'di ' + EUR(c.budget) : ''}</small></b></div><div class="bar-track"><div class="bar-fill" style="background:var(--cc)" data-w="${pct.toFixed(1)}"></div></div></div>
      <div class="mk-met">${met.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>
      ${link ? `<div class="mk-link"><span class="mk-link-ic">${ICO.link}</span><code title="${esc(link)}"><span class="mk-link-dom">…/spese-casa/</span>?ref=<b>${esc(c.codice)}</b></code><button class="btn sm" data-copy="${esc(link)}">${ICO.copy}Copia</button></div>` : ''}
      <div class="mk-camp-f"><button class="btn sm" data-camp="${esc(c.id)}">Modifica</button><button class="link-btn" data-campcont="${esc(c.id)}">${(n => n === 1 ? '1 contenuto' : N(n) + ' contenuti')(contenuti.filter(x => x.campagna_id === c.id).length)}</button></div>
    </div>`;
  }

  /* ---------- CONTENUTI (bacheca) ---------- */
  function vistaContenuti() {
    return `<div class="mk-kanban">${STATI.map(([k, nome, col]) => {
      const list = contenuti.filter(c => (c.stato || 'idea') === k).sort((a, b) => (a.data || '9999').localeCompare(b.data || '9999') || (a.ordine - b.ordine));
      return `<div class="mk-col mk-anim" data-stato="${k}" style="--sc:${col}"><div class="mk-col-h"><i></i><b>${esc(nome)}</b><span>${N(list.length)}</span></div>
        <div class="mk-col-l">${list.map(cardKanban).join('')}<div class="mk-drop-ph"></div></div>
        <button class="mk-col-add" data-addstato="${k}">${ICO.plus}Aggiungi</button></div>`;
    }).join('')}</div>`;
  }
  function cardKanban(c) {
    const ti = TIPI[c.tipo] || TIPI.post, cp = campById(c.campagna_id), t = oggi();
    const ritardo = c.data && c.data < t && c.stato !== 'pubblicato';
    return `<div class="mk-card" draggable="true" data-cont="${esc(c.id)}" style="--cc:${canale(c.canale).c}">
      <div class="mk-card-h"><span class="mk-card-tipo">${ti[1]}${esc(ti[0])}</span>${icoCanale(c.canale, 'sm')}</div>
      <b class="mk-card-t">${esc(c.titolo)}</b>
      <div class="mk-card-f">${c.data ? `<span class="${ritardo ? 'late-t' : ''}">${ICO.cal}${esc(quando(c.data))}${c.ora ? ' · ' + esc(c.ora) : ''}</span>` : '<span class="muted">senza data</span>'}
        ${cp ? `<span class="mk-card-cp" title="${esc(cp.nome)}"><i class="mk-dot" style="background:${esc(cp.colore)}"></i>${esc(cp.nome)}</span>` : ''}
        <span class="mk-card-ic">${c.file_path ? ICO.clip : ''}${c.link ? ICO.link : ''}</span></div></div>`;
  }
  function bindKanban() {
    $$('#mk-body .mk-card').forEach(el => {
      el.addEventListener('dragstart', e => { dragId = el.dataset.cont; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) {} });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); $$('.mk-col.drop').forEach(d => d.classList.remove('drop')); });
    });
    $$('#mk-body .mk-col').forEach(col => {
      col.addEventListener('dragover', e => { if (!dragId) return; e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
      col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('drop'); const id = dragId; dragId = null; if (id) sposta(id, { stato: col.dataset.stato }, STATO[col.dataset.stato][1]); });
    });
  }

  /* ---------- MODULI ---------- */
  const opt = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(Array.isArray(v) ? v[0] : (v.n || v))}</option>`).join('');
  function formContenuto(c, pre) {
    const nuovo = !c;
    c = c || { titolo: '', tipo: 'reel', canale: 'instagram', stato: 'idea', data: '', ora: '', campagna_id: null, link: '', file_path: '', file_nome: '', note: '', ...(pre || {}) };
    let rimuoviFile = false;
    openSheet(nuovo ? 'Nuovo contenuto' : 'Modifica contenuto', `
      <label class="f"><span>Titolo</span><input name="titolo" required placeholder="Es. Reel: scansiona lo scontrino in 3 secondi" value="${esc(c.titolo)}" data-focus></label>
      <div class="f"><span class="f-l">Canale</span><div class="mk-pick">${Object.entries(CANALI).map(([k, v]) => `<label><input type="radio" name="canale" value="${k}"${k === c.canale ? ' checked' : ''}><span>${icoCanale(k, 'sm')}${esc(v.n)}</span></label>`).join('')}</div></div>
      <div class="f-row"><label class="f"><span>Tipo</span><select name="tipo">${opt(TIPI, c.tipo)}</select></label><label class="f"><span>Stato</span><select name="stato">${STATI.map(([k, n]) => `<option value="${k}"${k === c.stato ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
      <div class="f-row"><label class="f"><span>Data di pubblicazione</span><input type="date" name="data" value="${esc(c.data || '')}"></label><label class="f"><span>Ora</span><input type="time" name="ora" value="${esc(c.ora || '')}"></label></div>
      <label class="f"><span>Campagna</span><select name="campagna_id"><option value="">Nessuna</option>${campagne.map(x => `<option value="${esc(x.id)}"${x.id === c.campagna_id ? ' selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label class="f"><span>Link (video su Drive, YouTube, post pubblicato…)</span><input name="link" type="url" inputmode="url" placeholder="https://" value="${esc(c.link || '')}"></label>
      <div class="f"><span class="f-l">Allegato · immagini o PDF fino a 10 MB</span>
        <div class="mk-file" id="mk-file">${c.file_path ? `<span class="mk-file-n">${ICO.file}<a href="#" data-apri="${esc(c.file_path)}">${esc(c.file_nome || 'file')}</a></span><button type="button" class="link-btn" id="mk-file-x">Rimuovi</button>` : '<span class="muted small">Nessun file</span>'}
          <label class="btn sm mk-file-b">${ICO.clip}${c.file_path ? 'Sostituisci' : 'Allega'}<input type="file" name="file" accept="image/*,application/pdf" hidden></label></div></div>
      <label class="f"><span>Note</span><textarea name="note" rows="3" placeholder="Testo del post, hashtag, idee per il video…">${esc(c.note || '')}</textarea></label>`, {
      ok: nuovo ? 'Aggiungi' : 'Salva',
      onSubmit: async fd => {
        const titolo = String(fd.get('titolo') || '').trim(); if (!titolo) { toast('Scrivi un titolo'); return false; }
        const f = fd.get('file');
        const row = { titolo, tipo: fd.get('tipo'), canale: fd.get('canale') || 'altro', stato: fd.get('stato'), data: fd.get('data') || null, ora: fd.get('ora') || '', campagna_id: fd.get('campagna_id') || null, link: String(fd.get('link') || '').trim(), note: String(fd.get('note') || '').trim(), updated_at: new Date().toISOString() };
        if (f && f.size) {
          if (f.size > 10485760) { toast('File troppo grande: massimo 10 MB. Per i video usa un link.'); return false; }
          if (!/^image\/|application\/pdf/.test(f.type)) { toast('Solo immagini o PDF. Per i video usa un link.'); return false; }
          const path = `${new Date().getFullYear()}/${Date.now().toString(36)}-${slug(f.name.replace(/\.[^.]+$/, '')) || 'file'}.${(f.name.split('.').pop() || 'bin').toLowerCase()}`;
          const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
          if (up.error) { toast(/bucket|not found/i.test(up.error.message) ? 'Esegui prima il file 10_marketing.sql su Supabase' : up.error.message); return false; }
          if (c.file_path) sb.storage.from(BUCKET).remove([c.file_path]).catch(() => {});
          Object.assign(row, { file_path: path, file_nome: f.name, file_tipo: f.type, file_size: f.size });
        } else if (rimuoviFile && c.file_path) {
          sb.storage.from(BUCKET).remove([c.file_path]).catch(() => {});
          Object.assign(row, { file_path: '', file_nome: '', file_tipo: '', file_size: 0 });
        }
        const r = nuovo ? await sb.from('mk_contenuti').insert(row).select().single() : await sb.from('mk_contenuti').update(row).eq('id', c.id).select().single();
        const salvato = sbErr(r);
        if (nuovo) contenuti.push(salvato); else Object.assign(contenuti.find(x => x.id === c.id) || {}, salvato);
        contenuti.sort((a, b) => (a.data || '9999').localeCompare(b.data || '9999'));
        if (salvato.data) { giornoSel = salvato.data; if (tab === 'calendario') mese = new Date(parse(salvato.data).getFullYear(), parse(salvato.data).getMonth(), 1); }
        toast(nuovo ? 'Contenuto aggiunto' : 'Contenuto salvato'); render(false);
      },
      onDelete: nuovo ? null : async () => {
        if (!confirm('Eliminare questo contenuto?')) return false;
        sbErr(await sb.from('mk_contenuti').delete().eq('id', c.id));
        if (c.file_path) sb.storage.from(BUCKET).remove([c.file_path]).catch(() => {});
        contenuti = contenuti.filter(x => x.id !== c.id); toast('Contenuto eliminato'); render(false);
      }
    });
    const x = $('#mk-file-x'); if (x) x.onclick = () => { rimuoviFile = true; $('#mk-file').querySelector('.mk-file-n').classList.add('gone'); x.remove(); };
    const fi = $('#sheet-body input[name=file]'); fi.addEventListener('change', () => { const f = fi.files[0]; if (!f) return; const lab = fi.closest('label'); lab.firstChild && (lab.querySelector('svg').nextSibling.textContent = ' ' + (f.name.length > 22 ? f.name.slice(0, 20) + '…' : f.name)); });
  }

  function formCampagna(c) {
    const nuova = !c;
    c = c || { nome: '', obiettivo: 'iscrizioni', canali: ['instagram'], inizio: oggi(), fine: addDays(oggi(), 30), budget: 0, spesa: 0, impression: 0, click: 0, installazioni: 0, codice: '', colore: COLORI[(campagne || []).length % COLORI.length], note: '' };
    const num = v => String(v == null ? '' : v);
    openSheet(nuova ? 'Nuova campagna' : c.nome, `
      <label class="f"><span>Nome</span><input name="nome" required placeholder="Es. Lancio autunno" value="${esc(c.nome)}" data-focus></label>
      <div class="f-row"><label class="f"><span>Obiettivo</span><select name="obiettivo">${opt(OBIETTIVI, c.obiettivo)}</select></label>
        <div class="f"><span class="f-l">Colore</span><div class="mk-colors">${COLORI.map(k => `<label><input type="radio" name="colore" value="${k}"${k === c.colore ? ' checked' : ''}><span style="background:${k}"></span></label>`).join('')}</div></div></div>
      <div class="f"><span class="f-l">Canali</span><div class="mk-pick multi">${Object.entries(CANALI).map(([k, v]) => `<label><input type="checkbox" name="canali" value="${k}"${(c.canali || []).includes(k) ? ' checked' : ''}><span>${icoCanale(k, 'sm')}${esc(v.n)}</span></label>`).join('')}</div></div>
      <div class="f-row"><label class="f"><span>Inizio</span><input type="date" name="inizio" required value="${esc(c.inizio)}"></label><label class="f"><span>Fine</span><input type="date" name="fine" value="${esc(c.fine || '')}"></label></div>
      <div class="f-row"><label class="f"><span>Budget (€)</span><input name="budget" inputmode="decimal" value="${esc(num(c.budget))}"></label><label class="f"><span>Speso finora (€)</span><input name="spesa" inputmode="decimal" value="${esc(num(c.spesa))}"></label></div>
      <div class="mk-res"><span class="f-l">Risultati dai social (li inserisci tu)</span><div class="f-row f-row3"><label class="f"><span>Visualizzazioni</span><input name="impression" inputmode="numeric" value="${esc(num(c.impression))}"></label><label class="f"><span>Click</span><input name="click" inputmode="numeric" value="${esc(num(c.click))}"></label><label class="f"><span>Installazioni</span><input name="installazioni" inputmode="numeric" value="${esc(num(c.installazioni))}"></label></div></div>
      <label class="f"><span>Codice del link tracciato</span><div class="mk-code"><span>…/spese-casa/?ref=</span><input name="codice" placeholder="lancio-autunno" value="${esc(c.codice || '')}" autocapitalize="off"></div><div class="hint muted" id="mk-code-h">Chi si iscrive da questo link viene contato nella campagna.</div></label>
      <label class="f"><span>Note</span><textarea name="note" rows="2" placeholder="Pubblico, messaggio, cosa provare…">${esc(c.note || '')}</textarea></label>`, {
      ok: nuova ? 'Crea campagna' : 'Salva',
      onSubmit: async fd => {
        const nome = String(fd.get('nome') || '').trim(); if (!nome) { toast('Scrivi il nome'); return false; }
        const n = v => { const x = parseFloat(String(v || '0').replace(/\./g, '').replace(',', '.')); return isNaN(x) ? 0 : Math.max(0, x); };
        const inizio = fd.get('inizio'), fine = fd.get('fine') || null;
        if (fine && fine < inizio) { toast('La fine è prima dell\'inizio'); return false; }
        let codice = slug(fd.get('codice')) || slug(nome);
        if (campagne.some(x => x.id !== c.id && x.codice === codice)) codice = codice.slice(0, 25) + '-' + Math.random().toString(36).slice(2, 5);
        const row = { nome, obiettivo: fd.get('obiettivo'), colore: fd.get('colore') || COLORI[0], canali: fd.getAll('canali'), inizio, fine, budget: n(fd.get('budget')), spesa: n(fd.get('spesa')), impression: Math.round(n(fd.get('impression'))), click: Math.round(n(fd.get('click'))), installazioni: Math.round(n(fd.get('installazioni'))), codice, note: String(fd.get('note') || '').trim(), updated_at: new Date().toISOString() };
        const r = nuova ? await sb.from('mk_campagne').insert(row).select().single() : await sb.from('mk_campagne').update(row).eq('id', c.id).select().single();
        const salvata = sbErr(r);
        if (nuova) campagne.unshift(salvata); else Object.assign(campagne.find(x => x.id === c.id) || {}, salvata);
        campagne.sort((a, b) => b.inizio.localeCompare(a.inizio));
        toast(nuova ? 'Campagna creata · link pronto da copiare' : 'Campagna salvata');
        if (nuova && tab !== 'campagne') { tab = 'campagne'; salvaTab(); }
        render(false);
      },
      onDelete: nuova ? null : async () => {
        if (!confirm(`Eliminare la campagna "${c.nome}"? I contenuti collegati restano, senza campagna.`)) return false;
        sbErr(await sb.from('mk_campagne').delete().eq('id', c.id));
        campagne = campagne.filter(x => x.id !== c.id); contenuti.forEach(x => { if (x.campagna_id === c.id) x.campagna_id = null; });
        toast('Campagna eliminata'); render(false);
      },
      wide: true
    });
    const nomeI = $('#sheet-body [name=nome]'), codI = $('#sheet-body [name=codice]'); let tocco = !!c.codice;
    codI.addEventListener('input', () => (tocco = true));
    nomeI.addEventListener('input', () => { if (!tocco) codI.value = slug(nomeI.value); });
  }

  async function apriFile(path) {
    const r = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
    if (r.error || !r.data) return toast(r.error ? r.error.message : 'File non trovato');
    window.open(r.data.signedUrl, '_blank', 'noopener');
  }
  const salvaTab = () => { try { localStorage.setItem('pn_mk_tab', tab); } catch (e) {} };

  /* ---------- eventi ---------- */
  $('#mk-tabs').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (!b || b.dataset.t === tab) return; tab = b.dataset.t; salvaTab(); render(false); });
  document.addEventListener('click', e => {
    if (!e.target.closest('#v-marketing') && !e.target.closest('#sheet')) return;
    const t = e.target;
    const tb = t.closest('[data-mktab]'); if (tb) { tab = tb.dataset.mktab; salvaTab(); render(false); return; }
    const a = t.closest('[data-mk]'); if (a) { if (a.dataset.mk === 'nuova-campagna') formCampagna(); else formContenuto(null, tab === 'calendario' ? { data: giornoSel } : null); return; }
    const cp = t.closest('[data-copy]'); if (cp) { e.preventDefault(); (navigator.clipboard ? navigator.clipboard.writeText(cp.dataset.copy) : Promise.reject()).then(() => toast('Link copiato'), () => prompt('Copia il link', cp.dataset.copy)); return; }
    const ap = t.closest('[data-apri]'); if (ap) { e.preventDefault(); apriFile(ap.dataset.apri); return; }
    const ad = t.closest('[data-addday]'); if (ad) { e.stopPropagation(); formContenuto(null, { data: ad.dataset.addday }); return; }
    const as = t.closest('[data-addstato]'); if (as) { formContenuto(null, { stato: as.dataset.addstato }); return; }
    const cc = t.closest('[data-campcont]'); if (cc) { tab = 'contenuti'; salvaTab(); render(false); return; }
    const ca = t.closest('[data-camp]'); if (ca) { const c = campById(ca.dataset.camp); if (c) formCampagna(c); return; }
    const co = t.closest('[data-cont]'); if (co && !t.closest('#sheet')) { const c = contenuti.find(x => x.id === co.dataset.cont); if (c) formContenuto(c); return; }
    const me = t.closest('[data-mese]'); if (me) { const v = +me.dataset.mese; const d = oggiD(); mese = v === 0 ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date(mese.getFullYear(), mese.getMonth() + v, 1); if (v === 0) giornoSel = oggi(); render(false); const cal = $('#mk-cal'); if (cal && !REDUCED) { cal.classList.add(v < 0 ? 'from-l' : 'from-r'); } return; }
    const dy = t.closest('.mk-day[data-day]'); if (dy) { giornoSel = dy.dataset.day; render(false); const dc = $('#mk-daycard'); if (dc && innerWidth < 900) dc.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); if (dc && !REDUCED) { dc.classList.remove('mk-flash'); void dc.offsetWidth; dc.classList.add('mk-flash'); } return; }
  });
  window.addEventListener('resize', () => { clearTimeout(window.__mkrz); window.__mkrz = setTimeout(() => { if (P.view() === 'marketing') { pill(); if (tab === 'panoramica') grafico($('#mk-chart')); } }, 200); });

  window.PNM = { render, load };
  P.rerender();
})();
