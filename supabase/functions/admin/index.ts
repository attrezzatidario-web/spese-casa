// Spese Casa — funzione "admin" (Supabase Edge Function)
// Azioni del pannello di controllo che richiedono i permessi del server:
//   { azione: 'elimina_utente', user_id }  → elimina l'account, la sua casa (se è l'unico membro) e i file
// Solo chi è nella tabella app_admins può usarla. Da pubblicare con "Verify JWT" disattivato.
import { createClient } from 'npm:@supabase/supabase-js@2';

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
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u || !u.user) return json({ ok: false, error: 'Accedi di nuovo' }, 401);
    const { data: adm } = await sb.from('app_admins').select('user_id').eq('user_id', u.user.id).maybeSingle();
    if (!adm) return json({ ok: false, error: 'Accesso non autorizzato' }, 403);
    const body = await req.json().catch(() => ({}));

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
