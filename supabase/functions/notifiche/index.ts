// Spese Casa — funzione "notifiche" (Supabase Edge Function)
// Ogni ora (alle :05) controlla le case che hanno scelto questo orario e manda
// sul telefono i promemoria: affitto, bollette, spese fisse, auto (anche gomme), manutenzioni,
// documenti, cose da fare, budget, progetti, riepilogo del mese, 730, lista e
// promemoria per registrare le spese. Una sola notifica al giorno per dispositivo.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const TZ = 'Europe/Rome';
const VAPID_PUBLIC = 'BOmeNL_VFB4WwSPylaBuisV2pi0A-GsmoeJK2CgeLpZVQ_HczJIn5T0wgKijQlFQPCECjPKFCApTyqzkruYu28c';
const APP_URL = 'https://attrezzatidario-web.github.io/spese-casa/';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/* ---------------- date e formati ---------------- */
export function romeNow(d = new Date()) {
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
const D = (s: string) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12)); };
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const diffDays = (s: string, today: string) => Math.round((D(s).getTime() - D(today).getTime()) / 864e5);
const dm = (s: string) => String(s).slice(0, 10).split('-').reverse().slice(0, 2).join('/');
const eur = (v: unknown) => Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
const on = (v: unknown, def = true) => (v === undefined || v === null || v === '') ? def : (v === true || String(v).toUpperCase() === 'TRUE');

/* ---------------- calcolo dei promemoria (puro, testabile) ---------------- */
type Item = { titolo: string; dettaglio: string; importo?: number; key?: string };
// dati: { config, bollette, fisse, veicoli, manutenzioni, faccende, spese }
export function promemoria(dati: any, today: string): Item[] {
  const cfg = dati.config || {}, n = cfg.notifiche || {};
  const giorni = Math.max(0, n.giorniPrima != null && n.giorniPrima !== '' ? Number(n.giorniPrima) : 3);
  const avvisa = (dd: number) => dd === giorni || dd === 0 || dd === -1 || dd === -3 || dd === -7;
  const quando = (dd: number) => dd === 0 ? 'scade oggi' : dd > 0 ? 'tra ' + dd + (dd === 1 ? ' giorno' : ' giorni') : 'scaduto da ' + (-dd) + (dd === -1 ? ' giorno' : ' giorni');
  const spese: any[] = dati.spese || [];
  const items: Item[] = [];
  const P = dati.premium !== false; // funzioni Premium (auto, manutenzioni, progetti, avvisi avanzati)

  // affitto: mese corrente, precedente e prossimo, solo se non ancora pagato
  const a = cfg.affitto || {};
  if (n.affitto !== false && a.attivo && Number(a.giorno) > 0) {
    const t = D(today);
    [0, -1, 1].forEach(off => {
      const ref = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + off, 1, 12));
      const last = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0, 12)).getUTCDate();
      const due = ymdOf(new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), Math.min(Number(a.giorno), last), 12)));
      const mk = due.slice(0, 7);
      if (a.inizio && mk < String(a.inizio).slice(0, 7)) return;
      if (spese.some(s => s.bollettaId === 'affitto:' + mk)) return;
      const dd = diffDays(due, today);
      if (avvisa(dd)) items.push({ titolo: 'Affitto ' + mk.slice(5) + '/' + mk.slice(0, 4), dettaglio: quando(dd) + ' (' + dm(due) + ')', importo: Number(a.canone) || 0 });
    });
  }
  if (n.bollette !== false) {
    (dati.bollette || []).filter((b: any) => on(b.attiva) && b.scadenza).forEach((b: any) => {
      const dd = diffDays(b.scadenza, today);
      if (avvisa(dd)) items.push({ titolo: b.nome, dettaglio: quando(dd) + ' (' + dm(b.scadenza) + ')', importo: Number(b.importo) || 0 });
    });
  }
  if (n.fisse !== false) {
    (dati.fisse || []).filter((f: any) => on(f.attiva) && on(f.notifica) && f.prossima).forEach((f: any) => {
      const dd = diffDays(f.prossima, today);
      if (on(f.auto, false)) { if (dd === giorni || dd === 0) items.push({ titolo: f.nome, dettaglio: 'addebito automatico ' + (dd === 0 ? 'oggi' : 'tra ' + dd + (dd === 1 ? ' giorno' : ' giorni')), importo: Number(f.importo) || 0 }); }
      else if (avvisa(dd)) items.push({ titolo: f.nome, dettaglio: quando(dd) + ' (' + dm(f.prossima) + ')', importo: Number(f.importo) || 0 });
    });
  }
  if (P && n.auto !== false) {
    (dati.veicoli || []).filter((v: any) => on(v.attiva)).forEach((v: any) => {
      const nome = v.nome + (v.targa ? ' (' + v.targa + ')' : '');
      [['Assicurazione', v.scadAssicurazione, v.impAssicurazione], ['Bollo', v.scadBollo, v.impBollo], ['Revisione', v.scadRevisione, 0], ['Tagliando', v.scadTagliando, 0]]
        .forEach(([t, s, imp]) => {
          if (!s) return;
          const dd = diffDays(String(s), today);
          if (avvisa(dd) || dd === 30 || dd === 15) items.push({ titolo: t + ' ' + nome, dettaglio: quando(dd) + ' (' + dm(String(s)) + ')', importo: Number(imp) || 0 });
        });
    });
  }
  if (P && n.manutenzioni !== false) {
    (dati.manutenzioni || []).filter((m: any) => on(m.attiva) && m.prossima).forEach((m: any) => {
      const dd = diffDays(m.prossima, today);
      if (avvisa(dd) || dd === 14) items.push({ titolo: 'Manutenzione: ' + m.nome, dettaglio: quando(dd) + ' (' + dm(m.prossima) + ')', importo: Number(m.costo) || 0 });
    });
  }
  if (n.faccende !== false) (dati.faccende || []).filter((f: any) => !on(f.fatto, false) && f.scadenza).forEach((f: any) => {
    const dd = diffDays(f.scadenza, today);
    if (dd === 1 || dd === 0 || dd === -1 || dd === -3) items.push({ titolo: 'Da fare: ' + f.titolo, dettaglio: dd === 1 ? 'domani' : dd === 0 ? 'oggi' : 'in ritardo di ' + (-dd) + (dd === -1 ? ' giorno' : ' giorni') });
  });

  // budget del mese (una volta al mese, grazie alla chiave)
  const mese = today.slice(0, 7), b = cfg.budget || {}, lim = Number(b.limite) || 0;
  const delMese = spese.filter(s => String(s.data).slice(0, 7) === mese);
  const budOn = n.budget !== false;
  if (budOn && lim && b.email !== false) {
    const tot = delMese.filter(s => !(b.escludiAffitto && String(s.bollettaId || '').startsWith('affitto:'))).reduce((x, s) => x + (Number(s.importo) || 0), 0);
    if (tot > lim) items.push({ titolo: 'Limite di spesa superato', dettaglio: 'speso ' + eur(tot) + ' su ' + eur(lim), key: 'budget:' + mese });
    else if (P && tot >= lim * 0.8) items.push({ titolo: 'Limite di spesa quasi raggiunto', dettaglio: 'speso ' + eur(tot) + ' su ' + eur(lim) + ' (' + Math.round(tot / lim * 100) + '%)', key: 'budget80:' + mese });
  }
  const bc = cfg.budgetCat || {}, limiti = bc.limiti || {};
  if (P && budOn && bc.email !== false) Object.keys(limiti).forEach(c => {
    const l = Number(limiti[c]) || 0; if (!l) return;
    const t = delMese.filter(s => s.categoria === c).reduce((x, s) => x + (Number(s.importo) || 0), 0);
    if (t > l) items.push({ titolo: 'Budget superato: ' + c, dettaglio: 'speso ' + eur(t) + ' su ' + eur(l), key: 'cat:' + mese + ':' + c });
  });

  // documenti e garanzie in scadenza
  if (n.documenti !== false) {
    (dati.documenti || []).filter((d: any) => d.scadenza).forEach((d: any) => {
      const dd = diffDays(d.scadenza, today);
      if (dd === 30 || dd === 7 || dd === 1 || dd === 0) items.push({ titolo: (d.tipo === 'Garanzie' ? 'Garanzia: ' : 'Scadenza: ') + (d.nome || 'documento'), dettaglio: quando(dd) + ' (' + dm(d.scadenza) + ')' });
    });
  }
  // cambio gomme (obbligo invernale dal 15 novembre al 15 aprile)
  if (P && n.auto !== false && (dati.veicoli || []).some((v: any) => on(v.attiva))) {
    const md = today.slice(5);
    if (md === '11-05') items.push({ titolo: 'Gomme invernali', dettaglio: 'dal 15 novembre servono gomme invernali o catene a bordo' });
    if (md === '04-05') items.push({ titolo: 'Gomme estive', dettaglio: 'dal 15 aprile puoi rimontare le estive (entro il 15 maggio)' });
  }
  // budget dei progetti
  if (P && n.progetti !== false) {
    const sp: any[] = dati.speseProgetti || [];
    (dati.progetti || []).filter((p: any) => Number(p.budget) > 0 && (p.attivo === '' || p.attivo == null || on(p.attivo))).forEach((p: any) => {
      const tot = sp.filter(s => s.progetto === p.id).reduce((x, s) => x + (Number(s.importo) || 0), 0), l = Number(p.budget);
      if (tot > l) items.push({ titolo: 'Progetto oltre il budget: ' + p.nome, dettaglio: 'speso ' + eur(tot) + ' su ' + eur(l), key: 'prj:' + p.id + ':' + Math.floor(tot / l * 10) });
    });
  }
  // riepilogo del mese appena chiuso (il primo del mese)
  if (P && n.riepilogo !== false && today.slice(8) === '01') {
    const t = D(today), ym = (k: number) => ymdOf(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + k, 1, 12))).slice(0, 7);
    const m1 = ym(-1), m2 = ym(-2), totM = (m: string) => spese.filter(s => String(s.data).slice(0, 7) === m).reduce((x, s) => x + (Number(s.importo) || 0), 0);
    const a1 = totM(m1), a2 = totM(m2);
    if (a1 > 0) {
      const cat: Record<string, number> = {};
      spese.filter(s => String(s.data).slice(0, 7) === m1).forEach(s => { cat[s.categoria || 'Altro'] = (cat[s.categoria || 'Altro'] || 0) + (Number(s.importo) || 0); });
      const top = Object.entries(cat).sort((x, y) => y[1] - x[1])[0];
      const diff = a2 ? Math.round((a1 - a2) / a2 * 100) : 0;
      items.push({ titolo: 'Mese chiuso: ' + eur(a1), dettaglio: (a2 ? (diff > 0 ? '+' : '') + diff + '% rispetto al mese prima · ' : '') + 'più spesa: ' + top[0] + ' (' + eur(top[1]) + ')', key: 'mese:' + m1 });
    }
  }
  // 730: spese detraibili dell'anno scorso (2 maggio)
  if (P && n.detrazioni !== false && today.slice(5) === '05-02') {
    const d730: any[] = dati.spese730 || [];
    const tot = d730.reduce((x, s) => x + (Number(s.importo) || 0), 0);
    if (tot > 0) items.push({ titolo: 'Dichiarazione 730', dettaglio: d730.length + ' spese detraibili nel ' + (Number(today.slice(0, 4)) - 1) + ' per ' + eur(tot) + ': trovi il riepilogo in Altro → Riepilogo 730' });
  }
  // lista della spesa (sabato mattina)
  if (P && n.lista === true && D(today).getUTCDay() === 6) {
    const aperti = (dati.lista || []).filter((x: any) => !on(x.fatto, false));
    if (aperti.length) items.push({ titolo: 'Lista della spesa: ' + aperti.length + (aperti.length === 1 ? ' prodotto' : ' prodotti'), dettaglio: aperti.slice(0, 4).map((x: any) => x.nome).join(', ') + (aperti.length > 4 ? '…' : '') });
  }
  // nessuna spesa registrata da 3 giorni
  if (P && n.registra === true && spese.length) {
    const ultima = spese.map(s => String(s.data).slice(0, 10)).sort().pop() as string;
    const dd = diffDays(ultima, today);
    if (dd === -3 || dd === -7) items.push({ titolo: 'Spese da registrare?', dettaglio: 'nessuna spesa da ' + (-dd) + ' giorni: aggiungi gli scontrini rimasti in tasca' });
  }
  return items;
}

export function messaggio(items: Item[]) {
  const riga = (i: Item) => i.titolo + (i.importo ? ' · ' + eur(i.importo) : '') + ' — ' + i.dettaglio;
  if (items.length === 1) return { title: items[0].titolo + (items[0].importo ? ' · ' + eur(items[0].importo) : ''), body: items[0].dettaglio };
  const max = 5;
  return {
    title: 'Spese Casa · ' + items.length + ' promemoria',
    body: items.slice(0, max).map(riga).join('\n') + (items.length > max ? '\n…e altri ' + (items.length - max) : '')
  };
}

/* ---------------- resoconto IA ---------------- */
// dati riassunti per l'IA (come il "buongiorno" della versione precedente, più entrate e saldo)
export function resocontoDati(dati: any, today: string) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const cfg = dati.config || {}, b = cfg.budget || {}, mese = today.slice(0, 7);
  const t = D(today), ieri = ymdOf(new Date(t.getTime() - 864e5)), lim7 = ymdOf(new Date(t.getTime() + 7 * 864e5));
  const pers: Record<string, string> = {}; (dati.persone || []).forEach((p: any) => pers[p.id] = p.nome);
  const spese: any[] = dati.spese || [], sMese = spese.filter(s => String(s.data).slice(0, 7) === mese);
  const prevMese = ymdOf(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1, 12))).slice(0, 7);
  const giorniMese = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0, 12)).getUTCDate(), g = t.getUTCDate();
  const totM = sMese.filter(s => !(b.escludiAffitto && String(s.bollettaId || '').startsWith('affitto:'))).reduce((a, s) => a + (Number(s.importo) || 0), 0);
  const totPrev = spese.filter(s => String(s.data).slice(0, 7) === prevMese && String(s.data).slice(8, 10) <= today.slice(8, 10)).reduce((a, s) => a + (Number(s.importo) || 0), 0);
  const entrateM = (dati.entrate || []).filter((e: any) => String(e.data).slice(0, 7) === mese).reduce((a: number, e: any) => a + (Number(e.importo) || 0), 0);
  const perCat: Record<string, number> = {}; sMese.forEach(s => perCat[s.categoria] = r2((perCat[s.categoria] || 0) + (Number(s.importo) || 0)));
  const perNeg: Record<string, [number, number]> = {}; sMese.forEach(s => { const n = String(s.descrizione || '').trim(); if (!n) return; const o = perNeg[n] = perNeg[n] || [0, 0]; o[0] += Number(s.importo) || 0; o[1]++; });
  const scad: any[] = [];
  const dd = (s: string) => diffDays(s, today);
  (dati.bollette || []).filter((x: any) => on(x.attiva) && x.scadenza && String(x.scadenza) <= lim7).forEach((x: any) => scad.push({ cosa: x.nome, data: String(x.scadenza), tra_giorni: dd(x.scadenza), importo: Number(x.importo) || 0 }));
  (dati.fisse || []).filter((f: any) => on(f.attiva) && f.prossima && String(f.prossima) <= lim7).forEach((f: any) => scad.push({ cosa: f.nome + (on(f.auto, false) ? ' (addebito automatico)' : ''), data: String(f.prossima), tra_giorni: dd(f.prossima), importo: Number(f.importo) || 0 }));
  (dati.manutenzioni || []).filter((m: any) => on(m.attiva) && m.prossima && String(m.prossima) <= lim7).forEach((m: any) => scad.push({ cosa: 'Manutenzione: ' + m.nome, data: String(m.prossima), tra_giorni: dd(m.prossima), importo: Number(m.costo) || 0 }));
  const a = cfg.affitto || {};
  if (a.attivo && Number(a.giorno)) {
    const due = ymdOf(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(Number(a.giorno), giorniMese), 12)));
    if (!spese.some(s => s.bollettaId === 'affitto:' + mese) && due <= lim7) scad.push({ cosa: 'Affitto', data: due, tra_giorni: dd(due), importo: Number(a.canone) || 0 });
  }
  scad.sort((x, y) => x.data.localeCompare(y.data));
  const lims = (cfg.budgetCat || {}).limiti || {}, budCat: any[] = [];
  Object.keys(lims).forEach(c => { const l = Number(lims[c]) || 0; if (!l) return; const tt = sMese.filter(s => s.categoria === c).reduce((x, s) => x + (Number(s.importo) || 0), 0); if (tt >= l * 0.8) budCat.push({ categoria: c, speso: r2(tt), limite: l }); });
  return {
    giorno: ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'][t.getUTCDay()] + ' ' + today.split('-').reverse().join('/'),
    speseDiIeri: spese.filter(s => String(s.data) === ieri).map(s => ({ cosa: s.descrizione || s.categoria, importo: Number(s.importo), chi: pers[s.personaId] || '' })),
    mese: { speso: r2(totM), stessoPeriodoMeseScorso: r2(totPrev), entrate: r2(entrateM), saldo: r2(entrateM - totM), limite: Number(b.limite) || null, giornoDelMese: g, giorniNelMese: giorniMese, proiezioneFineMese: g ? r2(totM / g * giorniMese) : null },
    categorieMese: perCat,
    negoziMese: Object.keys(perNeg).sort((x, y) => perNeg[y][0] - perNeg[x][0]).slice(0, 10).map(n => ({ negozio: n, totale: r2(perNeg[n][0]), volte: perNeg[n][1] })),
    scadenzeProssimi7Giorni: scad,
    budgetCategorieQuasiFiniti: budCat,
    speseFisseMensili: r2((dati.fisse || []).filter((f: any) => on(f.attiva)).reduce((x: number, f: any) => x + (Number(f.importo) || 0) / ({ settimanale: 0.25, mensile: 1, bimestrale: 2, trimestrale: 3, quadrimestrale: 4, semestrale: 6, annuale: 12 } as any)[f.frequenza || 'mensile'] || 0, 0)),
    coseDaFare: (dati.faccende || []).filter((f: any) => !on(f.fatto, false) && (!f.scadenza || String(f.scadenza) <= lim7)).map((f: any) => ({ cosa: f.titolo, chi: pers[f.personaId] || '', entro: f.scadenza || '' })),
    listaSpesa: (dati.lista || []).filter((x: any) => !on(x.fatto, false)).length
  };
}

const S = (type: string, extra?: any) => Object.assign({ type }, extra || {});
export function promptResoconto(d: any, settimanale: boolean) {
  return 'Sei il consulente di finanza familiare dell\'app Spese Casa, per una famiglia italiana. Oggi è ' + d.giorno + '. ' +
    'Scrivi il ' + (settimanale ? 'resoconto della settimana' : 'resoconto del mattino') + ' da mostrare nell\'app e in una notifica sul telefono.\n' +
    'REGOLE: tono professionale, caldo e concreto; niente markdown né asterischi; importi nel formato 1.234,56 €; usa SOLO i dati qui sotto, non inventare.\n' +
    'titolo: massimo 40 caratteri, il fatto più importante di oggi (es. "Mese sotto controllo: 1.240 € spesi"). ' +
    'anteprima: massimo 120 caratteri, una frase con il dato chiave e un consiglio, è il testo della notifica. ' +
    'testo: da 6 a 12 righe brevi, ognuna inizia con un\'emoji (📊 💶 📅 🟠 📝 🛒 💡): 1) andamento del mese (speso, rispetto allo stesso periodo del mese scorso, proiezione a fine mese, limite), 2) entrate e saldo del mese se ci sono, ' +
    '3) spese di ieri in una riga, 4) scadenze dei prossimi giorni con importi, 5) budget di categoria quasi finiti o superati, 6) cose da fare e lista della spesa se presenti. ' +
    'Chiudi con 2 consigli pratici di risparmio basati sui dati reali (righe che iniziano con 💡), riferiti a una categoria, un negozio o una spesa fissa precisa. Salta le sezioni vuote.\n' +
    'Dati (JSON): ' + JSON.stringify(d).slice(0, 40000);
}
const SCHEMA_RES = S('OBJECT', { properties: { titolo: S('STRING'), anteprima: S('STRING'), testo: S('STRING') }, required: ['titolo', 'anteprima', 'testo'] });

// modelli "Flash" disponibili per questa chiave, dal più recente (come fa l'app)
async function modelliFlash(key: string): Promise<string[]> {
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    const j: any = await r.json();
    const ver = (n: string) => { const m = n.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    return (j.models || [])
      .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m: any) => String(m.name).replace('models/', ''))
      .filter((n: string) => /flash/.test(n) && !/lite|image|tts|audio|live|thinking|exp|embed/.test(n))
      .sort((x: string, y: string) => (ver(y) - ver(x)) || (Number(/preview/.test(x)) - Number(/preview/.test(y))));
  } catch { return []; }
}

export async function gemini(key: string, prompt: string, schema: any) {
  const base = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const elenco = await modelliFlash(key);
  const modelli = ['gemini-flash-latest', ...elenco.filter(m => m !== 'gemini-flash-latest')].slice(0, 4);
  const think = [{ thinkingBudget: 0 }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null];
  let primoErrore = '';
  for (const model of modelli) {
    let ti = 0;
    for (let tent = 0; tent < 6; tent++) {
      const gc: any = { temperature: 0.4, responseMimeType: 'application/json', responseSchema: schema };
      if (think[ti]) gc.thinkingConfig = think[ti];
      const r = await fetch(base + model + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gc }) });
      const j: any = await r.json().catch(() => ({}));
      if (r.ok) {
        const txt = ((((j.candidates || [])[0] || {}).content || {}).parts || []).filter((x: any) => x.text && !x.thought).map((x: any) => x.text).join('');
        if (!txt) { primoErrore = primoErrore || 'risposta vuota'; break; }
        return JSON.parse(txt);
      }
      const msg = (j.error && j.error.message) || ('Errore ' + r.status);
      if (r.status === 400 && /think/i.test(msg) && ti < think.length - 1) { ti++; continue; }
      if (r.status === 401 || (r.status === 400 && /API key|API_KEY|credential/i.test(msg))) throw new Error('Google rifiuta la chiave IA della casa');
      if (r.status === 429) throw new Error('Limite gratuito IA raggiunto, riprova tra qualche minuto');
      if (r.status === 503 || r.status === 500) { await new Promise(res => setTimeout(res, 2000 * (tent + 1))); if (tent < 2) continue; }
      primoErrore = primoErrore || (model + ': ' + msg);
      break; // provo il modello successivo
    }
  }
  throw new Error('IA non disponibile (' + (primoErrore || 'nessun modello') + ')');
}

export async function resoconto(sb: any, hh: string, subs: any[], dati: any, today: string, forza: boolean) {
  const key0 = 'res:' + today;
  if (!forza && subs.length && await giaInviato(sb, subs[0].id, key0)) return { saltato: 'già inviato' };
  const { data: keys } = await sb.from('ai_keys').select('key').eq('household_id', hh).order('updated_at', { ascending: false }).limit(1);
  if (!keys || !keys.length) return { saltato: 'nessuna chiave IA' };
  const rs = (dati.config.notifiche || {}).resoconto || {};
  const r = await gemini(keys[0].key, promptResoconto(resocontoDati(dati, today), rs.freq === 'settimanale'), SCHEMA_RES);
  const row = { id: today, data: today, titolo: String(r.titolo || '').slice(0, 80), anteprima: String(r.anteprima || '').slice(0, 200), testo: String(r.testo || ''), creato: new Date().toISOString() };
  await sb.from('records').upsert({ household_id: hh, sheet: 'Resoconti', id: today, data: row }, { onConflict: 'household_id,sheet,id' });
  const esiti = [];
  for (const sub of subs) {
    const e = await invia(sb, sub, { title: row.titolo || 'Il tuo resoconto', body: row.anteprima, url: APP_URL + '#home', tag: 'spese-casa-resoconto' });
    esiti.push(e);
    if (e === 'ok' && !forza) await segna(sb, sub.id, key0);
  }
  return { titolo: row.titolo, inviate: esiti };
}

/* ---------------- server ---------------- */
async function caricaCasa(sb: any, hh: string, today: string) {
  const fogli = ['Config', 'Bollette', 'Fisse', 'Veicoli', 'Manutenzioni', 'Faccende', 'Lista', 'Persone', 'Documenti', 'Progetti'];
  const out: any = { config: {}, bollette: [], fisse: [], veicoli: [], manutenzioni: [], faccende: [], lista: [], persone: [], documenti: [], progetti: [], spese: [], entrate: [], speseProgetti: [], spese730: [] };
  const map: Record<string, string> = { Bollette: 'bollette', Fisse: 'fisse', Veicoli: 'veicoli', Manutenzioni: 'manutenzioni', Faccende: 'faccende', Lista: 'lista', Persone: 'persone', Documenti: 'documenti', Progetti: 'progetti' };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('records').select('sheet,id,data').eq('household_id', hh).in('sheet', fogli).range(from, from + 999);
    if (error) throw error;
    data.forEach((r: any) => {
      if (r.sheet === 'Config') { try { out.config[r.id] = JSON.parse(r.data.valore); } catch { out.config[r.id] = r.data.valore; } }
      else out[map[r.sheet]].push(r.data);
    });
    if (data.length < 1000) break;
  }
  // spese dal primo giorno di due mesi fa (affitto pagato, budget, riepilogo del mese)
  const t = D(today), da = ymdOf(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 2, 1, 12)));
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('records').select('data').eq('household_id', hh).eq('sheet', 'Spese').gte('data->>data', da).range(from, from + 999);
    if (error) throw error;
    data.forEach((r: any) => out.spese.push(r.data));
    if (data.length < 1000) break;
  }
  // spese collegate ai progetti con un budget
  if (out.progetti.some((p: any) => Number(p.budget) > 0)) {
    const { data, error } = await sb.from('records').select('data').eq('household_id', hh).eq('sheet', 'Spese').neq('data->>progetto', '').limit(5000);
    if (!error) data.forEach((r: any) => out.speseProgetti.push(r.data));
  }
  // spese detraibili dell'anno scorso (solo il 2 maggio)
  if (today.slice(5) === '05-02') {
    const y = Number(today.slice(0, 4)) - 1;
    const { data, error } = await sb.from('records').select('data').eq('household_id', hh).eq('sheet', 'Spese').gte('data->>data', y + '-01-01').lte('data->>data', y + '-12-31').neq('data->>detrazione', '').neq('data->>detrazione', 'no').limit(5000);
    if (!error) data.forEach((r: any) => out.spese730.push(r.data));
  }
  {
    const { data, error } = await sb.from('records').select('data').eq('household_id', hh).eq('sheet', 'Entrate').gte('data->>data', da).limit(1000);
    if (error) throw error;
    data.forEach((r: any) => out.entrate.push(r.data));
  }
  {
    const { data, error } = await sb.from('household_plans').select('plan,expires_at').eq('household_id', hh).maybeSingle();
    // se la tabella dei piani non c'è ancora, nessuno perde funzioni
    out.premium = error ? true : !!(data && data.plan === 'premium' && (!data.expires_at || new Date(data.expires_at).getTime() > Date.now()));
  }
  return out;
}

async function invia(sb: any, sub: any, payload: unknown) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'normal' });
    await sb.from('push_subscriptions').update({ last_ok: new Date().toISOString() }).eq('id', sub.id);
    return 'ok';
  } catch (e: any) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) { await sb.from('push_subscriptions').delete().eq('id', sub.id); return 'scaduta'; }
    return 'errore ' + (e && (e.statusCode || e.message));
  }
}
const giaInviato = async (sb: any, subId: string, key: string) => {
  const { data } = await sb.from('notif_log').select('key').eq('sub_id', subId).eq('key', key).limit(1);
  return !!(data && data.length);
};
const segna = (sb: any, subId: string, key: string) => sb.from('notif_log').insert({ sub_id: subId, key });

async function gestisciCasa(sb: any, hh: string, subs: any[], today: string, forza: boolean) {
  const dati = await caricaCasa(sb, hh, today);
  const n = dati.config.notifiche || {}, rs = n.resoconto || {}, ora = romeNow().hour;
  const out: any = { hh };
  // resoconto IA (ogni mattina, oppure il lunedì)
  if (dati.premium && rs.attivo && ora === Math.min(23, Math.max(0, Number(rs.ora ?? 8))) && (rs.freq !== 'settimanale' || D(today).getUTCDay() === 1)) {
    try { out.resoconto = await resoconto(sb, hh, subs, dati, today, false); } catch (e: any) { out.resoconto = { errore: String(e && e.message || e) }; }
  }
  if (!forza && ora !== Math.min(23, Math.max(0, Number(n.ora ?? 9)))) return out;
  const tutti = promemoria(dati, today);
  const res: any[] = [];
  for (const sub of subs) {
    const dailyKey = 'daily:' + today;
    if (!forza && await giaInviato(sb, sub.id, dailyKey)) continue;
    // i budget superati si avvisano una volta sola al mese
    const items: Item[] = [];
    for (const i of tutti) { if (!i.key || forza || !(await giaInviato(sb, sub.id, i.key))) items.push(i); }
    if (!items.length) { if (!forza) await segna(sb, sub.id, dailyKey); continue; }
    const m = messaggio(items);
    const esito = await invia(sb, sub, { ...m, url: APP_URL + (items.length === 1 && items[0].titolo.startsWith('Lista') ? '#lista' : '#home'), tag: 'spese-casa-' + today });
    res.push(esito);
    if (esito === 'ok' && !forza) { await segna(sb, sub.id, dailyKey); for (const i of items) if (i.key) await segna(sb, sub.id, i.key); }
  }
  return { ...out, promemoria: tutti.length, inviate: res };
}

if (import.meta.main) Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
  try {
    const priv = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!priv) return json({ ok: false, error: 'Manca il segreto VAPID_PRIVATE_KEY' }, 500);
    webpush.setVapidDetails('mailto:attrezzatidario@gmail.com', VAPID_PUBLIC, priv);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const today = romeNow().ymd;

    // prova dall'app: solo per il dispositivo di chi è collegato
    if (body.test) {
      const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: u } = await sb.auth.getUser(jwt);
      if (!u || !u.user) return json({ ok: false, error: 'Accedi di nuovo' }, 401);
      const { data: subs } = await sb.from('push_subscriptions').select('*').eq('user_id', u.user.id).eq('endpoint', String(body.endpoint || ''));
      if (!subs || !subs.length) return json({ ok: false, error: 'Questo dispositivo non è iscritto alle notifiche' }, 404);
      const sub = subs[0];
      const items = promemoria(await caricaCasa(sb, sub.household_id, today), today);
      const m = items.length ? messaggio(items) : { title: 'Notifiche attive ✅', body: 'Da domani ti avviso qui quando qualcosa sta per scadere.' };
      const esito = await invia(sb, sub, { ...m, url: APP_URL, tag: 'spese-casa-prova' });
      return json({ ok: esito === 'ok', esito, promemoria: items.length });
    }

    // resoconto IA adesso (pulsante "Prova adesso" nell'app)
    if (body.resoconto) {
      const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: u } = await sb.auth.getUser(jwt);
      if (!u || !u.user) return json({ ok: false, error: 'Accedi di nuovo' }, 401);
      const { data: mem } = await sb.from('household_members').select('household_id').eq('user_id', u.user.id).order('created_at').limit(1);
      if (!mem || !mem.length) return json({ ok: false, error: 'Casa non trovata' }, 404);
      const hh = mem[0].household_id;
      const { data: subs } = await sb.from('push_subscriptions').select('*').eq('household_id', hh);
      const datiC = await caricaCasa(sb, hh, today);
      if (!datiC.premium) return json({ ok: false, error: 'Il Resoconto IA è una funzione Premium' });
      const r = await resoconto(sb, hh, subs || [], datiC, today, true);
      if (r.saltato) return json({ ok: false, error: r.saltato === 'nessuna chiave IA' ? 'Attiva prima il resoconto con la tua chiave IA' : r.saltato });
      return json({ ok: true, ...r });
    }

    // giro orario (pianificato)
    const { data: subs, error } = await sb.from('push_subscriptions').select('*');
    if (error) throw error;
    const perCasa: Record<string, any[]> = {};
    (subs || []).forEach((s: any) => (perCasa[s.household_id] = perCasa[s.household_id] || []).push(s));
    const out = [];
    for (const hh of Object.keys(perCasa)) { try { out.push(await gestisciCasa(sb, hh, perCasa[hh], today, false)); } catch (e: any) { out.push({ hh, errore: String(e && e.message || e) }); } }
    // pulizia del registro più vecchio di 60 giorni
    await sb.from('notif_log').delete().lt('created_at', new Date(Date.now() - 60 * 864e5).toISOString());
    return json({ ok: true, ora: romeNow(), case: out.length, dettaglio: out });
  } catch (e: any) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
});
