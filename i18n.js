/* Spese Casa — lingue dell'app
   L'app è scritta in italiano; per le altre lingue questo file traduce al volo tutto quello che compare
   sullo schermo (testi, segnaposto, avvisi), usando i dizionari in i18n/<lingua>.js.
   I dati salvati (categorie, metodi, note…) restano gli stessi: cambia solo come vengono mostrati. */
(function () {
  'use strict';
  const LINGUE = { it: 'Italiano', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch' };
  const LOCALE = { it: 'it-IT', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' };
  const VERSIONE = '3';
  let lang = 'it';
  try { const l = localStorage.getItem('sc_lang'); if (l && LINGUE[l]) lang = l; } catch (e) {}
  // prima volta: nessuna scelta salvata → resta l'italiano (come richiesto), la scelta si fa all'accesso
  const I = window.I18N = {
    LINGUE, lang, loc: LOCALE[lang],
    set(l) { if (!LINGUE[l]) return; try { localStorage.setItem('sc_lang', l); } catch (e) {} location.reload(); },
    t: s => s, tf: (s, v) => fill(s, v), dict: null
  };
  document.documentElement.lang = lang;
  if (lang === 'it') return;
  // dizionario della lingua scelta (caricato subito, prima dell'app)
  document.write(`<script src="i18n/${lang}.js?v=${VERSIONE}"><\/script>`);

  function fill(s, v) { return v ? String(s).replace(/\{(\d+)\}/g, (m, i) => (v[i] != null ? v[i] : m)) : s; }

  // ---------- motore ----------
  let D = null, PAT = [], PREF = [], cache = new Map(), inPref = false;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const LEAD = /^[\s·•\-–—:,;|(]+/, TRAIL = /[\s·•\-–—:,;|(.!?…]+$/;
  function prepara() {
    D = window.I18N_DICT || {};
    PAT = [];
    for (const k of Object.keys(D)) {
      if (!/\{\d+\}/.test(k)) continue;
      const parti = k.split(/(\{\d+\})/);
      const ord = [];
      // segnaposto attaccato a lettere (desinenze italiane: "pagament{1}") = solo 0-3 lettere;
      // segnaposto dopo un altro segnaposto può essere vuoto; gli altri almeno un carattere
      const re = parti.map((p, i) => {
        const m = p.match(/^\{(\d+)\}$/); if (!m) return esc(p);
        ord.push(+m[1]);
        const prima = parti[i - 1] || '';
        if (/[A-Za-zÀ-ÿ]$/.test(prima)) return '([a-zà-ÿ]{0,3})';
        if (prima === '' && i > 1) return '(.*?)';
        return '(.+?)';
      }).join('');
      PAT.push({ re: new RegExp('^' + re + '$'), ord, out: D[k], peso: k.replace(/\{\d+\}/g, '').length });
    }
    PAT.sort((a, b) => b.peso - a.peso);
    PREF = Object.keys(D).filter(k => !/\{\d+\}/.test(k) && k.length >= 3 && /^[A-ZÀ-Ýa-zà-ý]/.test(k)).sort((a, b) => b.length - a.length);
  }
  function base(s) {
    if (D[s] != null) return D[s];
    if (D[s + '.'] != null) return D[s + '.'].replace(/\.$/, '');
    // maiuscola/minuscola iniziale diversa
    const lo = s.charAt(0).toLowerCase() + s.slice(1), up = s.charAt(0).toUpperCase() + s.slice(1);
    if (lo !== s && D[lo] != null) { const r = D[lo]; return r.charAt(0).toUpperCase() + r.slice(1); }
    if (up !== s && D[up] != null) { const r = D[up]; return r.charAt(0).toLowerCase() + r.slice(1); }
    for (const p of PAT) {
      const m = s.match(p.re); if (!m) continue;
      const v = {}; p.ord.forEach((n, i) => { const x = m[i + 1]; v[n] = /[A-Za-zÀ-ÿ]{2}/.test(x) ? (trad(x) || x) : x; });
      return fill(p.out, v);
    }
    // "3 spese", "12 mesi": numero + parola nota
    const nm = s.match(/^([\d.,]+\s?)(\D.*)$/); if (nm && D[nm[2]] != null) return nm[1] + D[nm[2]];
    // testo composto in codice ("Pagato il 12 ott", "Scade il 5 nov"): inizio noto + resto
    for (const k of PREF) {
      if (s.length > k.length + 1 && s.startsWith(k) && s.charAt(k.length) === ' ') {
        const resto = s.slice(k.length + 1);
        // il resto non può a sua volta essere spezzato (evita frasi miste)
        if (inPref) continue;
        inPref = true; let tr; try { tr = trad(resto); } finally { inPref = false; }
        // il resto deve essere tradotto, oppure una data/numero: niente frasi a metà
        const parole = resto.match(/[A-Za-zÀ-ÿ]{2,}/g) || [];
        const tipoData = /\d/.test(resto) && parole.length <= 1 && (!parole[0] || parole[0].length <= 5);
        if (tr == null && parole.length && !tipoData) continue;
        return D[k] + ' ' + (tr || resto);
      }
    }
    return null;
  }
  // traduce un testo (null se non c'è traduzione)
  function trad(testo) {
    if (!D) prepara();
    if (lang === 'en' && testo === '0,00') return '0.00';
    if (testo.indexOf('\n') > 0 && testo.trim().indexOf('\n') > 0) { const righe = testo.split('\n'); const tr = righe.map(x => trad(x)); if (tr.some(x => x != null)) { const r2 = righe.map((x, i) => tr[i] != null ? tr[i] : x).join('\n'); cache.set(testo, r2); return r2; } }
    if (!testo || !/[A-Za-zÀ-ÿ]{2}/.test(testo)) return null;
    if (cache.has(testo)) return cache.get(testo);
    let r = null;
    const norm = testo.replace(/\s+/g, ' ');
    const tt = norm.trim();
    if (D[tt] != null) { r = norm.slice(0, norm.indexOf(tt)) + D[tt] + norm.slice(norm.indexOf(tt) + tt.length); cache.set(testo, r); return r; }
    const xb = base(tt);
    if (xb != null) { r = norm.slice(0, norm.indexOf(tt)) + xb + norm.slice(norm.indexOf(tt) + tt.length); cache.set(testo, r); return r; }
    const lead = (norm.match(LEAD) || [''])[0], trail = (norm.slice(lead.length).match(TRAIL) || [''])[0];
    const core = norm.slice(lead.length, norm.length - trail.length);
    if (core) {
      let x = base(core);
      if (x == null && /\s·\s/.test(core)) {
        // "Luce · mensile · Carta": tradotto pezzo per pezzo
        const pezzi = core.split(' · '); let cambiato = false;
        const t2 = pezzi.map(p => { const y = base(p.trim()); if (y != null) { cambiato = true; return y; } return p; });
        if (cambiato) x = t2.join(' · ');
      }
      if (x != null) r = lead + x + trail;
    }
    if (cache.size > 5000) cache.clear();
    if (!inPref || r != null) cache.set(testo, r);
    return r;
  }
  I.t = s => trad(String(s)) || s;
  I.tf = (s, v) => fill(I.t(s), v);

  // ---------- traduzione della pagina ----------
  const ATTR = ['placeholder', 'title', 'aria-label', 'alt'];
  const SALTA = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };
  const fatti = new WeakMap();
  function nodoTesto(n) {
    const p = n.parentNode; if (!p || SALTA[p.nodeName] || (p.closest && p.closest('[data-notr]'))) return;
    const v = n.nodeValue; if (fatti.get(n) === v) return;
    const r = trad(v);
    if (r != null && r !== v) n.nodeValue = r;
    fatti.set(n, n.nodeValue);
  }
  function elemento(el) {
    if (el.nodeType !== 1 || SALTA[el.nodeName] || el.hasAttribute('data-notr')) return;
    for (const a of ATTR) { if (el.hasAttribute(a)) { const v = el.getAttribute(a), r = trad(v); if (r != null && r !== v) el.setAttribute(a, r); } }
    if (el.nodeName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) { const r = trad(el.value); if (r) el.value = r; }
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: x => (x.nodeType === 1 && (SALTA[x.nodeName] || x.hasAttribute('data-notr'))) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let x; while ((x = w.nextNode())) {
      if (x.nodeType === 3) nodoTesto(x);
      else for (const a of ATTR) if (x.hasAttribute(a)) { const v = x.getAttribute(a), r = trad(v); if (r != null && r !== v) x.setAttribute(a, r); }
    }
  }
  I.apply = root => elemento(root || document.body);
  function avvia() {
    prepara();
    document.title = I.t(document.title);
    elemento(document.body);
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') nodoTesto(m.target);
        else if (m.type === 'attributes') { const el = m.target, v = el.getAttribute(m.attributeName); if (v) { const r = trad(v); if (r != null && r !== v) el.setAttribute(m.attributeName, r); } }
        else m.addedNodes.forEach(n => (n.nodeType === 3 ? nodoTesto(n) : elemento(n)));
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia); else avvia();
  // finestre del sistema (conferme e richieste)
  const c0 = window.confirm.bind(window), p0 = window.prompt.bind(window), a0 = window.alert.bind(window);
  window.confirm = m => c0(I.t(m));
  window.prompt = (m, d) => p0(I.t(m), d);
  window.alert = m => a0(I.t(m));
})();
