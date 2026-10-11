// Spese Casa — funzione "notifiche" (Supabase Edge Function)
// Ogni ora (alle :05) controlla le case che hanno scelto questo orario e manda
// sul telefono i promemoria: affitto, bollette, spese fisse, auto, manutenzioni,
// cose da fare e budget superato. Una sola notifica al giorno per dispositivo.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const TZ = 'Europe/Rome';
const VAPID_PUBLIC = 'BOmeNL_VFB4WwSPylaBuisV2pi0A-GsmoeJK2CgeLpZVQ_HczJIn5T0wgKijQlFQPCECjPKFCApTyqzkruYu28c';
const APP_URL = 'https://attrezzatidario-web.github.io/spese-casa/v2/';
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

  // affitto: mese corrente, precedente e prossimo, solo se non ancora pagato
  const a = cfg.affitto || {};
  if (a.attivo && Number(a.giorno) > 0) {
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
  if (n.auto !== false) {
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
  if (n.manutenzioni !== false) {
    (dati.manutenzioni || []).filter((m: any) => on(m.attiva) && m.prossima).forEach((m: any) => {
      const dd = diffDays(m.prossima, today);
      if (avvisa(dd) || dd === 14) items.push({ titolo: 'Manutenzione: ' + m.nome, dettaglio: quando(dd) + ' (' + dm(m.prossima) + ')', importo: Number(m.costo) || 0 });
    });
  }
  (dati.faccende || []).filter((f: any) => !on(f.fatto, false) && f.scadenza).forEach((f: any) => {
    const dd = diffDays(f.scadenza, today);
    if (dd === 1 || dd === 0 || dd === -1 || dd === -3) items.push({ titolo: 'Da fare: ' + f.titolo, dettaglio: dd === 1 ? 'domani' : dd === 0 ? 'oggi' : 'in ritardo di ' + (-dd) + (dd === -1 ? ' giorno' : ' giorni') });
  });

  // budget del mese (una volta al mese, grazie alla chiave)
  const mese = today.slice(0, 7), b = cfg.budget || {}, lim = Number(b.limite) || 0;
  const delMese = spese.filter(s => String(s.data).slice(0, 7) === mese);
  if (lim && b.email !== false) {
    const tot = delMese.filter(s => !(b.escludiAffitto && String(s.bollettaId || '').startsWith('affitto:'))).reduce((x, s) => x + (Number(s.importo) || 0), 0);
    if (tot > lim) items.push({ titolo: 'Limite di spesa superato', dettaglio: 'speso ' + eur(tot) + ' su ' + eur(lim), key: 'budget:' + mese });
  }
  const bc = cfg.budgetCat || {}, limiti = bc.limiti || {};
  if (bc.email !== false) Object.keys(limiti).forEach(c => {
    const l = Number(limiti[c]) || 0; if (!l) return;
    const t = delMese.filter(s => s.categoria === c).reduce((x, s) => x + (Number(s.importo) || 0), 0);
    if (t > l) items.push({ titolo: 'Budget superato: ' + c, dettaglio: 'speso ' + eur(t) + ' su ' + eur(l), key: 'cat:' + mese + ':' + c });
  });
  return items;
}

export function messaggio(items: Item[]) {
  const riga = (i: Item) => i.titolo + (i.importo ? ' · ' + eur(i.importo) : '') + ' — ' + i.dettaglio;
  if (items.length === 1) return { title: items[0].titolo + (items[0].importo ? ' · ' + eur(items[0].importo) : ''), body: items[0].dettaglio };
  const max = 4;
  return {
    title: 'Spese Casa · ' + items.length + ' promemoria',
    body: items.slice(0, max).map(riga).join('\n') + (items.length > max ? '\n…e altri ' + (items.length - max) : '')
  };
}

/* ---------------- server ---------------- */
async function caricaCasa(sb: any, hh: string, today: string) {
  const fogli = ['Config', 'Bollette', 'Fisse', 'Veicoli', 'Manutenzioni', 'Faccende'];
  const out: any = { config: {}, bollette: [], fisse: [], veicoli: [], manutenzioni: [], faccende: [], spese: [] };
  const map: Record<string, string> = { Bollette: 'bollette', Fisse: 'fisse', Veicoli: 'veicoli', Manutenzioni: 'manutenzioni', Faccende: 'faccende' };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('records').select('sheet,id,data').eq('household_id', hh).in('sheet', fogli).range(from, from + 999);
    if (error) throw error;
    data.forEach((r: any) => {
      if (r.sheet === 'Config') { try { out.config[r.id] = JSON.parse(r.data.valore); } catch { out.config[r.id] = r.data.valore; } }
      else out[map[r.sheet]].push(r.data);
    });
    if (data.length < 1000) break;
  }
  // spese dal primo giorno del mese scorso (affitto pagato e budget)
  const t = D(today), da = ymdOf(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1, 12)));
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('records').select('data').eq('household_id', hh).eq('sheet', 'Spese').gte('data->>data', da).range(from, from + 999);
    if (error) throw error;
    data.forEach((r: any) => out.spese.push(r.data));
    if (data.length < 1000) break;
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
  const ora = Math.min(23, Math.max(0, Number((dati.config.notifiche || {}).ora ?? 9)));
  if (!forza && romeNow().hour !== ora) return { hh, saltata: true };
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
    const esito = await invia(sb, sub, { ...m, url: APP_URL + '#bollette', tag: 'spese-casa-' + today });
    res.push(esito);
    if (esito === 'ok' && !forza) { await segna(sb, sub.id, dailyKey); for (const i of items) if (i.key) await segna(sb, sub.id, i.key); }
  }
  return { hh, promemoria: tutti.length, inviate: res };
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
