// Spese Casa — funzione "abbonamenti" (Supabase Edge Function)
// Riceve le notifiche di RevenueCat (acquisti su App Store e Google Play)
// e aggiorna il piano della casa in household_plans.
// Nell'app l'utente di RevenueCat è l'id della casa: un abbonamento vale per tutti i membri.
// Segreti richiesti: REVENUECAT_WEBHOOK_AUTH (stesso valore impostato in RevenueCat → Webhook → Authorization header)
// Da pubblicare con "Verify JWT" disattivato.
import { createClient } from 'npm:@supabase/supabase-js@2';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTIVA = ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT'];
const FINE = ['EXPIRATION'];

export function esito(ev: any): { hh: string; plan?: 'premium' | 'free'; expires_at?: string | null; source?: string; product?: string } | null {
  if (!ev) return null;
  const ids = [ev.app_user_id, ev.original_app_user_id, ...(ev.aliases || [])].filter((x: string) => UUID.test(String(x || '')));
  if (!ids.length) return null;
  const hh = ids[0];
  const source = ev.store === 'APP_STORE' ? 'apple' : ev.store === 'PLAY_STORE' ? 'google' : String(ev.store || 'store').toLowerCase();
  if (ATTIVA.includes(ev.type)) {
    return { hh, plan: 'premium', expires_at: ev.expiration_at_ms ? new Date(Number(ev.expiration_at_ms)).toISOString() : null, source, product: ev.product_id || null };
  }
  if (FINE.includes(ev.type)) return { hh, plan: 'free', expires_at: null, source, product: ev.product_id || null };
  return { hh }; // CANCELLATION, BILLING_ISSUE…: resta attivo fino alla scadenza
}

if (import.meta.main) Deno.serve(async req => {
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
  const atteso = Deno.env.get('REVENUECAT_WEBHOOK_AUTH');
  if (!atteso || req.headers.get('authorization') !== atteso) return json({ ok: false }, 401);
  let body: any; try { body = await req.json(); } catch { return json({ ok: false, error: 'json' }, 400); }
  const r = esito(body && body.event);
  if (!r) return json({ ok: true, ignorato: true });
  if (!r.plan) return json({ ok: true, invariato: true });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  // le case Premium "manuali" (es. il proprietario dell'app) non vengono toccate
  const { data: cur } = await sb.from('household_plans').select('source').eq('household_id', r.hh).maybeSingle();
  if (cur && cur.source === 'manual') return json({ ok: true, manuale: true });
  const { error } = await sb.from('household_plans').upsert({ household_id: r.hh, plan: r.plan, source: r.source, product: r.product, expires_at: r.expires_at, updated_at: new Date().toISOString() }, { onConflict: 'household_id' });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, ...r });
});
