// Spese Casa — funzione "admin" (Supabase Edge Function)
// Azioni del pannello di controllo che richiedono i permessi del server:
//   { azione: 'elimina_utente', user_id }  → elimina l'account, la sua casa (se è l'unico membro) e i file
//   { azione: 'prova_avvisi' }              → manda una notifica di prova ai dispositivi del proprietario
//   { azione: 'nuovi_iscritti' }            → chiamata dal database a ogni nuovo account: avvisa il proprietario
// Solo chi è nella tabella app_admins può usarla (tranne 'nuovi_iscritti', che svuota soltanto la coda
// degli avvisi già scritta dal database). Da pubblicare con "Verify JWT" disattivato.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC = 'BOmeNL_VFB4WwSPylaBuisV2pi0A-GsmoeJK2CgeLpZVQ_HczJIn5T0wgKijQlFQPCECjPKFCApTyqzkruYu28c';

type Nuovo = { user_id: string; email: string | null; totale: number | null; created_at: string };

// testo della notifica per uno o più nuovi iscritti
export function testoAvviso(lista: Nuovo[]) {
  const ultimo = lista[lista.length - 1];
  const tot = ultimo && ultimo.totale ? ultimo.totale : null;
  const coda = tot ? ' · ' + tot + (tot === 1 ? ' utente' : ' utenti') + ' in totale' : '';
  if (lista.length === 1) return { title: 'Nuovo iscritto', body: (ultimo.email || 'Nuovo account') + coda };
  return { title: lista.length + ' nuovi iscritti', body: lista.map(n => n.email || 'account').slice(-3).join(', ') + (lista.length > 3 ? '…' : '') + coda };
}

// invia a tutti i dispositivi del proprietario; toglie quelli non più validi
async function inviaAdmin(sb: any, msg: Record<string, unknown>) {
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!priv) throw new Error('Manca il segreto VAPID_PRIVATE_KEY');
  webpush.setVapidDetails('mailto:tettostudio.app@gmail.com', VAPID_PUBLIC, priv);
  const { data: subs } = await sb.from('admin_push').select('endpoint, sub');
  let ok = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(msg), { TTL: 86400, urgency: 'high' });
      ok++;
      await sb.from('admin_push').update({ last_ok: new Date().toISOString() }).eq('endpoint', s.endpoint);
    } catch (e: any) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from('admin_push').delete().eq('endpoint', s.endpoint);
    }
  }
  return { dispositivi: (subs || []).length, inviate: ok };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

if (import.meta.main) Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));

    // chiamata dal database: avvisa dei nuovi iscritti ancora in coda (al massimo quelli delle ultime 24 ore)
    if (body.azione === 'nuovi_iscritti') {
      const ieri = new Date(Date.now() - 86400000).toISOString();
      const { data: coda } = await sb.from('admin_nuovi').select('user_id, email, totale, created_at')
        .is('avvisato', null).gt('created_at', ieri).order('created_at').limit(50);
      if (!coda || !coda.length) return json({ ok: true, inviate: 0 });
      const ids = coda.map((n: Nuovo) => n.user_id);
      // segna come avvisati solo quelli non già presi da un'altra chiamata (niente doppioni)
      const { data: presi } = await sb.from('admin_nuovi').update({ avvisato: new Date().toISOString() })
        .in('user_id', ids).is('avvisato', null).select('user_id, email, totale, created_at');
      if (!presi || !presi.length) return json({ ok: true, inviate: 0 });
      presi.sort((a: Nuovo, b: Nuovo) => a.created_at.localeCompare(b.created_at));
      const t = testoAvviso(presi);
      const r = await inviaAdmin(sb, { ...t, url: 'pannello.html#utenti', tag: 'pn-iscritti', icon: 'pannello-192.png', badge: 'pannello-192.png' });
      return json({ ok: true, nuovi: presi.length, ...r });
    }

    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u || !u.user) return json({ ok: false, error: 'Accedi di nuovo' }, 401);
    const { data: adm } = await sb.from('app_admins').select('user_id').eq('user_id', u.user.id).maybeSingle();
    if (!adm) return json({ ok: false, error: 'Accesso non autorizzato' }, 403);

    if (body.azione === 'prova_avvisi') {
      const r = await inviaAdmin(sb, { title: 'Avvisi attivi', body: 'Da ora ti avviso qui ogni volta che si iscrive qualcuno.', url: 'pannello.html#utenti', tag: 'pn-prova', icon: 'pannello-192.png', badge: 'pannello-192.png' });
      return json({ ok: true, ...r });
    }

    if (body.azione === 'elimina_utente') {
      const uid = String(body.user_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(uid)) return json({ ok: false, error: 'Utente non valido' }, 400);
      if (uid === u.user.id) return json({ ok: false, error: 'Non puoi eliminare il tuo account da qui' }, 400);
      const { data: mem } = await sb.from('household_members').select('household_id').eq('user_id', uid);
      let file = 0;
      for (const m of mem || []) {
        const { count } = await sb.from('household_members').select('user_id', { count: 'exact', head: true }).eq('household_id', m.household_id);
        if ((count || 0) > 1) continue; // casa condivisa: restano i dati agli altri membri
        // file dell'archivio della casa
        const tutti: string[] = [];
        const giro = async (d: string) => {
          for (let off = 0; ; off += 100) {
            const { data } = await sb.storage.from('documenti').list(d, { limit: 100, offset: off });
            if (!data || !data.length) break;
            for (const it of data) { if (it.id) tutti.push(d + '/' + it.name); else await giro(d + '/' + it.name); }
            if (data.length < 100) break;
          }
        };
        await giro(m.household_id);
        for (let i = 0; i < tutti.length; i += 100) await sb.storage.from('documenti').remove(tutti.slice(i, i + 100));
        file += tutti.length;
        await sb.from('households').delete().eq('id', m.household_id);
      }
      const { error } = await sb.auth.admin.deleteUser(uid);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, file });
    }
    return json({ ok: false, error: 'Azione sconosciuta' }, 400);
  } catch (e: any) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
});
